import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const env = { ASSETS: { fetch: async (req) => new Response(`asset:${new URL(req.url).pathname}`) }, TURNSTILE_SITE_KEY: 'site-key' };

test('static paths are delegated to the assets binding', async () => {
  const res = await worker.fetch(new Request('https://papertools.example/bibtex-to-apa/'), env);
  assert.equal(await res.text(), 'asset:/bibtex-to-apa/');
});

test('/api/meta is handled by the worker', async () => {
  const res = await worker.fetch(new Request('https://papertools.example/api/meta'), env);
  assert.equal(res.status, 400); // missing ?url= -> handled by handleMeta, not assets
  const post = await worker.fetch(new Request('https://papertools.example/api/meta', { method: 'POST' }), env);
  assert.equal(post.status, 405);
  const foreign = await worker.fetch(new Request('https://papertools.example/api/meta?url=https://example.com/', { headers: { origin: 'https://evil.example' } }), env);
  assert.equal(foreign.status, 403);
});

test('/api/config reports the Turnstile site key', async () => {
  const res = await worker.fetch(new Request('https://papertools.example/api/config'), env);
  assert.deepEqual(await res.json(), { turnstileSiteKey: 'site-key', turnstileAction: 'fetch-page' });
  const none = await worker.fetch(new Request('https://papertools.example/api/config'), { ...env, TURNSTILE_SITE_KEY: undefined });
  assert.deepEqual(await none.json(), { turnstileSiteKey: null, turnstileAction: 'fetch-page' });
});
