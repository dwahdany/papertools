// URL / identifier -> Reference resolvers. Browser-first, CORS-friendly APIs,
// with one same-origin helper (the /api/meta Pages Function) for ordinary web pages.
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
//     Extra: arXiv identifiers carry `version` ("5" for "1706.03762v5", else undefined);
//     `id` is always the version-less id.
//
//   resolveReference(input, { fetch?, signal?, now?, sleep?, metaEndpoint?, wayback? }) -> Promise<{
//     reference: Reference,
//     source: string,          // 'crossref' | 'datacite' | 'doi.org' | 'arxiv' | 'semanticscholar' |
//                              // 'openreview' | 'pubmed' | 'openlibrary' | 'html-meta' | 'wayback' | 'url-only'
//     identifier: ReturnType<typeof detectIdentifier>,
//     warnings: string[],      // human-readable notes, including every failed attempt
//     sources: Source[],       // every source attempted, in order (see below)
//     bibtex?: string,         // OpenReview only: the note's content._bibtex when present
//   }>
//     Source = { name, status: 'ok' | 'skipped' | 'failed', detail?: string, message?: string }
//       name:   'crossref' | 'datacite' | 'doi.org' | 'arxiv' | 'semanticscholar' | 'openreview-api2' |
//               'openreview-api1' | 'pubmed' | 'pmc' | 'openlibrary' | 'api-meta' | 'direct' | 'wayback'
//       detail: short reason for 'failed' / 'skipped' ("not found", "rate limited", "blocked by CORS",
//               "no usable metadata", …); message: the full warning text for failures.
//     Options:
//       fetch        inject a fetch implementation (tests); default globalThis.fetch
//       signal       AbortSignal cancelling every request
//       now          Date used for `accessed`
//       sleep        (ms) => Promise, used for the Semantic Scholar back-off (default setTimeout)
//       metaEndpoint URL of the page-fetching function (GET ?url=…, see functions/api/meta.js).
//                    Default: new URL('/api/meta', location.origin) in browsers; undefined in Node
//                    (and when passed explicitly as null/undefined) -> the step is skipped.
//       wayback      try the Internet Archive for web pages (default true)
//
//     Strategy (first success wins; every attempt is recorded in `sources` and failures in `warnings`;
//     the chains below follow what the live APIs actually allow from a browser):
//       doi    -> api.crossref.org/works/{doi} -> api.datacite.org/dois/{doi}
//                 -> doi.org/{doi} with Accept: application/vnd.citationstyles.csl+json (fromCsl).
//                 arXiv DOIs (10.48550/arXiv.ID) skip Crossref (they are DataCite DOIs) and use the
//                 arXiv chain.
//       arxiv  -> api.datacite.org/dois/10.48550/arXiv.ID (fromDataciteArxiv; DataCite has every arXiv
//                 paper and sends CORS) -> semanticscholar ARXIV:ID -> export.arxiv.org Atom (last: the
//                 arXiv API sends no CORS header, so this only works outside browsers).
//                 The arXiv preprint is cited (type 'preprint', archive 'arXiv', archiveId without
//                 version, doi 10.48550/arXiv.ID, url arxiv.org/abs/ID). When Semantic Scholar was
//                 consulted and knows a non-arXiv DOI, or the Atom feed carries a DOI/journal_ref, a
//                 warning "A published version exists (DOI …)" is added. No extra request is made
//                 just for that warning.
//       pmid   -> eutils esummary (retmode=json) -> if it has a DOI, the DOI chain for richer data
//       pmcid  -> eutils esummary db=pmc -> pmid / doi re-resolve as above
//       openreview -> api2.openreview.net/notes?forum=ID then api.openreview.net/notes?forum=ID
//                 (content fields may be {value: …} in API2) -> type paper-conference with venue
//                 as containerTitle. OpenReview answers 403 {"name":"ChallengeRequiredError"} (anti-bot
//                 challenge) from many networks; on that, or any failure, semanticscholar URL: lookup
//                 with the full forum URL -> ResolveError whose partial is { type: 'paper-conference',
//                 url, accessed } and whose message says OpenReview blocked the request.
//       acl    -> api.crossref.org/works/10.18653/v1/{id} (2017+ IDs) -> semanticscholar ACL:{id}
//       s2     -> api.semanticscholar.org/graph/v1/paper/{sha|CorpusID:n}
//                 ?fields=title,authors,year,venue,journal,externalIds,publicationVenue,publicationTypes
//                 A (non-arXiv) DOI in the record is re-resolved through the DOI chain.
//       isbn   -> openlibrary.org/api/books?bibkeys=ISBN:…&format=json&jscmd=data
//       url    -> if the URL contains a DOI/arXiv id: resolve as above. Else, for a few hosts
//                 Semantic Scholar knows (acm, biorxiv, dblp, …), its URL: lookup. Then:
//                 (a) GET {metaEndpoint}?url=… -> { ok, url, head } and fromHtmlMeta(head, url);
//                 (b) fetch(url) directly (works on CORS-enabled sites such as proceedings.mlr.press);
//                 (c) archive.org/wayback/available?url=… -> web.archive.org/web/{ts}id_/{url}
//                     (raw snapshot) -> fromHtmlMeta with the ORIGINAL url, plus a warning naming the
//                     snapshot date; source 'wayback';
//                 (d) ResolveError whose .partial holds a 'url-only' Reference { type:'webpage', url,
//                     containerTitle: hostname (www. stripped), accessed: today }.
//                 An HTML result without any title counts as a failure and the chain continues. When an
//                 HTML result carries citation_doi / citation_arxiv_id, the richer chain is tried and
//                 the HTML result kept as fallback.
//
//   class ResolveError extends Error { partial?: {reference, source, identifier, warnings, sources} }
//
//   Mapping helpers (exported for tests):
//     fromCrossref(item) -> Reference        (item = message of works/{doi})
//     fromDatacite(attrs) -> Reference       (attrs = data.attributes)
//     fromDataciteArxiv(attrs, id?) -> Reference  (arXiv record: earliest 'Submitted' date, normalised DOI)
//     fromCsl(json) -> Reference             (CSL-JSON from doi.org content negotiation)
//     fromArxivAtom(xmlString, id) -> Reference
//     fromSemanticScholar(json) -> Reference
//     fromOpenReview(note) -> Reference
//     fromPubmedSummary(result) -> Reference  (result = result[ID])
//     fromOpenLibrary(book) -> Reference
//     fromHtmlMeta(doc, url, now) -> Reference  (doc = HTML source string or DOM Document)
//
//   Additional exports:
//     canonicalUrl(identifier) -> string     landing page for a detectIdentifier() result
//     todayIso(now?) -> 'YYYY-MM-DD'         local date of `now` (default: new Date())
//     fetchJson(url, { signal?, fetch?, accept?, service?, subject?, timeoutMs? }) -> Promise<any>
//     fetchText(url, { same options }) -> Promise<string>
//     parseXml(text) -> XmlNode             tiny dependency-free XML tree (Atom subset)
//     scanHtml(html) -> { meta, title, canonical, jsonLd }   HTML head scanner
//     decodeEntities(text) -> string        &amp; &lt; &gt; &quot; &#39; &#x27; numeric …
//     parseFullName(name) -> Name           "Aidan N. Gomez" / "Gomez, Aidan N." / literal
//     parseDate(text) -> { year?, month?, day? }
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
//     short-container-title ignored. Volume/issue strings. A 404 is text/plain "Resource not found.".
//   - DataCite arXiv records: doi comes back lower-case ("10.48550/arxiv.1706.03762") and is
//     normalised to "10.48550/arXiv.1706.03762"; creators carry givenName/familyName/nameType.
//   - CSL-JSON (doi.org): type article-journal/paper-conference/book/chapter/thesis/report/
//     software/dataset/webpage map 1:1; 'article' is a preprint when the publisher is arXiv.
//   - arXiv id normalisation: accept old-style "hep-th/9901001" and new "1706.03762v5".
//   - Always set `url` to a canonical landing URL when none better exists.
//   - Every network call: timeout ~15s via AbortController, an Accept header, and a friendly
//     error message (status code, host) on failure.
//
// CORS (probed live): Crossref, DataCite, doi.org (and the Crossref/DataCite hops it redirects to),
// Semantic Scholar (200 only), NCBI E-utilities, Open Library, archive.org and proceedings.mlr.press
// answer with Access-Control-Allow-Origin. export.arxiv.org, arxiv.org, aclanthology.org, github.com and
// most publisher pages do NOT – which is why the 'url' strategy goes through /api/meta and the Wayback
// Machine before giving up with a ResolveError. OpenReview's APIs may answer every request with an
// anti-bot challenge (HTTP 403 ChallengeRequiredError).
//
// Etiquette: Crossref is used through its plain (anonymous) pool – a browser must not leak
// an e-mail address, so no `mailto` parameter. Semantic Scholar's shared unauthenticated pool is
// rate-limited and its 429 response has no CORS header (browsers see a TypeError): on 429 or a
// network error we wait 2 s and retry once, then give up with a "rate-limited" warning. It is never
// tried before Crossref/DataCite when those apply. arXiv asks for one request at a time: all arXiv
// API requests go through a module-level queue.

import { compactReference, makeReference } from './model.js';

export {
  detectIdentifier, resolveReference, ResolveError,
  fromCrossref, fromDatacite, fromDataciteArxiv, fromCsl, fromArxivAtom, fromSemanticScholar, fromOpenReview,
  fromPubmedSummary, fromOpenLibrary, fromHtmlMeta,
  canonicalUrl, todayIso, fetchJson, fetchText, parseXml, scanHtml, decodeEntities,
  parseFullName, parseDate,
};

/** @typedef {import('./model.js').Reference} Reference */
/** @typedef {import('./model.js').Name} Name */
/** @typedef {{ kind: string, id: string, url: string, version?: string }} Identifier */
/** @typedef {{ name: string, status: 'ok'|'skipped'|'failed', detail?: string, message?: string }} Source */

/** Error thrown by resolveReference; `partial` carries a best-effort result. */
class ResolveError extends Error {
  /**
   * @param {string} message
   * @param {{reference: Reference, source: string, identifier: Identifier|null, warnings: string[], sources?: Source[]}} [partial]
   */
  constructor(message, partial) {
    super(message);
    this.name = 'ResolveError';
    this.partial = partial;
  }
}

// ---------------------------------------------------------------------------
// Small text utilities
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–',
  mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“',
  rdquo: '”', copy: '©', reg: '®', trade: '™', deg: '°',
  eacute: 'é', egrave: 'è', uuml: 'ü', ouml: 'ö', auml: 'ä',
  szlig: 'ß', ccedil: 'ç', ntilde: 'ñ', aacute: 'á', iacute: 'í',
  oacute: 'ó', uacute: 'ú', times: '×', middot: '·',
};

/**
 * Decode HTML / XML character references.
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  if (typeof text !== 'string' || text.indexOf('&') === -1) return text || '';
  return text.replace(/&(#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g, (m, _all, hex, dec, name) => {
    if (hex) return safeCodePoint(parseInt(hex, 16), m);
    if (dec) return safeCodePoint(parseInt(dec, 10), m);
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m;
  });
}

function safeCodePoint(cp, fallback) {
  return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : fallback;
}

/** @param {unknown} v @returns {string} */
function str(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return str(v[0]);
  if (typeof v === 'object') return '';
  return String(v);
}

/** Collapse whitespace (including newlines) to single spaces and trim. */
function collapse(text) {
  return str(text).replace(/\s+/g, ' ').trim();
}

/** Strip HTML / JATS tags, decode entities and collapse whitespace. */
function cleanTitle(text) {
  return collapse(decodeEntities(str(text).replace(/<[^>]*>/g, ' '))).replace(/\s+([,.;:!?)\]])/g, '$1');
}

/** First element of an array, or the value itself. */
function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse an integer or return undefined. */
function int(v) {
  const n = parseInt(str(v), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Local calendar date of `now` as YYYY-MM-DD. */
function todayIso(now) {
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Hostname of a URL without a leading "www.", or '' when unparsable. */
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse the date formats seen in the APIs we use: "2017-06-12", "2017/06/12",
 * "2017-06-12T10:00:00Z", "2017", "2019 Aug 27", "Nov 18, 2016", "18 November 2016".
 * @param {unknown} text
 * @returns {{year?: number, month?: number, day?: number}}
 */
function parseDate(text) {
  const s = collapse(text);
  if (!s) return {};
  let m = /^(\d{4})\s+([A-Za-z]{3,})\.?(?:\s+(\d{1,2}))?/.exec(s); // "2019 Aug 27"
  if (m) return dateParts(m[1], monthNumber(m[2]), m[3]);
  m = /^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?(?:[T\s]|$)/.exec(s); // ISO-like
  if (m) return dateParts(m[1], m[2], m[3]);
  m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s); // "Nov 18, 2016"
  if (m) return dateParts(m[3], monthNumber(m[1]), m[2]);
  m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/.exec(s); // "18 November 2016"
  if (m) return dateParts(m[3], monthNumber(m[2]), m[1]);
  m = /^([A-Za-z]{3,})\.?,?\s+(\d{4})/.exec(s); // "November 2016"
  if (m) return dateParts(m[2], monthNumber(m[1]));
  m = /(?:^|\D)(\d{4})(?:\D|$)/.exec(s); // anything with a 4-digit year
  if (m) return dateParts(m[1]);
  return {};
}

function monthNumber(word) {
  return MONTHS[word.slice(0, 4).toLowerCase()] || MONTHS[word.slice(0, 3).toLowerCase()];
}

function dateParts(y, m, d) {
  const out = {};
  const year = int(y);
  if (year) out.year = year;
  const month = int(m);
  if (month >= 1 && month <= 12) out.month = month;
  const day = int(d);
  if (out.month && day >= 1 && day <= 31) out.day = day;
  return out;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'du', 'la', 'le', 'ter', 'ten', 'af', 'zu', 'dos', 'das', 'do']);
const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv']);

/**
 * Turn a display name into a Name. Handles "Aidan N. Gomez", "Gomez, Aidan N.",
 * "Laurens van der Maaten", "Martin Luther King Jr." and single-token names
 * (returned as `literal`).
 * @param {unknown} name
 * @returns {Name|null}
 */
function parseFullName(name) {
  const s = collapse(decodeEntities(str(name)));
  if (!s) return null;
  if (s.includes(',')) {
    const [familyPart, ...rest] = s.split(',').map((p) => p.trim()).filter(Boolean);
    const given = rest.filter((p) => !SUFFIXES.has(p.toLowerCase())).join(' ');
    const suffix = rest.find((p) => SUFFIXES.has(p.toLowerCase()));
    if (!familyPart) return null;
    if (!given && !suffix) return { literal: familyPart };
    return compactName(splitParticles(familyPart.split(' ')), given, suffix);
  }
  const tokens = s.split(' ');
  if (tokens.length === 1) return { literal: s };
  let suffix;
  if (tokens.length > 2 && SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) suffix = tokens.pop();
  const family = [tokens.pop()];
  while (tokens.length > 1 && PARTICLES.has(tokens[tokens.length - 1].toLowerCase())) family.unshift(tokens.pop());
  return compactName(splitParticles(family), tokens.join(' '), suffix);
}

/** Split ["van", "der", "Maaten"] into particle + family. */
function splitParticles(familyTokens) {
  const particles = [];
  while (familyTokens.length > 1 && PARTICLES.has(familyTokens[0].toLowerCase())) particles.push(familyTokens.shift());
  return { particle: particles.join(' '), family: familyTokens.join(' ') };
}

function compactName({ particle, family }, given, suffix) {
  const out = { family };
  if (given) out.given = given;
  if (particle) out.particle = particle;
  if (suffix) out.suffix = suffix;
  return out;
}

/**
 * PubMed style "Vaswani A" / "Smith MW" / "de la Torre JM" -> Name.
 * Two-letter initials become "M W" so the formatter yields "M. W.".
 * @param {string} name
 * @param {string} [authtype]
 * @returns {Name|null}
 */
function parsePubmedName(name, authtype) {
  const s = collapse(name);
  if (!s) return null;
  if (/collective/i.test(authtype || '')) return { literal: s };
  const tokens = s.split(' ');
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && /^[A-Z]{1,3}$/.test(last)) {
    tokens.pop();
    let suffix;
    if (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) suffix = tokens.pop();
    return compactName({ particle: '', family: tokens.join(' ') }, last.split('').join(' '), suffix);
  }
  return parseFullName(s);
}

/** Crossref / DataCite style structured contributor -> Name. */
function structuredName(c) {
  if (!c || typeof c !== 'object') return null;
  const family = collapse(c.family || c.familyName);
  const given = collapse(c.given || c.givenName);
  if (family) {
    const out = { family };
    if (given) out.given = given;
    if (c.suffix) out.suffix = collapse(c.suffix);
    return out;
  }
  const literal = collapse(c.name || c.literal);
  if (!literal) return null;
  if (/organi[sz]ational/i.test(c.nameType || '')) return { literal };
  // DataCite often writes personal names as "Family, Given" in `name`.
  return parseFullName(literal);
}

/** @param {unknown} list @param {(x: any) => Name|null} fn @returns {Name[]} */
function mapNames(list, fn) {
  if (!Array.isArray(list)) return [];
  return list.map(fn).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Identifier detection
// ---------------------------------------------------------------------------

const DOI_RE = /10\.\d{4,9}\/[^\s"<>]+/;
const ARXIV_NEW_RE = /(\d{4}\.\d{4,5})(v\d+)?/;
const ARXIV_OLD_RE = /([a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/;
const ACL_RE = /^(?:[A-Z]\d{2}-\d{4}|\d{4}\.[a-z0-9]+-[a-z0-9]+\.\d+)$/i;
const S2_HOSTS = ['semanticscholar.org', 'api.semanticscholar.org', 'www.semanticscholar.org'];

/**
 * Recognise a DOI, arXiv id, PMID, PMCID, OpenReview id, ACL id, Semantic Scholar id,
 * ISBN or generic URL in free text.
 * @param {unknown} input
 * @returns {Identifier|null}
 */
function detectIdentifier(input) {
  // Tolerate identifiers pasted with surrounding brackets: "(https://doi.org/…)", "<10.1000/x>".
  const s = str(input).trim().replace(/^[(<[]+/, '').replace(/[)>\]]+$/, '').trim();
  if (!s) return null;
  // Bare identifiers win over scheme-less URL guesses ("10.1038/x" is a DOI, not a host).
  const url = /^https?:\/\//i.test(s) ? asUrl(s) : null;
  const found = url ? fromUrl(url) : fromBare(s);
  if (!found) return null;
  found.url = canonicalUrl(found);
  return found;
}

/** Parse http(s) URL, tolerating a missing scheme for "example.com/path" inputs. */
function asUrl(s) {
  if (/\s/.test(s)) return null;
  const candidate = /^https?:\/\//i.test(s) ? s : (/^[\w-]+(\.[\w-]+)+(\/|$|\?)/.test(s) ? `https://${s}` : null);
  if (!candidate) return null;
  try {
    const u = new URL(candidate);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u : null;
  } catch { return null; }
}

/** @param {URL} u @returns {Identifier|null} */
function fromUrl(u) {
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
  const ident = (kind, id, extra) => ({ kind, id, url: '', ...extra });

  if (host === 'doi.org' || host === 'dx.doi.org') {
    const doi = cleanDoi(path.slice(1));
    return doi ? ident('doi', doi) : null;
  }
  if (host === 'arxiv.org' || host === 'export.arxiv.org') {
    const m = /^\/(?:abs|pdf|html|format)\/(.+?)(?:\.pdf)?$/.exec(path);
    const ax = m && arxivId(m[1]);
    if (ax) return ident('arxiv', ax.id, { version: ax.version });
  }
  if (host === 'openreview.net') {
    const id = u.searchParams.get('id');
    if (id && /^\/(forum|pdf|attachment)?$/.test(path || '/')) return ident('openreview', id);
    if (id) return ident('openreview', id);
  }
  if (host === 'pubmed.ncbi.nlm.nih.gov') {
    const m = /^\/(\d+)/.exec(path);
    if (m) return ident('pmid', m[1]);
  }
  if (host === 'ncbi.nlm.nih.gov' || host === 'pmc.ncbi.nlm.nih.gov') {
    const m = /\/(PMC\d+)/i.exec(path);
    if (m) return ident('pmcid', m[1].toUpperCase());
    const p = /^\/pubmed\/(\d+)/.exec(path);
    if (p) return ident('pmid', p[1]);
  }
  if (host === 'aclanthology.org' || host === 'aclweb.org') {
    const m = /^\/(?:anthology\/)?([A-Za-z]\d{2}-\d{4}|\d{4}\.[a-z0-9]+-[a-z0-9]+\.\d+)(?:\.pdf)?$/i.exec(path);
    if (m) return ident('acl', m[1]);
  }
  if (S2_HOSTS.includes(host) || host.endsWith('.semanticscholar.org')) {
    const hex = /\/paper\/(?:[^/]+\/)?([0-9a-f]{40})/i.exec(path);
    if (hex) return ident('s2', hex[1].toLowerCase());
    const corpus = /CorpusID:(\d+)/i.exec(path);
    if (corpus) return ident('s2', `CorpusID:${corpus[1]}`);
  }
  const doi = doiInUrl(u, path);
  if (doi) return ident('doi', doi);
  return ident('url', u.href);
}

/** Find a DOI inside a publisher URL's path or query string. */
function doiInUrl(u, path) {
  const sources = [path];
  for (const [, v] of u.searchParams) sources.push(v);
  for (const src of sources) {
    const m = DOI_RE.exec(src);
    if (m) return cleanDoi(m[0]);
  }
  return '';
}

/**
 * Trim a DOI found in text/URLs: trailing punctuation, publisher path suffixes
 * (/full, /abstract, /pdf, /meta, /epdf), bioRxiv/medRxiv version suffixes.
 */
function cleanDoi(raw) {
  let doi = str(raw).trim();
  try { doi = decodeURIComponent(doi); } catch { /* keep as is */ }
  doi = doi.replace(/[).,;:]+$/, '');
  doi = doi.replace(/\/(full|abstract|pdf|meta|epdf|html|summary|references|figures)(\/.*)?$/i, '');
  if (/^10\.1101\//.test(doi)) doi = doi.replace(/v\d+(\.full(\.pdf)?|\.article-(info|metrics))?$/i, '').replace(/\.full(\.pdf)?$/i, '');
  doi = doi.replace(/[).,;:]+$/, '');
  return DOI_RE.test(doi) && doi.startsWith('10.') ? doi : '';
}

/** Normalise an arXiv id with optional version. */
function arxivId(raw) {
  const s = str(raw).trim().replace(/^arxiv:/i, '');
  let m = /^(\d{4}\.\d{4,5})(?:v(\d+))?$/.exec(s);
  if (m) return { id: m[1], version: m[2] };
  m = /^([a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7})(?:v(\d+))?$/.exec(s);
  if (m) return { id: m[1], version: m[2] };
  return null;
}

/** @param {string} s @returns {Identifier|null} */
function fromBare(s) {
  const ident = (kind, id, extra) => ({ kind, id, url: '', ...extra });
  let m;
  if ((m = /^doi:\s*(.+)$/i.exec(s))) { const d = cleanDoi(m[1]); return d ? ident('doi', d) : null; }
  if ((m = DOI_RE.exec(s)) && m.index === 0) { const d = cleanDoi(m[0]); return d ? ident('doi', d) : null; }
  if ((m = /^arxiv:\s*(.+)$/i.exec(s))) { const ax = arxivId(m[1]); return ax ? ident('arxiv', ax.id, { version: ax.version }) : null; }
  const ax = arxivId(s);
  if (ax) return ident('arxiv', ax.id, { version: ax.version });
  if ((m = /^PMID:?\s*(\d+)$/i.exec(s))) return ident('pmid', m[1]);
  if ((m = /^(PMC\d+)$/i.exec(s))) return ident('pmcid', m[1].toUpperCase());
  if ((m = /^CorpusID:\s*(\d+)$/i.exec(s))) return ident('s2', `CorpusID:${m[1]}`);
  if (/^[0-9a-f]{40}$/i.test(s)) return ident('s2', s.toLowerCase());
  if (ACL_RE.test(s)) return ident('acl', s);
  const isbn = isbnDigits(s);
  if (isbn) return ident('isbn', isbn);
  const u = asUrl(s);
  return u ? fromUrl(u) : null;
}

/** Normalise "ISBN 978-0-262-03561-3" / "0262035618" -> digits only (10 or 13), or ''. */
function isbnDigits(s) {
  const m = /^(?:ISBN(?:-1[03])?:?\s*)?([\d\s-]{9,17}[\dXx])$/.exec(s.trim());
  if (!m) return '';
  const digits = m[1].replace(/[\s-]/g, '').toUpperCase();
  if (!/^(\d{9}[\dX]|\d{13})$/.test(digits)) return '';
  return digits;
}

/**
 * Landing page URL for an identifier.
 * @param {Identifier|null} identifier
 * @returns {string}
 */
function canonicalUrl(identifier) {
  if (!identifier || !identifier.id) return '';
  const { kind, id } = identifier;
  switch (kind) {
    case 'doi': return `https://doi.org/${id}`;
    case 'arxiv': return `https://arxiv.org/abs/${id}`;
    case 'pmid': return `https://pubmed.ncbi.nlm.nih.gov/${id}/`;
    case 'pmcid': return `https://pmc.ncbi.nlm.nih.gov/articles/${id}/`;
    case 'openreview': return `https://openreview.net/forum?id=${encodeURIComponent(id)}`;
    case 'acl': return `https://aclanthology.org/${id}/`;
    case 's2': return id.startsWith('CorpusID:')
      ? `https://api.semanticscholar.org/${id}`
      : `https://www.semanticscholar.org/paper/${id}`;
    case 'isbn': return `https://openlibrary.org/isbn/${id}`;
    default: return id;
  }
}

// ---------------------------------------------------------------------------
// Tiny XML parser (Atom subset) and HTML head scanner
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} XmlNode
 * @property {string} name
 * @property {Record<string,string>} attrs
 * @property {XmlNode[]} children
 * @property {string} text   concatenated direct text (entities decoded)
 */

const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Parse `a="1" b='2' c=3` into an object with lower-cased keys. */
function parseAttrs(src) {
  const attrs = {};
  if (!src) return attrs;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(src))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/**
 * Parse well-formed XML into a tree. Supports declarations, comments, CDATA,
 * self-closing tags and namespaced names (kept verbatim, e.g. "arxiv:doi").
 * Unbalanced input never throws; unclosed elements are closed at the end.
 * @param {string} text
 * @returns {XmlNode} synthetic root whose children are the top-level elements
 */
function parseXml(text) {
  const src = str(text);
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { stack[stack.length - 1].text += decodeEntities(src.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { i = skipTo(src, '-->', lt + 4); continue; }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += src.slice(lt + 9, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) { i = skipTo(src, '?>', lt + 2); continue; }
    if (src.startsWith('<!', lt)) { i = skipTo(src, '>', lt + 2); continue; }
    const gt = findTagEnd(src, lt);
    const tag = src.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      const idx = stack.map((n) => n.name).lastIndexOf(name);
      if (idx > 0) stack.length = idx;
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const nameMatch = /^[^\s/>]+/.exec(body);
    if (!nameMatch) continue;
    const node = { name: nameMatch[0], attrs: parseAttrs(body.slice(nameMatch[0].length)), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function skipTo(src, marker, from) {
  const end = src.indexOf(marker, from);
  return end === -1 ? src.length : end + marker.length;
}

/** Index of the `>` closing the tag opened at `lt`, honouring quoted attribute values. */
function findTagEnd(src, lt) {
  let quote = '';
  for (let j = lt + 1; j < src.length; j++) {
    const ch = src[j];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return j;
  }
  return src.length;
}

/** First child element with the given name (case-sensitive). */
function child(node, name) {
  return node ? node.children.find((c) => c.name === name) : undefined;
}

/** All child elements with the given name. */
function children(node, name) {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Text content of a child element, whitespace-collapsed. */
function childText(node, name) {
  const c = child(node, name);
  return c ? collapse(c.text) : '';
}

/**
 * Scan an HTML document for head metadata without a DOM.
 * @param {string} html
 * @returns {{ meta: Record<string, string[]>, title: string, canonical: string, jsonLd: any[] }}
 *   `meta` keys are lower-cased name/property values; values keep document order.
 */
function scanHtml(html) {
  const src = str(html);
  const out = { meta: {}, title: '', canonical: '', jsonLd: [] };
  const tagRe = /<(!--|\/?[a-zA-Z][^\s/>]*)/g;
  let m;
  while ((m = tagRe.exec(src))) {
    if (m[1] === '!--') { tagRe.lastIndex = skipTo(src, '-->', m.index + 4); continue; }
    const name = m[1].toLowerCase();
    const gt = findTagEnd(src, m.index);
    const attrs = parseAttrs(src.slice(m.index + 1 + m[1].length, gt).replace(/\/$/, ''));
    tagRe.lastIndex = gt + 1;
    if (name === 'meta') {
      const key = (attrs.name || attrs.property || attrs.itemprop || '').toLowerCase().trim();
      const content = collapse(attrs.content);
      if (key && content) (out.meta[key] ||= []).push(content);
    } else if (name === 'link') {
      if (/(^|\s)canonical(\s|$)/i.test(attrs.rel || '') && attrs.href && !out.canonical) out.canonical = attrs.href.trim();
    } else if (name === 'title' || name === 'script') {
      const close = src.toLowerCase().indexOf(`</${name}`, gt + 1);
      const inner = src.slice(gt + 1, close === -1 ? src.length : close);
      tagRe.lastIndex = close === -1 ? src.length : close;
      if (name === 'title') { if (!out.title) out.title = collapse(decodeEntities(inner)); } else if (/ld\+json/i.test(attrs.type || '')) {
        try { out.jsonLd.push(JSON.parse(inner.replace(/^\s*<!--|-->\s*$/g, ''))); } catch { /* ignore malformed JSON-LD */ }
      }
    } else if (name === 'body' || name === '/head') {
      break; // metadata lives in <head>
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Fetch a URL with timeout and friendly errors.
 * @param {string} url
 * @param {{signal?: AbortSignal, fetch?: typeof fetch, accept?: string, service?: string,
 *   subject?: string, timeoutMs?: number, allowErrorStatus?: boolean}} [options]
 *   `allowErrorStatus` returns non-2xx responses instead of throwing.
 * @returns {Promise<Response>}
 */
async function fetchResponse(url, options = {}) {
  const doFetch = options.fetch || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new ResolveError('fetch is not available in this environment');
  const service = options.service || hostOf(url) || 'The server';
  const subject = options.subject ? ` for ${options.subject}` : '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort(options.signal.reason);
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const response = await doFetch(url, {
      signal: controller.signal,
      headers: { Accept: options.accept || 'application/json' },
    });
    if (!response.ok && !options.allowErrorStatus) {
      const err = new ResolveError(`${service} returned ${response.status}${subject}${statusHint(response.status)}`);
      err.status = response.status;
      // Keep the start of the body: some services explain themselves there
      // (OpenReview's anti-bot challenge, Semantic Scholar's rate limit).
      try { err.body = String(await response.text()).slice(0, 2000); } catch { err.body = ''; }
      throw err;
    }
    return response;
  } catch (err) {
    if (err instanceof ResolveError) throw err;
    if (options.signal && options.signal.aborted) throw new ResolveError(`Request to ${service} was cancelled`);
    if (controller.signal.aborted) {
      const t = new ResolveError(`${service} did not respond within ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} s${subject}`);
      t.timeout = true;
      throw t;
    }
    const reason = err && err.message ? err.message : String(err);
    const netErr = new ResolveError(`Could not reach ${service} (${hostOf(url) || url}): ${reason}`);
    netErr.networkError = true;
    throw netErr;
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onAbort);
  }
}

function statusHint(status) {
  if (status === 404) return ' (not found)';
  if (status === 429) return ' (rate limited, try again in a moment)';
  if (status >= 500) return ' (server error)';
  return '';
}

/**
 * GET JSON. Rejects with a ResolveError carrying `.status` on HTTP errors.
 * @param {string} url
 * @param {Parameters<typeof fetchResponse>[1]} [options]
 */
async function fetchJson(url, options = {}) {
  const response = await fetchResponse(url, { accept: 'application/json', ...options });
  try {
    return await response.json();
  } catch {
    throw new ResolveError(`${options.service || hostOf(url)} returned a response that is not valid JSON`);
  }
}

/**
 * GET text (XML / HTML).
 * @param {string} url
 * @param {Parameters<typeof fetchResponse>[1]} [options]
 */
async function fetchText(url, options = {}) {
  const response = await fetchResponse(url, { accept: 'text/html, application/xml, text/plain, */*', ...options });
  return response.text();
}

/** arXiv: never more than one request in flight. */
let arxivQueue = Promise.resolve();
function withArxivLock(fn) {
  const run = arxivQueue.then(fn, fn);
  arxivQueue = run.catch(() => {});
  return run;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

const CROSSREF_TYPES = {
  'journal-article': 'article-journal',
  'proceedings-article': 'paper-conference',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  'book-chapter': 'chapter',
  'book-section': 'chapter',
  'book-part': 'chapter',
  'posted-content': 'preprint',
  report: 'report',
  'report-component': 'report',
  dissertation: 'thesis',
  dataset: 'dataset',
  'peer-review': 'generic',
};

/**
 * Map a Crossref works message to a Reference.
 * @param {any} item  `message` of /works/{doi}
 * @returns {Reference}
 */
function fromCrossref(item) {
  const it = item && typeof item === 'object' ? item : {};
  const type = CROSSREF_TYPES[it.type] || 'generic';
  const ref = makeReference({ type });

  let title = cleanTitle(first(it.title));
  const subtitle = cleanTitle(first(it.subtitle));
  if (subtitle && title && !title.toLowerCase().includes(subtitle.toLowerCase())) title = `${title}: ${subtitle}`;
  ref.title = title || subtitle;

  const containers = (Array.isArray(it['container-title']) ? it['container-title'] : [it['container-title']])
    .map(cleanTitle).filter(Boolean);
  if (containers.length > 1) {
    // Crossref lists a book series before the book title (Springer: ["Lecture Notes in
    // Computer Science", "Computer Vision – ECCV 2016"], ["Methods in Molecular Biology",
    // "Docking Screens for Drug Discovery"]); a recognisable series name anywhere wins.
    const seriesIdx = containers.findIndex((c) => /lecture notes|series|advances in|studies in|methods in|handbook of|topics in|frontiers in|progress in/i.test(c));
    const series = seriesIdx === -1 ? containers[0] : containers[seriesIdx];
    ref.containerTitle = containers.find((c) => c !== series);
    ref.collectionTitle = series;
  } else if (containers.length === 1) {
    ref.containerTitle = containers[0];
  }
  const eventName = cleanTitle(it.event && it.event.name);
  if (type === 'paper-conference' && !ref.containerTitle && eventName) ref.containerTitle = eventName;

  ref.author = mapNames(it.author, structuredName);
  const editors = mapNames(it.editor, structuredName);
  if (editors.length) ref.editor = editors;

  Object.assign(ref, crossrefDate(it));
  ref.volume = collapse(it.volume);
  ref.issue = collapse(it.issue);
  ref.page = collapse(it.page);
  ref.articleNumber = collapse(it['article-number']);
  ref.publisher = cleanTitle(it.publisher);
  ref.doi = collapse(it.DOI);
  ref.url = collapse(it.URL) || (ref.doi ? `https://doi.org/${ref.doi}` : '');
  const isbn = first(it.ISBN);
  if (isbn) ref.isbn = collapse(isbn);
  const institution = cleanTitle(first(it.institution) && first(it.institution).name);

  if (type === 'preprint') {
    const archive = institution || cleanTitle(it['group-title']) || ref.publisher;
    if (/arxiv/i.test(archive) || /^10\.48550\/arxiv\./i.test(ref.doi)) {
      ref.archive = 'arXiv';
      const m = /^10\.48550\/arxiv\.(.+)$/i.exec(ref.doi);
      if (m) ref.archiveId = m[1];
    } else if (archive) {
      ref.archive = archive;
    }
    if (it.subtype && it.subtype !== 'preprint') ref.genre = collapse(it.subtype);
  } else if (type === 'thesis' || type === 'report') {
    ref.institution = institution || ref.publisher;
    if (type === 'thesis' && it.degree) ref.genre = cleanTitle(first(it.degree));
  }
  return compactReference(ref);
}

/** issued -> published-print -> published-online -> created. */
function crossrefDate(it) {
  for (const key of ['issued', 'published-print', 'published-online', 'published', 'created']) {
    const parts = it[key] && it[key]['date-parts'] && it[key]['date-parts'][0];
    if (Array.isArray(parts) && int(parts[0])) return dateParts(parts[0], parts[1], parts[2]);
  }
  return {};
}

const DATACITE_TYPES = {
  journalarticle: 'article-journal',
  conferencepaper: 'paper-conference',
  conferenceproceeding: 'paper-conference',
  book: 'book',
  bookchapter: 'chapter',
  preprint: 'preprint',
  dataset: 'dataset',
  software: 'software',
  report: 'report',
  dissertation: 'thesis',
};

/**
 * Map DataCite REST `data.attributes` to a Reference.
 * @param {any} attrs
 * @returns {Reference}
 */
function fromDatacite(attrs) {
  const a = attrs && typeof attrs === 'object' ? attrs : {};
  const general = collapse(a.types && a.types.resourceTypeGeneral).toLowerCase();
  const specific = collapse(a.types && a.types.resourceType).toLowerCase();
  const publisher = cleanTitle(typeof a.publisher === 'object' && a.publisher ? a.publisher.name : a.publisher);
  const doi = normaliseArxivDoi(collapse(a.doi));
  let type = DATACITE_TYPES[specific.replace(/\s+/g, '')] || DATACITE_TYPES[general] || 'generic';
  if (general === 'text' && (/arxiv/i.test(publisher) || /^10\.48550\//.test(doi))) type = 'preprint';

  const ref = makeReference({ type });
  const titles = Array.isArray(a.titles) ? a.titles : [];
  const main = titles.find((t) => !t.titleType) || titles[0];
  const sub = titles.find((t) => /subtitle/i.test(t.titleType || ''));
  ref.title = cleanTitle(main && main.title);
  if (sub && cleanTitle(sub.title) && !ref.title.toLowerCase().includes(cleanTitle(sub.title).toLowerCase())) {
    ref.title = `${ref.title}: ${cleanTitle(sub.title)}`;
  }
  ref.author = mapNames(a.creators, structuredName);
  const editors = mapNames((a.contributors || []).filter((c) => /editor/i.test(c.contributorType || '')), structuredName);
  if (editors.length) ref.editor = editors;
  ref.publisher = publisher;
  ref.doi = doi;
  ref.url = collapse(a.url) || (doi ? `https://doi.org/${doi}` : '');
  const issued = (Array.isArray(a.dates) ? a.dates : []).find((d) => /issued|published|available/i.test(d.dateType || ''));
  Object.assign(ref, issued ? parseDate(issued.date) : {});
  if (!ref.year && int(a.publicationYear)) ref.year = int(a.publicationYear);
  const c = a.container && typeof a.container === 'object' ? a.container : {};
  if (c.title) ref.containerTitle = cleanTitle(c.title);
  if (c.volume) ref.volume = collapse(c.volume);
  if (c.issue) ref.issue = collapse(c.issue);
  if (c.firstPage) ref.page = c.lastPage ? `${c.firstPage}-${c.lastPage}` : collapse(c.firstPage);
  if (a.version && type === 'software') ref.version = collapse(a.version);
  if (type === 'preprint') {
    if (/arxiv/i.test(publisher) || /^10\.48550\/arxiv\./i.test(doi)) {
      ref.archive = 'arXiv';
      const m = /^10\.48550\/arxiv\.(.+)$/i.exec(doi);
      if (m) ref.archiveId = m[1];
    } else {
      ref.archive = publisher;
    }
  }
  return compactReference(ref);
}

/** "10.48550/arxiv.1706.03762" (DataCite / doi.org casing) -> "10.48550/arXiv.1706.03762". */
function normaliseArxivDoi(doi) {
  const m = /^10\.48550\/arxiv\.(.+)$/i.exec(doi);
  return m ? `10.48550/arXiv.${m[1]}` : doi;
}

/**
 * Map a DataCite record of an arXiv paper (DOI 10.48550/arXiv.ID) to a preprint
 * Reference. Reuses fromDatacite and then applies the arXiv conventions: the
 * date is the earliest 'Submitted' date (v1) and falls back to publicationYear,
 * the DOI is normalised to "10.48550/arXiv.ID", the URL is the abstract page.
 * @param {any} attrs  `data.attributes`
 * @param {string} [id]  arXiv id when known (else derived from the DOI / identifiers)
 * @returns {Reference}
 */
function fromDataciteArxiv(attrs, id) {
  const a = attrs && typeof attrs === 'object' ? attrs : {};
  const ref = fromDatacite(a);
  const fromDoi = /^10\.48550\/arxiv\.(.+)$/i.exec(collapse(a.doi));
  const fromIds = (Array.isArray(a.identifiers) ? a.identifiers : []).find((x) => x && /arxiv/i.test(x.identifierType || ''));
  const parsed = arxivId(id) || (fromDoi && arxivId(fromDoi[1])) || (fromIds && arxivId(fromIds.identifier)) || { id: str(id) || (fromDoi ? fromDoi[1] : '') };
  const arxiv = parsed.id;
  ref.type = 'preprint';
  ref.archive = 'arXiv';
  if (arxiv) {
    ref.archiveId = arxiv;
    ref.doi = `10.48550/arXiv.${arxiv}`;
    ref.url = `https://arxiv.org/abs/${arxiv}`;
  }
  const submitted = (Array.isArray(a.dates) ? a.dates : [])
    .filter((d) => d && /^submitted$/i.test(d.dateType || ''))
    .map((d) => parseDate(d.date))
    .filter((d) => d.year)
    .sort((x, y) => (x.year - y.year) || ((x.month || 0) - (y.month || 0)) || ((x.day || 0) - (y.day || 0)));
  delete ref.year; delete ref.month; delete ref.day;
  if (submitted.length) Object.assign(ref, submitted[0]);
  else if (int(a.publicationYear)) ref.year = int(a.publicationYear);
  else Object.assign(ref, parseDate((a.dates || []).map((d) => d && d.date).find(Boolean)));
  delete ref.containerTitle; delete ref.volume; delete ref.issue; delete ref.page;
  return compactReference(ref);
}

const CSL_TYPES = {
  'article-journal': 'article-journal',
  'article-magazine': 'article-journal',
  'article-newspaper': 'article-journal',
  'paper-conference': 'paper-conference',
  book: 'book',
  chapter: 'chapter',
  thesis: 'thesis',
  report: 'report',
  software: 'software',
  dataset: 'dataset',
  webpage: 'webpage',
  'post-weblog': 'webpage',
  post: 'webpage',
  manuscript: 'manuscript',
  patent: 'patent',
  document: 'generic',
  article: 'generic',
};

/** CSL-JSON author -> Name ({family, given} | {literal} | family-only org names). */
function cslName(c) {
  if (!c || typeof c !== 'object') return null;
  const literal = collapse(c.literal || c.name);
  if (literal) return { literal };
  const family = collapse(c.family);
  const given = collapse(c.given);
  if (!family) return null;
  if (!given) return family.includes(' ') ? { literal: family } : { family };
  const out = { family, given };
  if (c['non-dropping-particle'] || c['dropping-particle']) out.particle = collapse([c['dropping-particle'], c['non-dropping-particle']].filter(Boolean).join(' '));
  if (c.suffix) out.suffix = collapse(c.suffix);
  return out;
}

/**
 * Map a CSL-JSON item (doi.org content negotiation, any registration agency)
 * to a Reference.
 * @param {any} json
 * @returns {Reference}
 */
function fromCsl(json) {
  const it = json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  const cslType = collapse(it.type).toLowerCase();
  const publisher = cleanTitle(it.publisher);
  const doi = normaliseArxivDoi(collapse(it.DOI));
  // doi.org may hand back Crossref's own type vocabulary ('journal-article') inside CSL-JSON.
  let type = CSL_TYPES[cslType] || CROSSREF_TYPES[cslType] || 'generic';
  const isArxiv = /^arxiv$/i.test(publisher) || /^10\.48550\/arxiv\./i.test(doi);
  if ((cslType === 'article' || cslType === 'document' || !cslType) && isArxiv) type = 'preprint';
  else if (cslType === 'article' && collapse(first(it['container-title']))) type = 'article-journal';

  const ref = makeReference({ type });
  let title = cleanTitle(first(it.title));
  const subtitle = cleanTitle(first(it.subtitle));
  if (subtitle && title && !title.toLowerCase().includes(subtitle.toLowerCase())) title = `${title}: ${subtitle}`;
  ref.title = title || subtitle;
  ref.author = mapNames(it.author, cslName);
  const editors = mapNames(it.editor, cslName);
  if (editors.length) ref.editor = editors;
  Object.assign(ref, crossrefDate(it));
  const container = cleanTitle(first(it['container-title']));
  if (container) ref.containerTitle = container;
  const collection = cleanTitle(first(it['collection-title']));
  if (collection) ref.collectionTitle = collection;
  const event = cleanTitle(it['event-title'] || it.event);
  if (type === 'paper-conference' && !ref.containerTitle && event) ref.containerTitle = event;
  ref.volume = collapse(it.volume);
  ref.issue = collapse(it.issue);
  ref.page = collapse(it.page);
  ref.articleNumber = collapse(it['article-number']);
  ref.publisher = publisher;
  if (it['publisher-place']) ref.publisherPlace = cleanTitle(it['publisher-place']);
  ref.doi = doi;
  const rawUrl = collapse(it.URL);
  // doi.org hands out "http://dx.doi.org/…" links; keep the canonical https://doi.org form.
  ref.url = /^https?:\/\/(dx\.)?doi\.org\//i.test(rawUrl) && doi ? `https://doi.org/${doi}` : (rawUrl || (doi ? `https://doi.org/${doi}` : ''));
  const isbn = first(it.ISBN);
  if (isbn) ref.isbn = collapse(isbn);
  if (it.number && (type === 'report' || type === 'patent')) ref.number = collapse(it.number);
  if (it.genre && (type === 'thesis' || type === 'report')) ref.genre = cleanTitle(it.genre);
  if (it.version && type === 'software') ref.version = collapse(it.version);
  if (type === 'preprint') {
    if (isArxiv) {
      ref.archive = 'arXiv';
      const m = /^10\.48550\/arXiv\.(.+)$/.exec(doi);
      if (m) { ref.archiveId = m[1]; ref.url = `https://arxiv.org/abs/${m[1]}`; }
      delete ref.publisher;
    } else {
      ref.archive = cleanTitle(it.archive) || publisher;
    }
  } else if (type === 'thesis' || type === 'report') {
    ref.institution = cleanTitle(it.publisher || it.institution);
  }
  return compactReference(ref);
}

/**
 * Map an arXiv Atom feed to a Reference.
 * @param {string} xmlString
 * @param {string} [id]  expected arXiv id (used in error messages / fallback)
 * @returns {Reference}
 * @throws {ResolveError} when the feed has no entry or an "Error" entry
 */
function fromArxivAtom(xmlString, id) {
  const root = parseXml(xmlString);
  const feed = child(root, 'feed') || root;
  const entries = children(feed, 'entry');
  const entry = entries.find((e) => !/^error$/i.test(childText(e, 'title'))) || null;
  if (!entry) {
    const errEntry = entries[0];
    const detail = errEntry ? childText(errEntry, 'summary') : '';
    throw new ResolveError(`arXiv has no paper with id ${id || '(unknown)'}${detail ? ` (${detail})` : ''}`);
  }
  const idText = childText(entry, 'id');
  const idMatch = /arxiv\.org\/abs\/(.+)$/i.exec(idText);
  const parsed = arxivId(idMatch ? idMatch[1] : idText) || arxivId(id) || { id: id || '' };
  const ref = makeReference({ type: 'preprint', archive: 'arXiv', archiveId: parsed.id });
  ref.title = collapse(childText(entry, 'title'));
  ref.author = mapNames(children(entry, 'author'), (a) => parseFullName(childText(a, 'name')));
  Object.assign(ref, parseDate(childText(entry, 'published')));
  const doi = childText(entry, 'arxiv:doi') || (children(entry, 'link').find((l) => l.attrs.title === 'doi') || { attrs: {} }).attrs.href;
  if (doi) ref.doi = cleanDoi(doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')) || collapse(doi);
  const journalRef = childText(entry, 'arxiv:journal_ref');
  if (journalRef) ref.note = `Published as: ${journalRef}`;
  const primary = child(entry, 'arxiv:primary_category');
  if (primary && primary.attrs.term) ref.archiveClass = primary.attrs.term;
  ref.url = `https://arxiv.org/abs/${parsed.id}`;
  return compactReference(ref);
}

const VENUE_EXPANSIONS = [
  [/^ICLR$/i, 'International Conference on Learning Representations'],
  [/^(NeurIPS|NIPS)$/i, 'Advances in Neural Information Processing Systems'],
  [/^ICML$/i, 'International Conference on Machine Learning'],
];

/** Expand a short venue acronym when known; otherwise return the input. */
function expandVenue(name) {
  const n = collapse(name);
  for (const [re, full] of VENUE_EXPANSIONS) if (re.test(n)) return full;
  return n;
}

/**
 * Map a Semantic Scholar Graph API paper to a Reference.
 * @param {any} json
 * @returns {Reference}
 */
function fromSemanticScholar(json) {
  const p = json && typeof json === 'object' ? json : {};
  const ext = p.externalIds && typeof p.externalIds === 'object' ? p.externalIds : {};
  const venue = collapse(p.venue);
  const pv = p.publicationVenue && typeof p.publicationVenue === 'object' ? p.publicationVenue : {};
  // S2 reports arXiv-only records as journal {name: "ArXiv", volume: "abs/…"}; that is not a journal.
  const rawJournal = p.journal && typeof p.journal === 'object' ? p.journal : {};
  const journal = /^arxiv(\.org)?$/i.test(collapse(rawJournal.name)) ? {} : rawJournal;
  const pubTypes = Array.isArray(p.publicationTypes) ? p.publicationTypes : [];
  const journalName = cleanTitle(journal.name);
  const isArxivOnly = ext.ArXiv && (!venue || /^arxiv(\.org)?$/i.test(venue));

  let type = 'generic';
  if (isArxivOnly) type = 'preprint';
  else if (pubTypes.includes('Conference') || /conference/i.test(pv.type || '')) type = 'paper-conference';
  else if (pubTypes.includes('JournalArticle') || /journal/i.test(pv.type || '') || journalName) type = 'article-journal';
  else if (pubTypes.includes('Book')) type = 'book';
  else if (pubTypes.includes('BookSection')) type = 'chapter';

  const ref = makeReference({ type });
  ref.title = cleanTitle(p.title);
  ref.author = mapNames(p.authors, (a) => parseFullName(a && a.name));
  if (int(p.year)) ref.year = int(p.year);
  if (type === 'preprint') {
    ref.archive = 'arXiv';
    ref.archiveId = collapse(ext.ArXiv);
  } else if (type === 'paper-conference') {
    ref.containerTitle = cleanTitle(pv.name) || venue || journalName;
    if (journal.volume) ref.volume = collapse(journal.volume);
    if (journal.pages) ref.page = collapse(journal.pages);
  } else if (type === 'article-journal') {
    ref.containerTitle = journalName || cleanTitle(pv.name) || venue;
    ref.volume = collapse(journal.volume);
    ref.page = collapse(journal.pages);
  } else {
    ref.containerTitle = cleanTitle(pv.name) || venue || journalName;
    if (journal.volume) ref.volume = collapse(journal.volume);
    if (journal.pages) ref.page = collapse(journal.pages);
  }
  if (ext.DOI) ref.doi = collapse(ext.DOI);
  if (ext.ArXiv && !ref.archiveId) { ref.archiveId = collapse(ext.ArXiv); if (!ref.archive) ref.archive = 'arXiv'; }
  if (ext.PubMed) ref.pmid = collapse(ext.PubMed);
  ref.url = p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}`
    : (ref.doi ? `https://doi.org/${ref.doi}` : (ext.ArXiv ? `https://arxiv.org/abs/${ext.ArXiv}` : ''));
  return compactReference(ref);
}

/** Unwrap OpenReview API2 `{value: …}` fields. */
function orValue(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? v.value : v;
}

/**
 * Map an OpenReview note (API1 or API2 shape) to a Reference.
 * @param {any} note
 * @returns {Reference & { bibtex?: string }}
 */
function fromOpenReview(note) {
  const n = note && typeof note === 'object' ? note : {};
  const content = n.content && typeof n.content === 'object' ? n.content : {};
  const get = (k) => orValue(content[k]);
  const venue = collapse(get('venue'));
  const venueId = collapse(get('venueid'));
  const notAccepted = /^(submitted|rejected|withdrawn|desk.?rejected)\b/i.test(venue) || /\/(submission|rejected|withdrawn|desk_rejected)/i.test(venueId);
  const ref = makeReference({ type: notAccepted ? 'preprint' : 'paper-conference' });
  ref.title = cleanTitle(get('title'));
  const authors = get('authors');
  ref.author = mapNames(Array.isArray(authors) ? authors : (authors ? String(authors).split(/\s*[,;]\s*|\s+and\s+/) : []), parseFullName);

  const venueCore = venue.replace(/^(submitted to|rejected by|withdrawn from|accepted at|accepted to|published at)\s+/i, '');
  const yearMatch = /\b(19|20)\d{2}\b/.exec(venueCore) || /\b(19|20)\d{2}\b/.exec(venueId);
  if (yearMatch) ref.year = int(yearMatch[0]);
  const venueName = collapse(venueCore.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s*[-–:(),]+\s*$/, '').replace(/\(\s*\)/g, ''));
  if (notAccepted) {
    ref.archive = 'OpenReview';
    if (venueName) ref.note = venue;
  } else if (venueName) {
    ref.containerTitle = expandVenue(venueName);
  } else if (venueId) {
    ref.containerTitle = expandVenue(venueId.split('/')[0].replace(/\.cc$/i, ''));
  }
  const epoch = int(n.pdate) || int(n.cdate) || int(n.tcdate);
  if (epoch) {
    const d = new Date(epoch);
    if (!ref.year) ref.year = d.getUTCFullYear();
    if (ref.year === d.getUTCFullYear()) { ref.month = d.getUTCMonth() + 1; ref.day = d.getUTCDate(); }
  }
  const id = collapse(n.forum) || collapse(n.id);
  if (id) { ref.url = `https://openreview.net/forum?id=${encodeURIComponent(id)}`; ref.archiveId = notAccepted ? id : undefined; }
  const bibtex = collapse(get('_bibtex')) ? String(get('_bibtex')).trim() : '';
  const out = compactReference(ref);
  if (bibtex) out.bibtex = bibtex;
  return out;
}

/**
 * Map a PubMed esummary record (`result[ID]`, retmode=json) to a Reference.
 * @param {any} result
 * @returns {Reference}
 */
function fromPubmedSummary(result) {
  const r = result && typeof result === 'object' ? result : {};
  const ref = makeReference({ type: 'article-journal' });
  ref.title = cleanTitle(r.title).replace(/\.$/, '');
  ref.author = mapNames(r.authors, (a) => parsePubmedName(a && a.name, a && a.authtype));
  ref.containerTitle = cleanTitle(r.fulljournalname) || cleanTitle(r.source);
  ref.volume = collapse(r.volume);
  ref.issue = collapse(r.issue);
  ref.page = collapse(r.pages);
  Object.assign(ref, parseDate(r.pubdate));
  if (!ref.year) Object.assign(ref, parseDate(r.epubdate));
  const ids = Array.isArray(r.articleids) ? r.articleids : [];
  const byType = (t) => collapse((ids.find((x) => x && x.idtype === t) || {}).value);
  ref.doi = cleanDoi(byType('doi'));
  if (!ref.doi) {
    const m = /doi:\s*(10\.\S+)/i.exec(str(r.elocationid));
    if (m) ref.doi = cleanDoi(m[1]);
  }
  if (!ref.page && /^pii:/i.test(str(r.elocationid))) ref.articleNumber = collapse(str(r.elocationid).replace(/^pii:\s*/i, ''));
  const pmid = byType('pubmed') || collapse(r.uid);
  if (pmid) ref.pmid = pmid;
  const pmc = byType('pmc') || byType('pmcid');
  if (pmc) ref.pmcid = pmc.toUpperCase().replace(/^PMC(\d+).*$/, 'PMC$1');
  ref.url = ref.doi ? `https://doi.org/${ref.doi}` : (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '');
  return compactReference(ref);
}

/**
 * Map an Open Library `jscmd=data` book record to a Reference.
 * @param {any} book  `data["ISBN:…"]`
 * @returns {Reference}
 */
function fromOpenLibrary(book) {
  const b = book && typeof book === 'object' ? book : {};
  const ref = makeReference({ type: 'book' });
  const title = cleanTitle(b.title);
  const subtitle = cleanTitle(b.subtitle);
  ref.title = subtitle && !title.toLowerCase().includes(subtitle.toLowerCase()) ? `${title}: ${subtitle}` : title;
  ref.author = mapNames(b.authors, (a) => parseFullName(a && a.name));
  ref.publisher = cleanTitle(first(b.publishers) && first(b.publishers).name);
  const place = first(b.publish_places);
  if (place && place.name) ref.publisherPlace = cleanTitle(place.name);
  Object.assign(ref, parseDate(b.publish_date));
  const ids = b.identifiers && typeof b.identifiers === 'object' ? b.identifiers : {};
  const isbn = first(ids.isbn_13) || first(ids.isbn_10);
  if (isbn) ref.isbn = collapse(isbn);
  if (b.edition_name) ref.edition = cleanTitle(b.edition_name);
  ref.url = collapse(b.url) || (isbn ? `https://openlibrary.org/isbn/${isbn}` : '');
  return compactReference(ref);
}

const SCHOLARLY_LD_TYPES = new Set(['article', 'newsarticle', 'blogposting', 'scholarlyarticle', 'webpage', 'techarticle', 'report', 'book', 'creativework']);

/**
 * Build a Reference from the metadata of an HTML page.
 * @param {string|Document} doc  HTML source, or a DOM Document (serialised via outerHTML)
 * @param {string} url            the page URL (fallback for `url`, hostname for the site name)
 * @param {Date} [now]            accessed date
 * @returns {Reference}
 */
function fromHtmlMeta(doc, url, now) {
  const html = typeof doc === 'string' ? doc
    : (doc && doc.documentElement && typeof doc.documentElement.outerHTML === 'string' ? doc.documentElement.outerHTML : '');
  const scan = scanHtml(html);
  const meta = scan.meta;
  const get = (...keys) => { for (const k of keys) { const v = meta[k.toLowerCase()]; if (v && v[0]) return v[0]; } return ''; };
  const all = (k) => meta[k.toLowerCase()] || [];
  const pageUrl = collapse(url);
  const host = hostOf(pageUrl);

  let ref;
  if (get('citation_title')) ref = fromCitationMeta(get, all);
  else ref = fromJsonLd(scan.jsonLd) || makeReference({ type: 'webpage' });

  if (!ref.title) ref.title = cleanTitle(get('og:title', 'dc.title', 'dcterms.title', 'twitter:title')) || scan.title;
  if (!ref.author.length) {
    const names = [...all('article:author'), ...all('author'), ...all('dc.creator'), ...all('dcterms.creator'), ...all('parsely-author'), ...all('sailthru.author')]
      .filter((v) => !/^https?:\/\//i.test(v));
    ref.author = mapNames(names, parseFullName);
  }
  if (!ref.year) Object.assign(ref, parseDate(get('article:published_time', 'dc.date', 'dcterms.date', 'dcterms.issued', 'date', 'datepublished', 'pubdate', 'parsely-pub-date', 'article:modified_time')));
  if (ref.type === 'webpage' && !ref.containerTitle) ref.containerTitle = cleanTitle(get('og:site_name', 'dc.publisher', 'application-name')) || host;
  ref.url = scan.canonical || get('og:url') || get('citation_public_url', 'citation_abstract_html_url') || pageUrl;
  // PMLR pages carry the volume only in their path (/v139/...).
  if (!ref.volume && ref.type === 'paper-conference' && /(^|\.)proceedings\.mlr\.press$/i.test(host)) {
    const m = /\/v(\d+)\//.exec(pageUrl);
    if (m) ref.volume = m[1];
  }
  ref.accessed = todayIso(now);
  return compactReference(ref);
}

/** Highwire Press `citation_*` tags -> scholarly Reference. */
function fromCitationMeta(get, all) {
  const ref = makeReference();
  ref.title = cleanTitle(get('citation_title'));
  ref.author = mapNames(all('citation_author'), parseFullName);
  Object.assign(ref, parseDate(get('citation_publication_date', 'citation_date', 'citation_online_date', 'citation_year')));
  const journal = cleanTitle(get('citation_journal_title'));
  const conference = cleanTitle(get('citation_conference_title', 'citation_conference'));
  const book = cleanTitle(get('citation_inbook_title', 'citation_book_title'));
  const reportInst = cleanTitle(get('citation_technical_report_institution'));
  const thesisInst = cleanTitle(get('citation_dissertation_institution'));
  const arxiv = collapse(get('citation_arxiv_id')).replace(/^arxiv:/i, '');
  if (journal) { ref.type = 'article-journal'; ref.containerTitle = journal; } else if (conference) { ref.type = 'paper-conference'; ref.containerTitle = conference; } else if (book) { ref.type = 'chapter'; ref.containerTitle = book; } else if (thesisInst) { ref.type = 'thesis'; ref.institution = thesisInst; } else if (reportInst) { ref.type = 'report'; ref.institution = reportInst; ref.number = collapse(get('citation_technical_report_number')); } else if (arxiv) { ref.type = 'preprint'; ref.archive = 'arXiv'; } else if (get('citation_isbn')) ref.type = 'book';
  ref.volume = collapse(get('citation_volume'));
  ref.issue = collapse(get('citation_issue'));
  const firstPage = collapse(get('citation_firstpage'));
  const lastPage = collapse(get('citation_lastpage'));
  ref.page = firstPage && lastPage && firstPage !== lastPage ? `${firstPage}-${lastPage}` : firstPage;
  ref.doi = cleanDoi(get('citation_doi').replace(/^(doi:|https?:\/\/(dx\.)?doi\.org\/)/i, ''));
  if (arxiv) { ref.archiveId = arxiv; if (!ref.archive) ref.archive = 'arXiv'; }
  ref.publisher = cleanTitle(get('citation_publisher'));
  if (get('citation_isbn')) ref.isbn = collapse(get('citation_isbn'));
  if (get('citation_pdf_url')) ref.pdfUrl = get('citation_pdf_url');
  const editors = mapNames(all('citation_editor'), parseFullName);
  if (editors.length) ref.editor = editors;
  if (!ref.doi) delete ref.doi;
  return ref;
}

/** JSON-LD (schema.org) -> Reference, or null when no recognised node exists. */
function fromJsonLd(blocks) {
  const node = findLdNode(blocks);
  if (!node) return null;
  const ldType = collapse(first(node['@type'])).toLowerCase();
  const isPartOf = node.isPartOf && typeof node.isPartOf === 'object' ? cleanTitle(node.isPartOf.name) : '';
  const publisher = cleanTitle(node.publisher && typeof node.publisher === 'object' ? node.publisher.name : node.publisher);
  const ref = makeReference({ type: ldType === 'scholarlyarticle' && isPartOf ? 'article-journal' : (ldType === 'scholarlyarticle' ? 'generic' : (ldType === 'book' ? 'book' : 'webpage')) });
  ref.title = cleanTitle(node.headline || node.name);
  ref.author = mapNames(Array.isArray(node.author) ? node.author : (node.author ? [node.author] : []), ldName);
  Object.assign(ref, parseDate(node.datePublished || node.dateCreated));
  ref.containerTitle = isPartOf || (ref.type === 'webpage' ? publisher : '');
  if (ref.type !== 'webpage' || !isPartOf) ref.publisher = publisher;
  if (ref.type === 'webpage') delete ref.publisher;
  const u = typeof node.url === 'string' ? node.url : (node.mainEntityOfPage && typeof node.mainEntityOfPage === 'object' ? node.mainEntityOfPage['@id'] : node.mainEntityOfPage);
  if (typeof u === 'string') ref.url = collapse(u);
  if (typeof node.sameAs === 'string' && /doi\.org\//.test(node.sameAs)) ref.doi = cleanDoi(node.sameAs.replace(/^https?:\/\/(dx\.)?doi\.org\//, ''));
  return ref;
}

function findLdNode(blocks) {
  const queue = Array.isArray(blocks) ? [...blocks] : [];
  while (queue.length) {
    const n = queue.shift();
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) { queue.push(...n); continue; }
    if (Array.isArray(n['@graph'])) queue.push(...n['@graph']);
    const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
    if (types.some((t) => SCHOLARLY_LD_TYPES.has(collapse(t).toLowerCase()))) return n;
  }
  return null;
}

function ldName(a) {
  if (typeof a === 'string') return parseFullName(a);
  if (!a || typeof a !== 'object') return null;
  const name = cleanTitle(a.name);
  if (!name) return null;
  if (/organization/i.test(collapse(first(a['@type'])))) return { literal: name };
  if (a.familyName) { const out = { family: cleanTitle(a.familyName) }; if (a.givenName) out.given = cleanTitle(a.givenName); return out; }
  return parseFullName(name);
}

// ---------------------------------------------------------------------------
// Resolution strategies
// ---------------------------------------------------------------------------

const S2_FIELDS = 'title,authors,year,venue,journal,externalIds,publicationVenue,publicationTypes';
const S2_URL_HOSTS = ['arxiv.org', 'aclweb.org', 'aclanthology.org', 'acm.org', 'biorxiv.org', 'medrxiv.org', 'dblp.org', 'pubmed.ncbi.nlm.nih.gov', 'semanticscholar.org', 'openreview.net'];
const S2_BACKOFF_MS = 2000;

/**
 * @typedef {Object} Ctx
 * @property {typeof fetch} fetch
 * @property {AbortSignal} [signal]
 * @property {Date} now
 * @property {(ms: number) => Promise<void>} sleep
 * @property {string[]} warnings
 * @property {Source[]} sources
 * @property {string} [metaEndpoint]
 * @property {boolean} wayback
 */

/** Default page-fetching function URL: same-origin /api/meta in browsers, none elsewhere. */
function defaultMetaEndpoint() {
  try {
    const origin = typeof location !== 'undefined' && location ? location.origin : '';
    if (/^https?:\/\//i.test(origin)) return new URL('/api/meta', origin).href;
  } catch { /* no usable location */ }
  return undefined;
}

/**
 * Resolve any supported identifier or URL to a Reference.
 * @param {string} input
 * @param {{fetch?: typeof fetch, signal?: AbortSignal, now?: Date, sleep?: (ms: number) => Promise<void>,
 *   metaEndpoint?: string|null, wayback?: boolean}} [options]
 */
async function resolveReference(input, options = {}) {
  const identifier = detectIdentifier(input);
  if (!identifier) {
    throw new ResolveError('Could not recognise a DOI, arXiv id, PubMed id, OpenReview id, ISBN or URL in the input.');
  }
  /** @type {Ctx} */
  const ctx = {
    fetch: options.fetch || globalThis.fetch,
    signal: options.signal,
    now: options.now instanceof Date ? options.now : new Date(),
    sleep: options.sleep || defaultSleep,
    warnings: [],
    sources: [],
    metaEndpoint: 'metaEndpoint' in options ? (options.metaEndpoint ? String(options.metaEndpoint) : undefined) : defaultMetaEndpoint(),
    wayback: options.wayback !== false,
  };
  const strategies = {
    doi: resolveDoi, arxiv: resolveArxiv, pmid: resolvePmid, pmcid: resolvePmcid, openreview: resolveOpenReview,
    acl: resolveAcl, s2: (id, c) => resolveS2(id.id, c), isbn: resolveIsbn, url: resolveUrl,
  };
  try {
    const result = await strategies[identifier.kind](identifier, ctx);
    return { ...result, identifier, warnings: ctx.warnings, sources: ctx.sources };
  } catch (err) {
    if (err instanceof ResolveError && err.partial) {
      err.partial.identifier = err.partial.identifier || identifier;
      err.partial.warnings = err.partial.warnings || ctx.warnings;
      err.partial.sources = err.partial.sources || ctx.sources;
      throw err;
    }
    const message = err instanceof ResolveError ? err.message : `Unexpected error: ${err && err.message ? err.message : err}`;
    if (!ctx.warnings.includes(message)) ctx.warnings.push(message);
    throw new ResolveError(message, { reference: urlOnlyReference(identifier, ctx), source: 'url-only', identifier, warnings: ctx.warnings, sources: ctx.sources });
  }
}

/** Minimal reference carrying whatever the identifier itself tells us. */
function urlOnlyReference(identifier, ctx) {
  const ref = makeReference({ type: identifier.kind === 'url' ? 'webpage' : 'generic', title: '', url: identifier.url, accessed: todayIso(ctx.now) });
  if (identifier.kind === 'doi') ref.doi = identifier.id;
  if (identifier.kind === 'arxiv') { ref.type = 'preprint'; ref.archive = 'arXiv'; ref.archiveId = identifier.id; }
  if (identifier.kind === 'url') ref.containerTitle = hostOf(identifier.url);
  if (identifier.kind === 'openreview') ref.type = 'paper-conference';
  const out = compactReference(ref);
  out.title = '';
  return out;
}

/** Build a ResolveError with a short machine-friendly `reason` for the sources list. */
function fail(message, reason) {
  const err = new ResolveError(message);
  if (reason) err.reason = reason;
  return err;
}

/** Short reason for the sources list. */
function shortReason(err) {
  if (!err) return 'failed';
  if (err.reason) return err.reason;
  if (err.rateLimited || err.status === 429) return 'rate limited';
  if (err.status === 404) return 'not found';
  if (err.status === 403) return 'forbidden';
  if (err.status) return `HTTP ${err.status}`;
  if (err.timeout) return 'timed out';
  if (err.networkError) return 'unreachable (blocked by CORS or offline)';
  const m = err.message ? String(err.message) : String(err);
  return m.length > 60 ? `${m.slice(0, 57)}…` : m;
}

/**
 * Run one source attempt: on success record it as 'ok' and return the value;
 * on failure record it as 'failed' (with the message in warnings) and return null.
 * Aborts always propagate.
 * @template T
 * @param {Ctx} ctx @param {string} name @param {() => Promise<T>} fn
 * @returns {Promise<T|null>}
 */
async function step(ctx, name, fn) {
  try {
    const out = await fn();
    ctx.sources.push({ name, status: 'ok' });
    return out;
  } catch (err) {
    if (ctx.signal && ctx.signal.aborted) throw err;
    const message = err && err.message ? err.message : String(err);
    if (!ctx.warnings.includes(message)) ctx.warnings.push(message);
    ctx.sources.push({ name, status: 'failed', detail: shortReason(err), message });
    return null;
  }
}

/** Record a source that was deliberately not tried. */
function skip(ctx, name, detail) {
  ctx.sources.push({ name, status: 'skipped', detail });
}

/**
 * Run a nested chain (which records its own steps); swallow its final error
 * so the caller can fall back. Aborts always propagate.
 */
async function quietly(ctx, fn) {
  try {
    return await fn();
  } catch (err) {
    if (ctx.signal && ctx.signal.aborted) throw err;
    return null;
  }
}

/** Summarise the failed attempts since `from` for an error message. */
function summary(ctx, from) {
  return ctx.sources.slice(from).filter((s) => s.status === 'failed')
    .map((s) => `${SOURCE_NAMES[s.name] || s.name}: ${s.detail}`).join('; ');
}

const SOURCE_NAMES = {
  crossref: 'Crossref', datacite: 'DataCite', 'doi.org': 'doi.org', arxiv: 'arXiv API', semanticscholar: 'Semantic Scholar',
  'openreview-api2': 'OpenReview API2', 'openreview-api1': 'OpenReview API1', pubmed: 'PubMed', pmc: 'PubMed Central',
  openlibrary: 'Open Library', 'api-meta': 'page fetch (/api/meta)', direct: 'direct fetch', wayback: 'Internet Archive',
};

/** Prefer the caller's DOI casing when the record spells the same DOI differently. */
function keepDoiCase(reference, doi) {
  if (reference.doi && doi && reference.doi !== doi && reference.doi.toLowerCase() === doi.toLowerCase() && !/^10\.48550\//i.test(doi)) {
    reference.doi = doi;
    if (reference.url === `https://doi.org/${reference.doi.toLowerCase()}` || reference.url === `https://doi.org/${reference.doi.toUpperCase()}`) reference.url = `https://doi.org/${doi}`;
  }
  return reference;
}

/** @param {Identifier} id @param {Ctx} ctx */
async function resolveDoi(id, ctx) {
  const doi = id.id;
  const arxiv = /^10\.48550\/arxiv\.(.+)$/i.exec(doi);
  if (arxiv && arxivId(arxiv[1])) {
    skip(ctx, 'crossref', 'arXiv DOIs are registered with DataCite');
    const ax = arxivId(arxiv[1]);
    return resolveArxiv({ kind: 'arxiv', id: ax.id, url: `https://arxiv.org/abs/${ax.id}`, version: ax.version }, ctx);
  }
  const from = ctx.sources.length;
  const crossref = await step(ctx, 'crossref', async () => {
    const json = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { ...ctx, service: 'Crossref', subject: doi });
    if (!json || !json.message) throw fail(`Crossref returned no record for ${doi}`, 'no record');
    return { reference: keepDoiCase(fromCrossref(json.message), doi), source: 'crossref' };
  });
  if (crossref) return crossref;
  const datacite = await step(ctx, 'datacite', async () => {
    const json = await fetchJson(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, { ...ctx, service: 'DataCite', subject: doi });
    if (!json || !json.data || !json.data.attributes) throw fail(`DataCite returned no record for ${doi}`, 'no record');
    return { reference: keepDoiCase(fromDatacite(json.data.attributes), doi), source: 'datacite' };
  });
  if (datacite) return datacite;
  const csl = await step(ctx, 'doi.org', async () => {
    const json = await fetchJson(`https://doi.org/${encodeDoiPath(doi)}`, { ...ctx, service: 'doi.org', subject: doi, accept: 'application/vnd.citationstyles.csl+json' });
    if (!json || typeof json !== 'object' || !(json.title || json.DOI)) throw fail(`doi.org returned no citation data for ${doi}`, 'no record');
    return { reference: keepDoiCase(fromCsl(json), doi), source: 'doi.org' };
  });
  if (csl) return csl;
  throw new ResolveError(`No metadata source knows the DOI ${doi} (${summary(ctx, from)})`);
}

/** Encode a DOI for use in a doi.org path: keep "/" but escape everything else that matters. */
function encodeDoiPath(doi) {
  return doi.split('/').map((part) => encodeURIComponent(part)).join('/');
}

/** Reduce any record of an arXiv paper to the preprint we cite. */
function asArxivPreprint(reference, id) {
  const ref = { ...reference, type: 'preprint', archive: 'arXiv', archiveId: id, url: `https://arxiv.org/abs/${id}` };
  for (const k of ['containerTitle', 'collectionTitle', 'volume', 'issue', 'page', 'articleNumber', 'publisher', 'pmid']) delete ref[k];
  if (!ref.doi || /^10\.48550\//i.test(ref.doi)) ref.doi = `10.48550/arXiv.${id}`;
  return compactReference(ref);
}

/** @param {Identifier} id @param {Ctx} ctx */
async function resolveArxiv(id, ctx) {
  const from = ctx.sources.length;
  const datacite = await step(ctx, 'datacite', async () => {
    const doi = `10.48550/arXiv.${id.id}`;
    const json = await fetchJson(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, { ...ctx, service: 'DataCite', subject: `arXiv:${id.id}` });
    if (!json || !json.data || !json.data.attributes) throw fail(`DataCite returned no record for ${doi}`, 'no record');
    const reference = fromDataciteArxiv(json.data.attributes, id.id);
    if (!reference.title) throw fail(`DataCite's record for arXiv:${id.id} has no title`, 'no usable metadata');
    return { reference, source: 'datacite' };
  });
  if (datacite) return datacite;

  const s2 = await step(ctx, 'semanticscholar', async () => {
    const json = await s2Paper(`ARXIV:${id.id}`, ctx);
    const mapped = fromSemanticScholar(json);
    const published = json.externalIds && collapse(json.externalIds.DOI);
    const reference = asArxivPreprint(mapped, id.id);
    if (published && !/^10\.48550\//i.test(published)) {
      reference.doi = `10.48550/arXiv.${id.id}`;
      ctx.warnings.push(`A published version exists (DOI ${published}); this entry cites the arXiv preprint.`);
    } else if (mapped.containerTitle && mapped.type !== 'preprint') {
      ctx.warnings.push(`Semantic Scholar lists this paper in "${mapped.containerTitle}"; this entry cites the arXiv preprint.`);
    }
    return { reference, source: 'semanticscholar' };
  });
  if (s2) return s2;

  const atom = await step(ctx, 'arxiv', () => withArxivLock(async () => {
    const xml = await fetchText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id.id)}&max_results=1`, { ...ctx, service: 'arXiv', subject: id.id, accept: 'application/atom+xml, application/xml, text/xml' });
    const reference = fromArxivAtom(xml, id.id);
    if (reference.doi || reference.note) {
      ctx.warnings.push(`A published version exists${reference.doi ? ` (DOI ${reference.doi})` : ''}${reference.note ? ` – ${reference.note.replace(/^Published as: /, '')}` : ''}; this entry cites the arXiv preprint.`);
    }
    return { reference, source: 'arxiv' };
  }));
  if (atom) return atom;
  throw new ResolveError(`Could not find arXiv:${id.id} (${summary(ctx, from)})`);
}

/**
 * GET one Semantic Scholar paper. The shared pool answers 429 often and that
 * response has no CORS header (browsers see a TypeError): both cases wait
 * 2 s and retry once, then give up with a rate-limit error.
 * @param {string} paperId  "ARXIV:…", "ACL:…", "URL:…", sha, "CorpusID:n"
 * @param {Ctx} ctx
 */
async function s2Paper(paperId, ctx) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/${paperId.startsWith('URL:') ? `URL:${encodeURIComponent(paperId.slice(4))}` : encodeURIComponent(paperId).replace(/%3A/g, ':')}?fields=${S2_FIELDS}`;
  const opts = { ...ctx, service: 'Semantic Scholar', subject: paperId, accept: 'application/json' };
  const transient = (err) => err && (err.status === 429 || err.networkError);
  let json;
  try {
    json = await fetchJson(url, opts);
  } catch (err) {
    if (!transient(err)) throw err;
    await ctx.sleep(S2_BACKOFF_MS);
    try {
      json = await fetchJson(url, opts);
    } catch (err2) {
      if (!transient(err2)) throw err2;
      const limited = new ResolveError(`Semantic Scholar is rate-limited right now (${err2.status ? `HTTP ${err2.status}` : 'request blocked'} for ${paperId}); try again in a moment`);
      limited.rateLimited = true;
      limited.status = err2.status || 429;
      throw limited;
    }
  }
  if (!json || !json.paperId) throw fail(`Semantic Scholar has no record for ${paperId}`, 'no record');
  return json;
}

/**
 * Semantic Scholar lookup by any supported paper id. If the result has a
 * (non-arXiv) DOI, the DOI chain is preferred for richer data.
 * @param {string} paperId
 * @param {Ctx} ctx
 * @param {{reresolveDoi?: boolean}} [opts]
 */
async function resolveS2(paperId, ctx, opts = {}) {
  const s2 = await step(ctx, 'semanticscholar', async () => ({ reference: fromSemanticScholar(await s2Paper(paperId, ctx)), source: 'semanticscholar' }));
  if (!s2) throw new ResolveError(ctx.sources[ctx.sources.length - 1].message);
  const { reference } = s2;
  if (opts.reresolveDoi !== false && reference.doi && !/^10\.48550\//i.test(reference.doi)) {
    const better = await quietly(ctx, () => resolveDoi({ kind: 'doi', id: reference.doi, url: `https://doi.org/${reference.doi}` }, ctx));
    if (better) return better;
  }
  return s2;
}

/** @param {Identifier} id @param {Ctx} ctx */
async function resolveAcl(id, ctx) {
  const from = ctx.sources.length;
  const doi = `10.18653/v1/${id.id}`;
  const crossref = await step(ctx, 'crossref', async () => {
    const json = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { ...ctx, service: 'Crossref', subject: doi });
    if (!json || !json.message) throw fail(`Crossref returned no record for ${doi}`, 'no record');
    const reference = fromCrossref(json.message);
    if (!reference.title) throw fail(`Crossref's record for ${doi} has no title`, 'no usable metadata');
    return { reference, source: 'crossref' };
  });
  if (crossref) return crossref;
  const s2 = await quietly(ctx, () => resolveS2(`ACL:${id.id}`, ctx, { reresolveDoi: false }));
  if (s2) return s2;
  throw new ResolveError(`Could not find ACL Anthology paper ${id.id} (${summary(ctx, from)})`);
}

/** @param {Identifier} id @param {Ctx} ctx */
async function resolvePmid(id, ctx) {
  const pubmed = await step(ctx, 'pubmed', async () => {
    const json = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(id.id)}&retmode=json`, { ...ctx, service: 'PubMed', subject: `PMID ${id.id}` });
    const record = json && json.result && json.result[id.id];
    if (!record || record.error) throw fail(`PubMed has no record for PMID ${id.id}${record && record.error ? ` (${record.error})` : ''}`, 'no record');
    return { reference: fromPubmedSummary(record), source: 'pubmed' };
  });
  if (!pubmed) throw new ResolveError(ctx.sources[ctx.sources.length - 1].message);
  if (pubmed.reference.doi) {
    const better = await quietly(ctx, () => resolveDoi({ kind: 'doi', id: pubmed.reference.doi, url: `https://doi.org/${pubmed.reference.doi}` }, ctx));
    if (better) return better;
  }
  return pubmed;
}

/** @param {Identifier} id @param {Ctx} ctx */
async function resolvePmcid(id, ctx) {
  const digits = id.id.replace(/^PMC/i, '');
  const pmc = await step(ctx, 'pmc', async () => {
    const json = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${encodeURIComponent(digits)}&retmode=json`, { ...ctx, service: 'PubMed Central', subject: id.id });
    const record = json && json.result && json.result[digits];
    if (!record || record.error) throw fail(`PubMed Central has no record for ${id.id}`, 'no record');
    return { record, reference: fromPubmedSummary(record), source: 'pubmed' };
  });
  if (!pmc) throw new ResolveError(ctx.sources[ctx.sources.length - 1].message);
  const { record, reference } = pmc;
  if (reference.doi) {
    const better = await quietly(ctx, () => resolveDoi({ kind: 'doi', id: reference.doi, url: `https://doi.org/${reference.doi}` }, ctx));
    if (better) return better;
  }
  const pmid = ((Array.isArray(record.articleids) ? record.articleids : []).find((x) => x && x.idtype === 'pmid') || {}).value;
  if (pmid) {
    const better = await quietly(ctx, () => resolvePmid({ kind: 'pmid', id: String(pmid), url: '' }, ctx));
    if (better) return better;
  }
  return { reference, source: 'pubmed' };
}

/** @param {Identifier} id @param {Ctx} ctx */
async function resolveOpenReview(id, ctx) {
  let challenged = false;
  for (const [base, label, name] of [['https://api2.openreview.net', 'OpenReview API2', 'openreview-api2'], ['https://api.openreview.net', 'OpenReview API1', 'openreview-api1']]) {
    const found = await step(ctx, name, async () => {
      let json;
      try {
        json = await fetchJson(`${base}/notes?forum=${encodeURIComponent(id.id)}`, { ...ctx, service: label, subject: id.id });
      } catch (err) {
        if (err && err.status === 403 && /ChallengeRequiredError|Challenge verification/i.test(err.body || '')) {
          challenged = true;
          throw fail(`${label} refused the request with an anti-bot challenge (HTTP 403)`, 'blocked by anti-bot challenge');
        }
        throw err;
      }
      const notes = json && Array.isArray(json.notes) ? json.notes : [];
      const note = notes.find((n) => n && n.id === id.id) || notes.find((n) => n && n.forum === id.id && !n.replyto) || null;
      if (!note) throw fail(`${label} has no note for ${id.id}`, 'no record');
      const reference = fromOpenReview(note);
      const result = { reference, source: 'openreview' };
      if (reference.bibtex) { result.bibtex = reference.bibtex; delete reference.bibtex; }
      return result;
    });
    if (found) return found;
  }
  const s2 = await quietly(ctx, () => resolveS2(`URL:${id.url}`, ctx));
  if (s2) return s2;
  const partial = { reference: urlOnlyReference(id, ctx), source: 'url-only', identifier: id, warnings: ctx.warnings, sources: ctx.sources };
  throw new ResolveError(
    `${challenged ? 'OpenReview blocked the request from your browser (anti-bot challenge)' : 'OpenReview could not be reached from your browser'} and Semantic Scholar has no usable record for this forum. `
    + 'Paste the paper\'s arXiv link, its DOI, or the BibTeX from the OpenReview page instead, or fill in the fields below.',
    partial,
  );
}

/** @param {Identifier} id @param {Ctx} ctx */
async function resolveIsbn(id, ctx) {
  const key = `ISBN:${id.id}`;
  const book = await step(ctx, 'openlibrary', async () => {
    const json = await fetchJson(`https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(key)}&format=json&jscmd=data`, { ...ctx, service: 'Open Library', subject: id.id });
    const record = json && json[key];
    if (!record) throw fail(`Open Library has no record for ISBN ${id.id}`, 'no record');
    return { reference: fromOpenLibrary(record), source: 'openlibrary' };
  });
  if (!book) throw new ResolveError(ctx.sources[ctx.sources.length - 1].message);
  return book;
}

/**
 * Turn page HTML into a result; richer chains are tried when the page names a
 * DOI or arXiv id. Throws when the page yields no title at all.
 * @param {Ctx} ctx @param {string} html @param {string} pageUrl @param {string} source
 */
async function htmlResult(ctx, html, pageUrl, source) {
  const reference = fromHtmlMeta(html, pageUrl, ctx.now);
  if (!reference.title) throw fail(`${hostOf(pageUrl) || 'The page'} has no usable metadata (no title found)`, 'no usable metadata');
  if (reference.doi) {
    const better = await quietly(ctx, () => resolveDoi({ kind: 'doi', id: reference.doi, url: `https://doi.org/${reference.doi}` }, ctx));
    if (better) return better;
  }
  if (reference.archiveId && /arxiv/i.test(reference.archive || '')) {
    const ax = arxivId(reference.archiveId);
    if (ax) {
      const better = await quietly(ctx, () => resolveArxiv({ kind: 'arxiv', id: ax.id, url: `https://arxiv.org/abs/${ax.id}` }, ctx));
      if (better) return better;
    }
  }
  return { reference, source };
}

/** @param {Identifier} id @param {Ctx} ctx */
async function resolveUrl(id, ctx) {
  const url = id.url;
  const host = hostOf(url);
  if (S2_URL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    const viaS2 = await quietly(ctx, () => resolveS2(`URL:${url}`, ctx));
    if (viaS2) return viaS2;
  }

  // (a) Same-origin page-fetching function.
  if (ctx.metaEndpoint) {
    const viaFunction = await step(ctx, 'api-meta', async () => {
      const endpoint = `${ctx.metaEndpoint}${ctx.metaEndpoint.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`;
      const res = await fetchResponse(endpoint, { ...ctx, service: 'The page-fetching function', accept: 'application/json', allowErrorStatus: true });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (!body || typeof body !== 'object' || !('ok' in body)) {
        if (res.status === 404) throw fail('The page-fetching function (/api/meta) is not available on this host', 'not available here');
        throw fail(`The page-fetching function returned ${res.status}`, `HTTP ${res.status}`);
      }
      if (!body.ok) throw fail(`Could not fetch ${host || 'the page'}: ${body.error || `HTTP ${res.status}`}`, body.status ? `page answered HTTP ${body.status}` : 'page unreachable');
      return htmlResult(ctx, str(body.head), collapse(body.url) || url, 'html-meta');
    });
    if (viaFunction) return viaFunction;
  } else {
    skip(ctx, 'api-meta', 'no page-fetching function configured');
  }

  // (b) Direct fetch (works on sites that send CORS headers).
  const direct = await step(ctx, 'direct', async () => {
    const html = await fetchText(url, { ...ctx, service: host || 'The page', accept: 'text/html, application/xhtml+xml' });
    return htmlResult(ctx, html, url, 'html-meta');
  });
  if (direct) return direct;

  // (c) Internet Archive snapshot (raw, via the id_ flag).
  if (ctx.wayback) {
    const archived = await step(ctx, 'wayback', async () => {
      const avail = await fetchJson(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { ...ctx, service: 'The Internet Archive', subject: url });
      const closest = avail && avail.archived_snapshots && avail.archived_snapshots.closest;
      const ts = closest && closest.available !== false ? collapse(closest.timestamp) : '';
      if (!/^\d{8}/.test(ts)) throw fail('The Internet Archive has no snapshot of this page', 'no snapshot');
      const html = await fetchText(`https://web.archive.org/web/${ts}id_/${url}`, { ...ctx, service: 'The Internet Archive', subject: url, accept: 'text/html, application/xhtml+xml' });
      const result = await htmlResult(ctx, html, url, 'wayback');
      if (/(^|\.)archive\.org$/i.test(hostOf(result.reference.url))) result.reference.url = url;
      ctx.warnings.push(`Metadata read from an Internet Archive snapshot dated ${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}; check it against the live page.`);
      return result;
    });
    if (archived) return archived;
  } else {
    skip(ctx, 'wayback', 'disabled');
  }

  // (d) Give up with a URL-only partial.
  const partial = { reference: urlOnlyReference(id, ctx), source: 'url-only', identifier: id, warnings: ctx.warnings, sources: ctx.sources };
  throw new ResolveError(
    `Could not read ${host || 'the page'}: web pages normally do not allow cross-origin reads (CORS) and neither this site's page fetcher nor the Internet Archive could supply its metadata, so only the URL and site name could be filled in; please add the title, author and date by hand.`,
    partial,
  );
}
