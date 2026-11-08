import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMeta, isPublicHttpUrl, extractHead } from '../functions/api/meta.js';

const page = (head, body = '<body><p>hi</p></body>') => `<!doctype html><html lang="en"><head>${head}</head>${body}</html>`;

function fakeFetch(map) {
  return async (url) => {
    const entry = map[url];
    if (!entry) throw new TypeError('fetch failed');
    if (entry instanceof Error) throw entry;
    const { status = 200, body = '', headers = {}, finalUrl } = entry;
    const res = new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
    if (finalUrl) Object.defineProperty(res, 'url', { value: finalUrl });
    return res;
  };
}

const req = (q) => new Request(`https://papertools.pages.dev/api/meta${q}`);

test('isPublicHttpUrl accepts public hosts and rejects private/local ones', () => {
  for (const ok of ['https://example.com/x', 'http://blog.example.org/post?id=1', 'https://8.8.8.8/', 'https://[2001:db8::1]/']) {
    assert.equal(isPublicHttpUrl(ok), true, ok);
  }
  for (const bad of ['ftp://example.com', 'file:///etc/passwd', 'https://localhost/', 'http://127.0.0.1/',
    'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/', 'http://[fd00::1]/', 'https://user:pw@example.com/', 'http://intranet/', 'http://foo.internal/',
    'http://0.0.0.0/', 'http://100.64.0.1/', 'not a url']) {
    assert.equal(isPublicHttpUrl(bad), false, bad);
  }
});

test('extractHead returns the head element, or the pre-body prefix', () => {
  assert.equal(extractHead(page('<title>T</title>')), '<head><title>T</title></head>');
  assert.equal(extractHead('<HEAD ><meta name="a" content="b"></HEAD>rest'), '<HEAD ><meta name="a" content="b"></HEAD>');
  assert.equal(extractHead('<html><meta name="a" content="b"><body>x</body>'), '<html><meta name="a" content="b">');
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
});

test('rejects missing and non-public urls with 400', async () => {
  const fetch = fakeFetch({});
  assert.equal((await handleMeta(req(''), { fetch })).status, 400);
  assert.equal((await handleMeta(req('?url=http://127.0.0.1/admin'), { fetch })).status, 400);
  assert.equal((await handleMeta(req('?url=javascript:alert(1)'), { fetch })).status, 400);
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

test('truncates very large pages instead of buffering them whole', async () => {
  const big = page('<title>Big</title>', '<body>' + 'x'.repeat(2 * 1024 * 1024) + '</body>');
  const fetch = fakeFetch({ 'https://example.com/big': { body: big } });
  const res = await handleMeta(req('?url=https://example.com/big'), { fetch });
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.match(data.head, /<title>Big<\/title>/);
});
