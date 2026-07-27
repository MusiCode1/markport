// Cloudflare Worker port of src/runtime-server/server/api/proxy.js — outbound HTTP proxy for
// requests Obsidian initiates via ipcRenderer.send("request-url", ...). The
// browser cannot make these requests directly because external servers (e.g.
// releases.obsidian.md, GitHub) do not send CORS headers. capacitor-shim.js
// (client-mobile) intercepts those and forwards them here.
//
// POST /api/proxy-request
// Body:     { url, method, headers, contentType, body, binary }
// Response: { status, headers (lowercase), body } — body is ALWAYS base64
//           (matches capacitor-shim.js:732-740, which expects base64 always,
//           not just for binary payloads).
//
// Same allow-list + SSRF guard + redirect handling as the Node proxy — see
// src/runtime-server/server/api/proxy.js for the reference implementation this was ported
// from. Differences are Worker-runtime constraints only (no Buffer/Node http,
// manual redirect handling via fetch({redirect:'manual'}), Cache API instead
// of an in-process cache).
//
// Cache API note (brief finding 3 / §9 Q0): caches.default is a no-op on
// *.workers.dev (documented CF limitation) — it's only active on a
// custom-domain/route. Functional either way; caching is purely an
// optimization. See README for the routes/wrangler.toml uncomment needed in
// prod to get cache hits.

// Simple allow-list of hostnames we are willing to proxy. Keeps this from
// becoming an open proxy.
const ALLOWED_HOSTS = new Set([
  'releases.obsidian.md',
  'raw.githubusercontent.com',
  'api.github.com',
  'github.com',
  'forum.obsidian.md',
  'obsidian.md',
  // Templater uses this:
  'templater-unsplash-2.fly.dev',
]);

export function isAllowed(urlStr) {
  try {
    const { hostname } = new URL(urlStr);
    if (ALLOWED_HOSTS.has(hostname)) return true;
    // Allow any subdomain of allowed roots.
    if (hostname.endsWith('.obsidian.md')) return true;
    if (hostname.endsWith('.github.com')) return true;
    if (hostname.endsWith('.githubusercontent.com')) return true;
    return false;
  } catch (_) {
    return false;
  }
}

// ── base64 helpers (finding 1 🔴) ───────────────────────────────────────────
// There is no Buffer in the Worker runtime, and btoa() only accepts a
// "binary string" — NOT a Uint8Array/ArrayBuffer directly (it would silently
// stringify to "104,101,..." instead of encoding the bytes). Converting the
// whole buffer to a string in one shot via String.fromCharCode.apply(null,
// bytes) also blows the call stack on large buffers (plugin/asset downloads
// can be several MB), so this chunks the conversion.
export function bytesToB64(arrBuf) {
  const bytes = new Uint8Array(arrBuf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// Hosts we cache GET responses for — immutable content only (raw file /
// release-asset downloads). Deliberately excludes api.github.com: community
// plugin/theme list responses from that host change over time, and caching
// them would serve stale plugin listings (brief §9 Q1).
const CACHEABLE_HOSTS = new Set(['raw.githubusercontent.com', 'releases.obsidian.md']);

export function isCacheableHost(urlStr) {
  try {
    const { hostname } = new URL(urlStr);
    if (CACHEABLE_HOSTS.has(hostname)) return true;
    if (hostname.endsWith('.githubusercontent.com')) return true;
    return false;
  } catch (_) {
    return false;
  }
}

// ── rate limiting (§3.3, docs/plans/client-only-resilience.md) ─────────────
// In-memory, isolate-lifetime counter — NOT KV/Durable-Object state. Decision
// (see brief §3.3): caches.default is a documented no-op on *.pages.dev (no
// zone — same limitation this file's Cache API section already notes), and
// that SAME limitation rules out Cloudflare WAF rate-limiting rules (also
// zone-only) — "let Cloudflare handle it" isn't available on this
// deployment. handleProxy(request, ctx) deliberately does NOT gain an `env`
// parameter for this — a plain Map needs none, and proxy-worker.test.js:337
// already passes an (unused) third argument, so adding a real `env` there
// would silently collide with it for no benefit.
// Approved by the user (2026-07-25): 30 requests/minute per IP — generous
// enough for a plugin-install burst, tight enough against gross abuse.
// NOT precise: isolates recycle and the Map resets with them — acceptable
// per the user's own framing ("enough against abuse, not a hard quota").
const RATE_LIMIT_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
// §3.5ה (calev PARTIAL, ממצא 5 — DoD#16): hard cap on the number of distinct
// IPs tracked at once. Without one, the Map grows without bound — a scan
// across N distinct IPs leaves N live entries forever if they never come
// back (verified: 5000 distinct IPs through one isolate, all retained).
// Each entry is tiny, so this is a slow-burn, not an exploit, but it's
// unbounded state in a component whose whole selling point is being
// state-free, and isolates have a hard memory ceiling. 10k entries is
// generous headroom over any realistic per-isolate concurrent-abuser count
// while still bounding worst-case memory.
export let RATE_LIMIT_MAX_ENTRIES = 10000;
let rateLimitMap = new Map();

// Exposed for tests only: a module-level Map persists across every test case
// in a single bun-test file run, so cases would otherwise leak counters into
// each other (brief §3.3 finding). Call from beforeEach.
export function __resetRateLimit() {
  rateLimitMap = new Map();
}

// Test-only: lets §3.5ה's cap/prune tests exercise the eviction path without
// pushing 10k+ real requests through handleProxy on every run.
export function __setRateLimitMaxEntriesForTest(n) {
  RATE_LIMIT_MAX_ENTRIES = n;
}

export function __getRateLimitMapSizeForTest() {
  return rateLimitMap.size;
}

// Drops entries whose window has already fully expired — called
// opportunistically (not on every request; a Map.size check is O(1), a full
// sweep is O(n)) so long-running isolates don't accumulate one entry per
// distinct IP ever seen, only per IP active within the last window.
function pruneExpiredRateLimitEntries(now) {
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(key);
  }
}

// Missing CF-Connecting-IP bypasses the limiter entirely — in production
// behind Cloudflare the header is always present; proxy-worker.test.js's
// ~15 pre-existing DoD calls never set it (brief §3.3 finding: rate-limiting
// them by IP would 429 the whole file since they'd all share one bucket).
function checkRateLimit(ip) {
  if (!ip) return true;
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    if (rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
      pruneExpiredRateLimitEntries(now);
    }
    // §3.6ב (calev-heavy NO-GO round 2, finding 3): the old code fell back to
    // evicting `rateLimitMap.keys().next().value` — the OLDEST entry — when
    // pruning didn't free enough room. Oldest-by-insertion-order is NOT the
    // same as "expired": a currently-throttled IP that has been hammering
    // the proxy is exactly the kind of entry that stays oldest-and-live the
    // longest, so a flood of ~RATE_LIMIT_MAX_ENTRIES distinct new IPs could
    // evict it and hand it a free reset of its own 429 (measured: 10,001
    // distinct IPs bought back a throttled IP's counter). Never evict a
    // live (non-expired) entry — if the cap is still full after pruning
    // truly-expired ones, this new IP just goes untracked for this one
    // request (best-effort limiter, not a hard quota — see README Known
    // gaps). Memory stays bounded either way: we simply stop inserting once
    // at the cap, we don't evict to make room.
    if (rateLimitMap.size < RATE_LIMIT_MAX_ENTRIES) {
      rateLimitMap.set(ip, { count: 1, windowStart: now });
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_PER_MINUTE;
}

export async function handleProxy(request, ctx) {
  // Cheapest possible check first — before even parsing the body — so an
  // abusive client pays no JSON-parse cost either.
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (!checkRateLimit(clientIp)) {
    // §3.5ה (DoD#16): tell the client how long to back off instead of
    // leaving it to guess/hammer — the window is fixed (not sliding), so the
    // worst case is "wait out the rest of THIS window", i.e. up to
    // RATE_LIMIT_WINDOW_MS. Not exact (we don't track per-IP remaining time
    // here), but a same-order-of-magnitude value is far better than none.
    return json({ error: 'rate limit exceeded' }, 429, {
      'Retry-After': String(RATE_LIMIT_WINDOW_MS / 1000),
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const { url, method = 'GET', headers = {}, contentType, body, binary } = payload || {};

  if (!url || typeof url !== 'string') return json({ error: 'url required' }, 400);
  if (!isAllowed(url)) return json({ error: 'host not allowed' }, 403);

  // Cache: only GET, and only for immutable-content hosts (finding 3 / §9 Q1).
  // Cache key is the outbound URL itself, as a plain GET Request.
  const cacheable = (method === 'GET' || !method) && isCacheableHost(url);
  const cacheKey = new Request(url, { method: 'GET' });
  if (cacheable) {
    const hit = await caches.default.match(cacheKey);
    if (hit) {
      const out = new Response(hit.body, hit);
      out.headers.set('x-ow-cache', 'hit');
      return out;
    }
  }

  let resp;
  try {
    // finding 2 🔴: the whole outbound fetch + redirect chain is wrapped in
    // try/catch → 502 on any network failure, matching proxy.js's error
    // contract (capacitor-shim.js throws when `!pr.ok`).
    let cur = url;
    let m = method;
    const hdrs = { 'User-Agent': 'Obsidian/1.12.7', ...headers };
    if (contentType) hdrs['Content-Type'] = contentType;
    // Forbidden request-headers: Cloudflare's `fetch` does NOT throw on these —
    // it HANGS indefinitely (empirically confirmed by calev), so the try/catch
    // below never fires and a plugin-supplied Content-Length/Transfer-Encoding
    // would silently wedge its download. `RequestUrlParam.headers` is
    // plugin-controlled, so strip the request-body/connection-framing headers
    // (the runtime sets them correctly itself). Node's http passes them through
    // fine, hence proxy.js didn't need this — Worker fetch does.
    const FORBIDDEN = ['host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'expect'];
    for (const k of Object.keys(hdrs)) {
      if (FORBIDDEN.indexOf(k.toLowerCase()) !== -1) delete hdrs[k];
    }
    let reqBody = body ? (binary ? b64ToBytes(body) : body) : undefined;

    for (let i = 0; i < 6; i++) {
      resp = await fetch(cur, { method: m, headers: hdrs, body: reqBody, redirect: 'manual' });
      if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location') && i < 5) {
        const next = new URL(resp.headers.get('location'), cur).toString();
        // SSRF guard: the redirect target must ALSO be allow-listed. GitHub's
        // release CDN (objects/release-assets.githubusercontent.com) is
        // covered by the `.githubusercontent.com` rule, so real downloads
        // still follow; a redirect to an internal/metadata host
        // (169.254.169.254, localhost) is refused.
        if (!isAllowed(next)) return json({ error: 'redirect to disallowed host blocked' }, 502);
        if (new URL(next).hostname !== new URL(cur).hostname) {
          delete hdrs.authorization;
          delete hdrs.Authorization;
          delete hdrs.cookie;
          delete hdrs.Cookie;
        }
        if (resp.status === 303) {
          m = 'GET';
          reqBody = undefined;
        }
        cur = next;
        continue;
      }
      break;
    }
  } catch (err) {
    return json({ error: (err && err.message) || 'fetch failed' }, 502);
  }

  const buf = await resp.arrayBuffer();
  const outHeaders = {};
  for (const [k, v] of resp.headers) outHeaders[k.toLowerCase()] = v;
  const responsePayload = JSON.stringify({
    status: resp.status,
    headers: outHeaders,
    body: bytesToB64(buf),
  });
  const out = new Response(responsePayload, { headers: { 'Content-Type': 'application/json' } });

  if (cacheable && resp.status === 200) {
    const toCache = out.clone();
    toCache.headers.set('Cache-Control', 'public, max-age=86400');
    ctx.waitUntil(caches.default.put(cacheKey, toCache));
  }

  return out;
}
