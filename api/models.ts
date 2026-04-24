import { proxyOpenRouter } from "./_lib/openrouter";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { response, data } = await proxyOpenRouter(req, "/models");

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: "Failed to fetch models", details: data });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching models:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
