import dns from 'dns';
import net from 'net';

export interface ValidatedChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ValidatedChatRequest {
  model: string;
  messages: ValidatedChatMessage[];
  temperature: number;
  stream: boolean;
  ollamaHost?: string;
  provider: 'gemini' | 'openrouter' | 'ollama';
}

// In-memory sliding-window rate limiter
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Cleanup stale entries every 3 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 3 * 60 * 1000).unref?.();

/**
 * Checks client rate limit against an in-memory window.
 */
export function checkRateLimit(
  clientIp: string,
  maxRequests: number = 30,
  windowMs: number = 60 * 1000
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const record = rateLimitStore.get(clientIp);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(clientIp, {
      count: 1,
      resetTime: now + windowMs,
    });
    return { allowed: true, retryAfter: 0 };
  }

  if (record.count >= maxRequests) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  record.count += 1;
  return { allowed: true, retryAfter: 0 };
}

/**
 * Checks if an IP address belongs to RFC1918 private, link-local, metadata, or reserved ranges.
 */
export function isPrivateOrReservedIP(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return true;

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // IPv4 Checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [a, b, c] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;

    // 10.0.0.0/8 (RFC 1918 Private)
    if (a === 10) return true;

    // 100.64.0.0/10 (Carrier-Grade NAT, RFC 6598)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;

    // 169.254.0.0/16 (Link-Local, AWS/GCP/Azure Cloud Metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;

    // 172.16.0.0/12 (RFC 1918 Private)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 192 && b === 0 && c === 0) return true;

    // 192.0.2.0/24 (TEST-NET-1, documentation)
    if (a === 192 && b === 0 && c === 2) return true;

    // 192.168.0.0/16 (RFC 1918 Private)
    if (a === 192 && b === 168) return true;

    // 198.18.0.0/15 (Network benchmark tests)
    if (a === 198 && (b === 18 || b === 19)) return true;

    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 198 && b === 51 && c === 100) return true;

    // 203.0.113.0/24 (TEST-NET-3)
    if (a === 203 && b === 0 && c === 113) return true;

    // 224.0.0.0/4 (Multicast)
    if (a >= 224 && a <= 239) return true;

    // 240.0.0.0/4 (Reserved for future use)
    if (a >= 240) return true;

    // 255.255.255.255 (Broadcast)
    if (ip === '255.255.255.255') return true;

    return false;
  }

  // IPv6 Checks
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();

    // ::1 (Loopback)
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;

    // :: (Unspecified)
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;

    // Link-local: fe80::/10 (fe80 to febf)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true;
    }

    // Unique Local Addresses (ULA): fc00::/7 (fc00 to fdff)
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }

    // Discard prefix 100::/64
    if (lower.startsWith('100:')) return true;

    // Documentation 2001:db8::/32
    if (lower.startsWith('2001:db8:') || lower.startsWith('2001:0db8:')) return true;

    return false;
  }

  return true;
}

/**
 * Validates and normalizes Ollama destinations to defend against SSRF.
 * In production/hosted mode, client-specified arbitrary hosts are rejected.
 * In local development mode, only loopback destinations on approved ports are permitted.
 */
export async function validateOllamaDestination(
  hostInput?: string,
  isDev: boolean = process.env.NODE_ENV !== 'production'
): Promise<{ allowed: boolean; url?: string; reason?: string }> {
  // If no host input was passed, use server-side environment configuration
  if (!hostInput || !hostInput.trim()) {
    const serverHost = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
    return { allowed: true, url: serverHost };
  }

  let cleaned = hostInput.trim();
  if (cleaned.includes('://')) {
    if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
      return { allowed: false, reason: 'Only HTTP and HTTPS protocols are permitted for Ollama.' };
    }
  } else {
    cleaned = `http://${cleaned}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return { allowed: false, reason: 'Malformed Ollama host URL syntax.' };
  }

  // Only http and https protocols are permitted
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: 'Only HTTP and HTTPS protocols are permitted for Ollama.' };
  }

  // Reject credentials in user-supplied URLs
  if (parsed.username || parsed.password) {
    return { allowed: false, reason: 'URL credentials are not permitted in Ollama host configuration.' };
  }

  // Enforce approved Ollama ports (default 11434, or matching server config)
  const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
  const allowedPort = process.env.OLLAMA_PORT ? parseInt(process.env.OLLAMA_PORT, 10) : 11434;

  if (port !== 11434 && port !== allowedPort) {
    return { allowed: false, reason: `Port ${port} is not permitted for Ollama. Must use port 11434.` };
  }

  // In production/cloud deployments, client-controlled arbitrary hosts are rejected to prevent SSRF
  if (!isDev && process.env.ALLOW_REMOTE_OLLAMA_PROXY !== 'true') {
    // Only permit server-side configured host
    const configuredHost = (process.env.OLLAMA_HOST || '').trim().replace(/\/+$/, '');
    if (configuredHost) {
      try {
        const configuredUrl = new URL(configuredHost);
        if (parsed.hostname === configuredUrl.hostname && port === (configuredUrl.port ? parseInt(configuredUrl.port, 10) : 11434)) {
          return { allowed: true, url: `${parsed.protocol}//${parsed.hostname}:${port}` };
        }
      } catch {
        // Fall through to rejection
      }
    }
    return {
      allowed: false,
      reason: 'Client-specified Ollama destinations are disabled on hosted deployments to prevent SSRF. Run Void Chat locally or configure OLLAMA_HOST on the server.',
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Explicit loopback hostnames
  const isLoopbackHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';

  // Perform DNS resolution to inspect underlying IP
  let resolvedIps: string[] = [];
  try {
    const lookupResult = await dns.promises.lookup(hostname, { all: true });
    resolvedIps = lookupResult.map(r => r.address);
  } catch (err: any) {
    return { allowed: false, reason: `Could not resolve hostname "${hostname}": ${err?.message || 'DNS resolution failed'}` };
  }

  if (resolvedIps.length === 0) {
    return { allowed: false, reason: `Hostname "${hostname}" resolved to no IP addresses.` };
  }

  for (const ip of resolvedIps) {
    // Reject cloud metadata IP explicitly
    if (ip === '169.254.169.254' || ip.startsWith('169.254.')) {
      return { allowed: false, reason: 'Requests to cloud metadata services (169.254.169.254) are strictly forbidden.' };
    }

    // Check if IP is private/reserved
    const isPrivate = isPrivateOrReservedIP(ip);
    const isLoopbackIp = ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.');

    if (isPrivate) {
      if (isLoopbackHost && isLoopbackIp && isDev) {
        // Allowed in local dev mode
        continue;
      }
      return {
        allowed: false,
        reason: `Target IP ${ip} is a private, link-local, or reserved network address and is not permitted.`,
      };
    }
  }

  return {
    allowed: true,
    url: `${parsed.protocol}//${parsed.hostname}:${port}`,
  };
}

/**
 * Validates request authentication if APP_ACCESS_TOKEN is configured.
 */
export function validateAccessProtection(req: any): { authorized: boolean; reason?: string } {
  const expectedSecret = process.env.APP_ACCESS_TOKEN;
  if (!expectedSecret) {
    // No deployment-level access token configured
    return { authorized: true };
  }

  const authHeader = req.headers?.authorization || req.headers?.['x-access-token'];
  if (!authHeader) {
    return { authorized: false, reason: 'Authorization header or x-access-token required.' };
  }

  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : String(authHeader).trim();

  if (token !== expectedSecret.trim()) {
    return { authorized: false, reason: 'Invalid access token provided.' };
  }

  return { authorized: true };
}

export type ChatValidationResult =
  | { valid: true; data: ValidatedChatRequest; error?: never; status?: never }
  | { valid: false; error: string; status: number; data?: never };

/**
 * Validates chat request body structure, message roles, length limits, and provider requirements.
 */
export function validateChatRequest(body: any): ChatValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object.', status: 400 };
  }

  const { model, messages, temperature = 0.7, stream = false, ollamaHost } = body;

  // 1. Model validation
  if (!model || typeof model !== 'string' || !model.trim()) {
    return { valid: false, error: 'A valid "model" identifier string is required.', status: 400 };
  }

  const cleanModel = model.trim();
  if (cleanModel.length > 128) {
    return { valid: false, error: 'Model identifier exceeds maximum allowed length of 128 characters.', status: 400 };
  }

  // Model ID pattern validation: alphanumeric, dash, underscore, dot, slash, colon
  if (!/^[a-zA-Z0-9_\-\.\/:]+$/.test(cleanModel)) {
    return { valid: false, error: 'Model identifier contains invalid characters.', status: 400 };
  }

  // Determine provider strictly from model prefix and name
  let provider: 'gemini' | 'openrouter' | 'ollama';
  if (cleanModel.startsWith('ollama/')) {
    provider = 'ollama';
  } else if (cleanModel.startsWith('google/') || cleanModel.includes('gemini')) {
    provider = 'gemini';
  } else {
    provider = 'openrouter';
  }

  // 2. Validate provider credentials explicitly (Never silently substitute providers!)
  if (provider === 'gemini' && !process.env.GEMINI_API_KEY) {
    return {
      valid: false,
      error: 'GEMINI_API_KEY is not configured on the server. Please add GEMINI_API_KEY or select an available OpenRouter model.',
      status: 400,
    };
  }

  if (provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
    return {
      valid: false,
      error: 'OPENROUTER_API_KEY is not configured on the server. Please add OPENROUTER_API_KEY or select a Gemini model.',
      status: 400,
    };
  }

  // 3. Messages array validation
  if (!Array.isArray(messages)) {
    return { valid: false, error: '"messages" must be an array of chat messages.', status: 400 };
  }

  if (messages.length === 0) {
    return { valid: false, error: '"messages" array must contain at least one message.', status: 400 };
  }

  if (messages.length > 200) {
    return { valid: false, error: 'Conversation history exceeds maximum limit of 200 messages.', status: 400 };
  }

  const validatedMessages: ValidatedChatMessage[] = [];
  let totalLength = 0;
  const ALLOWED_ROLES = new Set(['user', 'assistant', 'system']);

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== 'object') {
      return { valid: false, error: `Message at index ${i} is not a valid object.`, status: 400 };
    }

    if (!ALLOWED_ROLES.has(m.role)) {
      return {
        valid: false,
        error: `Invalid role "${m.role}" at message index ${i}. Role must be strictly "user", "assistant", or "system".`,
        status: 400,
      };
    }

    let content = '';
    if (typeof m.content === 'string') {
      content = m.content;
    } else if (m.content != null) {
      content = String(m.content);
    }

    // Limit individual message content to 32,768 characters
    if (content.length > 32768) {
      return {
        valid: false,
        error: `Message at index ${i} exceeds maximum limit of 32,768 characters (length: ${content.length}).`,
        status: 400,
      };
    }

    totalLength += content.length;
    validatedMessages.push({
      role: m.role,
      content,
    });
  }

  // Limit aggregate prompt content length to 131,072 characters (~32k tokens)
  if (totalLength > 131072) {
    return {
      valid: false,
      error: `Total conversation content exceeds aggregate limit of 131,072 characters (total: ${totalLength}).`,
      status: 400,
    };
  }

  // 4. Temperature validation
  const numTemp = typeof temperature === 'number' ? temperature : parseFloat(temperature);
  const cleanTemp = isNaN(numTemp) ? 0.7 : Math.max(0, Math.min(2.0, numTemp));

  return {
    valid: true,
    data: {
      model: cleanModel,
      messages: validatedMessages,
      temperature: cleanTemp,
      stream: Boolean(stream),
      ollamaHost: typeof ollamaHost === 'string' ? ollamaHost : undefined,
      provider,
    },
  };
}
