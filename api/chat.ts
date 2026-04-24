import { proxyOpenRouter } from "./_lib/openrouter.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { model, messages, temperature = 0.7 } = req.body ?? {};

    if (!model) {
      return res.status(400).json({ error: "No model selected" });
    }

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages format" });
    }

    const { response, data } = await proxyOpenRouter(req, "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
      }),
    });

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: "OpenRouter API error", details: data });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("Error in chat completion:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return res.status(500).json({ error: "Internal server error", details: message });
  }
}
