// Cloudflare Worker entry point (Workers with static assets).
//
// Serves ./public as static assets and handles the one dynamic route,
// GET /api/meta, which fetches a web page server-side for the URL → APA tool
// (browsers cannot read most third-party pages cross-origin). The handler
// lives in functions/api/meta.js so the same code also works as a Pages
// Function.

import { handleMeta, onRequestOptions } from '../functions/api/meta.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/meta') {
      if (request.method === 'OPTIONS') return onRequestOptions();
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, OPTIONS' } });
      }
      return handleMeta(request, { env });
    }
    return env.ASSETS.fetch(request);
  },
};
