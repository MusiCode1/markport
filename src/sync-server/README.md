# sync-server

Lean pull-sync server for obsidian-web: serves a vault directory over `/sync/v1`
so an OPFS-backed client can pull it (content-hash based, not mtime — the
hash is deterministic from file content, so the server never has to reconcile
mtimes across devices/filesystems).

Separate package from `src/runtime-server/server` — this app is
static/serverless by default, and this server is an *optional* thing you run
yourself, pointed at a vault folder you want to sync from. It is **not** the
same as the `/api/fs` server used by the "server vault" mode.

**v1 scope: pull, read-only.** A client can list the vault (`manifest`) and
fetch file contents (`blob`). There is no push, no realtime, no encryption —
see "v2 (not implemented)" below.

## Running

```bash
cd src/sync-server
bun install
SYNC_TOKEN=<a long random secret> VAULT_PATH=/path/to/your/vault bun index.js
```

Both `SYNC_TOKEN` and `VAULT_PATH` are **required** — the server refuses to
start without them (fail-closed), rather than starting in a broken or
insecure state.

| Env var | Required | Default | Meaning |
|---|---|---|---|
| `SYNC_TOKEN` | yes | — | Bearer token clients must present. Server exits at boot if unset. |
| `VAULT_PATH` | yes | — | Absolute path to the vault directory to serve. |
| `PORT` | no | `4000` | TCP port to listen on. |
| `HOST` | no | `0.0.0.0` | Interface to bind. See **security** below. |

## ⚠️ Security — read this before exposing the server to a network

`sync-server` is meant to be reachable from another device on your network
(or the internet, if you port-forward/tunnel it) — that's the point, it's how
a second device pulls your vault. `HOST` therefore **defaults to `0.0.0.0`**
(all interfaces), and the **only** thing standing between an attacker and
your vault is `SYNC_TOKEN`:

- Use a long, random `SYNC_TOKEN` (e.g. `openssl rand -hex 32`).
- If you only ever sync from `localhost` (e.g. a tunnel/reverse-proxy
  terminates elsewhere), set `HOST=127.0.0.1` to remove any doubt.
- The server does not terminate TLS. If you expose it beyond your LAN, put a
  reverse proxy (Caddy, nginx, cloudflared, etc.) in front of it for HTTPS —
  otherwise the Bearer token travels in plaintext.
- Auth is checked **before** any filesystem access, using a fixed-length
  (sha256 digest) constant-time comparison (`crypto.timingSafeEqual`) — a
  request with no/wrong token costs the server O(1) work (no directory walk,
  no hashing, no file open). This is the v1 defense against being flooded
  with bad requests; there's no per-IP rate limiting/backoff yet (v2).

## API — `/sync/v1`

All routes below require `Authorization: Bearer <SYNC_TOKEN>`. Missing or
wrong token → `401` (empty body).

### `GET /sync/v1/manifest`

Recursively lists every file in `VAULT_PATH` (all file types, including
`.obsidian/` — v1 does not filter anything; see "Open questions" in the
brief for why).

```json
{
  "cursor": "<sha256 of the sorted entry list — changes iff any file changed>",
  "entries": [
    { "path": "notes/todo.md", "size": 1234, "hash": "<sha256 hex>" }
  ]
}
```

- `path` is `/`-separated and relative to `VAULT_PATH`.
- `hash` is the sha256 of the file's content — hashes are cached by
  `(mtime, size)`, so an unchanged file is not re-hashed on the next
  manifest build.
- The response carries `ETag: "<cursor>"`. Send `If-None-Match: "<cursor>"`
  to get a `304` instead of the full body if nothing changed. Note this only
  saves **bandwidth** — the server still has to walk the vault to know
  whether anything changed (skipping the walk itself needs a persisted
  cursor + change-log, which is v2).

### `GET /sync/v1/blob/:hash`

Streams the raw bytes of whichever file has that sha256 content hash
(content-addressed — files with identical content share one blob). Response
carries `Cache-Control: public, max-age=31536000, immutable` (a given hash's
content can never change, so clients/proxies can cache it forever).

- Unknown or malformed hash → `404`.
- If the hash isn't in the current index (e.g. a file was added after the
  last manifest scan), the server rescans once and retries before returning
  `404`.

## v2 (not implemented — stubs return `501`)

`GET /sync/v1/changes` (cursor-delta), `GET /sync/v1/live` (WebSocket
realtime), `POST /sync/v1/commit` (push), `PUT /sync/v1/blob/:hash` (push a
new blob), `/sync/v1/deletions` (tombstones). These exist as routed stubs so
a client gets a clear `501` describing the endpoint, not a bare `404`.

## Tests

```bash
cd src/sync-server
bun test
```
