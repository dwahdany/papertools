// Server-side page fetcher: GET /api/meta?url=<http(s) URL>  (used by src/worker.js)
//
// Browsers cannot read most third-party pages cross-origin, so the URL → APA
// tool asks this handler to fetch the page server-side. It returns the
// document <head> (where the <meta>, <title>, JSON-LD and canonical link
// live) and lets the client parse it with the same code used for pages that
// do allow cross-origin reads. Nothing is stored; the response is cacheable.
//
// Access control:
//   - same-origin only: a request that carries an Origin / Sec-Fetch-Site /
//     Referer header pointing elsewhere is refused (403);
//   - when env.TURNSTILE_SECRET is configured (TURNSTILE_SECRET_KEY is accepted
//     as an alias), every request must carry a Cloudflare Turnstile token
//     (header cf-turnstile-response, or ?turnstile=) that verifies with the
//     siteverify API with success === true, action === TURNSTILE_ACTION and a
//     hostname in env.TURNSTILE_HOSTNAMES (comma-separated; defaults to the
//     hostname this request was made to). The client obtains the token silently
//     (see public/url-to-apa/app.js). Without the secret the check is skipped,
//     so local previews keep working. GET /api/config tells the client the site
//     key (env.TURNSTILE_SITE_KEY) and the action to use.
//
// What the handler enforces on the fetch itself:
//   - only public http(s) hosts, checked on the requested URL AND on every
//     redirect hop (redirects are followed manually, at most MAX_REDIRECTS);
//     the function's own host is refused too;
//   - one deadline (FETCH_TIMEOUT_MS) that covers every hop and the body read,
//     so a slow-drip body cannot hold the invocation open;
//   - at most MAX_BYTES of the body; only text/html and application/xhtml+xml
//     documents; the body is decoded with the charset of the BOM, the
//     Content-Type header or an early <meta charset>, falling back to UTF-8;
//   - only head-like markup is relayed: a page without <head>, <title>, <meta>,
//     <link> or JSON-LD is reported as having no metadata, never echoed.
//
// Response (JSON):
//   { ok: true,  url: <final URL after redirects>, status, contentType, head: "<head>…</head>" }
//   { ok: false, error: "<message>", status?, contentType?, url? }
//     HTTP 400  bad input (missing / non-public URL, or a redirect to a non-public address)
//     HTTP 403  cross-origin request, or missing / invalid Turnstile token (code: 'cross-origin' |
//               'turnstile-missing' | 'turnstile-failed' | 'turnstile-unavailable' when siteverify itself failed)
//     HTTP 415  the final response is not an HTML document
//     HTTP 422  the document has no <head> metadata to relay
//     HTTP 502  upstream failure (unreachable, timed out, non-2xx, too many redirects)

const MAX_BYTES = 512 * 1024;          // read at most 512 KiB of the page
const FETCH_TIMEOUT_MS = 10_000;       // covers every redirect hop and the body read
const MAX_REDIRECTS = 5;
const HEAD_FALLBACK_BYTES = 64 * 1024; // pre-<body> prefix relayed when there is no <head>
const HTML_MIME_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const USER_AGENT =
  'Mozilla/5.0 (compatible; papertools/1.0; +https://github.com/dwahdany/papertools) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_VERIFY_TIMEOUT_MS = 10_000;
const TURNSTILE_MAX_TOKEN_LENGTH = 2048;
/** The widget action the client renders with; siteverify must echo it back. */
export const TURNSTILE_ACTION = 'fetch-page';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
};

/**
 * True when the request comes from this site itself (or from a direct
 * navigation). Browsers set Sec-Fetch-Site on every request and Origin on
 * cross-origin fetches; a scripted client can forge both, which is why the
 * Turnstile check exists — this is only the first, cheap filter.
 */
export function isSameOriginRequest(request) {
  const own = new URL(request.url).origin;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null' && origin !== own) return false;
  const referer = request.headers.get('referer');
  if (!site && !origin && referer) {
    try { if (new URL(referer).origin !== own) return false; } catch { return false; }
  }
  return true;
}

/**
 * Verify a Turnstile token with Cloudflare's siteverify API (canonical flow:
 * browser → this backend → siteverify). The token must verify with
 * success === true, carry the expected action, and belong to one of the
 * expected frontend hostnames.
 * @param {string} token
 * @param {string} secret
 * @param {{ remoteIp?: string|null, action?: string, hostnames: Iterable<string>, fetch?: typeof fetch, verifyUrl?: string }} opts
 * @returns {Promise<{ ok: boolean, unavailable?: boolean, errors: string[] }>}
 */
export async function verifyTurnstile(token, secret, opts = {}) {
  const { remoteIp = null, action = TURNSTILE_ACTION, fetch = globalThis.fetch, verifyUrl = TURNSTILE_VERIFY_URL } = opts;
  const hostnames = new Set([...(opts.hostnames || [])].map((h) => String(h).trim().toLowerCase()).filter(Boolean));
  if (typeof token !== 'string' || token.length === 0 || token.length > TURNSTILE_MAX_TOKEN_LENGTH) {
    return { ok: false, errors: ['invalid-token-format'] };
  }
  if (hostnames.size === 0) return { ok: false, errors: ['no-expected-hostnames'] };
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set('remoteip', remoteIp);
  let data;
  try {
    const res = await fetch(verifyUrl, {
      method: 'POST',
      body: form,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(TURNSTILE_VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, unavailable: true, errors: [`HTTP ${res.status}`] };
    data = await res.json();
  } catch (err) {
    return { ok: false, unavailable: true, errors: [err?.message || 'network error'] };
  }
  const errors = Array.isArray(data?.['error-codes']) ? [...data['error-codes']] : [];
  if (data?.success !== true) return { ok: false, errors: errors.length ? errors : ['not-successful'] };
  if (action && data.action !== action) errors.push('action-mismatch');
  if (!hostnames.has(String(data.hostname || '').toLowerCase())) errors.push('hostname-mismatch');
  return { ok: errors.length === 0, errors };
}

/** Expected frontend hostnames: env.TURNSTILE_HOSTNAMES, else the host this request was made to. */
export function expectedHostnames(env, requestUrl) {
  const configured = String(env?.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean);
  return configured.length ? configured : [requestUrl.hostname];
}

/** GET /api/config: tells the client whether Turnstile is configured, and which action to render with. */
export function handleConfig(env = {}) {
  return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || null, turnstileAction: TURNSTILE_ACTION }, 200, { 'cache-control': 'public, max-age=300' });
}

/** Reject URLs that point at non-public hosts (basic SSRF protection). */
export function isPublicHttpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  // Strip IPv6 brackets and a trailing dot ("localhost." is still localhost).
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.arpa') || !host.includes('.') && !host.includes(':')) {
    return false;
  }
  // IPv4 literals: block loopback, private, link-local, multicast, unspecified.
  // (The URL parser already normalises decimal/octal/hex forms to dotted quads.)
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
      return false;
    }
    return true;
  }
  // IPv6 literals: block everything except plain global unicast (2000::/3), and
  // within it the transition prefixes that embed an arbitrary IPv4 address:
  // 6to4 (2002::/16) and Teredo (2001:0::/32).
  if (host.includes(':')) {
    if (!/^[23][0-9a-f]{3}:/i.test(host)) return false;
    const [first, second] = host.split(':');
    if (first === '2002') return false;
    if (first === '2001' && (second === '' || /^0+$/.test(second))) return false;
    return true;
  }
  return true;
}

/**
 * Extract the <head> element. Without a proper <head>…</head>, return the part
 * of the document before <body> (capped) – but only when it actually looks like
 * document metadata; arbitrary text or JSON yields '' so it is never relayed.
 */
export function extractHead(html) {
  const start = html.search(/<head[\s>]/i);
  const endIdx = html.search(/<\/head\s*>/i);
  if (start !== -1 && endIdx !== -1 && endIdx > start) {
    return html.slice(start, endIdx + html.slice(endIdx).match(/<\/head\s*>/i)[0].length);
  }
  const body = html.search(/<body[\s>]/i);
  const prefix = (body !== -1 ? html.slice(0, body) : html).slice(0, HEAD_FALLBACK_BYTES);
  return /<(title|meta|link)[\s/>]|<script[^>]*ld\+json/i.test(prefix) ? prefix : '';
}

/** Error with a `name` the handler maps to a specific HTTP response. */
function named(name, message) {
  return Object.assign(new Error(message), { name });
}

/**
 * Fetch `url` following at most MAX_REDIRECTS redirects manually, so that every
 * hop is checked with `allowed` before it is requested (redirect: 'follow' would
 * happily land on 127.0.0.1 or the cloud metadata address).
 * Resolves to { response, url } where `url` is the URL that produced `response`.
 */
async function fetchChecked(fetch, url, init, allowed) {
  let current = url;
  for (let hop = 0; ; hop++) {
    if (hop > 0 && !allowed(current)) throw named('PrivateRedirect', 'redirected to a non-public URL');
    const response = await fetch(current, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url: current };
    const location = response.headers.get('location');
    if (!location) return { response, url: current }; // a 3xx without Location is just a bad status
    try { await response.body?.cancel(); } catch { /* ignore */ }
    if (hop >= MAX_REDIRECTS) throw named('TooManyRedirects', 'too many redirects');
    try { current = new URL(location, current).href; } catch { throw named('PrivateRedirect', 'redirected to an invalid URL'); }
  }
}

/**
 * Read at most `limit` bytes from a Response body and return them as raw bytes.
 * Rejects with an AbortError (and cancels the body) as soon as `signal` aborts,
 * so a stalled upstream cannot keep the read pending past the deadline.
 */
async function readLimited(response, limit, signal) {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  const abortError = () => named('AbortError', 'aborted');
  let onAbort;
  const aborted = new Promise((_, reject) => {
    if (signal?.aborted) return reject(abortError());
    onAbort = () => reject(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => {}); // the body usually finishes first; do not report an unhandled rejection
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      if (total >= limit) break;
    }
  } catch (err) {
    try { await reader.cancel(); } catch { /* ignore */ }
    throw err;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (total >= limit) { try { await reader.cancel(); } catch { /* ignore */ } }
  }
  const merged = new Uint8Array(Math.min(total, limit));
  let off = 0;
  for (const c of chunks) {
    const slice = c.subarray(0, Math.max(0, Math.min(c.byteLength, merged.length - off)));
    merged.set(slice, off);
    off += slice.byteLength;
    if (off >= merged.length) break;
  }
  return merged;
}

/**
 * Pick the character encoding of a document, in the order browsers use: a BOM,
 * then the Content-Type header, then a <meta charset> / http-equiv declaration
 * in the first 1024 bytes, else UTF-8.
 */
export function pickCharset(contentType, bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
  const m = /charset=["']?([\w.:-]+)/i.exec(contentType || '') ||
    /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(new TextDecoder('latin1').decode(bytes.subarray(0, 1024)));
  let label = m ? m[1].toLowerCase() : 'utf-8';
  // An ASCII-readable declaration cannot be UTF-16; browsers decode such pages as UTF-8.
  if (/^utf-?16(le|be)?$/.test(label)) label = 'utf-8';
  if (label === 'x-user-defined') label = 'windows-1252';
  return label;
}

/** Decode bytes with `label`, falling back to UTF-8 when the runtime does not know it. */
export function decodeBytes(bytes, label) {
  try { return new TextDecoder(label, { fatal: false }).decode(bytes); }
  catch { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

/**
 * Core handler, separated from the Worker entry point so it can be unit tested
 * with an injected fetch. `env` carries TURNSTILE_SECRET_KEY (optional);
 * `timeoutMs` and `maxBytes` exist for the tests.
 */
export async function handleMeta(request, { fetch = globalThis.fetch, env = {}, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  const requestUrl = new URL(request.url);
  if (!isSameOriginRequest(request)) {
    return json({ ok: false, error: 'This endpoint only serves the papertools site itself.', code: 'cross-origin' }, 403);
  }
  const secret = env.TURNSTILE_SECRET || env.TURNSTILE_SECRET_KEY;
  if (secret) {
    const token = request.headers.get('cf-turnstile-response') || requestUrl.searchParams.get('turnstile') || '';
    if (!token) {
      return json({ ok: false, error: 'Missing bot-check token. Reload the page and try again.', code: 'turnstile-missing' }, 403);
    }
    const verdict = await verifyTurnstile(token, secret, {
      remoteIp: request.headers.get('cf-connecting-ip'),
      hostnames: expectedHostnames(env, requestUrl),
      fetch,
    });
    if (verdict.unavailable) {
      return json({ ok: false, error: 'The bot-check service could not be reached. Try again in a moment.', code: 'turnstile-unavailable' }, 403);
    }
    if (!verdict.ok) {
      return json({ ok: false, error: 'Bot check failed. Reload the page and try again.', code: 'turnstile-failed', details: verdict.errors }, 403);
    }
  }
  const target = requestUrl.searchParams.get('url')?.trim();
  if (!target) return json({ ok: false, error: 'Missing ?url= parameter.' }, 400);
  // Never fetch ourselves (the function would recurse) and never leave the public Internet.
  const ownHost = requestUrl.hostname.toLowerCase().replace(/\.$/, '');
  const allowed = (url) => isPublicHttpUrl(url) && new URL(url).hostname.toLowerCase().replace(/\.$/, '') !== ownHost;
  if (!allowed(target)) {
    return json({ ok: false, error: 'Only public http(s) URLs can be fetched.' }, 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { response: upstream, url: finalUrl } = await fetchChecked(fetch, target, {
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'accept-language': 'en-US,en;q=0.8',
      },
    }, allowed);
    // Workers/Node set Response.url only when they followed redirects themselves,
    // which we no longer let them do, so report the URL we fetched last.
    const url = upstream.url || finalUrl;

    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok) {
      try { await upstream.body?.cancel(); } catch { /* ignore */ }
      return json({ ok: false, error: `The site answered with HTTP ${upstream.status}.`, status: upstream.status, url }, 502);
    }
    const mime = contentType.split(';')[0].trim().toLowerCase();
    if (!HTML_MIME_TYPES.has(mime)) {
      try { await upstream.body?.cancel(); } catch { /* ignore */ }
      return json({ ok: false, error: `The URL is not an HTML page (${mime || 'unknown type'}).`,
        status: upstream.status, contentType, url }, 415);
    }

    const bytes = await readLimited(upstream, maxBytes, controller.signal);
    const head = extractHead(decodeBytes(bytes, pickCharset(contentType, bytes)));
    if (!head) {
      return json({ ok: false, error: 'The page has no <head> metadata.', status: upstream.status, contentType, url }, 422);
    }
    return json({ ok: true, url, status: upstream.status, contentType, head }, 200, { 'cache-control': 'private, max-age=3600' });
  } catch (err) {
    switch (err?.name) {
      case 'PrivateRedirect':
        return json({ ok: false, error: 'The page redirected to a non-public address.' }, 400);
      case 'TooManyRedirects':
        return json({ ok: false, error: 'The page redirected too many times.' }, 502);
      case 'AbortError':
        return json({ ok: false, error: 'The page timed out.' }, 502);
      default:
        return json({ ok: false, error: 'The page could not be reached.' }, 502);
    }
  } finally {
    clearTimeout(timer);
  }
}

