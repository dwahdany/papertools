// Cloudflare Pages Function: GET /api/meta?url=<http(s) URL>
//
// Browsers cannot read most third-party pages cross-origin, so the URL → APA
// tool asks this function to fetch the page server-side. It returns the
// document <head> (where the <meta>, <title>, JSON-LD and canonical link
// live) and lets the client parse it with the same code used for pages that
// do allow cross-origin reads. Nothing is stored; the response is cacheable.
//
// Response (JSON):
//   { ok: true,  url: <final URL after redirects>, status, contentType, head: "<head>…</head>" }
//   { ok: false, error: "<message>" }   (HTTP 400 for bad input, 502 for upstream failures)

const MAX_BYTES = 512 * 1024;          // read at most 512 KiB of the page
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; papertools/1.0; +https://github.com/dwahdany/papertools) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff',
};

/** Reject URLs that point at non-public hosts (basic SSRF protection). */
export function isPublicHttpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.arpa') || !host.includes('.') && !host.includes(':')) {
    return false;
  }
  // IPv4 literals: block loopback, private, link-local, multicast, unspecified.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
      return false;
    }
    return true;
  }
  // IPv6 literals: block everything except plain global unicast (2000::/3).
  if (host.includes(':')) return /^[23][0-9a-f]{3}:/i.test(host);
  return true;
}

/** Extract the <head> element (or the first part of the document if there is none). */
export function extractHead(html) {
  const start = html.search(/<head[\s>]/i);
  const endIdx = html.search(/<\/head\s*>/i);
  if (start !== -1 && endIdx !== -1 && endIdx > start) {
    return html.slice(start, endIdx + html.slice(endIdx).match(/<\/head\s*>/i)[0].length);
  }
  // No proper head: return everything up to <body> (meta tags may still be there).
  const body = html.search(/<body[\s>]/i);
  return body !== -1 ? html.slice(0, body) : html.slice(0, 64 * 1024);
}

/** Read at most `limit` bytes from a Response body and decode as UTF-8. */
async function readLimited(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= limit) { try { await reader.cancel(); } catch { /* ignore */ } break; }
  }
  const merged = new Uint8Array(Math.min(total, limit));
  let off = 0;
  for (const c of chunks) {
    const slice = c.subarray(0, Math.max(0, Math.min(c.byteLength, merged.length - off)));
    merged.set(slice, off);
    off += slice.byteLength;
    if (off >= merged.length) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

/**
 * Core handler, separated from the Pages entry point so it can be unit tested
 * with an injected fetch.
 */
export async function handleMeta(request, { fetch = globalThis.fetch } = {}) {
  const target = new URL(request.url).searchParams.get('url')?.trim();
  if (!target) return json({ ok: false, error: 'Missing ?url= parameter.' }, 400);
  if (!isPublicHttpUrl(target)) {
    return json({ ok: false, error: 'Only public http(s) URLs can be fetched.' }, 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(target, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'accept-language': 'en-US,en;q=0.8',
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const reason = err && err.name === 'AbortError' ? 'timed out' : 'could not be reached';
    return json({ ok: false, error: `The page ${reason}.` }, 502);
  }
  clearTimeout(timer);

  const contentType = upstream.headers.get('content-type') || '';
  if (!upstream.ok) {
    return json({ ok: false, error: `The site answered with HTTP ${upstream.status}.`, status: upstream.status }, 502);
  }
  if (!/html|xml/i.test(contentType)) {
    return json({ ok: false, error: `The URL is not an HTML page (${contentType.split(';')[0] || 'unknown type'}).`,
      status: upstream.status, contentType, url: upstream.url || target }, 415);
  }

  const html = await readLimited(upstream, MAX_BYTES);
  return json({
    ok: true,
    url: upstream.url || target,
    status: upstream.status,
    contentType,
    head: extractHead(html),
  }, 200, { 'cache-control': 'public, max-age=3600' });
}

export const onRequestGet = (context) => handleMeta(context.request);

export const onRequestOptions = () => new Response(null, {
  status: 204,
  headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'accept',
    'access-control-max-age': '86400',
  },
});
