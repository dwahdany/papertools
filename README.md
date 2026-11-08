# papertools

Small tools for academic writing. No build step: plain HTML and ES modules, deployable to Cloudflare Pages. Everything runs in the browser; the only server-side piece is a stateless Pages Function that fetches web pages for the URL → APA tool (the rest of the site works on any static host).

| Tool | Path | What it does |
| --- | --- | --- |
| URL → APA | `/url-to-apa/` | Paste any web page link (blog post, docs, news) or a paper link (DOI, arXiv, OpenReview, PubMed, Semantic Scholar, ACL Anthology, publisher page) and get an APA 7 reference plus BibTeX. Paper metadata comes from public APIs (Crossref, DataCite, Semantic Scholar, PubMed, Open Library) called directly from your browser. Ordinary web pages are read through a tiny Pages Function (`functions/api/meta.js`) because browsers cannot read most third-party pages cross-origin; the Wayback Machine and a manual form are the fallbacks. |
| BibTeX → APA | `/bibtex-to-apa/` | Convert BibTeX entries to APA 7 references with italics like Google Scholar's "Cite" dialog. Copy as rich text, Markdown, LaTeX or plain text. |
| Markdown compactor | `/markdown-compactor/` | Strip padding whitespace and collapse separator dashes in Markdown tables. |

## Development

```bash
npm test          # unit tests (Node ≥ 20, no dependencies)
npm run serve     # serve ./public on http://localhost:8000 (static only, no /api/meta)
npx wrangler pages dev public   # full local preview including the Pages Function
```

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
tests/                  node --test unit tests
```

## License

MIT
