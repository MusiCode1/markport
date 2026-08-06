'use strict';

const crypto = require('crypto');

// Bearer-token auth middleware — DDoS-resistant by construction (brief §3א):
//  - mounted FIRST in index.js, before any route/FS work — a rejected request
//    does zero I/O, zero walk, zero hashing. O(1) reject.
//  - constant-time comparison: both sides are hashed to a fixed-length (32
//    byte) sha256 digest before crypto.timingSafeEqual — this protects
//    against a timing attack on the token itself AND against a length leak
//    (comparing raw strings of different lengths would let timingSafeEqual's
//    early length check leak how many characters matched).
//  - fail-closed at boot: index.js checks process.env.SYNC_TOKEN and exits
//    before listen() if it's missing (see index.js top-of-file check), so by
//    the time this middleware is constructed `expectedToken` is guaranteed
//    non-empty. The guard below is a defense-in-depth backstop in case a
//    future caller forgets that boot-time check — fail loudly, not open.
function createAuthMiddleware(expectedToken) {
  if (!expectedToken) {
    throw new Error('createAuthMiddleware requires a non-empty expectedToken');
  }
  const expectedDigest = crypto.createHash('sha256').update(expectedToken).digest();

  return function auth(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const providedDigest = crypto.createHash('sha256').update(token).digest();
    if (!token || !crypto.timingSafeEqual(providedDigest, expectedDigest)) {
      res.status(401).end();
      return;
    }
    next();
  };
}

module.exports = { createAuthMiddleware };
