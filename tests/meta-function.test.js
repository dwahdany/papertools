import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMeta, isPublicHttpUrl, extractHead, pickCharset, decodeBytes, onRequestOptions } from '../functions/api/meta.js';

const page = (head, body = '<body><p>hi</p></body>') => `<!doctype html><html lang="en"><head>${head}</head>${body}</html>`;
const enc = new TextEncoder();

/**
 * Fake fetch: `map` is { url: entry }. An entry is an Error (thrown), a function
 * (url, init) => Response, or { status, body, headers, finalUrl }; `body` may be a
 * string, Uint8Array, ReadableStream or null. Redirects are never followed by the
 * fake (the handler must do that itself); every requested URL is recorded in
 * `fetch.calls`.
 */
function fakeFetch(map) {
  const fetch = async (url, init = {}) => {
    fetch.calls.push(url);
    fetch.inits.push(init);
    const entry = map[url];
    if (!entry) throw new TypeError('fetch failed');
    if (entry instanceof Error) throw entry;
    if (typeof entry === 'function') return entry(url, init);
    const { status = 200, headers = {}, finalUrl } = entry;
    const body = 'body' in entry ? entry.body : '';
    const res = new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
    if (finalUrl) Object.defineProperty(res, 'url', { value: finalUrl });
    return res;
  };
  fetch.calls = [];
  fetch.inits = [];
  return fetch;
}

const redirect = (location, status = 302) => ({ status, body: null, headers: { location, 'content-type': 'text/plain' } });

const req = (q) => new Request(`https://papertools.pages.dev/api/meta${q}`);

test('isPublicHttpUrl accepts public hosts and rejects private/local ones', () => {
  for (const ok of ['https://example.com/x', 'http://blog.example.org/post?id=1', 'https://8.8.8.8/', 'https://[2001:db8::1]/',
    'https://[2400:cb00:2048:1::6814:1]/', 'https://example.com./', 'http://1.1.1.1./']) {
    assert.equal(isPublicHttpUrl(ok), true, ok);
  }
  for (const bad of ['ftp://example.com', 'file:///etc/passwd', 'https://localhost/', 'http://127.0.0.1/',
    'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/', 'http://[fd00::1]/', 'https://user:pw@example.com/', 'http://intranet/', 'http://foo.internal/',
    'http://0.0.0.0/', 'http://100.64.0.1/', 'not a url',
    // normalised forms of private addresses
    'http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://127.0.0.1./']) {
    assert.equal(isPublicHttpUrl(bad), false, bad);
  }
});

test('isPublicHttpUrl ignores a trailing dot and rejects 6to4 / Teredo IPv6 literals', () => {
  for (const bad of ['http://localhost./', 'http://foo.localhost./', 'http://intranet./', 'http://box.local./',
    'http://[2002:7f00:1::]/', 'http://[2001:0:7f00:1::]/', 'http://[2001::7f00:1]/', 'http://[2001:0000:0:0::1]/']) {
    assert.equal(isPublicHttpUrl(bad), false, bad);
  }
  assert.equal(isPublicHttpUrl('https://[2001:db8::1]/'), true);
  assert.equal(isPublicHttpUrl('https://[2001:4860:4860::8888]/'), true);
});

test('extractHead returns the head element, or the pre-body prefix when it holds metadata', () => {
  assert.equal(extractHead(page('<title>T</title>')), '<head><title>T</title></head>');
  assert.equal(extractHead('<HEAD ><meta name="a" content="b"></HEAD>rest'), '<HEAD ><meta name="a" content="b"></HEAD>');
  assert.equal(extractHead('<html><meta name="a" content="b"><body>x</body>'), '<html><meta name="a" content="b">');
  const ld = '<html><script type="application/ld+json">{"@type":"Article"}</script><body>x</body>';
  assert.equal(extractHead(ld), '<html><script type="application/ld+json">{"@type":"Article"}</script>');
  // Head-like markup but no closing tag: still relayed (capped).
  assert.match(extractHead('<html><head><title>T</title><body>x'), /<title>T<\/title>/);
});

test('extractHead never relays content that does not look like a document head', () => {
  assert.equal(extractHead('plain text'), '');
  assert.equal(extractHead('{"token":"SECRET"}'), '');
  assert.equal(extractHead('<svg xmlns="http://www.w3.org/2000/svg"><!-- SECRET --><text>x</text></svg>'), '');
  assert.equal(extractHead(''), '');
  // the no-<body> fallback is capped at 64 KiB
  const long = '<meta name="a" content="b">' + 'y'.repeat(200 * 1024);
  assert.equal(extractHead(long).length, 64 * 1024);
});

test('returns head, final url and content type for an HTML page', async () => {
  const html = page('<title>Hello</title><meta property="og:title" content="Hello world">');
  const fetch = fakeFetch({ 'https://example.com/post': { body: html, finalUrl: 'https://example.com/post/' } });
  const res = await handleMeta(req('?url=https://example.com/post'), { fetch });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.url, 'https://example.com/post/');
  assert.match(data.head, /og:title/);
  assert.ok(!data.head.includes('<body'));
  assert.equal(fetch.inits[0].redirect, 'manual');
});

test('rejects missing and non-public urls with 400', async () => {
  const fetch = fakeFetch({});
  assert.equal((await handleMeta(req(''), { fetch })).status, 400);
  assert.equal((await handleMeta(req('?url=http://127.0.0.1/admin'), { fetch })).status, 400);
  assert.equal((await handleMeta(req('?url=javascript:alert(1)'), { fetch })).status, 400);
  assert.equal((await handleMeta(req('?url=http://localhost./'), { fetch })).status, 400);
  assert.equal(fetch.calls.length, 0);
});

test('refuses to fetch its own host', async () => {
  const fetch = fakeFetch({});
  const self = encodeURIComponent('https://papertools.pages.dev/api/meta?url=https://example.com/');
  const res = await handleMeta(req(`?url=${self}`), { fetch });
  assert.equal(res.status, 400);
  assert.equal(fetch.calls.length, 0);
  const redirected = fakeFetch({ 'https://example.com/r': redirect('https://papertools.pages.dev/x') });
  assert.equal((await handleMeta(req('?url=https://example.com/r'), { fetch: redirected })).status, 400);
  assert.deepEqual(redirected.calls, ['https://example.com/r']);
});

test('maps upstream failures to 502 and non-HTML to 415', async () => {
  const fetch = fakeFetch({
    'https://example.com/404': { status: 404, body: 'nope' },
    'https://example.com/file.pdf': { body: '%PDF-1.4', headers: { 'content-type': 'application/pdf' } },
  });
  const r404 = await handleMeta(req('?url=https://example.com/404'), { fetch });
  assert.equal(r404.status, 502);
  assert.match((await r404.json()).error, /HTTP 404/);
  const rPdf = await handleMeta(req('?url=https://example.com/file.pdf'), { fetch });
  assert.equal(rPdf.status, 415);
  const rDown = await handleMeta(req('?url=https://example.com/down'), { fetch });
  assert.equal(rDown.status, 502);
  assert.match((await rDown.json()).error, /could not be reached/);
});

test('only text/html and application/xhtml+xml documents are relayed', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><!-- SECRET TOKEN --><text>x</text></svg>';
  const rss = '<?xml version="1.0"?><rss><channel><title>Feed</title></channel></rss>';
  const fetch = fakeFetch({
    'https://example.com/a.svg': { body: svg, headers: { 'content-type': 'image/svg+xml' } },
    'https://example.com/feed': { body: rss, headers: { 'content-type': 'application/rss+xml; charset=utf-8' } },
    'https://example.com/atom': { body: rss, headers: { 'content-type': 'application/atom+xml' } },
    'https://example.com/x.xml': { body: rss, headers: { 'content-type': 'text/xml' } },
    'https://example.com/odd': { body: '%PDF', headers: { 'content-type': 'application/pdf; name=a.xml' } },
    'https://example.com/xhtml': { body: page('<title>X</title>'), headers: { 'content-type': 'application/xhtml+xml; charset=utf-8' } },
    'https://example.com/upper': { body: page('<title>U</title>'), headers: { 'content-type': 'TEXT/HTML' } },
  });
  for (const path of ['a.svg', 'feed', 'atom', 'x.xml', 'odd']) {
    const res = await handleMeta(req(`?url=https://example.com/${path}`), { fetch });
    assert.equal(res.status, 415, path);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.head, undefined);
    assert.ok(!JSON.stringify(data).includes('SECRET'));
  }
  for (const path of ['xhtml', 'upper']) {
    const res = await handleMeta(req(`?url=https://example.com/${path}`), { fetch });
    assert.equal(res.status, 200, path);
    assert.match((await res.json()).head, /<title>/);
  }
});

test('an HTML-typed body without head metadata is reported as 422, never echoed', async () => {
  const fetch = fakeFetch({
    'https://example.com/json': { body: '{"token":"SECRET"}' },
    'https://example.com/empty': { body: null, headers: { 'content-type': 'text/html' } },
  });
  for (const path of ['json', 'empty']) {
    const res = await handleMeta(req(`?url=https://example.com/${path}`), { fetch });
    assert.equal(res.status, 422, path);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.match(data.error, /no <head> metadata/);
    assert.equal(data.head, undefined);
    assert.ok(!JSON.stringify(data).includes('SECRET'));
  }
});

test('truncates very large pages instead of buffering them whole', async () => {
  const big = page('<title>Big</title>', '<body>' + 'x'.repeat(2 * 1024 * 1024) + '</body>');
  const fetch = fakeFetch({ 'https://example.com/big': { body: big } });
  const res = await handleMeta(req('?url=https://example.com/big'), { fetch });
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.match(data.head, /<title>Big<\/title>/);
  // the limit is honoured: everything past maxBytes (here: </head> and the body) is cut off
  const small = await handleMeta(req('?url=https://example.com/big'), { fetch, maxBytes: 58 });
  const cut = await small.json();
  assert.equal(cut.ok, true);
  assert.match(cut.head, /<title>Big<\/title>/);
  assert.ok(cut.head.length <= 58 && !cut.head.includes('</head>'), cut.head);
});

test('redirects are followed manually and each hop is re-validated', async () => {
  const fetch = fakeFetch({
    'https://example.com/r': redirect('http://127.0.0.1/admin'),
    'https://example.com/meta': redirect('http://169.254.169.254/latest/meta-data', 301),
    'https://example.com/dot': redirect('http://localhost./'),
    'https://example.com/scheme': redirect('file:///etc/passwd'),
    'http://127.0.0.1/admin': { body: page('<title>INTERNAL</title>') },
  });
  for (const path of ['r', 'meta', 'dot', 'scheme']) {
    const res = await handleMeta(req(`?url=https://example.com/${path}`), { fetch });
    assert.equal(res.status, 400, path);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.match(data.error, /non-public/);
    assert.ok(!JSON.stringify(data).includes('INTERNAL'));
  }
  assert.ok(!fetch.calls.includes('http://127.0.0.1/admin'), 'the private address must never be fetched');
  assert.ok(fetch.calls.every((u) => u.startsWith('https://example.com/')), fetch.calls.join(', '));
});

test('public redirects are followed (relative Location too) and the final url is reported', async () => {
  const fetch = fakeFetch({
    'https://example.com/old': redirect('/new', 301),
    'https://example.com/new': redirect('https://blog.example.org/post/', 307),
    'https://blog.example.org/post/': { body: page('<title>Moved</title>') },
  });
  const res = await handleMeta(req('?url=https://example.com/old'), { fetch });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.url, 'https://blog.example.org/post/');
  assert.match(data.head, /Moved/);
  assert.deepEqual(fetch.calls, ['https://example.com/old', 'https://example.com/new', 'https://blog.example.org/post/']);
  assert.ok(fetch.inits.every((i) => i.redirect === 'manual'));
});

test('gives up after five redirects and treats a 3xx without Location as an upstream error', async () => {
  const map = {};
  for (let i = 0; i < 7; i++) map[`https://example.com/${i}`] = redirect(`https://example.com/${i + 1}`);
  map['https://example.com/7'] = { body: page('<title>End</title>') };
  map['https://example.com/noloc'] = { status: 302, body: '' };
  const fetch = fakeFetch(map);
  const res = await handleMeta(req('?url=https://example.com/0'), { fetch });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /too many times/);
  assert.equal(fetch.calls.length, 6); // the original request plus five hops
  const five = fakeFetch(map);
  assert.equal((await handleMeta(req('?url=https://example.com/2'), { fetch: five })).status, 200);
  const noloc = await handleMeta(req('?url=https://example.com/noloc'), { fetch });
  assert.equal(noloc.status, 502);
  assert.match((await noloc.json()).error, /HTTP 302/);
});

test('a body that never completes hits the deadline and answers 502 "timed out"', async () => {
  const stalled = () => new Response(new ReadableStream({
    start(c) { c.enqueue(enc.encode('<html><head><title>x</title>')); }, // never closes
  }), { headers: { 'content-type': 'text/html' } });
  const fetch = fakeFetch({ 'https://example.com/slow': stalled });
  const started = Date.now();
  const res = await handleMeta(req('?url=https://example.com/slow'), { fetch, timeoutMs: 50 });
  assert.ok(Date.now() - started < 1000, 'must not wait for the body');
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /timed out/);
});

test('the deadline also covers headers that never arrive', async () => {
  const fetch = async (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const res = await handleMeta(req('?url=https://example.com/hang'), { fetch, timeoutMs: 30 });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /timed out/);
});

test('decodes the body with the declared charset instead of assuming UTF-8', async () => {
  const cp1252 = (s) => Uint8Array.from(s, (ch) => (ch === 'é' ? 0xE9 : ch.charCodeAt(0)));
  const html = '<html><head><title>Café</title></head><body>x</body></html>';
  const fetch = fakeFetch({
    'https://example.com/header': { body: cp1252(html), headers: { 'content-type': 'text/html; charset=windows-1252' } },
    'https://example.com/meta': { body: cp1252('<html><head><meta charset="windows-1252"><title>Café</title></head><body>x</body></html>'), headers: { 'content-type': 'text/html' } },
    'https://example.com/equiv': { body: cp1252('<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><title>Café</title></head></html>'), headers: { 'content-type': 'text/html' } },
    'https://example.com/bogus': { body: enc.encode(html), headers: { 'content-type': 'text/html; charset=x-bogus' } },
    'https://example.com/bom': { body: new Uint8Array([0xEF, 0xBB, 0xBF, ...enc.encode(html)]), headers: { 'content-type': 'text/html; charset=windows-1252' } },
    'https://example.com/utf8': { body: enc.encode(html) },
  });
  for (const path of ['header', 'meta', 'equiv', 'bogus', 'bom', 'utf8']) {
    const res = await handleMeta(req(`?url=https://example.com/${path}`), { fetch });
    assert.equal(res.status, 200, path);
    const { head } = await res.json();
    assert.match(head, /<title>Café<\/title>/, path);
    assert.ok(!head.includes('�') && !head.includes('ï»¿'), `${path}: ${head}`);
  }
});

test('pickCharset follows BOM > header > meta > utf-8 and normalises odd labels', () => {
  const ascii = (s) => enc.encode(s);
  assert.equal(pickCharset('text/html', ascii('<html>')), 'utf-8');
  assert.equal(pickCharset('text/html; charset=ISO-8859-1', ascii('<meta charset="utf-8">')), 'iso-8859-1');
  assert.equal(pickCharset('text/html', ascii('<meta charset=Shift_JIS>')), 'shift_jis');
  assert.equal(pickCharset('text/html', new Uint8Array([0xEF, 0xBB, 0xBF, ...ascii('<meta charset="windows-1252">')])), 'utf-8');
  assert.equal(pickCharset('text/html', new Uint8Array([0xFF, 0xFE, 0x3C, 0x00])), 'utf-16le');
  assert.equal(pickCharset('text/html', new Uint8Array([0xFE, 0xFF, 0x00, 0x3C])), 'utf-16be');
  assert.equal(pickCharset('text/html; charset=utf-16', ascii('<html>')), 'utf-8');
  assert.equal(pickCharset('text/html; charset=x-user-defined', ascii('<html>')), 'windows-1252');
  assert.equal(decodeBytes(new Uint8Array([0x43, 0x61, 0x66, 0xE9]), 'windows-1252'), 'Café');
  assert.equal(decodeBytes(enc.encode('Café'), 'no-such-encoding'), 'Café');
});

test('onRequestOptions answers the CORS preflight', async () => {
  const res = onRequestOptions();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal(res.headers.get('access-control-allow-headers'), 'accept');
  assert.equal(await res.text(), '');
});
