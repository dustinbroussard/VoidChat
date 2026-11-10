import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

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
  },
  {
    id: "google/gemini-3.1-flash-lite",
    name: "Google: Gemini 3.1 Flash Lite",
    pricing: { prompt: "0", completion: "0" },
    context_length: 1048576,
  },
  {
    id: "google/gemini-2.0-flash-lite-preview-02-05:free",
    name: "Google: Gemini 3.8 Flash (Default Free)",
    pricing: { prompt: "0", completion: "0" },
    context_length: 1048576,
  },
];

const FALLBACK_OPENROUTER_MODELS = [
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Meta: Llama 3.3 70B Instruct (Free)",
    pricing: { prompt: "0", completion: "0" },
    context_length: 131072,
  },
  {
    id: "deepseek/deepseek-r1:free",
    name: "DeepSeek: R1 (Free)",
    pricing: { prompt: "0", completion: "0" },
    context_length: 65536,
  },
  {
    id: "mistralai/mistral-7b-instruct:free",
    name: "Mistral: Mistral 7B Instruct (Free)",
    pricing: { prompt: "0", completion: "0" },
    context_length: 32768,
  },
  {
    id: "qwen/qwen-2.5-72b-instruct:free",
    name: "Qwen: Qwen 2.5 72B Instruct (Free)",
    pricing: { prompt: "0", completion: "0" },
    context_length: 32768,
  },
];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get("/api/models", async (req, res) => {
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
            modelsMap.set(m.id, m);
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
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/ollama/status", async (req, res) => {
    try {
      const host = ((req.query.host as string) || process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/+$/, "");
      const response = await fetch(`${host}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      res.json({ connected: response.ok });
    } catch {
      res.json({ connected: false });
    }
  });

  app.get("/api/ollama/tags", async (req, res) => {
    try {
      const host = ((req.query.host as string) || process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/+$/, "");
      const response = await fetch(`${host}/api/tags`, {
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

  app.post("/api/chat", async (req, res) => {
    try {
      const { model, messages, temperature = 0.7, ollamaHost } = req.body;

      if (!model) {
        return res.status(400).json({ error: "No model selected" });
      }

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Invalid messages format" });
      }

      // Handle Ollama model execution
      if (model.startsWith("ollama/")) {
        const rawModel = model.replace(/^ollama\//, "");
        const host = ((ollamaHost as string) || process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/+$/, "");

        const response = await fetch(`${host}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: rawModel,
            messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
            stream: false,
            options: { temperature },
          }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          return res.status(response.status).json({
            error: `Ollama error: ${errText || response.statusText}`,
          });
        }

        const data = await response.json();
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

      const isGeminiModel =
        model.includes("gemini") ||
        model.startsWith("google/") ||
        (!process.env.OPENROUTER_API_KEY && Boolean(process.env.GEMINI_API_KEY));

      if (isGeminiModel && process.env.GEMINI_API_KEY) {
        const ai = getGeminiClient();
        if (!ai) {
          return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
        }

        let geminiModelName = "gemini-3.8-flash";
        if (model.includes("3.1-flash-lite") || model.includes("lite")) {
          geminiModelName = "gemini-3.1-flash-lite";
        } else if (model.includes("4-argon")) {
          geminiModelName = "gemini-4-argon";
        } else {
          geminiModelName = "gemini-3.8-flash";
        }

        const systemMessage = messages.find((m: any) => m.role === "system")?.content;
        const nonSystemMessages = messages.filter((m: any) => m.role !== "system");

        const contents = nonSystemMessages.map((m: any) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content || "" }],
        }));

        let result;
        try {
          result = await ai.models.generateContent({
            model: geminiModelName,
            contents: contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "Hello" }] }],
            config: {
              ...(systemMessage ? { systemInstruction: systemMessage } : {}),
            },
          });
        } catch (genError: any) {
          const errStr = String(genError?.message || genError);
          // If gemini-3.8-flash experienced 503 high demand, try gemini-3.1-flash-lite
          if ((errStr.includes("503") || errStr.includes("high demand") || errStr.includes("UNAVAILABLE")) && geminiModelName !== "gemini-3.1-flash-lite") {
            console.warn("Primary Gemini model unavailable, attempting fallback to gemini-3.1-flash-lite...");
            result = await ai.models.generateContent({
              model: "gemini-3.1-flash-lite",
              contents: contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "Hello" }] }],
              config: {
                ...(systemMessage ? { systemInstruction: systemMessage } : {}),
              },
            });
          } else {
            throw genError;
          }
        }

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

      const openRouterKey = process.env.OPENROUTER_API_KEY;
      if (!openRouterKey) {
        return res.status(400).json({
          error:
            "No API key available. Please configure OPENROUTER_API_KEY or select a Gemini model with GEMINI_API_KEY in Settings > Secrets.",
        });
      }

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
          "X-Title": process.env.OPENROUTER_APP_TITLE || "Void Chat",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return res.status(response.status).json({
          error: "OpenRouter API error",
          details: data,
        });
      }

      res.json(data);
    } catch (error) {
      console.error("Error in chat completion:", error);
      let errorMsg = error instanceof Error ? error.message : String(error);
      try {
        const parsed = JSON.parse(errorMsg);
        if (parsed?.error?.message) {
          errorMsg = parsed.error.message;
        }
      } catch {
        // Not JSON
      }
      res.status(500).json({
        error: errorMsg,
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
