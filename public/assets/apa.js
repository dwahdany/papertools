// APA 7 reference formatter. Consumes a Reference (see model.js) and produces
// a rich-text reference list entry.
//
// CONTRACT (implementers must keep these signatures; UI pages depend on them):
//
//   formatApa(ref, options?) -> {
//     segments: Array<{ text: string, italic: boolean, url?: true }>,  // ordered runs
//     plain: string,      // italics dropped
//     html: string,       // runs wrapped in <i>…</i>, text HTML-escaped
//     markdown: string,   // italics as *…*, special chars escaped
//     latex: string,      // italics as \emph{…}, special chars escaped, URLs in \url{…}
//     warnings: string[], // e.g. "No year found; using n.d."
//   }
//
//   options = {
//     authorStyle: 'apa7' | 'scholar',  // apa7: up to 20 authors, then first 19 … last.
//                                       // scholar: Google-Scholar / APA 6 style — up to 7 authors;
//                                       // 8+ → first 6, "...", last.
//     sentenceCase: boolean,            // convert titles to sentence case, respecting {braces}
//                                       // and words with internal capitals (GPT-4, LLMs, DNA).
//     includeDoi: boolean,              // append https://doi.org/… when a DOI exists
//     includeUrl: boolean,              // append URL when no DOI (web pages: always)
//   }
//   Defaults: { authorStyle: 'apa7', sentenceCase: true, includeDoi: true, includeUrl: true }
//
//   applyCase(title, mode) -> string
//     mode 'sentence' | 'preserve'. Strips BibTeX brace groups in both modes;
//     in 'sentence' mode lowercases words except: first word, first word after
//     ": " / "? " / "! " / "— " / ". ", brace-protected spans, words with an uppercase
//     letter after position 0 (acronyms, CamelCase), single uppercase letter words
//     ("I", "X"). Proper nouns are NOT detected (impossible without a dictionary).
//
//   formatAuthors(names, style) -> string      // "Vaswani, A., Shazeer, N., & Polosukhin, I."
//   formatInitials(given) -> string            // "Ashish" -> "A.", "Jean-Pierre" -> "J.-P.", "A. N." -> "A. N."
//   normalizePageRange(page) -> string         // "123--145" / "123-145" -> "123–145"
//
//   Additional exports:
//   formatMany(refs, options?) -> result[]     // formatApa over an array (never throws)
//   defaultOptions                             // frozen copy of the defaults above
//
// Formatting rules by type (Google Scholar style for the italics):
//   article-journal : Authors (Year). Title. *Journal*, *Vol*(Issue), pages. https://doi.org/…
//   paper-conference: Authors (Year). Title. In *Proceedings title* (pp. x–y). Publisher. DOI
//                     (if volume/series present: In *Proceedings* (Vol. 30, pp. …))
//   book            : Authors (Year). *Title* (ed. edition). Publisher. DOI
//   chapter         : Authors (Year). Title. In E. Editor & F. Editor (Eds.), *Book title* (pp. x–y). Publisher. DOI
//   thesis          : Author (Year). *Title* [Doctoral dissertation, Institution]. URL
//   report          : Authors (Year). *Title* (Report No. N). Institution. URL
//   preprint        : Authors (Year). Title. *arXiv preprint arXiv:1706.03762*.   (Scholar style)
//                     — when no archive id: Authors (Year). *Title*. Archive/Publisher. DOI
//   webpage         : Authors (Year, Month Day). *Title*. Site Name. Retrieved Month Day, Year, from URL
//                     (if author == site name, omit site name; if no date -> (n.d.) and include retrieval date)
//   software/dataset: Authors (Year). *Title* (Version x) [Computer software / Data set]. Publisher. URL
//   generic         : Authors (Year). *Title*. Publisher/Container. DOI/URL
//
// Edge cases: no author -> start with title (title moves to author position);
// no year -> (n.d.); "others" / et al. author placeholder -> "et al."; corporate
// authors use `literal`; editors as authors for edited books: "Editor, E. (Ed.)."
//
// Style notes:
// - 'scholar' never appends a DOI/URL (except for web pages) and prints
//   "(Year, Month)" for conference papers with a known month.
// - Container titles: with sentenceCase on, proceedings / book titles are
//   sentence-cased in both styles; periodical (journal) titles keep their case
//   in 'apa7' (APA 7 rule) and are sentence-cased in 'scholar' (Scholar quirk).
// - publisherPlace is ignored (not used in APA 7). When the sole author is a
//   corporate `literal` equal to the publisher / institution / site name, that
//   publisher is omitted (APA 7 rule).
// - The LaTeX output needs \usepackage{hyperref} (or \usepackage{url}) for \url{}.

import { REFERENCE_TYPES } from './model.js';

export {
  formatApa, formatMany, applyCase, formatAuthors, formatInitials,
  normalizePageRange, defaultOptions,
};

/** @typedef {import('./model.js').Reference} Reference */
/** @typedef {import('./model.js').Name} Name */

/**
 * @typedef {Object} Segment
 * @property {string} text
 * @property {boolean} italic
 * @property {true} [url]  set on DOI / URL runs (rendered as \url{} in LaTeX, unescaped in Markdown)
 */

/**
 * @typedef {Object} ApaOptions
 * @property {'apa7'|'scholar'} authorStyle
 * @property {boolean} sentenceCase
 * @property {boolean} includeDoi
 * @property {boolean} includeUrl
 */

/**
 * @typedef {Object} ApaResult
 * @property {Segment[]} segments
 * @property {string} plain
 * @property {string} html
 * @property {string} markdown
 * @property {string} latex
 * @property {string[]} warnings
 */

/** @type {Readonly<ApaOptions>} */
const defaultOptions = Object.freeze({
  authorStyle: 'apa7',
  sentenceCase: true,
  includeDoi: true,
  includeUrl: true,
});

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];

const ORDINAL_WORDS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

/** Abbreviations after which ". " does not start a new sentence in titles. */
const NON_TERMINAL_ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'cf', 'al', 'vol', 'no', 'dr', 'mr', 'mrs', 'ms',
  'st', 'jr', 'sr', 'inc', 'ltd', 'co', 'fig', 'eq', 'proc', 'int', 'conf', 'pp', 'p',
]);

/** A word: letters/digits plus apostrophes and periods glued to a following letter (Ph.D, U.S). */
const WORD_RE = /[\p{L}\p{N}](?:[\p{L}\p{N}'’]|\.(?=[\p{L}\p{N}]))*/gu;

// ---------------------------------------------------------------------------
// Small helpers

/**
 * Coerce a field to a trimmed string ('' for null/undefined/objects).
 * @param {unknown} v
 * @returns {string}
 */
function str(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/**
 * Case-insensitive identity check used to omit a publisher equal to the author.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameName(a, b) {
  const norm = (s) => str(s).replace(/\.$/, '').toLowerCase();
  return Boolean(a) && Boolean(b) && norm(a) === norm(b);
}

/**
 * Capitalise the first letter of each word ("technical report" -> "Technical Report").
 * @param {string} s
 * @returns {string}
 */
function titleCaseWords(s) {
  return s.replace(/\p{L}[\p{L}\p{N}'’]*/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

/**
 * English ordinal for a positive integer.
 * @param {number} n
 * @returns {string}
 */
function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
}

// ---------------------------------------------------------------------------
// Pages, editions, DOIs, dates

/**
 * Normalise a page range to an en dash: "770--778", "770-778", "770 – 778",
 * "770—778" -> "770–778". Single pages and article numbers are returned as-is;
 * "S1-S10" and ACM style "123:1-123:20" are supported. A leading "p."/"pp." is
 * stripped. Non-string input is coerced ('' for null/undefined).
 * @param {unknown} page
 * @returns {string}
 */
function normalizePageRange(page) {
  let s = str(page);
  if (!s) return '';
  s = s.replace(/^pp?\.\s*/i, '').replace(/^pp?\s+/i, '');
  const m = s.match(/^([^\s\-–—−]+)\s*[-–—−]+\s*([^\s\-–—−]+)$/);
  return m ? `${m[1]}–${m[2]}` : s;
}

/**
 * Page locator with APA label: ranges get "pp.", single pages "p.".
 * @param {string} normalized  output of normalizePageRange
 * @returns {string}
 */
function pagesWithLabel(normalized) {
  if (!normalized) return '';
  return normalized.includes('–') ? `pp. ${normalized}` : `p. ${normalized}`;
}

/**
 * "2nd" / "Second" / "3" / "2nd ed." / "Revised" -> "2nd ed." / "3rd ed." / "Rev. ed."
 * Anything unrecognised is returned with " ed." appended.
 * @param {unknown} edition
 * @returns {string}
 */
function formatEdition(edition) {
  let s = str(edition).replace(/\b(ed\.?|edition)$/i, '').trim();
  if (!s) return '';
  let n = ORDINAL_WORDS[s.toLowerCase()];
  if (!n && /^\d+$/.test(s)) n = Number(s);
  const ord = s.match(/^(\d+)(st|nd|rd|th)$/i);
  if (!n && ord) n = Number(ord[1]);
  if (n) return `${ordinal(n)} ed.`;
  if (/^rev(ised|\.)?$/i.test(s)) return 'Rev. ed.';
  return `${s} ed.`;
}

/**
 * Strip URL / "doi:" prefixes from a DOI.
 * @param {unknown} doi
 * @returns {string}
 */
function cleanDoi(doi) {
  return str(doi)
    .replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();
}

/**
 * Year as a string, or '' when missing / "n.d.".
 * @param {unknown} year
 * @returns {string}
 */
function parseYear(year) {
  if (typeof year === 'number') return Number.isFinite(year) ? String(Math.trunc(year)) : '';
  const s = str(year);
  if (!s || /^n\.?\s?d\.?$/i.test(s)) return '';
  return s;
}

/**
 * Integer in [min, max] or null.
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @returns {number|null}
 */
function intInRange(v, min, max) {
  const n = typeof v === 'number' ? v : parseInt(str(v), 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * "2026-11-08" -> "November 8, 2026" ('' if unparsable).
 * @param {unknown} iso
 * @returns {string}
 */
function formatAccessDate(iso) {
  const m = str(iso).match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (!m) return '';
  const month = intInRange(m[2], 1, 12);
  const day = m[3] ? intInRange(m[3], 1, 31) : null;
  if (!month) return m[1];
  return day ? `${MONTHS[month - 1]} ${day}, ${m[1]}` : `${MONTHS[month - 1]} ${m[1]}`;
}

// ---------------------------------------------------------------------------
// Names

/**
 * @typedef {Object} NameParts
 * @property {string} family
 * @property {string} given
 * @property {string} particle
 * @property {string} suffix
 * @property {string} literal
 */

/**
 * Normalise one Name (or a bare string, treated as literal) to NameParts.
 * @param {unknown} name
 * @returns {NameParts|null}
 */
function toNameParts(name) {
  if (typeof name === 'string') {
    const literal = str(name);
    return literal ? { family: '', given: '', particle: '', suffix: '', literal } : null;
  }
  if (!name || typeof name !== 'object') return null;
  const p = {
    family: str(name.family),
    given: str(name.given),
    particle: str(name.particle),
    suffix: str(name.suffix),
    literal: str(name.literal),
  };
  return p.family || p.given || p.literal ? p : null;
}

/**
 * @param {unknown} names
 * @returns {NameParts[]}
 */
function toNameList(names) {
  if (!Array.isArray(names)) return [];
  return names.map(toNameParts).filter(Boolean);
}

/**
 * The BibTeX "and others" placeholder.
 * @param {NameParts} p
 * @returns {boolean}
 */
function isOthers(p) {
  return Boolean(p.literal) && /^(others|et al\.?)$/i.test(p.literal);
}

/**
 * Initials for a given name. Rule: every whitespace- or hyphen-separated token
 * becomes its first letter plus a period, keeping the letter's case; tokens that
 * are already initials ("A.", "Ø.") are kept; glued initials "A.N." are split;
 * hyphenated parts are joined with "-"; parenthesised nicknames are dropped.
 *   "Ashish" -> "A.", "Jean-Pierre" -> "J.-P.", "Ming Wei" -> "M. W.", "A.N." -> "A. N.",
 *   "José Ángel" -> "J. Á.", "Maria de los" -> "M. d. l."
 * @param {unknown} given
 * @returns {string}
 */
function formatInitials(given) {
  const s = str(given).normalize('NFC').replace(/\.(?=\p{L})/gu, '. ');
  if (!s) return '';
  return s.split(/\s+/)
    .map((token) => token.split('-').map(initialOf).filter(Boolean).join('-'))
    .filter(Boolean)
    .join(' ');
}

/**
 * First letter of a token followed by a period ('' when the token has no letter
 * or is a parenthesised nickname).
 * @param {string} part
 * @returns {string}
 */
function initialOf(part) {
  if (part.startsWith('(')) return '';
  const m = part.match(/\p{L}/u);
  return m ? `${m[0]}.` : '';
}

/**
 * "Family, I. I., Suffix" form used in the author position.
 * @param {NameParts} p
 * @returns {string}
 */
function invertedName(p) {
  if (p.literal) return p.literal;
  const family = [p.particle, p.family].filter(Boolean).join(' ');
  if (!family) return p.given;
  const initials = formatInitials(p.given);
  let out = family;
  if (initials) out += `, ${initials}`;
  if (p.suffix) out += `, ${p.suffix}`;
  return out;
}

/**
 * "I. I. Family, Suffix" form used for editors inside "In …".
 * @param {NameParts} p
 * @returns {string}
 */
function directName(p) {
  if (p.literal) return p.literal;
  const family = [p.particle, p.family].filter(Boolean).join(' ');
  let out = [formatInitials(p.given), family].filter(Boolean).join(' ');
  if (p.suffix) out += `, ${p.suffix}`;
  return out;
}

/**
 * Join inverted names following the author-count rules of the style.
 * apa7: ≤20 all, else first 19 + ", . . . " + last (no ampersand).
 * scholar: ≤7 all, else first 6 + ", ... & " + last.
 * @param {string[]} list
 * @param {'apa7'|'scholar'} style
 * @returns {string}
 */
function joinInverted(list, style) {
  const scholar = style === 'scholar';
  const max = scholar ? 7 : 20;
  if (list.length === 1) return list[0];
  const last = list[list.length - 1];
  if (list.length > max) {
    const head = list.slice(0, scholar ? 6 : 19).join(', ');
    return scholar ? `${head}, ... & ${last}` : `${head}, . . . ${last}`;
  }
  return `${list.slice(0, -1).join(', ')}, & ${last}`;
}

/**
 * Format an author list for the author position.
 * "Vaswani, A., Shazeer, N., & Polosukhin, I."; an "others" placeholder prints
 * "et al." in place of the literal with no ampersand ("Vaswani, A., et al.").
 * Returns '' for empty / invalid input; never throws.
 * @param {unknown} names   Name[]
 * @param {'apa7'|'scholar'} [style='apa7']
 * @returns {string}
 */
function formatAuthors(names, style = 'apa7') {
  const parts = toNameList(names);
  if (!parts.length) return '';
  const others = parts.some(isOthers);
  const real = parts.filter((p) => !isOthers(p)).map(invertedName);
  if (others) return real.length ? `${real.join(', ')}, et al.` : 'et al.';
  return joinInverted(real, style === 'scholar' ? 'scholar' : 'apa7');
}

/**
 * Editors in direct order: "E. Editor", "E. Editor & F. Other", "A. One, B. Two, & C. Three".
 * @param {NameParts[]} parts
 * @returns {{ text: string, plural: boolean }}
 */
function formatEditorsDirect(parts) {
  const others = parts.some(isOthers);
  const real = parts.filter((p) => !isOthers(p)).map(directName);
  const plural = real.length + (others ? 1 : 0) > 1;
  if (others) return { text: real.length ? `${real.join(', ')}, et al.` : 'et al.', plural };
  if (real.length === 1) return { text: real[0], plural };
  if (real.length === 2) return { text: `${real[0]} & ${real[1]}`, plural };
  return { text: `${real.slice(0, -1).join(', ')}, & ${real[real.length - 1]}`, plural };
}

// ---------------------------------------------------------------------------
// Case handling

/**
 * Remove BibTeX brace groups, remembering which characters were protected.
 * Stray closing braces are dropped.
 * @param {string} s
 * @returns {{ text: string, prot: boolean[] }}
 */
function stripBraces(s) {
  const chars = [];
  const prot = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { depth++; continue; }
    if (ch === '}') { if (depth > 0) depth--; continue; }
    chars.push(ch);
    prot.push(depth > 0);
  }
  return { text: chars.join(''), prot };
}

/**
 * True when any uppercase letter occurs after the first character.
 * @param {string} word
 * @returns {boolean}
 */
function hasInternalCapital(word) {
  return /\p{Lu}/u.test(Array.from(word).slice(1).join(''));
}

/**
 * Single uppercase letter word ("I", "X").
 * @param {string} word
 * @returns {boolean}
 */
function isSingleUpper(word) {
  return Array.from(word).length === 1 && /\p{Lu}/u.test(word);
}

/**
 * Does the word starting at `start` follow a sentence break (": ", "? ", "! ",
 * ". ", "— " or " – "), ignoring quotes / brackets in between?
 * @param {string} text
 * @param {number} start
 * @returns {boolean}
 */
function followsSentenceBreak(text, start) {
  const before = text.slice(0, start);
  const stripped = before.replace(/[\s"'“”‘’(\[]+$/u, '');
  if (stripped.length === before.length) return false;
  const last = stripped[stripped.length - 1];
  if (last === '—') return true;
  if (last === '–') return /\s–$/.test(stripped);
  if (last === ':' || last === '?' || last === '!') return true;
  if (last === '.') {
    const prev = stripped.slice(0, -1).match(/[\p{L}.]+$/u);
    return !prev || !NON_TERMINAL_ABBREVIATIONS.has(prev[0].toLowerCase());
  }
  return false;
}

/**
 * More than 70% uppercase letters (outside protected spans) and ≥3 words.
 * @param {string} text
 * @param {boolean[]} prot
 * @param {RegExpMatchArray[]} words
 * @returns {boolean}
 */
function isAllCaps(text, prot, words) {
  if (words.length < 3) return false;
  let upper = 0;
  let letters = 0;
  for (let i = 0; i < text.length; i++) {
    if (prot[i] || !/\p{L}/u.test(text[i])) continue;
    letters++;
    if (/\p{Lu}/u.test(text[i])) upper++;
  }
  return letters > 0 && upper / letters > 0.7;
}

/**
 * Sentence-case `text`, never touching characters flagged in `prot`.
 * @param {string} text
 * @param {boolean[]} prot
 * @returns {string}
 */
function sentenceCase(text, prot) {
  const chars = text.split('');
  const words = [...text.matchAll(WORD_RE)];
  const lowerRange = (from, to) => {
    for (let i = from; i < to; i++) if (!prot[i]) chars[i] = chars[i].toLowerCase();
  };
  if (isAllCaps(text, prot, words)) lowerRange(0, chars.length);
  words.forEach((m, idx) => {
    const start = m.index;
    const end = start + m[0].length;
    for (let i = start; i < end; i++) if (prot[i]) return;
    const word = chars.slice(start, end).join('');
    if (hasInternalCapital(word)) return;
    if (idx === 0 || followsSentenceBreak(text, start)) {
      chars[start] = chars[start].toUpperCase();
    } else if (!isSingleUpper(word)) {
      lowerRange(start, end);
    }
  });
  return chars.join('');
}

/**
 * Apply title casing. Both modes strip BibTeX brace groups `{...}`; 'sentence'
 * additionally lowercases words except: the first word, the first word after
 * ": " / "? " / "! " / ". " / "— ", brace-protected spans, words with an
 * uppercase letter after position 0 ("iPhone", "GPT-4", "LLMs", "COVID-19") and
 * single uppercase letters ("I", "X"). Hyphen-separated parts are treated as
 * separate words ("Self-Supervised" -> "self-supervised"). Titles with >70%
 * uppercase letters and ≥3 words ("ATTENTION IS ALL YOU NEED") are lowercased
 * first, then capitalised. Lowercasing is Unicode-aware (toLowerCase).
 * Limitations: proper nouns are not recognised (protect them with braces); a
 * word after an unlisted abbreviation ("Proc. of") is capitalised.
 * @param {unknown} title
 * @param {'sentence'|'preserve'} [mode='sentence']
 * @returns {string}
 */
function applyCase(title, mode = 'sentence') {
  const { text, prot } = stripBraces(str(title));
  if (mode !== 'sentence') return text;
  return sentenceCase(text, prot);
}

// ---------------------------------------------------------------------------
// Segments and rendering

/** @param {string} text @returns {Segment} */
function plainSeg(text) { return { text, italic: false }; }
/** @param {string} text @returns {Segment} */
function italicSeg(text) { return { text, italic: true }; }
/** @param {string} text @returns {Segment} */
function urlSeg(text) { return { text, italic: false, url: true }; }

/**
 * Append a non-italic period to a group unless it already ends in . ? or !
 * @param {Segment[]} segs
 * @returns {Segment[]}
 */
function withPeriod(segs) {
  const text = segs.map((s) => s.text).join('').trimEnd();
  if (!text || /[.?!]$/.test(text)) return segs;
  return [...segs, plainSeg('.')];
}

/**
 * Merge adjacent runs with the same formatting and collapse whitespace so the
 * output has single spaces only and no leading / trailing whitespace.
 * @param {Segment[]} segs
 * @returns {Segment[]}
 */
function normalizeSegments(segs) {
  /** @type {Segment[]} */
  const merged = [];
  for (const s of segs) {
    if (!s.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.italic === s.italic && Boolean(last.url) === Boolean(s.url)) {
      last.text += s.text;
    } else {
      merged.push({ ...s });
    }
  }
  let prevEndsSpace = true;
  for (const s of merged) {
    s.text = s.text.replace(/\s+/g, ' ');
    if (prevEndsSpace && s.text.startsWith(' ')) s.text = s.text.slice(1);
    if (s.text) prevEndsSpace = s.text.endsWith(' ');
  }
  const out = merged.filter((s) => s.text);
  if (out.length) out[out.length - 1].text = out[out.length - 1].text.trimEnd();
  return out.filter((s) => s.text);
}

/** @param {string} s @returns {string} */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/** @param {string} s @returns {string} */
function escapeMarkdown(s) {
  return s.replace(/[\\*_`[\]<>]/g, (ch) => `\\${ch}`);
}

const LATEX_ESCAPES = {
  '\\': '\\textbackslash{}', '#': '\\#', '$': '\\$', '%': '\\%', '&': '\\&',
  '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
};

/** @param {string} s @returns {string} */
function escapeLatex(s) {
  return s.replace(/[\\#$%&_{}~^]/g, (ch) => LATEX_ESCAPES[ch]).replace(/–/g, '--');
}

/** @param {Segment[]} segs @returns {string} */
function renderPlain(segs) {
  return segs.map((s) => s.text).join('');
}

/** @param {Segment[]} segs @returns {string} */
function renderHtml(segs) {
  return segs.map((s) => (s.italic ? `<i>${escapeHtml(s.text)}</i>` : escapeHtml(s.text))).join('');
}

/**
 * Markdown with *italics*; surrounding whitespace is moved outside the
 * asterisks so the emphasis delimiters always close.
 * @param {Segment[]} segs
 * @returns {string}
 */
function renderMarkdown(segs) {
  return segs.map((s) => {
    const text = s.url ? s.text : escapeMarkdown(s.text);
    if (!s.italic) return text;
    const m = text.match(/^(\s*)(.*?)(\s*)$/s);
    return m[2] ? `${m[1]}*${m[2]}*${m[3]}` : text;
  }).join('');
}

/**
 * LaTeX with \emph{} italics and \url{} links (requires hyperref or url).
 * @param {Segment[]} segs
 * @returns {string}
 */
function renderLatex(segs) {
  return segs.map((s) => {
    if (s.url) return `\\url{${s.text.replace(/\{/g, '%7B').replace(/\}/g, '%7D')}}`;
    const text = escapeLatex(s.text);
    return s.italic ? `\\emph{${text}}` : text;
  }).join('');
}

// ---------------------------------------------------------------------------
// Reference assembly

/**
 * @typedef {Object} Ctx
 * @property {Record<string, unknown>} r       the (possibly malformed) reference
 * @property {string} type                     validated type
 * @property {ApaOptions} opts
 * @property {boolean} scholar
 * @property {string[]} warnings
 * @property {NameParts[]} authors
 * @property {NameParts[]} editors
 * @property {boolean} editorsAsAuthors
 * @property {string} authorLiteral            sole corporate author, or ''
 */

/**
 * @param {unknown} options
 * @returns {ApaOptions}
 */
function normalizeOptions(options) {
  const src = options && typeof options === 'object' ? options : {};
  /** @type {ApaOptions} */
  const out = { ...defaultOptions };
  for (const key of Object.keys(defaultOptions)) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  out.authorStyle = out.authorStyle === 'scholar' ? 'scholar' : 'apa7';
  out.sentenceCase = Boolean(out.sentenceCase);
  out.includeDoi = Boolean(out.includeDoi);
  out.includeUrl = Boolean(out.includeUrl);
  return out;
}

/**
 * Title with the configured casing.
 * @param {Ctx} ctx
 * @param {unknown} text
 * @returns {string}
 */
function caseTitle(ctx, text) {
  return applyCase(text, ctx.opts.sentenceCase ? 'sentence' : 'preserve');
}

/**
 * Container title casing: periodicals keep their case in apa7 (sentence-cased
 * in scholar); proceedings / book titles follow sentenceCase in both styles.
 * @param {Ctx} ctx
 * @param {unknown} text
 * @param {boolean} periodical
 * @returns {string}
 */
function caseContainer(ctx, text, periodical) {
  const sentence = ctx.opts.sentenceCase && (ctx.scholar || !periodical);
  return applyCase(text, sentence ? 'sentence' : 'preserve');
}

/**
 * Whether the title is italicised for this reference.
 * @param {Ctx} ctx
 * @returns {boolean}
 */
function titleIsItalic(ctx) {
  switch (ctx.type) {
    case 'article-journal':
    case 'paper-conference':
    case 'chapter':
      return false;
    case 'preprint':
      return !str(ctx.r.archiveId);
    default:
      return true;
  }
}

/**
 * The date group text, without parentheses.
 * @param {Ctx} ctx
 * @returns {string}
 */
function formatDate(ctx) {
  const year = parseYear(ctx.r.year);
  if (!year) {
    ctx.warnings.push('No year found; using n.d.');
    return 'n.d.';
  }
  const month = intInRange(ctx.r.month, 1, 12);
  if (!month) return year;
  const monthName = MONTHS[month - 1];
  if (ctx.type === 'webpage') {
    const day = intInRange(ctx.r.day, 1, 31);
    return day ? `${year}, ${monthName} ${day}` : `${year}, ${monthName}`;
  }
  if (ctx.type === 'paper-conference' && ctx.scholar) return `${year}, ${monthName}`;
  return year;
}

/**
 * Parenthetical / bracketed additions that follow the title.
 * @param {Ctx} ctx
 * @returns {string[]}
 */
function titleExtras(ctx) {
  const { r, type } = ctx;
  const number = str(r.number);
  const genre = str(r.genre);
  const version = str(r.version);
  switch (type) {
    case 'book': {
      const items = [];
      if (ctx.editors.length && !ctx.editorsAsAuthors) {
        const ed = formatEditorsDirect(ctx.editors);
        items.push(`${ed.text}, ${ed.plural ? 'Eds.' : 'Ed.'}`);
      }
      const edition = formatEdition(r.edition);
      if (edition) items.push(edition);
      if (str(r.volume)) items.push(`Vol. ${str(r.volume)}`);
      if (!items.length) return [];
      return [`(${items.join(items.length > 1 && items[0].includes('Ed') ? '; ' : ', ')})`];
    }
    case 'thesis': {
      const inst = str(r.institution) || str(r.publisher);
      return [`[${genre || 'Doctoral dissertation'}${inst ? `, ${inst}` : ''}]`];
    }
    case 'report':
      return number ? [`(${genre ? titleCaseWords(genre) : 'Report'} No. ${number})`] : [];
    case 'software':
    case 'dataset': {
      const out = [];
      if (version) out.push(`(Version ${version})`);
      out.push(`[${genre || (type === 'software' ? 'Computer software' : 'Data set')}]`);
      return out;
    }
    case 'manuscript':
      return [`[${genre || 'Unpublished manuscript'}]`];
    case 'patent':
      return number ? [`(${genre || 'Patent'} No. ${number})`] : [];
    case 'generic': {
      const edition = formatEdition(r.edition);
      return edition ? [`(${edition})`] : [];
    }
    default:
      return [];
  }
}

/**
 * Title group segments (empty when no title).
 * @param {Ctx} ctx
 * @returns {Segment[]}
 */
function buildTitle(ctx) {
  const title = caseTitle(ctx, ctx.r.title);
  const segs = [];
  if (title) segs.push(titleIsItalic(ctx) ? italicSeg(title) : plainSeg(title));
  else ctx.warnings.push('No title found');
  for (const extra of titleExtras(ctx)) segs.push(plainSeg(` ${extra}`));
  return segs;
}

/**
 * Publisher-like group unless it duplicates the corporate author.
 * @param {Ctx} ctx
 * @param {string} name
 * @returns {Segment[][]}
 */
function publisherGroup(ctx, name) {
  if (!name || sameName(name, ctx.authorLiteral)) return [];
  return [[plainSeg(name)]];
}

/**
 * Journal source: *Journal*, *Vol*(Issue), pages / Article N
 * @param {Ctx} ctx
 * @returns {Segment[][]}
 */
function journalSource(ctx) {
  const { r } = ctx;
  const journal = caseContainer(ctx, r.containerTitle, true);
  const volume = str(r.volume);
  const issue = str(r.issue);
  const article = str(r.articleNumber);
  const locator = article ? `Article ${article}` : normalizePageRange(r.page);
  const segs = [];
  const sep = () => (segs.length ? ', ' : '');
  if (journal) segs.push(italicSeg(journal));
  if (volume) {
    segs.push(plainSeg(sep()), italicSeg(volume));
    if (issue) segs.push(plainSeg(`(${issue})`));
  } else if (issue) {
    segs.push(plainSeg(`${sep()}(${issue})`));
  }
  if (locator) segs.push(plainSeg(`${sep()}${locator}`));
  return segs.length ? [segs] : [];
}

/**
 * "In [Editors (Eds.),] *Container* (items)" group.
 * @param {Ctx} ctx
 * @param {string} container
 * @param {string[]} items
 * @param {boolean} withEditors
 * @returns {Segment[]}
 */
function inContainer(ctx, container, items, withEditors) {
  const segs = [plainSeg('In ')];
  if (withEditors && ctx.editors.length) {
    const ed = formatEditorsDirect(ctx.editors);
    segs.push(plainSeg(`${ed.text} (${ed.plural ? 'Eds.' : 'Ed.'}), `));
  }
  segs.push(italicSeg(container));
  if (items.length) segs.push(plainSeg(` (${items.join(', ')})`));
  return segs;
}

/**
 * Conference paper source: In *Proceedings* (Vol. N, pp. x–y). Publisher.
 * @param {Ctx} ctx
 * @returns {Segment[][]}
 */
function conferenceSource(ctx) {
  const { r } = ctx;
  const containerRaw = str(r.containerTitle) || str(r.collectionTitle);
  const container = caseContainer(ctx, containerRaw, false);
  const series = str(r.containerTitle) && str(r.collectionTitle)
    && !sameName(r.containerTitle, r.collectionTitle)
    ? caseContainer(ctx, r.collectionTitle, false) : '';
  const items = [];
  if (series) items.push(series);
  if (str(r.volume)) items.push(`Vol. ${str(r.volume)}`);
  const pages = pagesWithLabel(normalizePageRange(r.page));
  if (pages) items.push(pages);
  if (str(r.articleNumber)) items.push(`Article ${str(r.articleNumber)}`);
  const groups = [];
  if (container) groups.push(inContainer(ctx, container, items, !ctx.scholar));
  return [...groups, ...publisherGroup(ctx, str(r.publisher))];
}

/**
 * Chapter source: In E. Editor (Ed.), *Book* (2nd ed., Vol. 2, pp. x–y). Publisher.
 * @param {Ctx} ctx
 * @returns {Segment[][]}
 */
function chapterSource(ctx) {
  const { r } = ctx;
  const container = caseContainer(ctx, r.containerTitle, false);
  const items = [];
  const edition = formatEdition(r.edition);
  if (edition) items.push(edition);
  if (str(r.volume)) items.push(`Vol. ${str(r.volume)}`);
  const pages = pagesWithLabel(normalizePageRange(r.page));
  if (pages) items.push(pages);
  const groups = [];
  if (container) groups.push(inContainer(ctx, container, items, true));
  return [...groups, ...publisherGroup(ctx, str(r.publisher))];
}

/**
 * Preprint source: *arXiv preprint arXiv:ID* / *bioRxiv* / Archive or publisher.
 * @param {Ctx} ctx
 * @returns {Segment[][]}
 */
function preprintSource(ctx) {
  const { r } = ctx;
  const id = str(r.archiveId);
  const archive = str(r.archive) || (/^\d{4}\.\d{4,5}(v\d+)?$/.test(id) ? 'arXiv' : '');
  if (id) {
    if (/^arxiv$/i.test(archive)) return [[italicSeg(`arXiv preprint arXiv:${id}`)]];
    if (archive) return [[italicSeg(archive)]];
    return [[italicSeg(id)]];
  }
  return publisherGroup(ctx, str(r.publisher) || archive);
}

/**
 * Web page: Site Name (omitted when equal to the author).
 * @param {Ctx} ctx
 * @returns {Segment[][]}
 */
function webpageSource(ctx) {
  const site = applyCase(ctx.r.containerTitle, 'preserve');
  if (!site || sameName(site, ctx.authorLiteral)) return [];
  return [[plainSeg(site)]];
}

/**
 * Source groups (everything between the title and the DOI/URL) by type.
 * @param {Ctx} ctx
 * @returns {Segment[][]}
 */
function buildSource(ctx) {
  const { r, type } = ctx;
  switch (type) {
    case 'article-journal': return journalSource(ctx);
    case 'paper-conference': return conferenceSource(ctx);
    case 'chapter': return chapterSource(ctx);
    case 'preprint': return preprintSource(ctx);
    case 'webpage': return webpageSource(ctx);
    case 'thesis': {
      const inst = str(r.institution) || str(r.publisher);
      const publisher = str(r.publisher);
      return publisher && !sameName(publisher, inst) ? publisherGroup(ctx, publisher) : [];
    }
    case 'report':
    case 'manuscript':
      return publisherGroup(ctx, str(r.institution) || str(r.publisher));
    case 'generic':
      return publisherGroup(ctx, str(r.publisher) || applyCase(r.containerTitle, 'preserve'));
    default:
      return publisherGroup(ctx, str(r.publisher));
  }
}

/**
 * Trailing DOI / URL (no period after it), or '' when none applies.
 * @param {Ctx} ctx
 * @returns {string}
 */
function buildLocator(ctx) {
  const { r, opts } = ctx;
  const url = str(r.url);
  if (ctx.type === 'webpage') {
    if (!url) return '';
    const accessed = formatAccessDate(r.accessed);
    return accessed ? `Retrieved ${accessed}, from ${url}` : url;
  }
  if (ctx.scholar) return '';
  const doi = cleanDoi(r.doi);
  if (opts.includeDoi && doi) return `https://doi.org/${doi}`;
  if (!opts.includeUrl) return '';
  if (url) return url;
  const id = str(r.archiveId);
  const archive = str(r.archive) || (/^\d{4}\.\d{4,5}(v\d+)?$/.test(id) ? 'arXiv' : '');
  if (ctx.type === 'preprint' && id && /^arxiv$/i.test(archive)) return `https://arxiv.org/abs/${id}`;
  return '';
}

/**
 * Author group text (editors stand in for missing authors), or ''.
 * @param {Ctx} ctx
 * @returns {string}
 */
function buildAuthorText(ctx) {
  if (ctx.authors.length) return formatAuthors(ctx.authors, ctx.opts.authorStyle);
  const editorsCanLead = ctx.type !== 'chapter' && ctx.type !== 'paper-conference';
  if (ctx.editors.length && editorsCanLead) {
    ctx.editorsAsAuthors = true;
    const plural = ctx.editors.length > 1;
    return `${formatAuthors(ctx.editors, ctx.opts.authorStyle)} (${plural ? 'Eds.' : 'Ed.'})`;
  }
  return '';
}

/**
 * Format one Reference as an APA 7 reference list entry. Never throws on
 * malformed input; problems are reported in `warnings`.
 * @param {Partial<Reference>|unknown} ref
 * @param {Partial<ApaOptions>} [options]
 * @returns {ApaResult}
 */
function formatApa(ref, options) {
  const opts = normalizeOptions(options);
  const warnings = [];
  const r = ref && typeof ref === 'object' ? /** @type {Record<string, unknown>} */ (ref) : {};
  let type = typeof r.type === 'string' ? r.type.trim() : '';
  if (!REFERENCE_TYPES.includes(type)) {
    if (type) warnings.push(`Unknown type "${type}" treated as generic`);
    type = 'generic';
  }
  const authors = toNameList(r.author);
  /** @type {Ctx} */
  const ctx = {
    r,
    type,
    opts,
    scholar: opts.authorStyle === 'scholar',
    warnings,
    authors,
    editors: toNameList(r.editor),
    editorsAsAuthors: false,
    authorLiteral: authors.length === 1 ? authors[0].literal : '',
  };

  const authorText = buildAuthorText(ctx);
  if (!authorText) warnings.push('No author found; title moved to author position');
  const dateGroup = [plainSeg(`(${formatDate(ctx)})`)];
  const titleGroup = buildTitle(ctx);

  /** @type {Segment[][]} */
  const groups = [];
  if (authorText) {
    groups.push([plainSeg(authorText)], dateGroup);
    if (titleGroup.length) groups.push(titleGroup);
  } else {
    if (titleGroup.length) groups.push(titleGroup);
    groups.push(dateGroup);
  }
  groups.push(...buildSource(ctx));

  const segments = [];
  groups.forEach((g, i) => {
    if (i) segments.push(plainSeg(' '));
    segments.push(...withPeriod(g));
  });
  const locator = buildLocator(ctx);
  if (locator) segments.push(plainSeg(' '), urlSeg(locator));

  const normalized = normalizeSegments(segments);
  return {
    segments: normalized,
    plain: renderPlain(normalized),
    html: renderHtml(normalized),
    markdown: renderMarkdown(normalized),
    latex: renderLatex(normalized),
    warnings,
  };
}

/**
 * Format many references; a non-array yields [].
 * @param {unknown} refs
 * @param {Partial<ApaOptions>} [options]
 * @returns {ApaResult[]}
 */
function formatMany(refs, options) {
  if (!Array.isArray(refs)) return [];
  return refs.map((ref) => formatApa(ref, options));
}
