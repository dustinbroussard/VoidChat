const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_APP_TITLE = "VOID CHAT";

type HeaderValue = string | string[] | undefined;

function getHeader(header: HeaderValue): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

export function getAppUrl(req: { headers?: Record<string, HeaderValue> }): string {
  const host = getHeader(req.headers?.host);
  const forwardedProto = getHeader(req.headers?.["x-forwarded-proto"]);

  if (host) {
    return `${forwardedProto ?? "https"}://${host}`;
  }

  return process.env.APP_URL || "http://localhost:3000";
}

export function getOpenRouterHeaders(appUrl: string): Record<string, string> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": appUrl,
    "X-Title": process.env.OPENROUTER_APP_TITLE || DEFAULT_APP_TITLE,
  };
}

export async function proxyOpenRouter(
  req: { headers?: Record<string, HeaderValue> },
  path: string,
  init?: RequestInit,
) {
  const appUrl = getAppUrl(req);
  const headers = {
    ...getOpenRouterHeaders(appUrl),
    ...(init?.headers ?? {}),
  };

  const response = await fetch(`${OPENROUTER_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  return { response, data };
}
