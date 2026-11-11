import { proxyOpenRouter } from "./_lib/openrouter.js";
import { checkRateLimit, validateAccessProtection } from "./_lib/security.js";

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

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 1. Access protection check
  const authCheck = validateAccessProtection(req);
  if (!authCheck.authorized) {
    return res.status(401).json({ error: "Unauthorized: " + authCheck.reason });
  }

  // 2. Rate limiting check
  const clientIp = req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  const ipStr = Array.isArray(clientIp) ? clientIp[0] : String(clientIp).split(",")[0].trim();
  const rateCheck = checkRateLimit(`models-vercel:${ipStr}`, 60, 60 * 1000);
  if (!rateCheck.allowed) {
    res.setHeader("Retry-After", rateCheck.retryAfter);
    return res.status(429).json({ error: "Too many requests. Please wait a moment before refreshing models." });
  }

  try {
    let openRouterModels: any[] = [];

    if (process.env.OPENROUTER_API_KEY) {
      try {
        const { response, data } = await proxyOpenRouter(req, "/models");
        if (response.ok && Array.isArray(data?.data)) {
          openRouterModels = data.data;
        }
      } catch (fetchErr) {
        console.warn("Vercel /api/models: OpenRouter fetch failed:", fetchErr);
      }
    }

    const modelsMap = new Map<string, any>();

    // Include Gemini models
    for (const m of GEMINI_MODELS) {
      modelsMap.set(m.id, m);
    }

    if (openRouterModels.length > 0) {
      for (const m of openRouterModels) {
        if (!modelsMap.has(m.id)) {
          modelsMap.set(m.id, { ...m, source: "openrouter" });
        }
      }
    } else {
      for (const m of FALLBACK_OPENROUTER_MODELS) {
        if (!modelsMap.has(m.id)) {
          modelsMap.set(m.id, m);
        }
      }
    }

    return res.status(200).json({ data: Array.from(modelsMap.values()) });
  } catch (error) {
    console.error("Error in Vercel /api/models:", error);
    return res.status(500).json({ error: "Internal server error fetching models" });
  }
}
