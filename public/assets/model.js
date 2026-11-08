// Shared reference data model used by every tool.
//
// A `Reference` is a CSL-JSON-flavoured plain object. Producers (the BibTeX
// parser, the URL resolvers) build one; the APA formatter consumes one.
//
// Conventions:
// - Text fields are plain Unicode (LaTeX already decoded). The ONE exception:
//   `title` and `containerTitle` MAY contain BibTeX-style brace groups `{...}`
//   marking case-protected spans. The formatter strips the braces and never
//   changes the case inside them. Producers that have no case information
//   (web APIs) just emit titles without braces.
// - `page` is a range "123-145" (any dash), a single page "e1234", or an
//   article number; the formatter normalises dashes to an en dash.
// - Dates: `year` is a number, `month` 1-12, `day` 1-31. `accessed` is an
//   ISO date string "YYYY-MM-DD" (for web pages).
// - Names: either `{family, given, particle?, suffix?}` or `{literal}` for
//   corporate/group authors. `given` holds full given names or initials as
//   found ("Ashish", "A. N.", "Jean-Pierre").

/**
 * @typedef {Object} Name
 * @property {string} [family]
 * @property {string} [given]
 * @property {string} [particle]  e.g. "van der", "de"
 * @property {string} [suffix]    e.g. "Jr.", "III"
 * @property {string} [literal]   corporate author, e.g. "OpenAI"
 */

/**
 * @typedef {'article-journal'|'paper-conference'|'book'|'chapter'|'thesis'|
 *   'report'|'preprint'|'webpage'|'software'|'dataset'|'manuscript'|
 *   'patent'|'generic'} ReferenceType
 */

/**
 * @typedef {Object} Reference
 * @property {ReferenceType} type
 * @property {Name[]} author
 * @property {Name[]} [editor]
 * @property {string} [title]
 * @property {string} [containerTitle]   journal / proceedings / book (for chapters) / website name
 * @property {string} [collectionTitle]  series name
 * @property {string|number} [volume]
 * @property {string|number} [issue]
 * @property {string} [page]
 * @property {string} [articleNumber]
 * @property {string} [publisher]
 * @property {string} [publisherPlace]
 * @property {string} [institution]      thesis / report institution (school)
 * @property {string} [edition]
 * @property {string} [number]           report / patent number
 * @property {string} [genre]            e.g. "Doctoral dissertation", "Technical report", "Preprint"
 * @property {number} [year]
 * @property {number} [month]
 * @property {number} [day]
 * @property {string} [doi]              bare DOI, no URL prefix
 * @property {string} [url]
 * @property {string} [accessed]         ISO date
 * @property {string} [archive]          e.g. "arXiv", "bioRxiv", "SSRN"
 * @property {string} [archiveId]        e.g. "1706.03762"
 * @property {string} [note]
 * @property {string} [language]
 * @property {string} [id]               original citation key, if any
 */

/** Known reference types (exported for validation / UI). */
export const REFERENCE_TYPES = Object.freeze([
  'article-journal', 'paper-conference', 'book', 'chapter', 'thesis', 'report',
  'preprint', 'webpage', 'software', 'dataset', 'manuscript', 'patent', 'generic',
]);

/**
 * Create a Reference with defaults filled in.
 * @param {Partial<Reference>} partial
 * @returns {Reference}
 */
export function makeReference(partial = {}) {
  return { type: 'generic', author: [], ...partial };
}

/**
 * Remove empty strings / null / undefined / empty arrays from a Reference so
 * downstream code can rely on "present means non-empty".
 * @param {Reference} ref
 * @returns {Reference}
 */
export function compactReference(ref) {
  const out = {};
  for (const [k, v] of Object.entries(ref)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0 && k !== 'author') continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  if (!out.author) out.author = [];
  if (!out.type) out.type = 'generic';
  return out;
}
