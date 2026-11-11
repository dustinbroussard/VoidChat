import { GoogleGenAI } from "@google/genai";
import {
  checkRateLimit,
  validateChatRequest,
  validateAccessProtection,
} from "./_lib/security.js";
import { getOpenRouterHeaders, getAppUrl } from "./_lib/openrouter.js";

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 1. Content-Type check
  const contentType = req.headers?.["content-type"] || "";
  if (!contentType.includes("application/json")) {
    return res.status(415).json({ error: "Unsupported Media Type. Content-Type must be application/json." });
  }

  // 2. Access Protection
  const authCheck = validateAccessProtection(req);
  if (!authCheck.authorized) {
    return res.status(401).json({ error: "Unauthorized: " + authCheck.reason });
  }

  // 3. Rate Limiting
  const clientIp = req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  const ipStr = Array.isArray(clientIp) ? clientIp[0] : String(clientIp).split(",")[0].trim();
  const rateCheck = checkRateLimit(`chat-vercel:${ipStr}`, 30, 60 * 1000);
  if (!rateCheck.allowed) {
    res.setHeader("Retry-After", rateCheck.retryAfter);
    return res.status(429).json({
      error: `Rate limit exceeded. Please wait ${rateCheck.retryAfter} seconds before retrying.`,
    });
  }

  // 4. Request Validation
  const validation = validateChatRequest(req.body);
  if (validation.valid === false) {
    return res.status(validation.status).json({ error: validation.error });
  }

  const { model, messages, temperature, stream, provider } = validation.data;

  // Reject hosted Ollama proxying on Vercel
  if (provider === "ollama") {
    return res.status(400).json({
      error: "Local Ollama models cannot be reached through Vercel cloud serverless functions. Run Void Chat locally for Ollama integration.",
    });
  }

  // Abort tracking
  const abortController = new AbortController();
  let isClientDisconnected = false;

  req.on?.("close", () => {
    isClientDisconnected = true;
    abortController.abort();
  });

  const initSseStream = () => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
  };

  const sendSseChunk = (text: string) => {
    if (!isClientDisconnected && res.writable) {
      res.write(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`);
    }
  };

  const sendSseDone = () => {
    if (!isClientDisconnected && res.writable) {
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    }
  };

  const sendSseError = (errMsg: string) => {
    if (!isClientDisconnected && res.writable) {
      res.write(`data: ${JSON.stringify({ type: "error", error: errMsg })}\n\n`);
      res.end();
    }
  };

  try {
    // -------------------------------------------------------------
    // Provider: Google Gemini
    // -------------------------------------------------------------
    if (provider === "gemini") {
      const ai = getGeminiClient();
      if (!ai) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      let geminiModelName = "gemini-3.8-flash";
      if (model.includes("3.1-flash-lite") || model.includes("lite")) {
        geminiModelName = "gemini-3.1-flash-lite";
      } else if (model.includes("2.5-flash")) {
        geminiModelName = "gemini-2.5-flash";
      }

      const systemMessage = messages.find(m => m.role === "system")?.content;
      const nonSystemMessages = messages.filter(m => m.role !== "system");

      const contents = nonSystemMessages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content || "" }],
      }));

      if (stream) {
        initSseStream();

        try {
          const responseStream = await ai.models.generateContentStream({
            model: geminiModelName,
            contents: contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "Hello" }] }],
            config: {
              ...(systemMessage ? { systemInstruction: systemMessage } : {}),
              temperature,
            },
          });

          for await (const chunk of responseStream) {
            if (isClientDisconnected) break;
            const text = chunk.text;
            if (text) {
              sendSseChunk(text);
            }
          }

          sendSseDone();
        } catch (err: any) {
          if (!isClientDisconnected && err?.name !== "AbortError") {
            sendSseError(err?.message || "Gemini streaming error");
          }
        }
        return;
      }

      const result = await ai.models.generateContent({
        model: geminiModelName,
        contents: contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "Hello" }] }],
        config: {
          ...(systemMessage ? { systemInstruction: systemMessage } : {}),
          temperature,
        },
      });

      return res.status(200).json({
        choices: [
          {
            message: {
              role: "assistant",
              content: result.text ?? "",
            },
          },
        ],
      });
    }

    // -------------------------------------------------------------
    // Provider: OpenRouter
    // -------------------------------------------------------------
    if (provider === "openrouter") {
      const appUrl = getAppUrl(req);
      const headers = {
        ...getOpenRouterHeaders(appUrl),
        "Content-Type": "application/json",
      };

      const upstreamResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers,
        signal: abortController.signal,
        body: JSON.stringify({
          model,
          messages,
          temperature,
          stream: Boolean(stream),
        }),
      });

      if (!upstreamResponse.ok) {
        const errData = await upstreamResponse.json().catch(() => ({}));
        return res.status(upstreamResponse.status).json({
          error: "OpenRouter API error",
          details: errData,
        });
      }

      if (stream) {
        initSseStream();

        const reader = upstreamResponse.body?.getReader();
        if (!reader) {
          sendSseError("Failed to initialize OpenRouter stream reader.");
          return;
        }

        const decoder = new TextDecoder();
        let lineBuffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done || isClientDisconnected) break;

            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data:")) continue;

              const payload = trimmed.slice(5).trim();
              if (payload === "[DONE]") {
                sendSseDone();
                return;
              }

              try {
                const parsed = JSON.parse(payload);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  sendSseChunk(delta);
                }
              } catch {
                // Ignore partial JSON
              }
            }
          }
          sendSseDone();
        } catch (streamErr: any) {
          if (!isClientDisconnected && streamErr?.name !== "AbortError") {
            sendSseError(streamErr?.message || "OpenRouter stream error");
          }
        }
        return;
      }

      const data = await upstreamResponse.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: "Unsupported provider" });
  } catch (error: any) {
    if (isClientDisconnected || error?.name === "AbortError") return;
    console.error("Error in Vercel chat handler:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}
