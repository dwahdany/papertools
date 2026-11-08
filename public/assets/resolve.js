// URL / identifier -> Reference resolvers. Browser-only, CORS-friendly APIs.
//
// CONTRACT:
//
//   detectIdentifier(input) -> { kind, id, url } | null
//     kind: 'doi' | 'arxiv' | 'pmid' | 'pmcid' | 'openreview' | 'acl' | 's2' |
//           'isbn' | 'url'
//     Accepts bare identifiers ("10.1038/nature14539", "arXiv:1706.03762",
//     "1706.03762", "PMID: 31452104", "978-0-13-468599-1") and URLs
//     (doi.org, dx.doi.org, arxiv.org/abs|pdf, openreview.net/forum|pdf?id=,
//     pubmed.ncbi.nlm.nih.gov/ID, aclanthology.org/ID, semanticscholar.org/paper/...,
//     publisher URLs containing a DOI in the path like /doi/10.1145/...).
//     Anything else that parses as http(s) URL -> { kind: 'url', id: url, url }.
//
//   resolveReference(input, { fetch?, signal?, now? }) -> Promise<{
//     reference: Reference,
//     source: string,          // 'crossref' | 'datacite' | 'arxiv' | 'semanticscholar' | 'openreview' | 'pubmed' | 'openlibrary' | 'html-meta' | 'url-only'
//     identifier: ReturnType<typeof detectIdentifier>,
//     warnings: string[],
//   }>
//     Strategy (first success wins, failures recorded in warnings):
//       doi    -> api.crossref.org/works/{doi}  -> api.datacite.org/dois/{doi}
//       arxiv  -> export.arxiv.org/api/query?id_list=ID (Atom XML; parse with DOMParser) -> semanticscholar
//                 Prefer published version? NO: cite the arXiv preprint (type 'preprint',
//                 archive 'arXiv', archiveId without version) but if the Atom has a DOI
//                 record it in `doi`; add a warning "A published version exists (DOI …)" if
//                 arXiv's journal_ref/doi present.
//       pmid   -> eutils esummary (retmode=json) -> if it has a DOI, crossref for richer data
//       openreview -> api2.openreview.net/notes?forum=ID then api.openreview.net/notes?forum=ID
//                 (content fields may be {value: …} in API2) -> type paper-conference with
//                 venue as containerTitle; fallback semanticscholar URL lookup
//       acl, s2 -> api.semanticscholar.org/graph/v1/paper/{URL:…|ACL:…|ARXIV:…}
//                 ?fields=title,authors,year,venue,journal,externalIds,publicationVenue,publicationTypes
//       isbn   -> openlibrary.org/api/books?bibkeys=ISBN:…&format=json&jscmd=data
//       url    -> if the URL contains a DOI/arXiv id: resolve as above. Else try
//                 semanticscholar URL: lookup for known domains (arxiv, aclweb, acm, biorxiv,
//                 dblp, pubmed). Else fetch(url) directly and parse <meta> tags
//                 (citation_*, og:*, dc.*, article:published_time, author, <title>,
//                 JSON-LD @type Article/ScholarlyArticle/WebPage). Direct fetch usually
//                 fails with CORS -> reject with a ResolveError whose .partial holds a
//                 'url-only' Reference { type:'webpage', url, containerTitle: hostname
//                 (www. stripped), accessed: today } and whose message explains the
//                 page could not be read from the browser so fields must be filled in.
//
//   class ResolveError extends Error { partial?: {reference, source, identifier, warnings} }
//
//   Mapping helpers (exported for tests):
//     fromCrossref(item) -> Reference        (item = message of works/{doi})
//     fromDatacite(attrs) -> Reference       (attrs = data.attributes)
//     fromArxivAtom(xmlString, id) -> Reference
//     fromSemanticScholar(json) -> Reference
//     fromOpenReview(note) -> Reference
//     fromPubmedSummary(result) -> Reference  (result = result[ID])
//     fromOpenLibrary(book) -> Reference
//     fromHtmlMeta(doc, url, now) -> Reference  (doc = DOM Document)
//
//   Notes:
//   - Crossref: type journal-article -> article-journal; proceedings-article ->
//     paper-conference (container-title -> containerTitle, event/series -> collectionTitle);
//     book / monograph / edited-book -> book; book-chapter -> chapter; posted-content ->
//     preprint (institution/group-title -> archive e.g. "bioRxiv", "arXiv"); report -> report;
//     dissertation -> thesis; dataset -> dataset; others -> generic. Use `issued` date-parts,
//     fall back to published-print / published-online / created. Strip HTML/JATS tags from titles.
//     Crossref author objects: {given, family, name (literal), sequence}. Use `page`
//     ("1-10") or `article-number`. Use `publisher`. For journals, `container-title[0]`,
//     short-container-title ignored. Volume/issue strings.
//   - arXiv id normalisation: accept old-style "hep-th/9901001" and new "1706.03762v5".
//   - Always set `url` to a canonical landing URL when none better exists.
//   - The `fetch` option allows injecting a fake fetch in tests; default globalThis.fetch.
//   - Every network call: timeout ~15s via AbortController, Accept: application/json,
//     and a friendly error message (status code, host) on failure.

export { detectIdentifier, resolveReference, ResolveError,
  fromCrossref, fromDatacite, fromArxivAtom, fromSemanticScholar, fromOpenReview,
  fromPubmedSummary, fromOpenLibrary, fromHtmlMeta };

class ResolveError extends Error {
  constructor(message, partial) { super(message); this.name = 'ResolveError'; this.partial = partial; }
}
function notImplemented() { throw new Error('resolve.js: not implemented yet'); }
function detectIdentifier() { notImplemented(); }
async function resolveReference() { notImplemented(); }
function fromCrossref() { notImplemented(); }
function fromDatacite() { notImplemented(); }
function fromArxivAtom() { notImplemented(); }
function fromSemanticScholar() { notImplemented(); }
function fromOpenReview() { notImplemented(); }
function fromPubmedSummary() { notImplemented(); }
function fromOpenLibrary() { notImplemented(); }
function fromHtmlMeta() { notImplemented(); }
