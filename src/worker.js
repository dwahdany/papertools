// Cloudflare Worker entry point (Worker + static assets).
//
// Serves ./public as static assets and handles the two dynamic routes used by
// the URL → APA tool:
//   GET /api/meta?url=…   fetch a web page server-side and return its <head>
//                        (browsers cannot read most third-party pages cross-origin)
//   GET /api/config       tells the client whether a Turnstile site key is set
// See src/meta.js for the access checks (same-origin, optional Turnstile).

import { handleMeta, handleConfig } from './meta.js';

const API = {
  '/api/meta': (request, env) => handleMeta(request, { env }),
  '/api/config': (request, env) => handleConfig(env),
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const route = API[pathname];
    if (route) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      }
      return route(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
