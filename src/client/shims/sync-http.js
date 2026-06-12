/**
 * Synchronous HTTP helper.
 *
 * Obsidian uses ipcRenderer.sendSync() and statSync() in a few places.
 * In the browser we have to fall back to synchronous XMLHttpRequest.
 *
 * Yes, sync XHR is deprecated. For a single-user self-hosted app on
 * localhost it is the simplest path. If we ever need to remove it we can
 * preload the small set of values that Obsidian asks for synchronously.
 */
(function (global) {
  // opts.silent404 = true  → on 404, throw a clean ENOENT without a verbose
  // URL in the message.  Obsidian calls statSync/readFileSync on paths that
  // may not exist yet (config files, first boot) and handles ENOENT normally.
  // Without this flag those 404s appeared in the console as long HTTP error
  // strings, polluting the log with noise on every cold start.
  function syncRequest(method, url, body, opts) {
    const t0 = performance.now();
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, false); // false = synchronous
    if (body !== undefined && body !== null) {
      if (typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        // For binary bodies (ArrayBuffer/TypedArray) the browser does NOT set
        // Content-Type automatically on XHR.  Without it, express.raw() on the
        // server leaves req.body as {} and fsp.writeFile throws "Received an
        // instance of Object".  Strings get text/plain;charset=UTF-8 from the
        // browser, which body-parser already handles — we only need to add the
        // header for binary types.
        if (typeof body !== 'string') {
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        }
        xhr.send(body);
      } else {
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(body));
      }
    } else {
      xhr.send();
    }
    const duration = performance.now() - t0;

    // Record telemetry if available (telemetry.js loads before this shim).
    if (global.__owTelemetry) {
      global.__owTelemetry.record(
        method,
        url,
        duration,
        xhr.status,
        xhr.responseText ? xhr.responseText.length : 0,
      );
    }

    if (xhr.status < 200 || xhr.status >= 300) {
      // 404 with silent404 flag: throw a clean ENOENT so Obsidian's normal
      // try/catch handles it without extra noise.
      if (xhr.status === 404 && opts && opts.silent404) {
        const enoent = new Error('ENOENT: no such file or directory');
        enoent.code = 'ENOENT';
        enoent.status = 404;
        throw enoent;
      }
      const err = new Error('sync ' + method + ' ' + url + ' failed: ' + xhr.status + ' ' + xhr.responseText);
      err.status = xhr.status;
      try { Object.assign(err, JSON.parse(xhr.responseText)); } catch (_) { /* ignore */ }
      throw err;
    }
    return xhr;
  }

  function syncJson(method, url, body) {
    const xhr = syncRequest(method, url, body);
    return xhr.responseText ? JSON.parse(xhr.responseText) : null;
  }

  global.__owSyncRequest = syncRequest;
  global.__owSyncJson = syncJson;
})(window);
