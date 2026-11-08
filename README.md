# papertools

Small, fully client-side tools for academic writing. No server, no build step: plain HTML and ES modules, deployable to Cloudflare Pages (or any static host).

| Tool | Path | What it does |
| --- | --- | --- |
| URL → APA | `/url-to-apa/` | Paste a DOI, arXiv, OpenReview, PubMed, Semantic Scholar, ACL Anthology, publisher or web page link; get an APA 7 reference and BibTeX. Metadata comes from public, CORS-enabled APIs (Crossref, DataCite, arXiv, Semantic Scholar, OpenReview, PubMed, Open Library) directly from your browser. |
| BibTeX → APA | `/bibtex-to-apa/` | Convert BibTeX entries to APA 7 references with italics like Google Scholar's "Cite" dialog. Copy as rich text, Markdown, LaTeX or plain text. |
| Markdown compactor | `/markdown-compactor/` | Strip padding whitespace and collapse separator dashes in Markdown tables. |

## Development

```bash
npm test          # unit tests (Node ≥ 20, no dependencies)
npm run serve     # serve ./public on http://localhost:8000
```

## Deploying to Cloudflare Pages

Create a Pages project from this repository with:

- Build command: *(none)*
- Build output directory: `public`

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
tests/                  node --test unit tests
```

## License

MIT
