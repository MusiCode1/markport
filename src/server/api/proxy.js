/**
 * Outbound HTTP proxy for requests that Obsidian initiates via
 * ipcRenderer.send("request-url", replyId, req).
 *
 * The browser cannot make these requests directly because external servers
 * (e.g. releases.obsidian.md, GitHub) do not send CORS headers. The
 * electron shim intercepts the IPC message, forwards it to this endpoint,
 * and the server makes the request server-side.
 *
 * POST /api/proxy-request
 * Body: { url, method, headers, contentType, body, binary }
 * Response: { status, headers, body (base64 when binary) }
 */

'use strict';

const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Simple allow-list of hostnames we are willing to proxy.
// Keeps this from becoming an open proxy.
const ALLOWED_HOSTS = new Set([
  'releases.obsidian.md',
  'raw.githubusercontent.com',
  'api.github.com',
  'github.com',
  'forum.obsidian.md',
  'obsidian.md',
  // Templater uses these:
  'templater-unsplash-2.fly.dev',
  'raw.githubusercontent.com',
  // Allow any obsidian or github subdomain:
]);

function isAllowed(urlStr) {
  try {
    const { hostname } = new URL(urlStr);
    if (ALLOWED_HOSTS.has(hostname)) return true;
    // Allow any subdomain of allowed roots
    if (hostname.endsWith('.obsidian.md')) return true;
    if (hostname.endsWith('.github.com')) return true;
    if (hostname.endsWith('.githubusercontent.com')) return true;
    return false;
  } catch (_) {
    return false;
  }
}

function fetchUrl(urlStr, method, reqHeaders, body, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return reject(e); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method || 'GET',
      headers: { 'User-Agent': 'Obsidian/1.12.7', ...reqHeaders },
    };

    const req = lib.request(options, (res) => {
      // Follow redirects (GitHub releases redirect to CDN)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); // drain the response
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        const next = new URL(res.headers.location, urlStr).toString();
        // Don't check allow-list for redirect targets — caller already validated origin
        fetchUrl(next, res.statusCode === 303 ? 'GET' : method, reqHeaders, body, redirectsLeft - 1)
          .then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks);
        const resHeaders = {};
        // Lowercase header keys to match Obsidian expectations
        for (const [k, v] of Object.entries(res.headers)) {
          resHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
        }
        resolve({ status: res.statusCode, headers: resHeaders, body: rawBody });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function createProxyRouter() {
  const router = express.Router();

  router.post('/', express.json({ limit: '4mb' }), async (req, res) => {
    const { url, method, headers: reqHeaders = {}, contentType, body, binary } = req.body || {};

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url required' });
    }
    if (!isAllowed(url)) {
      console.warn('[proxy] blocked:', url);
      return res.status(403).json({ error: 'host not allowed' });
    }

    const outHeaders = { ...reqHeaders };
    if (contentType) outHeaders['Content-Type'] = contentType;

    let outBody;
    if (body) {
      outBody = binary ? Buffer.from(body, 'base64') : Buffer.from(body);
    }

    try {
      const result = await fetchUrl(url, method, outHeaders, outBody);
      // Return body as base64 so it survives JSON transport cleanly
      res.json({
        status: result.status,
        headers: result.headers,
        body: result.body.toString('base64'),
      });
    } catch (err) {
      console.error('[proxy] error fetching', url, err.message);
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createProxyRouter;
