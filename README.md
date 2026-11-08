# papertools

Small tools for academic writing. No build step: plain HTML and ES modules, deployable to Cloudflare Pages. Everything runs in the browser; the only server-side piece is a stateless Pages Function that fetches web pages for the URL → APA tool (the rest of the site works on any static host).

| Tool | Path | What it does |
| --- | --- | --- |
| URL → APA | `/url-to-apa/` | Paste any web page link (blog post, docs, news) or a paper link (DOI, arXiv, OpenReview, PubMed, Semantic Scholar, ACL Anthology, ISBN, publisher page) and get an APA 7 reference plus BibTeX. Paper metadata comes from public APIs (Crossref, DataCite, doi.org, Semantic Scholar, OpenReview, PubMed, Open Library) called directly from your browser. Ordinary web pages are read through a tiny server-side fetcher on the same Worker (`/api/meta`, see `src/meta.js`) because browsers cannot read most third-party pages cross-origin; a direct read (for CORS-enabled sites), the Wayback Machine and a manual form are the fallbacks. Every attempt is listed in a "Sources tried" line. |
| BibTeX → APA | `/bibtex-to-apa/` | Convert BibTeX entries to APA 7 references with italics like Google Scholar's "Cite" dialog. Copy as rich text, Markdown, LaTeX or plain text. |
| Markdown compactor | `/markdown-compactor/` | Strip padding whitespace and collapse separator dashes in Markdown tables. |

## Development

```bash
npm test          # unit tests (Node ≥ 20, no dependencies)
LIVE=1 node --test tests/live-resolve.test.js   # resolver checks against the real APIs (skipped without LIVE=1)
npm run serve     # serve ./public on http://localhost:8000 (static only, no /api/meta)
npx wrangler dev  # full local preview as the Worker, including /api/meta
```

Behind a corporate proxy, Node's built-in `fetch` needs `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21) for the live tests.

## How the URL → APA resolver finds metadata

The chains below follow what the public APIs actually allow from a browser (probed live; see the contract comment at the top of `public/assets/resolve.js`). First success wins; every attempt is reported in the result's `sources` array and shown on the page.

| Input | Chain |
| --- | --- |
| DOI | Crossref → DataCite → doi.org content negotiation (CSL-JSON). arXiv DOIs (`10.48550/arXiv.…`) skip Crossref and use the arXiv chain. |
| arXiv id / URL | DataCite (`10.48550/arXiv.<id>`; it has every arXiv paper and sends CORS) → Semantic Scholar `ARXIV:<id>` → arXiv Atom API (no CORS, so only outside browsers). Always cited as the preprint; a known published DOI becomes a warning. |
| PubMed / PMC id | NCBI E-utilities → DOI chain for richer data. |
| ACL Anthology id | Crossref `10.18653/v1/<id>` (2017+) → Semantic Scholar `ACL:<id>`. |
| OpenReview forum | OpenReview API2 → API1 → Semantic Scholar URL lookup. OpenReview often answers with an anti-bot challenge (HTTP 403); the error then says so and suggests pasting the arXiv link or BibTeX. |
| Semantic Scholar paper / CorpusID | Semantic Scholar (429s are retried once after 2 s; it is never tried before Crossref/DataCite). |
| ISBN | Open Library. |
| Any other URL | `/api/meta?url=…` (this site's Worker returns the page `<head>`) → direct `fetch` (works on CORS-enabled sites such as PMLR) → Wayback Machine (`archive.org/wayback/available`, then the raw `web.archive.org/web/<ts>id_/<url>` snapshot, with a warning naming the snapshot date) → URL-only partial reference for the editor. A `citation_doi` / `citation_arxiv_id` in the page triggers the richer chain. |

Nothing is stored anywhere: `/api/meta` is stateless and only relays the page head. It answers only requests from the site itself, can require a Turnstile token (below), and is deliberately narrow: only public http(s) hosts (re-checked on every redirect hop, at most five), one 10 s deadline covering the body read, at most 512 KiB, only `text/html` / `application/xhtml+xml` responses, decoded with the page's declared charset; a document without head metadata is answered with HTTP 422 instead of being echoed (400 bad input, 415 not HTML, 502 upstream failure).

## Deploying to Cloudflare

The repository deploys as a **Cloudflare Worker with static assets**: `wrangler.toml` points `main` at `src/worker.js`, which serves `public/` as static assets and routes `/api/meta` and `/api/config` to `src/meta.js`. There is no build step.

- **Git integration (Workers Builds):** connect the repository to a Worker; Cloudflare runs `npx wrangler deploy` on every push to the configured branch. The `name` in `wrangler.toml` must match the Worker's name.
- **From the command line:** `npx wrangler deploy` publishes, `npx wrangler dev` previews locally (static server plus the API routes).

### Protecting `/api/meta` with Turnstile

The page fetcher only answers requests from the site itself and can additionally require a [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) token. The check is off until both values are configured, so previews keep working:

1. In the Cloudflare dashboard create a Turnstile widget for the site's hostname (widget mode *Managed* or *Invisible*; the page renders it with `appearance: interaction-only`, so nothing is shown unless Cloudflare needs an interaction).
2. Set the **site key** as a plain variable and the **secret key** as an encrypted secret on the Worker:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

and add `TURNSTILE_SITE_KEY` under *Settings → Variables* (or in `wrangler.toml` under `[vars]`; the site key is public). Cloudflare's test keys `1x00000000000000000000AA` / `1x0000000000000000000000000000000AA` always pass and are handy for local checks.

The page reads `/api/config` to learn whether a site key is set, obtains a token silently, and sends it as the `cf-turnstile-response` header. `/api/meta` verifies it with the siteverify API and refuses requests with a missing or invalid token (HTTP 403).

## Layout

```
public/                 the site (deploy this directory)
  index.html            landing page
  url-to-apa/           URL → APA tool
  bibtex-to-apa/        BibTeX → APA tool
  markdown-compactor/   Markdown table compactor
  assets/
    model.js            shared Reference data model
    apa.js              APA 7 formatter (Reference → rich text)
    bibtex.js           BibTeX parser / LaTeX decoding / serializer
    resolve.js          URL & identifier → Reference resolvers
    compact.js          Markdown table compaction
    ui.js, style.css    shared UI helpers and styles
src/meta.js             server-side page fetcher with same-origin and Turnstile checks
src/worker.js           Workers entry point (static assets + /api/meta) for `wrangler deploy`
wrangler.toml           Workers configuration (ignored by `wrangler pages …`)
tests/                  node --test unit tests (fixtures/ holds real API bodies); live-resolve.test.js needs LIVE=1
```

## License

MIT
