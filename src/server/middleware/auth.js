'use strict';

/**
 * TOTP authentication middleware.
 * Activated when TOTP_SECRET env var is set.
 *
 * Routes:
 *   /__login        — 6-digit code entry form
 *   /__auth?code=   — verifies code, sets session cookie
 *   /__totp-setup   — QR code + raw secret (requires ?token=TOTP_SECRET)
 *
 * Generate a secret (run once in src/server/):
 *   node -e "const {authenticator}=require('otplib');console.log(authenticator.generateSecret())"
 */

const crypto        = require('crypto');
const fs            = require('fs');
const path          = require('path');
const { authenticator } = require('otplib');
const QRCode        = require('qrcode');

const TOTP_SECRET = process.env.TOTP_SECRET || '';
const COOKIE      = 'obsidian-web-session';
const MAX_AGE     = 7 * 24 * 60 * 60; // 7 days

// Allow 1 step (±30 s) of clock drift between phone and server
authenticator.options = { window: 1 };

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';')
      .map(c => c.trim().split('='))
      .filter(p => p.length >= 2)
      .map(([k, ...v]) => [k.trim(), v.join('=')])
  );
}

// ── Sessions ───────────────────────────────────────────────────────────────────
// Random token per successful login (NOT derived from the TOTP secret — a
// derived token never rotates, so one leaked cookie would be valid forever).
// Sessions persist to .sessions.json so a server restart doesn't log
// everyone out; expired entries are pruned on every load/save.

class SessionStore {
  constructor(file) {
    this.file = file; // null → in-memory only
    this.sessions = this.load();
  }

  load() {
    if (!this.file) return {};
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
      const now = Date.now();
      for (const [token, expires] of Object.entries(data)) {
        if (typeof expires !== 'number' || expires < now) delete data[token];
      }
      return data;
    } catch (_) {
      return {};
    }
  }

  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.sessions));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn('[auth] failed to persist sessions:', err.message);
    }
  }

  create() {
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions[token] = Date.now() + MAX_AGE * 1000;
    this.save();
    return token;
  }

  has(token) {
    if (!token) return false;
    const expires = this.sessions[token];
    if (!expires) return false;
    if (expires < Date.now()) {
      delete this.sessions[token];
      this.save();
      return false;
    }
    return true;
  }
}

// ── Rate limiting ──────────────────────────────────────────────────────────────
// A 6-digit TOTP with ±1 step drift is brute-forceable without throttling.
// Allow MAX_ATTEMPTS failed codes per IP per window; successes reset the
// counter. In-memory: a restart clears it, which only helps the attacker by
// MAX_ATTEMPTS more guesses — negligible against 10^6 codes.

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

class RateLimiter {
  constructor() {
    this.attempts = new Map(); // ip → { count, resetAt }
  }

  clientIp(req) {
    // Behind cloudflared/reverse proxies the socket address is the proxy;
    // use the first forwarded hop when present.
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
  }

  isBlocked(req) {
    const entry = this.attempts.get(this.clientIp(req));
    if (!entry) return false;
    if (Date.now() > entry.resetAt) {
      this.attempts.delete(this.clientIp(req));
      return false;
    }
    return entry.count >= MAX_ATTEMPTS;
  }

  recordFailure(req) {
    const ip = this.clientIp(req);
    const entry = this.attempts.get(ip);
    if (!entry || Date.now() > entry.resetAt) {
      this.attempts.set(ip, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS });
    } else {
      entry.count++;
    }
  }

  recordSuccess(req) {
    this.attempts.delete(this.clientIp(req));
  }
}

// ── HTML pages ─────────────────────────────────────────────────────────────────

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Obsidian Web — Sign in</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:#1e2127;color:#abb2bf;
         display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#282c34;border-radius:10px;padding:2rem 2rem 1.75rem;
          width:100%;max-width:320px;box-shadow:0 4px 32px rgba(0,0,0,.5)}
    h1{color:#e5c07b;font-size:1.1rem;margin-bottom:.35rem;text-align:center}
    p.sub{color:#7f848e;font-size:.82rem;text-align:center;margin-bottom:1.6rem}
    .digits{display:flex;gap:8px;justify-content:center;margin-bottom:1.1rem}
    .digits input{
      width:40px;height:52px;border-radius:6px;border:1.5px solid #3e4451;
      background:#1e2127;color:#e5c07b;font-size:1.5rem;font-weight:600;
      text-align:center;outline:none;transition:border-color .15s;
      /* hide number spinners */
      -moz-appearance:textfield;
    }
    .digits input::-webkit-inner-spin-button,
    .digits input::-webkit-outer-spin-button{-webkit-appearance:none}
    .digits input:focus{border-color:#e5c07b}
    .err{color:#e06c75;font-size:.82rem;text-align:center;
         min-height:1.2em;margin-bottom:.75rem}
    button{width:100%;padding:.65rem;border:none;border-radius:6px;
           background:#e5c07b;color:#1e2127;font-size:1rem;
           font-weight:600;cursor:pointer}
    button:hover{background:#d4af5a}
    button:disabled{opacity:.5;cursor:default}
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 Obsidian Web</h1>
    <p class="sub">Enter the 6-digit code from your authenticator app</p>
    <form id="f" method="get" action="/__auth">
      <input type="hidden" name="next" id="next"/>
      <input type="hidden" name="code" id="code"/>
      <div class="digits" id="digits">
        <input type="number" maxlength="1" min="0" max="9" inputmode="numeric" autofocus/>
        <input type="number" maxlength="1" min="0" max="9" inputmode="numeric"/>
        <input type="number" maxlength="1" min="0" max="9" inputmode="numeric"/>
        <input type="number" maxlength="1" min="0" max="9" inputmode="numeric"/>
        <input type="number" maxlength="1" min="0" max="9" inputmode="numeric"/>
        <input type="number" maxlength="1" min="0" max="9" inputmode="numeric"/>
      </div>
      <p class="err" id="err"></p>
      <button type="submit" id="btn" disabled>Sign in</button>
    </form>
  </div>
  <script>
    const p=new URLSearchParams(location.search);
    document.getElementById('next').value=p.get('next')||'/';
    if(p.get('error'))document.getElementById('err').textContent='Incorrect code — try again.';
    const inputs=[...document.querySelectorAll('.digits input')];
    const btn=document.getElementById('btn');
    function getCode(){return inputs.map(i=>i.value).join('');}
    function update(){btn.disabled=getCode().length<6;}
    inputs.forEach((inp,i)=>{
      inp.addEventListener('input',e=>{
        // clamp to single digit
        if(inp.value.length>1)inp.value=inp.value.slice(-1);
        inp.value=inp.value.replace(/[^0-9]/g,'');
        update();
        if(inp.value&&i<5)inputs[i+1].focus();
        if(getCode().length===6)document.getElementById('f').requestSubmit();
      });
      inp.addEventListener('keydown',e=>{
        if(e.key==='Backspace'&&!inp.value&&i>0)inputs[i-1].focus();
      });
      inp.addEventListener('paste',e=>{
        const txt=(e.clipboardData||window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6);
        txt.split('').forEach((d,j)=>{if(inputs[i+j])inputs[i+j].value=d;});
        update();e.preventDefault();
        if(getCode().length===6)document.getElementById('f').requestSubmit();
      });
    });
    document.getElementById('f').addEventListener('submit',e=>{
      document.getElementById('code').value=getCode();
    });
  </script>
</body>
</html>`;

async function buildSetupPage(secret) {
  const otpauth = authenticator.keyuri('obsidian-web', 'Obsidian Web', secret);
  const qrSvg   = await QRCode.toString(otpauth, { type: 'svg', width: 220, margin: 2 });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Obsidian Web — Authenticator Setup</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:#1e2127;color:#abb2bf;
         display:flex;align-items:center;justify-content:center;
         min-height:100vh;padding:1.5rem}
    .card{background:#282c34;border-radius:10px;padding:2rem;
          width:100%;max-width:380px;box-shadow:0 4px 32px rgba(0,0,0,.5)}
    h1{color:#e5c07b;font-size:1.15rem;margin-bottom:.4rem}
    p{color:#7f848e;font-size:.85rem;line-height:1.5;margin-bottom:1.2rem}
    .qr{background:#fff;border-radius:8px;padding:12px;
        display:inline-flex;margin-bottom:1.4rem}
    .qr svg{display:block}
    h2{color:#abb2bf;font-size:.85rem;font-weight:600;
       text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem}
    .secret{background:#1e2127;border-radius:6px;padding:.75rem 1rem;
            font-family:'SF Mono','Fira Mono','Consolas',monospace;
            font-size:1.1rem;letter-spacing:.12em;color:#98c379;
            word-break:break-all;margin-bottom:1.4rem;
            border:1px solid #3e4451;user-select:all;cursor:pointer}
    .secret:hover{border-color:#e5c07b}
    .apps{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1.4rem}
    .apps a{background:#2c313c;color:#abb2bf;text-decoration:none;
            padding:.35rem .75rem;border-radius:20px;font-size:.8rem}
    .apps a:hover{color:#e5c07b}
    .note{background:#2c313c;border-left:3px solid #e06c75;
          padding:.75rem 1rem;border-radius:0 6px 6px 0;
          font-size:.82rem;color:#7f848e}
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 Authenticator Setup</h1>
    <p>Scan the QR code with your authenticator app, or enter the secret manually.</p>

    <div class="qr">${qrSvg}</div>

    <h2>Manual entry code</h2>
    <div class="secret" title="Click to select all">${secret}</div>

    <h2>Compatible apps</h2>
    <div class="apps">
      <a href="https://apps.apple.com/app/google-authenticator/id388497605" target="_blank">Google Authenticator (iOS)</a>
      <a href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2" target="_blank">Google Authenticator (Android)</a>
      <a href="https://authy.com/download/" target="_blank">Authy</a>
      <a href="https://apps.apple.com/app/microsoft-authenticator/id983156458" target="_blank">Microsoft Authenticator</a>
    </div>

    <div class="note">
      <strong>Keep this page private.</strong><br/>
      Once you've scanned or copied the code, close this tab.
      The secret is stored in your <code>TOTP_SECRET</code> environment variable.
    </div>
  </div>
</body>
</html>`;
}

// ── Middleware factory ─────────────────────────────────────────────────────────

function createAuthMiddleware(appConfig = {}) {
  if (!TOTP_SECRET) return null;

  const sessionsFile = appConfig.userDataPath
    ? path.join(appConfig.userDataPath, '.sessions.json')
    : null;
  const sessions = new SessionStore(sessionsFile);
  const limiter = new RateLimiter();

  function isAuthenticated(req) {
    return sessions.has(parseCookies(req)[COOKIE]);
  }

  return async function authMiddleware(req, res, next) {

    // ── Setup page ── requires ?token=TOTP_SECRET so only the owner can view it
    if (req.path === '/__totp-setup') {
      if ((req.query?.token || '') !== TOTP_SECRET) {
        return res.status(403).end('Forbidden — add ?token=YOUR_TOTP_SECRET to the URL');
      }
      const html = await buildSetupPage(TOTP_SECRET);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }

    // ── Auth endpoint ── verify code, set cookie
    if (req.path === '/__auth') {
      if (limiter.isBlocked(req)) {
        return res.status(429)
          .end('Too many failed attempts — try again in a few minutes.');
      }
      const code = String(req.query?.code || '').replace(/\D/g, '');
      const dest = req.query?.next || '/';
      if (code.length === 6 && authenticator.verify({ token: code, secret: TOTP_SECRET })) {
        limiter.recordSuccess(req);
        const token = sessions.create();
        // Secure flag when the request arrived over HTTPS (directly or via
        // a proxy/tunnel like cloudflared). Omitted on plain-HTTP LAN
        // setups, where it would make the cookie unusable.
        const secure = (req.secure || req.headers['x-forwarded-proto'] === 'https')
          ? '; Secure' : '';
        res.setHeader('Set-Cookie',
          `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Strict${secure}`);
        return res.redirect(dest);
      }
      limiter.recordFailure(req);
      return res.redirect(`/__login?error=1&next=${encodeURIComponent(dest)}`);
    }

    // ── Login page ── always accessible (no point hiding it)
    if (req.path === '/__login') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(LOGIN_HTML);
    }

    // ── Authenticated ──
    if (isAuthenticated(req)) return next();

    // ── Unauthenticated ──
    const wantsJson = req.path.startsWith('/api/') ||
                      (req.headers.accept || '').includes('application/json');
    if (wantsJson) {
      return res.status(401).json({ error: 'Unauthorized — valid TOTP session required' });
    }
    res.redirect(`/__login?next=${encodeURIComponent(req.originalUrl)}`);
  };
}

module.exports = { createAuthMiddleware };
