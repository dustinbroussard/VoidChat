/**
 * Automated Security & Verification Test Suite for VoidChat
 */
const BASE_URL = 'http://127.0.0.1:3000';

async function runTests() {
  console.log('--- STARTING VOIDCHAT SECURITY & VERIFICATION TEST SUITE ---\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string, detail?: any) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`, detail !== undefined ? detail : '');
      failed++;
    }
  }

  // 1. SSRF: Cloud Metadata (169.254.169.254)
  try {
    const res = await fetch(`${BASE_URL}/api/ollama/status?host=http://169.254.169.254:11434`);
    const data = await res.json().catch(() => ({}));
    assert(
      res.status === 400 && data.error?.includes('169.254.169.254'),
      'SSRF Protection: Rejects cloud metadata IP 169.254.169.254',
      { status: res.status, body: data }
    );
  } catch (e: any) {
    assert(false, 'SSRF Protection: Rejects cloud metadata IP 169.254.169.254', e.message);
  }

  // 2. SSRF: Non-whitelisted Port (e.g. 8080)
  try {
    const res = await fetch(`${BASE_URL}/api/ollama/status?host=http://127.0.0.1:8080`);
    const data = await res.json().catch(() => ({}));
    assert(
      res.status === 400 && (data.error?.includes('port') || data.error?.includes('Port')),
      'SSRF Protection: Rejects non-whitelisted port 8080 on loopback',
      { status: res.status, body: data }
    );
  } catch (e: any) {
    assert(false, 'SSRF Protection: Rejects non-whitelisted port 8080 on loopback', e.message);
  }

  // 3. SSRF: RFC1918 Private Subnet (192.168.1.1)
  try {
    const res = await fetch(`${BASE_URL}/api/ollama/status?host=http://192.168.1.1:11434`);
    const data = await res.json().catch(() => ({}));
    assert(
      res.status === 400 && (data.error?.includes('private') || data.error?.includes('forbidden')),
      'SSRF Protection: Rejects private network RFC1918 IP 192.168.1.1',
      { status: res.status, body: data }
    );
  } catch (e: any) {
    assert(false, 'SSRF Protection: Rejects private network RFC1918 IP 192.168.1.1', e.message);
  }

  // 4. SSRF: RFC1918 10.0.0.5 on /api/ollama/tags
  try {
    const res = await fetch(`${BASE_URL}/api/ollama/tags?host=http://10.0.0.5:11434`);
    const data = await res.json().catch(() => ({}));
    assert(
      res.status === 400 && (data.error?.includes('private') || data.error?.includes('forbidden')),
      'SSRF Protection: Rejects private network RFC1918 IP 10.0.0.5 on /api/ollama/tags',
      { status: res.status, body: data }
    );
  } catch (e: any) {
    assert(false, 'SSRF Protection: Rejects private network RFC1918 IP 10.0.0.5', e.message);
  }

  // 5. SSRF: Non-http protocol ftp://
  try {
    const res = await fetch(`${BASE_URL}/api/ollama/status?host=ftp://localhost:11434`);
    const data = await res.json().catch(() => ({}));
    assert(
      res.status === 400 && (data.error?.includes('protocols') || data.error?.includes('HTTP') || data.error?.includes('Port')),
      'SSRF Protection: Rejects non-http protocol ftp://',
      { status: res.status, body: data }
    );
  } catch (e: any) {
    assert(false, 'SSRF Protection: Rejects non-http protocol ftp://', e.message);
  }

  // 6. Whitelisted loopback verification
  try {
    const res = await fetch(`${BASE_URL}/api/ollama/status?host=http://127.0.0.1:11434`);
    const data = await res.json().catch(() => ({}));
    assert(
      res.status === 200 && typeof data.connected === 'boolean',
      'SSRF Protection: Accepts valid loopback 127.0.0.1:11434 probe',
      { status: res.status, body: data }
    );
  } catch (e: any) {
    assert(false, 'SSRF Protection: Accepts valid loopback 127.0.0.1:11434 probe', e.message);
  }

  // 7. Request Validation: Invalid Message Role
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'hacker', content: 'test payload' }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    assert(
      res.status === 400,
      'API Protection: Rejects invalid message role "hacker"',
      { status: res.status, body: data }
    );
  } catch (e: any) {
    assert(false, 'API Protection: Rejects invalid message role "hacker"', e.message);
  }

  // 8. Request Validation: Content-Type enforcement
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'plain text body',
    });
    assert(
      res.status === 415,
      'API Protection: Rejects unsupported Content-Type (text/plain) with 415',
      { status: res.status }
    );
  } catch (e: any) {
    assert(false, 'API Protection: Rejects unsupported Content-Type', e.message);
  }

  // 9. Request Validation: Oversized Message (>32KB per message)
  try {
    const largeMessage = 'A'.repeat(33 * 1024);
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: largeMessage }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    assert(
      res.status === 400 && data.error?.includes('exceeds maximum limit'),
      'API Protection: Rejects message exceeding 32KB limit with 400',
      { status: res.status, body: data }
    );
  } catch (e: any) {
    assert(false, 'API Protection: Rejects message exceeding 32KB limit', e.message);
  }

  // 10. Provider Credential Check: Explicit Error, No Silent Fallback
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-3-opus',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    assert(
      res.status === 400 && data.error?.includes('OPENROUTER_API_KEY'),
      'Provider Protection: Rejects OpenRouter model when OPENROUTER_API_KEY missing without silent Gemini hijacking',
      { status: res.status, body: data }
    );
  } catch (e: any) {
    assert(false, 'Provider Protection: Rejects OpenRouter without silent fallback', e.message);
  }

  // 11. Rate Limiting Protection (Send concurrent burst)
  try {
    const burstPromises = Array.from({ length: 70 }, () => fetch(`${BASE_URL}/api/models`));
    const responses = await Promise.all(burstPromises);
    const rateLimitedRes = responses.find(r => r.status === 429);
    const retryAfter = rateLimitedRes?.headers.get('retry-after');

    assert(
      Boolean(rateLimitedRes) && Boolean(retryAfter),
      'Rate Limiting: Concurrent request burst triggers HTTP 429 with Retry-After header',
      { found429: Boolean(rateLimitedRes), retryAfter }
    );
  } catch (e: any) {
    assert(false, 'Rate Limiting: Concurrent request burst triggers HTTP 429', e.message);
  }

  console.log(`\n--- TEST RESULTS: ${passed} PASSED, ${failed} FAILED ---`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
