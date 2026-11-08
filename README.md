# papertools

Small tools for academic writing. No build step: plain HTML and ES modules, deployable to Cloudflare Pages. Everything runs in the browser; the only server-side piece is a stateless Pages Function that fetches web pages for the URL → APA tool (the rest of the site works on any static host).

| Tool | Path | What it does |
| --- | --- | --- |
| URL → APA | `/url-to-apa/` | Paste any web page link (blog post, docs, news) or a paper link (DOI, arXiv, OpenReview, PubMed, Semantic Scholar, ACL Anthology, ISBN, publisher page) and get an APA 7 reference plus BibTeX. Paper metadata comes from public APIs (Crossref, DataCite, doi.org, Semantic Scholar, OpenReview, PubMed, Open Library) called directly from your browser. Ordinary web pages are read through a tiny Pages Function (`functions/api/meta.js`) because browsers cannot read most third-party pages cross-origin; a direct read (for CORS-enabled sites), the Wayback Machine and a manual form are the fallbacks. Every attempt is listed in a "Sources tried" line. |
| BibTeX → APA | `/bibtex-to-apa/` | Convert BibTeX entries to APA 7 references with italics like Google Scholar's "Cite" dialog. Copy as rich text, Markdown, LaTeX or plain text. |
| Markdown compactor | `/markdown-compactor/` | Strip padding whitespace and collapse separator dashes in Markdown tables. |

## Development

```bash
npm test          # unit tests (Node ≥ 20, no dependencies)
LIVE=1 node --test tests/live-resolve.test.js   # resolver checks against the real APIs (skipped without LIVE=1)
npm run serve     # serve ./public on http://localhost:8000 (static only, no /api/meta)
npx wrangler pages dev public   # full local preview including the Pages Function
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
| Any other URL | `/api/meta?url=…` (this site's Pages Function returns the page `<head>`) → direct `fetch` (works on CORS-enabled sites such as PMLR) → Wayback Machine (`archive.org/wayback/available`, then the raw `web.archive.org/web/<ts>id_/<url>` snapshot, with a warning naming the snapshot date) → URL-only partial reference for the editor. A `citation_doi` / `citation_arxiv_id` in the page triggers the richer chain. |

Nothing is stored anywhere: `/api/meta` is stateless and only relays the page head.

## Deploying to Cloudflare Pages

Create a Pages project from this repository with:

- Build command: *(none)*
- Build output directory: `public`

The `functions/` directory is picked up automatically and becomes `/api/meta`.

`wrangler.toml` already points `pages_build_output_dir` at `public`, so `npx wrangler pages deploy` also works.

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
functions/api/meta.js   Pages Function: fetches a web page server-side and returns its <head>
tests/                  node --test unit tests (fixtures/ holds real API bodies); live-resolve.test.js needs LIVE=1
```

## License

MIT
