/**
 * Boot script - runs before Obsidian's code.
 *
 * Responsibilities:
 *   1. Install window.require so Obsidian's window.require("...") calls
 *      hit our shims instead of failing.
 *   2. Pre-set platform flags (window.electron, etc.) where Obsidian
 *      reads them outside of a require() call.
 *   3. Configure the vault base path that the fs shim will use.
 *   4. Fetch the bootstrap cache asynchronously (non-blocking), then
 *      inject Obsidian's scripts dynamically so the spinner stays visible
 *      (and the main thread stays unblocked) during the fetch.
 *
 * Order of script tags in index.html ensures all shim files have already
 * loaded their __ow* globals by the time this runs.
 *
 * Obsidian's scripts are NOT listed in index.html anymore. They are
 * injected here, after the async bootstrap resolves, with async=false so
 * the browser can download them in parallel but executes them in order.
 */

// Polyfill crypto.randomUUID for non-secure contexts (plain HTTP on LAN).
// Browsers restrict this API to HTTPS/localhost; plugins like ion-sync need it.
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  crypto.randomUUID = function () {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  };
}

// Polyfill crypto.subtle for non-secure contexts (plain HTTP on LAN).
// Browsers only expose SubtleCrypto on HTTPS/localhost. Plugins like ion-sync
// call digest / importKey / deriveKey / encrypt / decrypt — without this they
// throw "Cannot read properties of undefined (reading 'digest')" etc.
if (typeof crypto !== 'undefined' && !crypto.subtle) {
  (function () {

    // ── helpers ────────────────────────────────────────────────────────────
    function _toU8(x) {
      if (x instanceof Uint8Array) return x;
      if (x instanceof ArrayBuffer) return new Uint8Array(x);
      if (x && x.buffer instanceof ArrayBuffer) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
      return new Uint8Array(x);
    }

    // ── SHA-256 (pure JS, public domain) ──────────────────────────────────
    var _K = new Uint32Array([
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ]);
    function _r(n,k){return(n>>>k)|(n<<(32-k));}
    function _sha256(data) {
      var H=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
      var len=data.length,bc=Math.ceil((len+9)/64),p=new Uint8Array(bc*64);
      p.set(data);p[len]=0x80;
      var dv=new DataView(p.buffer);
      dv.setUint32(p.length-4,(len*8)>>>0,false);
      dv.setUint32(p.length-8,Math.floor(len/0x20000000)>>>0,false);
      var W=new Uint32Array(64);
      for(var i=0;i<bc;i++){
        var bv=new DataView(p.buffer,i*64,64);
        for(var t=0;t<16;t++)W[t]=bv.getUint32(t*4,false);
        for(var t=16;t<64;t++){var s0=_r(W[t-15],7)^_r(W[t-15],18)^(W[t-15]>>>3);var s1=_r(W[t-2],17)^_r(W[t-2],19)^(W[t-2]>>>10);W[t]=(W[t-16]+s0+W[t-7]+s1)>>>0;}
        var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
        for(var t=0;t<64;t++){var S1=_r(e,6)^_r(e,11)^_r(e,25),ch=(e&f)^(~e&g);var t1=(h+S1+ch+_K[t]+W[t])>>>0;var S0=_r(a,2)^_r(a,13)^_r(a,22),maj=(a&b)^(a&c)^(b&c);var t2=(S0+maj)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
        H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;
        H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;
      }
      var out=new Uint8Array(32),ov=new DataView(out.buffer);
      for(var i=0;i<8;i++)ov.setUint32(i*4,H[i],false);
      return out;
    }

    // ── SHA-1 (pure JS, for ion-sync getSHA) ─────────────────────────────
    function _sha1(data) {
      var H=new Uint32Array([0x67452301,0xEFCDAB89,0x98BADCFE,0x10325476,0xC3D2E1F0]);
      var len=data.length,bc=Math.ceil((len+9)/64),p=new Uint8Array(bc*64);
      p.set(data);p[len]=0x80;
      var dv=new DataView(p.buffer);
      dv.setUint32(p.length-4,(len*8)>>>0,false);
      dv.setUint32(p.length-8,Math.floor(len/0x20000000)>>>0,false);
      var W=new Uint32Array(80);
      for(var i=0;i<bc;i++){
        var bv=new DataView(p.buffer,i*64,64);
        for(var t=0;t<16;t++)W[t]=bv.getUint32(t*4,false);
        for(var t=16;t<80;t++){var x=W[t-3]^W[t-8]^W[t-14]^W[t-16];W[t]=(x<<1)|(x>>>31);}
        var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4];
        for(var t=0;t<80;t++){
          var f,k;
          if(t<20){f=(b&c)|(~b&d);k=0x5A827999;}
          else if(t<40){f=b^c^d;k=0x6ED9EBA1;}
          else if(t<60){f=(b&c)|(b&d)|(c&d);k=0x8F1BBCDC;}
          else{f=b^c^d;k=0xCA62C1D6;}
          var tmp=(((a<<5)|(a>>>27))+f+e+k+W[t])>>>0;
          e=d;d=c;c=((b<<30)|(b>>>2))>>>0;b=a;a=tmp;
        }
        H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;H[4]=(H[4]+e)>>>0;
      }
      var out=new Uint8Array(20),ov=new DataView(out.buffer);
      for(var i=0;i<5;i++)ov.setUint32(i*4,H[i],false);
      return out;
    }

    // ── AES-256 forward cipher (pure JS) ──────────────────────────────────
    // S-box (forward)
    var _AS = new Uint8Array([99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22]);
    // Round constants for AES-256 key schedule (7 values needed: rounds at i=8,16,…,56)
    var _ARC = new Uint32Array([0x01000000,0x02000000,0x04000000,0x08000000,0x10000000,0x20000000,0x40000000]);
    // GF(2^8) × 2 table
    var _AX2 = new Uint8Array(256);
    for (var _ai=0;_ai<256;_ai++) _AX2[_ai]=((_ai<<1)^(_ai&0x80?0x1b:0))&0xff;

    function _aesKeyExp(key) {
      // key: 32-byte Uint8Array → 60-word key schedule (AES-256, 14 rounds)
      var W=new Uint32Array(60);
      for (var i=0;i<8;i++) W[i]=(key[4*i]<<24)|(key[4*i+1]<<16)|(key[4*i+2]<<8)|key[4*i+3];
      for (var i=8;i<60;i++) {
        var t=W[i-1];
        if (i%8===0) {
          // SubWord(RotWord(t)) XOR Rcon
          t=(_AS[(t>>16)&0xff]<<24)|(_AS[(t>>8)&0xff]<<16)|(_AS[t&0xff]<<8)|_AS[(t>>24)&0xff];
          t^=_ARC[(i>>3)-1];
        } else if (i%8===4) {
          t=(_AS[(t>>24)&0xff]<<24)|(_AS[(t>>16)&0xff]<<16)|(_AS[(t>>8)&0xff]<<8)|_AS[t&0xff];
        }
        W[i]=W[i-8]^t;
      }
      return W;
    }

    function _aesEnc(blk, W) {
      // Encrypt one 16-byte block. State is column-major: column c = bytes s[4c..4c+3].
      var s=new Uint8Array(16); s.set(blk);
      // Round 0: AddRoundKey
      for (var c=0;c<4;c++){var w=W[c];s[4*c]^=(w>>24)&0xff;s[4*c+1]^=(w>>16)&0xff;s[4*c+2]^=(w>>8)&0xff;s[4*c+3]^=w&0xff;}
      for (var round=1;round<=14;round++) {
        // SubBytes
        for (var i=0;i<16;i++) s[i]=_AS[s[i]];
        // ShiftRows: row r (= indices r,4+r,8+r,12+r) shifts left by r
        var t;
        t=s[1];s[1]=s[5];s[5]=s[9];s[9]=s[13];s[13]=t;         // row 1: shift-left 1
        t=s[2];s[2]=s[10];s[10]=t; t=s[6];s[6]=s[14];s[14]=t;  // row 2: shift-left 2
        t=s[15];s[15]=s[11];s[11]=s[7];s[7]=s[3];s[3]=t;        // row 3: shift-left 3
        // MixColumns (skipped in last round)
        if (round<14) {
          for (var c=0;c<4;c++) {
            var i=4*c,a=s[i],b=s[i+1],cc=s[i+2],d=s[i+3];
            s[i]  =_AX2[a]^_AX2[b]^b^cc^d;
            s[i+1]=a^_AX2[b]^_AX2[cc]^cc^d;
            s[i+2]=a^b^_AX2[cc]^_AX2[d]^d;
            s[i+3]=_AX2[a]^a^b^cc^_AX2[d];
          }
        }
        // AddRoundKey
        for (var c=0;c<4;c++){var w=W[round*4+c];s[4*c]^=(w>>24)&0xff;s[4*c+1]^=(w>>16)&0xff;s[4*c+2]^=(w>>8)&0xff;s[4*c+3]^=w&0xff;}
      }
      return s;
    }

    // ── AES-GCM ───────────────────────────────────────────────────────────
    // GF(2^128) multiply per GCM spec: R = 0xe1 followed by 15 zero bytes.
    function _gcmMul(X, Y) {
      var Z=new Uint8Array(16), V=new Uint8Array(Y);
      for (var i=0;i<16;i++) {
        for (var j=7;j>=0;j--) {
          if ((X[i]>>j)&1) for (var k=0;k<16;k++) Z[k]^=V[k];
          var lsb=V[15]&1;
          for (var k=15;k>0;k--) V[k]=(V[k]>>>1)|((V[k-1]&1)<<7);
          V[0]=V[0]>>>1;
          if (lsb) V[0]^=0xe1;
        }
      }
      return Z;
    }

    // Compute GCM auth tag: GHASH(pad(AAD)||pad(CT)||len64(AAD)||len64(CT)) then XOR AES(J0).
    function _gcmTag(W, H, J0, ct, aad) {
      var ap=(16-aad.length%16)%16, cp=(16-ct.length%16)%16;
      var buf=new Uint8Array(aad.length+ap+ct.length+cp+16);
      buf.set(aad,0); buf.set(ct,aad.length+ap);
      var lo=aad.length+ap+ct.length+cp;
      var ab=aad.length*8, cb=ct.length*8;
      // 64-bit big-endian lengths (upper 32 bits are 0 for files < 512 MB)
      buf[lo+4]=(ab>>>24)&0xff;buf[lo+5]=(ab>>>16)&0xff;buf[lo+6]=(ab>>>8)&0xff;buf[lo+7]=ab&0xff;
      buf[lo+12]=(cb>>>24)&0xff;buf[lo+13]=(cb>>>16)&0xff;buf[lo+14]=(cb>>>8)&0xff;buf[lo+15]=cb&0xff;
      // GHASH
      var Y=new Uint8Array(16);
      for (var i=0;i<buf.length;i+=16) {
        var blk=new Uint8Array(16); blk.set(buf.slice(i,i+16));
        for (var j=0;j<16;j++) Y[j]^=blk[j];
        Y=_gcmMul(Y,H);
      }
      // T = AES(J0) XOR GHASH
      var EJ=_aesEnc(J0,W), T=new Uint8Array(16);
      for (var i=0;i<16;i++) T[i]=EJ[i]^Y[i];
      return T;
    }

    // CTR-mode keystream: counter starts at INC32(J0), increments for each 16-byte block.
    function _gcmCtr(W, J0, data) {
      var ctr=new Uint8Array(J0), out=new Uint8Array(data.length);
      for (var i=0;i<data.length;i+=16) {
        var v=((ctr[12]<<24)|(ctr[13]<<16)|(ctr[14]<<8)|ctr[15]);
        v=(v+1)>>>0;
        ctr[12]=(v>>24)&0xff;ctr[13]=(v>>16)&0xff;ctr[14]=(v>>8)&0xff;ctr[15]=v&0xff;
        var ks=_aesEnc(ctr,W);
        for (var j=0;j<Math.min(16,data.length-i);j++) out[i+j]=data[i+j]^ks[j];
      }
      return out;
    }

    // ── CryptoKey shim ────────────────────────────────────────────────────
    function _OWKey(data, alg) { this.__ow_data=data; this.__ow_alg=alg; }

    // ── crypto.subtle ─────────────────────────────────────────────────────
    crypto.subtle = {

      digest: function (algorithm, data) {
        var name=(typeof algorithm==='string'?algorithm:(algorithm&&algorithm.name)||'')
          .toUpperCase().replace(/-/g,'');
        if (name==='SHA256') return Promise.resolve(_sha256(_toU8(data)).buffer);
        if (name==='SHA1')   return Promise.resolve(_sha1(_toU8(data)).buffer);
        return Promise.reject(new Error('[polyfill] crypto.subtle.digest: unsupported "'+algorithm+'"'));
      },

      // Wrap raw key material for later use by deriveKey / encrypt / decrypt
      importKey: function (format, keyData, algorithm, extractable, usages) {
        if (format==='raw') {
          var alg=(typeof algorithm==='string'?algorithm:(algorithm&&algorithm.name)||'').toUpperCase();
          return Promise.resolve(new _OWKey(_toU8(keyData), alg));
        }
        return Promise.reject(new Error('[polyfill] crypto.subtle.importKey: unsupported format "'+format+'"'));
      },

      // PBKDF2 only — offloaded to /api/pbkdf2 (native Node crypto) because
      // 100 000 iterations of pure-JS SHA-256 would freeze the browser for ~10 s.
      deriveKey: function (algorithm, baseKey, derivedKeyType, extractable, usages) {
        var algName=(typeof algorithm==='string'?algorithm:(algorithm&&algorithm.name)||'').toUpperCase();
        if (algName==='PBKDF2') {
          var salt=_toU8(algorithm.salt), iters=algorithm.iterations;
          var dkLen=((derivedKeyType&&derivedKeyType.length)||256)/8;
          var pwHex=Array.from(baseKey.__ow_data).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
          var saltHex=Array.from(salt).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
          return fetch('/api/pbkdf2',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({password:pwHex,salt:saltHex,iterations:iters,keyLen:dkLen})
          }).then(function(r){
            if(!r.ok) throw new Error('[polyfill] /api/pbkdf2 returned '+r.status);
            return r.json();
          }).then(function(d){
            var dk=new Uint8Array(dkLen);
            for (var i=0;i<dkLen;i++) dk[i]=parseInt(d.key.slice(i*2,i*2+2),16);
            return new _OWKey(dk,'AES-GCM');
          });
        }
        return Promise.reject(new Error('[polyfill] crypto.subtle.deriveKey: unsupported "'+algName+'"'));
      },

      // AES-GCM encrypt — returns ArrayBuffer of ciphertext || 16-byte auth tag
      encrypt: function (algorithm, key, data) {
        var name=(typeof algorithm==='string'?algorithm:(algorithm&&algorithm.name)||'').toUpperCase();
        if (name==='AES-GCM') {
          try {
            var iv=_toU8(algorithm.iv), pt=_toU8(data);
            var W=_aesKeyExp(key.__ow_data);
            var H=_aesEnc(new Uint8Array(16),W);
            var J0=new Uint8Array(16); J0.set(iv.slice(0,12)); J0[15]=1;
            var ct=_gcmCtr(W,J0,pt);
            var tag=_gcmTag(W,H,J0,ct,new Uint8Array(0));
            var out=new Uint8Array(ct.length+16); out.set(ct); out.set(tag,ct.length);
            return Promise.resolve(out.buffer);
          } catch(e) { return Promise.reject(e); }
        }
        return Promise.reject(new Error('[polyfill] crypto.subtle.encrypt: unsupported "'+name+'"'));
      },

      // AES-GCM decrypt — input is ciphertext || 16-byte auth tag
      decrypt: function (algorithm, key, data) {
        var name=(typeof algorithm==='string'?algorithm:(algorithm&&algorithm.name)||'').toUpperCase();
        if (name==='AES-GCM') {
          try {
            var iv=_toU8(algorithm.iv), buf=_toU8(data);
            if (buf.length<16) throw new Error('[polyfill] AES-GCM: data too short');
            var ct=buf.slice(0,buf.length-16), tag=buf.slice(buf.length-16);
            var W=_aesKeyExp(key.__ow_data);
            var H=_aesEnc(new Uint8Array(16),W);
            var J0=new Uint8Array(16); J0.set(iv.slice(0,12)); J0[15]=1;
            var expectedTag=_gcmTag(W,H,J0,ct,new Uint8Array(0));
            var ok=true; for (var i=0;i<16;i++) ok=ok&&(tag[i]===expectedTag[i]);
            if (!ok) return Promise.reject(new DOMException('AES-GCM: tag mismatch','OperationError'));
            return Promise.resolve(_gcmCtr(W,J0,ct).buffer);
          } catch(e) { return Promise.reject(e); }
        }
        return Promise.reject(new Error('[polyfill] crypto.subtle.decrypt: unsupported "'+name+'"'));
      },
    };
  })();
}

// Ordered list of Obsidian's renderer scripts — mirrors the old <script defer>
// list in index.html. Keep in sync with obsidian/index.html if Obsidian is
// updated to add or remove scripts.
const OBSIDIAN_SCRIPTS = [
  '/obsidian/lib/codemirror/codemirror.js',
  '/obsidian/lib/codemirror/overlay.js',
  '/obsidian/lib/codemirror/markdown.js',
  '/obsidian/lib/codemirror/cm-addons.js',
  '/obsidian/lib/codemirror/vim.js',
  '/obsidian/lib/codemirror/meta.min.js',
  '/obsidian/lib/moment.min.js',
  '/obsidian/lib/pixi.min.js',
  '/obsidian/lib/i18next.min.js',
  '/obsidian/lib/scrypt.js',
  '/obsidian/lib/turndown.js',
  '/obsidian/enhance.js',
  '/obsidian/i18n.js',
  '/obsidian/app.js',
];

(function () {
  // Many Node.js npm packages (e.g. node-forge) reference the Node.js global
  // object as `global`. In the browser this doesn't exist; alias it to window
  // so plugins that bundle such packages don't crash on startup.
  if (typeof global === 'undefined') {
    window.global = window;
  }

  // Register the Service Worker for bootstrap caching (stale-while-revalidate).
  // On repeat visits the SW intercepts /api/bootstrap and returns a cached
  // response instantly, then revalidates in the background — no server
  // round-trip needed. The SW file is served at /sw.js with
  // Service-Worker-Allowed: / so it can intercept requests on the full origin.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
      console.warn('[obsidian-web] service worker registration failed:', err.message);
    });
  }

  const VAULT_BASE = '/vault';
  const params = new URLSearchParams(location.search);
  let VAULT_ID = params.get('vault') || localStorage.getItem('obsidian-web:lastVaultId') || '';

  if (!VAULT_ID && location.pathname !== '/starter') {
    location.href = '/starter';
    return;
  }

  if (VAULT_ID) {
    localStorage.setItem('obsidian-web:lastVaultId', VAULT_ID);
  }

  // Tell the fs shim what path prefix to strip when talking to the server.
  window.__owFs.setVaultBase(VAULT_BASE);
  window.__owFs.setVaultId(VAULT_ID);

  // Auto-trust community plugins in demo mode so the "Do you trust this
  // vault?" modal doesn't block first-time visitors.
  // Obsidian checks: localStorage.getItem("enable-plugin-" + appId)
  if (VAULT_ID) {
    localStorage.setItem('enable-plugin-' + VAULT_ID, 'true');
  }

  // Mobile emulation: on small viewports, set the EmulateMobile flag so
  // Obsidian activates its mobile UI (170 CSS rules + JS behavior).
  // Obsidian reads this from localStorage before we can intervene, so it
  // must be set before app.js loads (which it is — boot.js runs first).
  if (window.innerWidth < 600 || window.innerHeight < 600) {
    localStorage.setItem('EmulateMobile', '1');
  } else {
    localStorage.removeItem('EmulateMobile');
  }

  // Map module name -> shim object.
  const modules = {
    'fs':          window.__owFs,
    'original-fs': window.__owFs,
    'path':        window.__owPath,
    'url':         window.__owUrl,
    'os':          window.__owOs,
    'electron':    window.__owElectron,
    'btime':       window.__owBtime,
    'crypto':      makeCryptoShim(),
    'node:crypto': makeCryptoShim(),   // plugins that use the node: prefix
    'util':        makeUtilShim(),
    'node:util':   makeUtilShim(),
    'buffer':      { Buffer: window.Buffer },   // require('buffer').Buffer
    'process':     window.process,              // require('process')
    // child_process: stub so plugins that optionally use it (e.g. Templater
    // system commands) can load. Commands will fail gracefully at runtime.
    'child_process': makeChildProcessStub(),
    '@electron/remote': window.__owElectron.remote,
    // keytar: server-backed credential store (replaces OS keychain)
    'keytar': makeKeytarShim(),
  };

  function makeKeytarShim() {
    function q(service, account) {
      return '/api/keytar?service=' + encodeURIComponent(service) + '&account=' + encodeURIComponent(account);
    }
    return {
      getPassword(service, account) {
        return fetch(q(service, account))
          .then(r => r.ok ? r.json().then(j => j.password) : null)
          .catch(() => null);
      },
      setPassword(service, account, password) {
        return fetch('/api/keytar', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service, account, password }),
        }).then(() => undefined);
      },
      deletePassword(service, account) {
        return fetch(q(service, account), { method: 'DELETE' })
          .then(r => r.json()).then(j => !!j.ok)
          .catch(() => false);
      },
      findCredentials(service) {
        return fetch('/api/keytar/all?service=' + encodeURIComponent(service))
          .then(r => r.ok ? r.json() : [])
          .catch(() => []);
      },
      findPassword(service) {
        return fetch('/api/keytar/all?service=' + encodeURIComponent(service))
          .then(r => r.ok ? r.json() : [])
          .then(entries => entries.length ? entries[0].password : null)
          .catch(() => null);
      },
      // Our server-backed store is always available
      isEncryptionAvailable() { return true; },
    };
  }

  function makeChildProcessStub() {
    const ERR = new Error('[obsidian-web] child_process is not available in web mode');
    function noop() {}
    // Minimal EventEmitter-like object returned by spawn/exec
    function fakeProc() {
      return {
        stdout: { on: noop, pipe: noop },
        stderr: { on: noop, pipe: noop },
        stdin:  { write: noop, end: noop },
        on: noop, once: noop, off: noop,
        kill: noop, pid: 0,
      };
    }
    return {
      exec(cmd, opts, cb) {
        if (typeof opts === 'function') { cb = opts; }
        if (typeof cb === 'function') { setTimeout(() => cb(ERR, '', ''), 0); }
        return fakeProc();
      },
      execSync() { throw ERR; },
      spawn() { return fakeProc(); },
      spawnSync() { return { stdout: '', stderr: '', status: 1, error: ERR }; },
      execFile(file, args, opts, cb) {
        if (typeof opts === 'function') { cb = opts; }
        if (typeof cb === 'function') { setTimeout(() => cb(ERR, '', ''), 0); }
        return fakeProc();
      },
      fork() { return fakeProc(); },
    };
  }

  function makeUtilShim() {
    // Minimal Node.js `util` polyfill.
    // promisify: wraps a (err, value) callback-style function into a Promise.
    function promisify(fn) {
      return function (...args) {
        return new Promise((resolve, reject) => {
          fn.call(this, ...args, (err, value) => {
            if (err) reject(err);
            else resolve(value);
          });
        });
      };
    }
    // callbackify: inverse of promisify.
    function callbackify(fn) {
      return function (...args) {
        const cb = args.pop();
        fn.apply(this, args).then(
          (v) => cb(null, v),
          (e) => cb(e instanceof Error ? e : new Error(String(e))),
        );
      };
    }
    // inspect: basic stringification (subset of Node's util.inspect).
    function inspect(obj) {
      try { return JSON.stringify(obj); } catch (_) { return String(obj); }
    }
    // inherits: prototype chain helper used by older Node packages.
    function inherits(ctor, superCtor) {
      ctor.super_ = superCtor;
      Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
    }
    return { promisify, callbackify, inspect, inherits };
  }

  function makeCryptoShim() {
    // ---- Pure-JS SHA-256 (synchronous, public domain) -------------------------
    // Used by createHash('sha256') and createHmac('sha256', ...) so that sync
    // callers (like ion-sync's _computeToken) get real results, not empty strings.
    const _SHA256_K = new Uint32Array([
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ]);
    function _ror32(n, k) { return (n >>> k) | (n << (32 - k)); }
    function _sha256(data /* Uint8Array */) {
      const H = new Uint32Array([
        0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19,
      ]);
      const len = data.length;
      const bc = Math.ceil((len + 9) / 64);
      const pad = new Uint8Array(bc * 64);
      pad.set(data);
      pad[len] = 0x80;
      const dv = new DataView(pad.buffer);
      dv.setUint32(pad.length - 4, (len * 8) >>> 0, false);
      dv.setUint32(pad.length - 8, Math.floor(len / 0x20000000) >>> 0, false);
      const W = new Uint32Array(64);
      for (let i = 0; i < bc; i++) {
        const bv = new DataView(pad.buffer, i * 64, 64);
        for (let t = 0; t < 16; t++) W[t] = bv.getUint32(t * 4, false);
        for (let t = 16; t < 64; t++) {
          const s0 = _ror32(W[t-15],7)^_ror32(W[t-15],18)^(W[t-15]>>>3);
          const s1 = _ror32(W[t-2],17)^_ror32(W[t-2],19)^(W[t-2]>>>10);
          W[t] = (W[t-16]+s0+W[t-7]+s1)>>>0;
        }
        let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
        for (let t = 0; t < 64; t++) {
          const S1=_ror32(e,6)^_ror32(e,11)^_ror32(e,25);
          const ch=(e&f)^(~e&g);
          const t1=(h+S1+ch+_SHA256_K[t]+W[t])>>>0;
          const S0=_ror32(a,2)^_ror32(a,13)^_ror32(a,22);
          const maj=(a&b)^(a&c)^(b&c);
          const t2=(S0+maj)>>>0;
          h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
        }
        H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;
        H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;
      }
      const out = new Uint8Array(32);
      const ov = new DataView(out.buffer);
      for (let i = 0; i < 8; i++) ov.setUint32(i*4, H[i], false);
      return out;
    }
    function _hmacSha256(key, data) {
      const BS = 64;
      let k = key.length > BS ? _sha256(key) : key;
      const k0 = new Uint8Array(BS); k0.set(k);
      const ip = new Uint8Array(BS), op = new Uint8Array(BS);
      for (let i = 0; i < BS; i++) { ip[i] = k0[i]^0x36; op[i] = k0[i]^0x5c; }
      const inner = new Uint8Array(BS + data.length); inner.set(ip); inner.set(data, BS);
      const ih = _sha256(inner);
      const outer = new Uint8Array(BS + 32); outer.set(op); outer.set(ih, BS);
      return _sha256(outer);
    }
    function _toBytes(v) {
      if (typeof v === 'string') return new TextEncoder().encode(v);
      if (v instanceof Uint8Array) return v;
      if (v && v.buffer) return new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength);
      return new Uint8Array(v);
    }
    function _encodeResult(bytes, enc) {
      if (!enc || enc === 'buffer') return bytes;
      if (enc === 'hex') return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('');
      if (enc === 'base64') return btoa(String.fromCharCode(...bytes));
      return bytes;
    }
    function _makeHasher(computeFn) {
      const chunks = [];
      const h = {
        update(data) { chunks.push(_toBytes(data)); return h; },
        digest(enc, cb) {
          if (typeof enc === 'function') { cb = enc; enc = 'hex'; }
          const combined = new Uint8Array(chunks.reduce((s,c) => s+c.length, 0));
          let off = 0; for (const c of chunks) { combined.set(c, off); off += c.length; }
          const result = _encodeResult(computeFn(combined), enc);
          if (typeof cb === 'function') { cb(null, result); return h; }
          return result;
        },
      };
      return h;
    }
    // ---------------------------------------------------------------------------

    return {
      randomBytes(n) {
        const arr = new Uint8Array(n);
        crypto.getRandomValues(arr);
        arr.toString = function (encoding) {
          if (encoding === 'hex') {
            let s = '';
            for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, '0');
            return s;
          }
          return Uint8Array.prototype.toString.call(this);
        };
        return arr;
      },
      createHash(algo) {
        const al = (algo || '').toLowerCase().replace('-','');
        if (al === 'sha256') return _makeHasher(_sha256);
        // For other algos: async via SubtleCrypto; sync path returns empty.
        const algoMap = { sha1: 'SHA-1', sha512: 'SHA-512', md5: 'SHA-256' };
        const subtleAlgo = algoMap[al] || 'SHA-256';
        const chunks = [];
        const h = {
          update(data) {
            chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
            return h;
          },
          digest(encoding, cb) {
            if (typeof encoding === 'function') { cb = encoding; encoding = 'hex'; }
            if (typeof cb === 'function') {
              const combined = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
              let off = 0;
              for (const c of chunks) { combined.set(c, off); off += c.length; }
              crypto.subtle.digest(subtleAlgo, combined).then((buf) => {
                const bytes = new Uint8Array(buf);
                const s = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('');
                cb(null, encoding === 'hex' ? s : bytes);
              }).catch((err) => cb(err));
              return h;
            }
            console.warn('[obsidian-web] crypto.createHash(' + algo + ').digest() sync — returning empty');
            return encoding === 'hex' ? '' : new Uint8Array(0);
          },
        };
        return h;
      },
      createHmac(algo, key) {
        const al = (algo || '').toLowerCase().replace('-','');
        const keyBytes = _toBytes(key);
        if (al === 'sha256') return _makeHasher((data) => _hmacSha256(keyBytes, data));
        console.warn('[obsidian-web] crypto.createHmac: unsupported algo', algo, '— returning zeros');
        return _makeHasher(() => new Uint8Array(32));
      },
    };
  }

  // ── Missing-shim tracker ────────────────────────────────────────────────
  // Collects every require(), sendSync(), and send() call that we don't handle.
  // Inspect from DevTools: __owMissing.summary() / .table() / .list()
  (function () {
    const hits = new Map(); // key → { type, name, count, firstSeen, lastSeen }

    function record(type, name) {
      const key = type + ':' + name;
      const now = Math.round(performance.now());
      if (hits.has(key)) {
        const e = hits.get(key);
        e.count++;
        e.lastSeen = now;
      } else {
        hits.set(key, { type, name, count: 1, firstSeen: now, lastSeen: now });
      }
    }

    function summary() {
      const rows = [...hits.values()].sort((a, b) => b.count - a.count);
      if (rows.length === 0) {
        console.log('[obsidian-web] __owMissing: nothing missing \u2713');
        return [];
      }
      console.group('[obsidian-web] Missing shims — ' + rows.length + ' distinct, ' +
        rows.reduce((s, r) => s + r.count, 0) + ' total calls');
      console.table(rows.map(r => ({
        type: r.type, name: r.name, count: r.count,
        'first(ms)': r.firstSeen, 'last(ms)': r.lastSeen,
      })));
      console.groupEnd();
      return rows;
    }

    window.__owMissing = { record, summary, list: () => [...hits.values()] };
  })();

  // Install window.require.
  window.require = function (name) {
    if (Object.prototype.hasOwnProperty.call(modules, name)) {
      return modules[name];
    }
    console.warn('[obsidian-web] window.require: unknown module "' + name + '"');
    window.__owMissing && window.__owMissing.record('require', name);
    return undefined;
  };

  // Some Obsidian code reads window.electron directly (bypassing require).
  window.electron = window.__owElectron;

  // Some Obsidian code reads window.process.platform / arch.
  window.process = window.process || {
    platform: 'linux',
    arch: 'x64',
    versions: { electron: '0.0.0', node: '0.0.0' },
    env: {},
    cwd: () => '/',
    nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
  };

  // Set the global Buffer if Obsidian needs it. We don't ship a full
  // Buffer polyfill yet - if something blows up here, that's our cue.
  if (!window.Buffer) {
    window.Buffer = {
      from: (data, encoding) => {
        if (typeof data === 'string') {
          if (encoding === 'base64') {
            const bin = atob(data);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return arr;
          }
          return new TextEncoder().encode(data);
        }
        return new Uint8Array(data);
      },
      isBuffer: (x) => x instanceof Uint8Array,
      alloc: (n) => new Uint8Array(n),
    };
  }

  // Expose the vault path where Obsidian expects to find one.
  // It will be passed when Obsidian opens a vault; our launcher
  // (later) tells Obsidian to open VAULT_BASE.
  window.__obsidianWeb = {
    vaultBase: VAULT_BASE,
    vaultId: VAULT_ID,
  };

  console.log('[obsidian-web] boot complete; require + shims installed');

  // ── Async bootstrap + dynamic script injection ──────────────────────────
  //
  // All synchronous setup above (window.require, shims, globals) is complete
  // before this block runs. The fetch is async so the spinner renders
  // immediately without blocking the main thread.
  //
  // After the cache is populated we inject Obsidian's scripts with async=false:
  // the browser downloads them in parallel but executes them in insertion
  // order, so Obsidian's dependencies are always satisfied.
  //
  // sendSync() / statSync() are only called AFTER app.js starts running,
  // which is after this promise resolves — so the cache is always ready.
  if (VAULT_ID && location.pathname !== '/starter') {
    var statusEl = document.getElementById('ow-status');
    var pollTimer = null;
    var vaultParam = encodeURIComponent(VAULT_ID);

    // Start polling /api/bootstrap/status after 2 seconds of waiting.
    // Shows progress to the user during slow cold-start builds.
    var pollDelay = setTimeout(function () {
      pollTimer = setInterval(function () {
        fetch('/api/bootstrap/status?vault=' + vaultParam)
          .then(function (r) { return r.json(); })
          .then(function (s) {
            if (!statusEl || s.state === 'idle' || s.state === 'ready') return;
            var text = s.label || '';
            if (s.state === 'scanning' && s.dirs) {
              text += ' (' + s.dirs + ' dirs, ' + (s.files || 0) + ' files)';
            }
            if (s.state === 'reading' && s.filesRead) {
              text += ' (' + s.filesRead + '/' + (s.total || '?') + ')';
            }
            statusEl.textContent = text;
          })
          .catch(function () {});
      }, 1000);
    }, 2000);

    function stopPolling() {
      clearTimeout(pollDelay);
      if (pollTimer) clearInterval(pollTimer);
    }

    // Bootstrap cache and the server-backed localStorage load in parallel.
    // Both must be ready BEFORE Obsidian's scripts are injected: app.js
    // reads localStorage (safeStorage tokens, app state) synchronously at
    // startup. A localStorage failure is non-fatal — native storage stays.
    Promise.all([
      fetch('/api/bootstrap?vault=' + vaultParam + '&full=1')
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        }),
      (window.__owInstallRemoteLocalStorage
        ? window.__owInstallRemoteLocalStorage()
        : Promise.resolve()
      ).catch(function (e) {
        console.warn('[obsidian-web] remote localStorage unavailable, staying device-local:', e && e.message);
      }),
    ])
      .then(function (results) {
        var data = results[0];
        stopPolling();
        var vault = data.electron && data.electron['vault'];
        if (!vault || !vault.id) {
          localStorage.removeItem('obsidian-web:lastVaultId');
          location.href = '/starter';
          return;
        }
        window.__owBootstrapCache = data;
        if (statusEl) statusEl.textContent = 'Loading Obsidian...';
        console.log('[obsidian-web] bootstrap loaded: ' + Object.keys(data.fs).length + ' files pre-cached');

        // Inject Obsidian's scripts in order. async=false preserves execution
        // order while allowing parallel download.
        var loaded = 0;
        for (var i = 0; i < OBSIDIAN_SCRIPTS.length; i++) {
          var s = document.createElement('script');
          s.src = OBSIDIAN_SCRIPTS[i];
          s.async = false;
          s.onload = function () {
            loaded++;
            if (statusEl) statusEl.textContent = 'Loading Obsidian (' + loaded + '/' + OBSIDIAN_SCRIPTS.length + ')';
          };
          document.head.appendChild(s);
        }

        // Hide the loading overlay once Obsidian's workspace element appears,
        // then apply post-boot patches that need window.app to be ready.
        var overlay = document.getElementById('ow-loading');
        if (overlay) {
          var obs = new MutationObserver(function () {
            if (document.querySelector('.workspace')) {
              overlay.remove();
              obs.disconnect();
              _owPatchWorkspace();
            }
          });
          obs.observe(document.body, { childList: true, subtree: true });
        }

        // Converts an app:// or file:// asset URL to an /api/fs/read HTTP URL.
        // app://local/vault/images/photo.png → /api/fs/read?path=images%2Fphoto.png
        // file:///vault/images/photo.png    → /api/fs/read?path=images%2Fphoto.png
        function _owAssetHref(src) {
          if (!src) return null;
          var vaultId = window.__obsidianWeb && window.__obsidianWeb.vaultId;
          var vaultParam = vaultId ? '&vault=' + encodeURIComponent(vaultId) : '';
          var rel = null;

          if (src.startsWith('app://local/')) {
            // app://local/<vaultBase>/<rel>  e.g. app://local/vault/img.png
            var after = src.slice('app://local/'.length); // 'vault/img.png'
            var vaultBase = 'vault'; // matches VAULT_BASE ('/vault') without leading slash
            if (after.startsWith(vaultBase + '/')) {
              rel = after.slice(vaultBase.length + 1);
            } else {
              rel = after; // fallback: use entire path after app://local/
            }
          } else if (src.startsWith('file:///vault/')) {
            rel = src.slice('file:///vault/'.length);
          } else if (src.startsWith('file:///')) {
            rel = src.slice('file:///'.length);
          }

          if (!rel) return null;
          return '/api/fs/read?path=' + encodeURIComponent(rel) + vaultParam;
        }

        function _owFixAssetEl(el) {
          var src = el.getAttribute('src') || el.getAttribute('href');
          if (!src) return;
          if (!src.startsWith('app://') && !src.startsWith('file://')) return;
          var fixed = _owAssetHref(src);
          if (!fixed) return;
          if (el.tagName === 'LINK') {
            el.setAttribute('href', fixed);
          } else {
            el.setAttribute('src', fixed);
          }
        }

        function _owInstallAssetRewriter() {
          // Fix any already-present asset elements (shouldn't be any yet, but
          // running it once costs nothing).
          ['img', 'video', 'audio', 'source'].forEach(function (tag) {
            document.querySelectorAll(tag).forEach(_owFixAssetEl);
          });

          // Watch for new/modified elements and fix them as they appear.
          var assetObs = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
              var m = mutations[i];
              // New nodes added to DOM.
              for (var j = 0; j < m.addedNodes.length; j++) {
                var node = m.addedNodes[j];
                if (node.nodeType !== 1) continue; // elements only
                _owFixAssetEl(node);
                // Also fix descendants (e.g. an <img> inside an added <div>).
                node.querySelectorAll && node.querySelectorAll('img,video,audio,source').forEach(_owFixAssetEl);
              }
              // src/href attribute changed on an existing element.
              if (m.type === 'attributes') {
                _owFixAssetEl(m.target);
              }
            }
          });
          assetObs.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'href'],
          });
        }

        // Patch workspace methods that rely on Electron-native APIs unavailable
        // in the browser. Retries briefly in case window.app is not yet set.
        function _owPatchWorkspace(attempt) {
          attempt = attempt || 0;
          if (!window.app || !window.app.workspace) {
            if (attempt < 10) setTimeout(function () { _owPatchWorkspace(attempt + 1); }, 50);
            return;
          }
          var ws = window.app.workspace;

          // vault.getResourcePath: Obsidian calls this for every embedded asset
          // (images, audio, video, PDFs). In Electron it returns app://local/...
          // which browsers can't load. Build the URL directly from file.path
          // (the clean vault-relative path, no protocol prefix, no timestamp)
          // rather than trying to parse the Electron URL format.
          if (window.app.vault && typeof window.app.vault.getResourcePath === 'function') {
            window.app.vault.getResourcePath = function (file) {
              var vaultId = window.__obsidianWeb && window.__obsidianWeb.vaultId;
              var vaultParam = vaultId ? '&vault=' + encodeURIComponent(vaultId) : '';
              return '/api/fs/read?path=' + encodeURIComponent((file && file.path) || '') + vaultParam;
            };
          }

          // MutationObserver fallback: rewrite any app:// or file:// src attrs
          // that slip through (e.g. images in notes already open at load time,
          // or plugins that bypass getResourcePath).
          _owInstallAssetRewriter();

          // openPopoutLeaf: Obsidian checks for a native Electron BrowserWindow
          // via an internal validation function (V0) that throws "re-install"
          // when running in a plain browser. Replace it to open a new browser
          // tab with the same vault instead.
          if (typeof ws.openPopoutLeaf === 'function') {
            ws.openPopoutLeaf = function _owOpenPopoutLeaf() {
              var params = new URLSearchParams(location.search);
              var vaultId = params.get('vault') ||
                (window.__obsidianWeb && window.__obsidianWeb.vaultId);
              var url = vaultId
                ? location.origin + '/?vault=' + encodeURIComponent(vaultId)
                : location.origin + '/';
              // Use the shell.openExternal shim which holds a pre-Obsidian
              // reference to window.open (Obsidian patches window.open to
              // route through its link handler, causing infinite recursion).
              if (window.__owElectron && window.__owElectron.shell) {
                window.__owElectron.shell.openExternal(url);
              } else {
                window.open(url, '_blank', 'noopener,noreferrer');
              }
            };
          }
        }
      })
      .catch(function (err) {
        stopPolling();
        console.warn('[obsidian-web] bootstrap failed:', err.message);
        localStorage.removeItem('obsidian-web:lastVaultId');
        location.href = '/starter';
      });
  }
})();
