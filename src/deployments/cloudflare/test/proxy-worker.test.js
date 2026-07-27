// Bun integration test for the Cloudflare Worker proxy (src/deployments/cloudflare/proxy-worker.js).
//
// Why Bun and not `wrangler dev`/workerd: workerd does not produce results in
// this sandbox (hangs even on a trivial Worker — known environment gap, see
// dev/docs/walkthrough.md:840 "אין לנו CF deploy מקומי"). Bun implements
// fetch/Request/Response/btoa/atob/URL to the same spec as workerd, so
// `handleProxy`/`isAllowed`/`bytesToB64`/`b64ToBytes` run unmodified under
// `bun test`, against the REAL network (GitHub/obsidian.md — no mocking of
// the outbound fetch itself). See brief §0 "Testing strategy — מעודכן".
//
// Run: bun test src/deployments/cloudflare/test/proxy-worker.test.js

import { expect, test, describe, beforeEach } from 'bun:test';
import {
  handleProxy, isAllowed, isCacheableHost, bytesToB64, b64ToBytes,
  __resetRateLimit, __setRateLimitMaxEntriesForTest, __getRateLimitMapSizeForTest,
} from '../proxy-worker.js';

// ── caches.default mock (DoD#4) ──────────────────────────────────────────────
// Bun has no global `caches` (that's a Worker/Service-Worker runtime API) —
// brief §0 explicitly allows mocking it: "caches.default (Map עם match/put)".
// This mirrors the real Cache API contract handleProxy relies on: match(req)
// → Response|undefined, put(req, res) → void. Keyed by request URL, same as
// the real Cache API keys by the Request's URL.
function makeMockCaches() {
  const store = new Map();
  return {
    default: {
      async match(req) {
        const key = typeof req === 'string' ? req : req.url;
        const hit = store.get(key);
        return hit ? hit.clone() : undefined;
      },
      async put(req, res) {
        const key = typeof req === 'string' ? req : req.url;
        store.set(key, res.clone());
      },
    },
  };
}

// handleProxy always references the global `caches.default` (real Worker
// runtime semantics — it's not passed in as a parameter). Install a base
// mock for the whole file so tests that happen to hit a cacheable host
// (e.g. DoD#1's raw.githubusercontent.com manifest) don't crash on
// `ReferenceError: caches is not defined`. The dedicated Cache API tests
// below swap in their own fresh, isolated instance so cache hits/misses are
// deterministic regardless of test order.
globalThis.caches = makeMockCaches();

// Minimal ctx stub — handleProxy calls ctx.waitUntil() when caching (Commit 1
// onward); Commit 0 doesn't cache, but keep the stub future-proof.
function makeCtx() {
  const waited = [];
  return { waited, waitUntil: (p) => waited.push(p) };
}

function postRequest(body) {
  return new Request('https://worker.example/api/proxy-request', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function postRequestFromIp(ip, body) {
  return new Request('https://worker.example/api/proxy-request', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

// ── §3.3 rate limiting — the module-level Map is shared across every case in
// this bun-test file (brief finding), so it must be reset before EACH test —
// not just the rate-limiting describe block below — otherwise an earlier
// test's requests-from-a-known-IP could bleed into a later one.
beforeEach(() => {
  __resetRateLimit();
});

// ── DoD#7 — isAllowed unit ──────────────────────────────────────────────────

describe('isAllowed', () => {
  test('explicit allow-listed hosts', () => {
    expect(isAllowed('https://releases.obsidian.md/x')).toBe(true);
    expect(isAllowed('https://raw.githubusercontent.com/x')).toBe(true);
    expect(isAllowed('https://api.github.com/x')).toBe(true);
    expect(isAllowed('https://github.com/x')).toBe(true);
    expect(isAllowed('https://forum.obsidian.md/x')).toBe(true);
    expect(isAllowed('https://obsidian.md/x')).toBe(true);
    expect(isAllowed('https://templater-unsplash-2.fly.dev/x')).toBe(true);
  });

  test('subdomains of allowed roots', () => {
    expect(isAllowed('https://publish.obsidian.md/x')).toBe(true);
    expect(isAllowed('https://api.github.com/x')).toBe(true);
    expect(isAllowed('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isAllowed('https://release-assets.githubusercontent.com/x')).toBe(true);
  });

  test('disallowed hosts', () => {
    expect(isAllowed('https://evil.com/x')).toBe(false);
    expect(isAllowed('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowed('http://localhost/x')).toBe(false);
    expect(isAllowed('http://127.0.0.1/x')).toBe(false);
    // not a real subdomain — githubusercontent.com.evil.com would fail too,
    // but check the more common trap: host that merely *contains* the string.
    expect(isAllowed('https://raw.githubusercontent.com.evil.com/x')).toBe(false);
  });

  test('malformed URL → false, not a throw', () => {
    expect(isAllowed('not a url')).toBe(false);
    expect(isAllowed('')).toBe(false);
  });
});

// ── DoD#5 — base64 round-trip binary-safe ───────────────────────────────────

describe('bytesToB64 / b64ToBytes', () => {
  test('round-trips small random binary content', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i; // 0x00..0xFF, all byte values
    const b64 = bytesToB64(bytes.buffer);
    const back = b64ToBytes(b64);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  test('round-trips large buffer (chunked path, > 0x8000 bytes)', () => {
    const SIZE = 200 * 1024; // exceeds CHUNK (0x8000 = 32768)
    const bytes = new Uint8Array(SIZE);
    for (let i = 0; i < SIZE; i++) bytes[i] = (i * 7) % 256;
    const b64 = bytesToB64(bytes.buffer);
    const back = b64ToBytes(b64);
    expect(back.length).toBe(SIZE);
    for (let i = 0; i < SIZE; i += 997) {
      expect(back[i]).toBe(bytes[i]);
    }
  });

  test('empty buffer', () => {
    expect(bytesToB64(new ArrayBuffer(0))).toBe('');
    expect(b64ToBytes('').length).toBe(0);
  });
});

// ── DoD#1 — manifest fetch through handleProxy (real network) ──────────────

describe('handleProxy — real network', () => {
  test('DoD#1: raw.githubusercontent.com manifest → 200, base64 body decodes to JSON', async () => {
    const req = postRequest({
      url: 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json',
      method: 'GET',
    });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.status).toBe(200);
    expect(typeof payload.body).toBe('string');
    const decoded = new TextDecoder().decode(b64ToBytes(payload.body));
    const parsed = JSON.parse(decoded);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  }, 20000);

  test('DoD#2: release-asset (302 → githubusercontent CDN) is followed', async () => {
    const req = postRequest({
      url: 'https://github.com/obsidianmd/obsidian-releases/releases/download/v1.4.16/obsidian-1.4.16.asar.gz',
      method: 'GET',
    });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(200);
    const payload = await res.json();
    // Followed the redirect to release-assets.githubusercontent.com (or
    // similar CDN host) and got the actual asset back, not the 302 itself.
    expect(payload.status).toBe(200);
    expect(typeof payload.body).toBe('string');
    expect(payload.body.length).toBeGreaterThan(0);
  }, 20000);

  test('DoD#3: SSRF — disallowed host → 403', async () => {
    const req = postRequest({ url: 'https://evil.com/steal', method: 'GET' });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(403);
  });

  test('DoD#3: SSRF — 169.254.169.254 (cloud metadata) → 403', async () => {
    const req = postRequest({ url: 'http://169.254.169.254/latest/meta-data/', method: 'GET' });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(403);
  });

  test('DoD#3: SSRF — localhost → 403', async () => {
    const req = postRequest({ url: 'http://localhost:8080/', method: 'GET' });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(403);
  });

  test('DoD#3: SSRF — real allow-listed host redirecting off-list stays 502-safe (sanity)', async () => {
    // Sanity check with real GitHub infra: an allow-listed URL that redirects
    // within the allow-list (release CDN) must NOT be spuriously blocked.
    // The actual "redirect lands on a disallowed/internal host → 502" branch
    // is exercised deterministically below (real GitHub won't redirect us to
    // 169.254.169.254 on demand), by stubbing only the transport (fetch)
    // while running the real handleProxy/isAllowed redirect-chain logic.
    const req = postRequest({
      url: 'https://github.com/obsidianmd/obsidian-releases/releases/download/v1.4.16/obsidian-1.4.16.asar.gz',
      method: 'GET',
    });
    const res = await handleProxy(req, makeCtx());
    const payload = await res.json();
    expect(payload.status).not.toBe(502);
  }, 20000);

  test('DoD#3: SSRF — redirect chain landing on internal host → 502 blocked, not followed', async () => {
    // github.com is allow-listed, so the initial request passes isAllowed();
    // stub the transport to return a 302 pointing at the AWS/GCP metadata
    // endpoint, exactly as a compromised/malicious upstream could attempt.
    // handleProxy must re-check isAllowed() on the redirect target and
    // refuse to follow it (502), never leaking the request to 169.254.169.254.
    const realFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async (_url, _opts) => {
      fetchCalls++;
      return new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      });
    };
    try {
      const req = postRequest({ url: 'https://github.com/some/redirecting-path', method: 'GET' });
      const res = await handleProxy(req, makeCtx());
      const payload = await res.json();
      expect(payload.error).toBe('redirect to disallowed host blocked');
      expect(res.status).toBe(502);
      expect(fetchCalls).toBe(1); // never followed the redirect with a second fetch
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('missing url → 400', async () => {
    const req = postRequest({ method: 'GET' });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(400);
  });

  test('invalid JSON body → 400', async () => {
    const req = new Request('https://worker.example/api/proxy-request', {
      method: 'POST',
      body: 'not json',
    });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(400);
  });
});

// ── isCacheableHost unit (§9 Q1 decision: only immutable-content hosts) ─────

describe('isCacheableHost', () => {
  test('immutable-content hosts are cacheable', () => {
    expect(isCacheableHost('https://raw.githubusercontent.com/x')).toBe(true);
    expect(isCacheableHost('https://releases.obsidian.md/x')).toBe(true);
    expect(isCacheableHost('https://release-assets.githubusercontent.com/x')).toBe(true);
  });

  test('api.github.com (mutable lists) is NOT cacheable — §9 Q1', () => {
    expect(isCacheableHost('https://api.github.com/repos/x/y/releases')).toBe(false);
  });

  test('non-allow-listed / malformed → false', () => {
    expect(isCacheableHost('https://evil.com/x')).toBe(false);
    expect(isCacheableHost('not a url')).toBe(false);
  });
});

// ── DoD#4 — Cache API (caches.default mock) ─────────────────────────────────

describe('handleProxy — Cache API (DoD#4)', () => {
  test('second GET to a cacheable host → x-ow-cache:hit, no second network fetch', async () => {
    const realCaches = globalThis.caches;
    const realFetch = globalThis.fetch;
    globalThis.caches = makeMockCaches();
    let fetchCalls = 0;
    globalThis.fetch = async (...args) => {
      fetchCalls++;
      return realFetch(...args);
    };
    try {
      const url = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';

      // First call: real network fetch, cache miss, response cached via
      // ctx.waitUntil (must await it — that's how the Worker runtime keeps
      // the cache write alive past the response, and how we observe it here).
      const ctx1 = makeCtx();
      const res1 = await handleProxy(postRequest({ url, method: 'GET' }), ctx1);
      expect(res1.status).toBe(200);
      expect(res1.headers.get('x-ow-cache')).not.toBe('hit');
      await Promise.all(ctx1.waited);
      expect(fetchCalls).toBe(1);

      // Second call, same URL: must come from cache — no second network
      // fetch, and the hit marker is set.
      const ctx2 = makeCtx();
      const res2 = await handleProxy(postRequest({ url, method: 'GET' }), ctx2);
      expect(res2.headers.get('x-ow-cache')).toBe('hit');
      expect(fetchCalls).toBe(1); // unchanged — no second fetch() call
    } finally {
      globalThis.caches = realCaches;
      globalThis.fetch = realFetch;
    }
  }, 20000);

  test('non-cacheable host (api.github.com) is never cached — always a fresh fetch', async () => {
    const realCaches = globalThis.caches;
    const realFetch = globalThis.fetch;
    globalThis.caches = makeMockCaches();
    let fetchCalls = 0;
    globalThis.fetch = async (...args) => {
      fetchCalls++;
      return realFetch(...args);
    };
    try {
      const url = 'https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest';
      const ctx1 = makeCtx();
      const res1 = await handleProxy(postRequest({ url, method: 'GET' }), ctx1);
      expect(res1.status).toBe(200);
      await Promise.all(ctx1.waited);
      expect(fetchCalls).toBe(1);

      const ctx2 = makeCtx();
      const res2 = await handleProxy(postRequest({ url, method: 'GET' }), ctx2);
      expect(res2.headers.get('x-ow-cache')).not.toBe('hit');
      expect(fetchCalls).toBe(2); // fetched again — api.github.com is excluded from caching
    } finally {
      globalThis.caches = realCaches;
      globalThis.fetch = realFetch;
    }
  }, 20000);
});

// forbidden request-headers (Content-Length/Transfer-Encoding) — Worker fetch
// HANGS on these (calev finding), so handleProxy must strip them before fetch.
test('strips forbidden request headers before fetch (calev medium finding)', async () => {
  const origFetch = globalThis.fetch;
  let seenHeaders = null;
  globalThis.fetch = async (u, opts) => {
    seenHeaders = opts.headers;
    return new Response('ok', { status: 200 });
  };
  try {
    const req = new Request('https://x/', { method: 'POST', body: JSON.stringify({
      url: 'https://raw.githubusercontent.com/o/r/main/x.txt', method: 'GET',
      headers: { 'Content-Length': '99', 'Transfer-Encoding': 'chunked', 'Authorization': 'Basic zzz', 'Connection': 'keep-alive' },
    }) });
    const mockCaches = { default: { match: async () => undefined, put: async () => {} } };
    await handleProxy(req, { waitUntil() {} }, mockCaches);
    expect(seenHeaders['Content-Length'] || seenHeaders['content-length']).toBeUndefined();
    expect(seenHeaders['Transfer-Encoding'] || seenHeaders['transfer-encoding']).toBeUndefined();
    expect(seenHeaders['Connection'] || seenHeaders['connection']).toBeUndefined();
    expect(seenHeaders['Authorization']).toBe('Basic zzz');   // legit header survives
  } finally { globalThis.fetch = origFetch; }
});

// ── §3.3 — rate limiting (docs/plans/client-only-resilience.md) ────────────
// Uses 'https://evil.com/x' as the target on purpose: isAllowed() rejects it
// with a fast, network-free 403 — proves the rate-limit check runs (or
// doesn't) without depending on real network calls or DoD#1/2's manifest
// fetch. A 403 vs 429 status is exactly what distinguishes
// "rate-limited" from "reached the handler and got rejected for another
// reason" here.

describe('rate limiting (§3.3)', () => {
  test('DoD#6: under the 30/min limit → no 429 (still 403s from isAllowed, not rate-limited)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await handleProxy(postRequestFromIp('1.2.3.4', { url: 'https://evil.com/x' }), makeCtx());
      expect(res.status).toBe(403);
    }
  });

  test('DoD#6: the 31st request/min from one IP → 429', async () => {
    let last;
    for (let i = 0; i < 31; i++) {
      last = await handleProxy(postRequestFromIp('5.6.7.8', { url: 'https://evil.com/x' }), makeCtx());
    }
    expect(last.status).toBe(429);
  });

  test('a different IP is unaffected by another IP already at its limit', async () => {
    for (let i = 0; i < 31; i++) {
      await handleProxy(postRequestFromIp('9.9.9.9', { url: 'https://evil.com/x' }), makeCtx());
    }
    const res = await handleProxy(postRequestFromIp('1.1.1.1', { url: 'https://evil.com/x' }), makeCtx());
    expect(res.status).not.toBe(429);
  });

  test('missing CF-Connecting-IP bypasses the limiter entirely (matches prod-behind-Cloudflare vs. test reality)', async () => {
    for (let i = 0; i < 40; i++) {
      const res = await handleProxy(postRequest({ url: 'https://evil.com/x' }), makeCtx());
      expect(res.status).not.toBe(429);
    }
  });

  test('DoD#7 sanity: rate limiting does not block a legitimate request under the limit', async () => {
    const res = await handleProxy(postRequestFromIp('8.8.4.4', {
      url: 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json',
      method: 'GET',
    }), makeCtx());
    expect(res.status).toBe(200);
  }, 20000);

  // ── §3.5ה (calev PARTIAL, ממצא 5 — DoD#16) ────────────────────────────────
  // rateLimitMap used to grow without bound: a scan across distinct IPs left
  // one permanent entry per IP, never pruned. These exercise the cap/prune
  // logic directly with a small max-entries value (rather than pushing the
  // real 10,000-entry production cap through handleProxy on every test run)
  // and a fake clock for the window-expiry case — same technique calev used
  // to drive the probe by hand.

  test('DoD#16: the tracked-IP map is capped — distinct IPs beyond the cap evict rather than grow forever', async () => {
    __setRateLimitMaxEntriesForTest(5);
    try {
      for (let i = 0; i < 8; i++) {
        await handleProxy(postRequestFromIp('50.0.0.' + i, { url: 'https://evil.com/x' }), makeCtx());
      }
      expect(__getRateLimitMapSizeForTest()).toBeLessThanOrEqual(5);
    } finally {
      __setRateLimitMaxEntriesForTest(10000);
    }
  });

  test('DoD#16: pruning drops expired entries at the cap instead of evicting still-live ones', async () => {
    __setRateLimitMaxEntriesForTest(3);
    const origNow = Date.now;
    try {
      let t = 1_000_000;
      Date.now = () => t;
      await handleProxy(postRequestFromIp('60.0.0.1', { url: 'https://evil.com/x' }), makeCtx());
      await handleProxy(postRequestFromIp('60.0.0.2', { url: 'https://evil.com/x' }), makeCtx());
      await handleProxy(postRequestFromIp('60.0.0.3', { url: 'https://evil.com/x' }), makeCtx());
      expect(__getRateLimitMapSizeForTest()).toBe(3);

      t += 61_000;   // past the fixed 60s window — all three entries above are now expired
      await handleProxy(postRequestFromIp('60.0.0.4', { url: 'https://evil.com/x' }), makeCtx());
      // Hitting the cap with the new IP prunes the three expired entries
      // first, then inserts — net result is 1 entry, not "3 kept, oldest
      // live one evicted".
      expect(__getRateLimitMapSizeForTest()).toBe(1);
    } finally {
      Date.now = origNow;
      __setRateLimitMaxEntriesForTest(10000);
    }
  });

  test('DoD#16: a 429 response carries Retry-After', async () => {
    let last;
    for (let i = 0; i < 31; i++) {
      last = await handleProxy(postRequestFromIp('70.0.0.1', { url: 'https://evil.com/x' }), makeCtx());
    }
    expect(last.status).toBe(429);
    expect(last.headers.get('Retry-After')).toBe('60');
  });

  // ── §3.6ב (calev-heavy NO-GO round 2, finding 3) ────────────────────────────
  // The old eviction path evicted `rateLimitMap.keys().next().value` — the
  // oldest entry by insertion order — whenever the cap was still full after
  // pruning. A currently-throttled IP (still very much "live", not expired)
  // stays in the map and, if it was one of the earliest entries inserted, is
  // exactly the oldest surviving one — so a flood of new distinct IPs could
  // evict IT and hand it back a fresh 200. Regression test: throttle one IP,
  // then push the map to its cap with brand-new IPs, then confirm the
  // throttled IP is STILL throttled — its entry must never be evicted just
  // to make room for someone else, only pruning of truly-expired entries may
  // free space.
  test('DoD#16 / §3.6ב: a throttled IP stays throttled even when the cap is filled by other IPs', async () => {
    __setRateLimitMaxEntriesForTest(2);
    try {
      // Throttle 90.0.0.1 — 31 requests within the same (real, un-mocked)
      // clock tick trips the 30/minute limit.
      let last;
      for (let i = 0; i < 31; i++) {
        last = await handleProxy(postRequestFromIp('90.0.0.1', { url: 'https://evil.com/x' }), makeCtx());
      }
      expect(last.status).toBe(429);

      // Map is now { 90.0.0.1 } (size 1, cap 2). One more distinct IP fills
      // the cap exactly (size 2); a further one used to force an eviction.
      await handleProxy(postRequestFromIp('90.0.0.2', { url: 'https://evil.com/x' }), makeCtx());
      expect(__getRateLimitMapSizeForTest()).toBe(2);
      await handleProxy(postRequestFromIp('90.0.0.3', { url: 'https://evil.com/x' }), makeCtx());
      // Cap still 2 — 90.0.0.3 went untracked rather than evicting anyone
      // (nothing here has expired: RATE_LIMIT_WINDOW_MS is 60s, this test
      // runs in milliseconds).
      expect(__getRateLimitMapSizeForTest()).toBe(2);

      // The decisive assertion: 90.0.0.1's throttle must have survived —
      // its counter was never reset by the eviction that used to happen
      // when 90.0.0.3 arrived at a full cap.
      const stillThrottled = await handleProxy(
        postRequestFromIp('90.0.0.1', { url: 'https://evil.com/x' }), makeCtx());
      expect(stillThrottled.status).toBe(429);
    } finally {
      __setRateLimitMaxEntriesForTest(10000);
    }
  });
});
