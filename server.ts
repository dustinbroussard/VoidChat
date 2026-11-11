import express, { Request, Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  checkRateLimit,
  validateOllamaDestination,
  validateChatRequest,
  validateAccessProtection,
} from "./api/_lib/security";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const GEMINI_MODELS = [
  {
    id: "google/gemini-3.8-flash",
    name: "Google: Gemini 3.8 Flash",
    pricing: { prompt: "0", completion: "0" },
    context_length: 1048576,
    source: "gemini",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    name: "Google: Gemini 3.1 Flash Lite",
    pricing: { prompt: "0", completion: "0" },
    context_length: 1048576,
    source: "gemini",
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Google: Gemini 2.5 Flash",
    pricing: { prompt: "0", completion: "0" },
    context_length: 1048576,
    source: "gemini",
  },
];

const FALLBACK_OPENROUTER_MODELS = [
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Meta: Llama 3.3 70B Instruct (Free)",
    pricing: { prompt: "0", completion: "0" },
    context_length: 131072,
    source: "openrouter",
  },
  {
    id: "deepseek/deepseek-r1:free",
    name: "DeepSeek: R1 (Free)",
    pricing: { prompt: "0", completion: "0" },
    context_length: 65536,
    source: "openrouter",
  },
  {
    id: "mistralai/mistral-7b-instruct:free",
    name: "Mistral: Mistral 7B Instruct (Free)",
    pricing: { prompt: "0", completion: "0" },
    context_length: 32768,
    source: "openrouter",
  },
  {
    id: "qwen/qwen-2.5-72b-instruct:free",
    name: "Qwen: Qwen 2.5 72B Instruct (Free)",
    pricing: { prompt: "0", completion: "0" },
    context_length: 32768,
    source: "openrouter",
  },
];

async function startServer() {
  const app = express();
  const PORT = 3000;
  const isDev = process.env.NODE_ENV !== "production";

  // Enforce secure body size limit (512KB) instead of 10MB
  app.use(express.json({ limit: '512kb' }));

  // Global security & access validation middleware for /api/*
  app.use('/api', (req: Request, res: Response, next) => {
    // 1. Validate Content-Type for mutating requests
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (!req.is('application/json')) {
        return res.status(415).json({
          error: 'Unsupported Media Type. Content-Type must be application/json.',
        });
      }
    }

    // 2. Deployment-level access token validation if configured
    const authCheck = validateAccessProtection(req);
    if (!authCheck.authorized) {
      return res.status(401).json({ error: 'Unauthorized: ' + authCheck.reason });
    }

    next();
  });

  // API Route: Models Catalog
  app.get("/api/models", async (req: Request, res: Response) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rateCheck = checkRateLimit(`models:${clientIp}`, 60, 60 * 1000);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', rateCheck.retryAfter);
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment before refreshing models.',
      });
    }

    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      let openRouterModels: any[] = [];

      if (apiKey) {
        try {
          const response = await fetch("https://openrouter.ai/api/v1/models", {
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
              "X-Title": process.env.OPENROUTER_APP_TITLE || "Void Chat",
            },
            signal: AbortSignal.timeout(5000),
          });

          if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data?.data)) {
              openRouterModels = data.data;
            }
          }
        } catch (fetchErr) {
          console.warn("Failed to fetch OpenRouter models:", fetchErr);
        }
      }

      const modelsMap = new Map<string, any>();

      // Always include Gemini models
      for (const m of GEMINI_MODELS) {
        modelsMap.set(m.id, m);
      }

      // If OpenRouter models were fetched, include them
      if (openRouterModels.length > 0) {
        for (const m of openRouterModels) {
          if (!modelsMap.has(m.id)) {
            modelsMap.set(m.id, { ...m, source: 'openrouter' });
          }
        }
      } else {
        // Fallback models when OpenRouter API is not configured
        for (const m of FALLBACK_OPENROUTER_MODELS) {
          if (!modelsMap.has(m.id)) {
            modelsMap.set(m.id, m);
          }
        }
      }

      res.json({ data: Array.from(modelsMap.values()) });
    } catch (error) {
      console.error("Error in /api/models:", error);
      res.status(500).json({ error: "Internal server error fetching models" });
    }
  });

  // API Route: Ollama Status with strict SSRF protection
  app.get("/api/ollama/status", async (req: Request, res: Response) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rateCheck = checkRateLimit(`ollama-status:${clientIp}`, 60, 60 * 1000);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', rateCheck.retryAfter);
      return res.status(429).json({ error: 'Rate limit exceeded.' });
    }

    const hostInput = req.query.host as string | undefined;
    const validation = await validateOllamaDestination(hostInput, isDev);

    if (!validation.allowed || !validation.url) {
      return res.status(400).json({
        connected: false,
        error: validation.reason || 'Invalid or forbidden destination.',
      });
    }

    try {
      const response = await fetch(`${validation.url}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      res.json({ connected: response.ok });
    } catch {
      res.json({ connected: false });
    }
  });

  // API Route: Ollama Tags with strict SSRF protection
  app.get("/api/ollama/tags", async (req: Request, res: Response) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rateCheck = checkRateLimit(`ollama-tags:${clientIp}`, 60, 60 * 1000);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', rateCheck.retryAfter);
      return res.status(429).json({ error: 'Rate limit exceeded.' });
    }

    const hostInput = req.query.host as string | undefined;
    const validation = await validateOllamaDestination(hostInput, isDev);

    if (!validation.allowed || !validation.url) {
      return res.status(400).json({
        models: [],
        error: validation.reason || 'Invalid or forbidden destination.',
      });
    }

    try {
      const response = await fetch(`${validation.url}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        return res.status(response.status).json({ models: [] });
      }
      const data = await response.json();
      res.json(data);
    } catch {
      res.json({ models: [] });
    }
  });

  // API Route: Chat Generation (Streaming SSE & Non-Streaming)
  app.post("/api/chat", async (req: Request, res: Response) => {
    console.error("[HIT CHAT ROUTE]", req.body?.model);
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rateCheck = checkRateLimit(`chat:${clientIp}`, 30, 60 * 1000);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', rateCheck.retryAfter);
      return res.status(429).json({
        error: `Rate limit exceeded. Please wait ${rateCheck.retryAfter} seconds before sending another message.`,
      });
    }

    // 1. Strict Request Validation
    const validation = validateChatRequest(req.body);
    if (validation.valid === false) {
      return res.status(validation.status).json({ error: validation.error });
    }

    const { model, messages, temperature, stream, ollamaHost, provider } = validation.data;

    // Upstream Abort Controller hooked to client disconnect
    const upstreamController = new AbortController();
    let isClientDisconnected = false;

    req.on("close", () => {
      isClientDisconnected = true;
      upstreamController.abort();
    });

    // Helper to send SSE headers
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
      // Provider: Ollama Local Inference
      // -------------------------------------------------------------
      if (provider === "ollama") {
        const rawModel = model.replace(/^ollama\//, "");
        const hostValidation = await validateOllamaDestination(ollamaHost, isDev);

        if (!hostValidation.allowed || !hostValidation.url) {
          return res.status(400).json({
            error: hostValidation.reason || "Forbidden Ollama host destination.",
          });
        }

        const ollamaEndpoint = `${hostValidation.url}/api/chat`;

        const upstreamResponse = await fetch(ollamaEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: upstreamController.signal,
          body: JSON.stringify({
            model: rawModel,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            stream: stream,
            options: { temperature },
          }),
        });

        if (!upstreamResponse.ok) {
          const errText = await upstreamResponse.text().catch(() => "");
          const status = upstreamResponse.status === 404 ? 404 : 502;
          return res.status(status).json({
            error: upstreamResponse.status === 404
              ? `Ollama model "${rawModel}" was not found. Please run 'ollama run ${rawModel}' first.`
              : `Ollama service error: ${errText || upstreamResponse.statusText}`,
          });
        }

        if (stream) {
          initSseStream();

          const reader = upstreamResponse.body?.getReader();
          if (!reader) {
            sendSseError("Failed to initialize stream from Ollama.");
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
                if (!trimmed) continue;
                try {
                  const parsed = JSON.parse(trimmed);
                  if (parsed.message?.content) {
                    sendSseChunk(parsed.message.content);
                  }
                  if (parsed.done) {
                    sendSseDone();
                    return;
                  }
                } catch {
                  // Ignore JSON parse errors on partial chunks
                }
              }
            }
            sendSseDone();
          } catch (streamErr: any) {
            if (!isClientDisconnected && streamErr?.name !== "AbortError") {
              sendSseError(streamErr?.message || "Ollama stream read error");
            }
          }
          return;
        }

        // Non-streaming Ollama response
        const data = await upstreamResponse.json();
        return res.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: data?.message?.content || "",
              },
            },
          ],
        });
      }

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
        } else {
          geminiModelName = "gemini-3.8-flash";
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
          } catch (genError: any) {
            if (!isClientDisconnected && genError?.name !== "AbortError") {
              console.error("Gemini stream error:", genError);
              sendSseError(genError?.message || "Gemini streaming error occurred.");
            }
          }
          return;
        }

        // Non-streaming Gemini response
        const result = await ai.models.generateContent({
          model: geminiModelName,
          contents: contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "Hello" }] }],
          config: {
            ...(systemMessage ? { systemInstruction: systemMessage } : {}),
            temperature,
          },
        });

        return res.json({
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
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        if (!openRouterKey) {
          return res.status(400).json({
            error: "OPENROUTER_API_KEY is not configured on the server. Please provide the key or select a Gemini model.",
          });
        }

        const upstreamResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
            "X-Title": process.env.OPENROUTER_APP_TITLE || "Void Chat",
          },
          signal: upstreamController.signal,
          body: JSON.stringify({
            model,
            messages,
            temperature,
            stream: stream,
          }),
        });

        if (!upstreamResponse.ok) {
          const errData = await upstreamResponse.json().catch(() => ({}));
          const errMsg = errData?.error?.message || errData?.error || "OpenRouter upstream error";
          return res.status(upstreamResponse.status).json({
            error: errMsg,
            details: errData,
          });
        }

        if (stream) {
          initSseStream();

          const reader = upstreamResponse.body?.getReader();
          if (!reader) {
            sendSseError("Failed to initialize OpenRouter response stream.");
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
                  // Partial JSON chunk
                }
              }
            }
            sendSseDone();
          } catch (streamErr: any) {
            if (!isClientDisconnected && streamErr?.name !== "AbortError") {
              sendSseError(streamErr?.message || "OpenRouter stream read error");
            }
          }
          return;
        }

        // Non-streaming OpenRouter response
        const data = await upstreamResponse.json();
        return res.json(data);
      }

      return res.status(400).json({ error: "Unsupported provider requested." });
    } catch (error: any) {
      if (isClientDisconnected || error?.name === "AbortError") {
        return;
      }
      console.error("Error in /api/chat execution:", error);
      res.status(500).json({
        error: error?.message || "Internal server error occurred during completion.",
      });
    }
  });

  // Vite development middleware vs Static Production bundle
  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
