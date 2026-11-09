// BibTeX parsing and serialisation.
//
// CONTRACT (UI pages and the URL tool depend on these signatures):
//
//   parseBibtex(text) -> {
//     entries: Array<{ type: string, key: string, fields: Record<string,string>, raw: string }>,
//     errors:  Array<{ message: string, line: number }>,
//   }
//     - type is lowercased ('article', 'inproceedings', ...). key may be ''.
//     - field names lowercased; values are the RAW BibTeX value with the outer
//       delimiters removed, `#` concatenation applied, @string macros and the
//       standard month macros (jan..dec) expanded, but LaTeX NOT yet decoded and
//       braces preserved (so case protection survives).
//     - @comment and @preamble are skipped; text outside entries is ignored.
//     - Robust to: nested braces, quotes containing braces, missing trailing
//       comma, parentheses delimiters @article(...), Windows line endings, BOM,
//       `%` comment lines outside entries (NOT inside values).
//     - Error recovery is linear in the input size: after the first unbalanced
//       entry a brace-match table is built once, so a file with thousands of
//       broken entries parses in O(n) instead of O(errors x n).
//
//   latexToUnicode(s) -> string
//     First decodes the HTML entities some exporters (e.g. Crossref) leave in
//     values: &amp; &lt; &gt; &quot; &apos; &nbsp; and numeric &#NNN; / &#xHH;
//     (other `&name;` text is left alone). Then
//     decodes LaTeX accents/commands: \"{o} \"o {\"o} \'e \`e \^e \~n \c{c} \v{s}
//     \H{o} \k{a} \={a} \.{z} \u{g} \r{a} \o \O \l \L \ss \ae \AE \oe \OE \aa \AA
//     \i \j, ligatures, \& \% \$ \_ \# \{ \}, ~ -> nbsp (U+00A0), -- -> –,
//     --- -> —, `` '' -> “ ”, ` ' -> ‘ ’, \textit{x}/\emph{x}/\textbf{x} -> x,
//     \url{x} -> x, \mbox{x} -> x, \ldots -> …, \\ -> space, \, \; \  -> space,
//     math $...$ kept as-is minus the dollars, unknown \commands removed (keep argument).
//     Braces are left in place by this function (callers decide); use
//     stripBraces(s) to remove them. NOTE: so that case-protection braces stay
//     distinguishable from literal ones, `\{` and `\}` are passed through
//     escaped; stripBraces() turns them into plain { }. Values that look like a
//     URL (http…, www.) are returned untouched.
//
//   stripBraces(s) -> string           // removes { and } (not escaped ones)
//
//   parseNames(s) -> Name[]            // "Vaswani, Ashish and Noam Shazeer and others"
//     Handles the three BibTeX name forms (First von Last | von Last, First |
//     von Last, Jr, First), "and" separators at brace depth 0, "others" ->
//     { literal: 'others' } (formatter prints "et al."), corporate names in
//     braces -> { literal }, LaTeX decoded and braces stripped in outputs.
//
//   bibtexToReference(entry) -> Reference
//     Maps entry types/fields to the shared model:
//       article -> article-journal (journal -> containerTitle, volume, number -> issue, pages)
//       inproceedings/conference -> paper-conference (booktitle -> containerTitle, series -> collectionTitle)
//       book -> book (publisher, edition, address -> publisherPlace); editor-only books keep editor
//       incollection/inbook -> chapter (booktitle -> containerTitle, editor, pages)
//       phdthesis -> thesis (genre 'Doctoral dissertation', school -> institution)
//       mastersthesis -> thesis (genre "Master's thesis")
//       techreport -> report (institution, number, type -> genre)
//       misc/unpublished/online/electronic/www/webpage/manuscript -> preprint if
//         eprint/archivePrefix=arXiv or journal/howpublished/note mentions arXiv;
//         otherwise a `note` naming a kind wins ("Computer software" / "[Data set]"
//         -> software/dataset, "Unpublished manuscript" / "Manuscript in
//         preparation" / "Submitted for publication" -> manuscript, and that note
//         is consumed: a non-default phrase becomes `genre`); otherwise
//         online/electronic/www/webpage -> webpage if url (organization/journal/
//         publisher/institution -> containerTitle), else generic;
//         misc -> webpage if url and no publisher (nor textual howpublished), else generic;
//         unpublished/manuscript -> manuscript (type -> genre)
//       software -> software, dataset -> dataset, manual -> generic, patent -> patent
//     Also: eprint + archiveprefix/eprinttype -> archive/archiveId (primaryclass
//     is not read); doi (strip https://doi.org/ prefix); url; year (int),
//     month (name or number -> 1-12), day; date (biblatex "2017-06-12") ->
//     year/month/day; urldate -> accessed; language/langid -> language;
//     title/booktitle: latexToUnicode but KEEP braces; everything else decoded
//     and brace-stripped. Preserve the citation key in `id`.
//     Also fills `version` (from a `version` field).
//
//   referenceToBibtex(ref) -> string
//     Inverse mapping, producing a tidy entry with a generated key like
//     `vaswani2017attention` (first author family lowercase + year + first
//     significant title word), escaping & % # _ $ (and a literal ~ as
//     \textasciitilde{}; nbsp -> ~), emitting year/month/day and language, and
//     protecting acronyms in title with braces: a whitespace token is braced
//     when one of its words (split like apa.js sentenceCase, i.e. at hyphens,
//     slashes, ...) has an uppercase letter after its first character ("GPT-4",
//     "ReLU", "LLMs"), so Title-Case compounds ("Zero-Shot") stay unprotected
//     and tokens starting with a control sequence ("\pi-Tuning") are left alone.
//     Name parts containing " and " or a comma are braced so they re-parse as
//     one person. manuscript -> @unpublished with note "Unpublished manuscript"
//     (or `type = {genre}` for another genre). Used by the URL tool. Honours an
//     optional `ref.primaryClass` (arXiv category) when emitting preprints.
//
//   parseBibtexToReferences(text) -> { references: Reference[], errors }
//     Convenience: parseBibtex + bibtexToReference on every entry.

import { makeReference, compactReference } from './model.js';

export {
  parseBibtex, latexToUnicode, stripBraces, parseNames, bibtexToReference,
  referenceToBibtex, parseBibtexToReferences,
};

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const MONTH_NAMES = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
]);

/** Standard BibTeX month macros -> full English month names. */
const MONTH_MACROS = Object.freeze(Object.fromEntries(
  MONTH_NAMES.map((m) => [m.slice(0, 3).toLowerCase(), m]),
));

const ARXIV_ID_SRC = '(\\d{4}\\.\\d{4,5}|[a-z\\-]+(?:\\.[a-z]{2})?\\/\\d{7})';
const ARXIV_ID_ONLY_RE = new RegExp(`^(?:arxiv:\\s*)?${ARXIV_ID_SRC}(?:v\\d+)?$`, 'i');
const ARXIV_MENTION_RES = [
  new RegExp(`arxiv[:\\s]\\s*${ARXIV_ID_SRC}(?:v\\d+)?`, 'i'),
  new RegExp(`arxiv\\.org\\/(?:abs|pdf|html)\\/${ARXIV_ID_SRC}(?:v\\d+)?`, 'i'),
  new RegExp(`10\\.48550\\/arxiv\\.${ARXIV_ID_SRC}(?:v\\d+)?`, 'i'),
];

const URL_LIKE_RE = /^[\s{]*(https?:\/\/|ftp:\/\/|www\.)/i;

// ---------------------------------------------------------------------------
// Small string helpers
// ---------------------------------------------------------------------------

/** Collapse runs of ASCII whitespace (not nbsp) to a single space and trim. */
function collapseSpace(s) {
  return s.replace(/[ \t\r\n\f\v]+/g, ' ').trim();
}

/** Decode LaTeX, strip braces, collapse whitespace. */
function cleanText(raw) {
  return collapseSpace(stripBraces(latexToUnicode(raw)));
}

/** Decode LaTeX but keep braces (titles). */
function cleanTitle(raw) {
  return collapseSpace(latexToUnicode(raw));
}

/**
 * Read a balanced `{...}` group starting at index `i` (which must be `{`).
 * Backslash-escaped braces do not count. Unbalanced input runs to the end.
 * @returns {{ inner: string, end: number }} end = index after the closing brace
 */
function readBalancedGroup(s, i) {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\') { k++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { inner: s.slice(i + 1, k), end: k + 1 };
    }
  }
  return { inner: s.slice(i + 1), end: s.length };
}

// ---------------------------------------------------------------------------
// parseBibtex
// ---------------------------------------------------------------------------

class BibParseError extends Error {
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

/** Coerce to string, drop BOM, normalise line endings. */
function normalizeInput(input) {
  if (input === null || input === undefined) return '';
  let text = String(input);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return text.replace(/\r\n?/g, '\n');
}

/** @returns {(pos:number)=>number} 1-based line number for a string offset */
function makeLineLocator(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Find the next `@` outside entries, skipping `%`-comment lines. */
function findNextAt(text, from) {
  const n = text.length;
  let i = from;
  let lineStart = i === 0 || text[i - 1] === '\n';
  while (i < n) {
    if (lineStart) {
      let j = i;
      while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
      if (text[j] === '%') {
        const nl = text.indexOf('\n', j);
        if (nl < 0) return -1;
        i = nl + 1;
        continue;
      }
      lineStart = false;
    }
    const ch = text[i];
    if (ch === '@') return i;
    if (ch === '\n') lineStart = true;
    i++;
  }
  return -1;
}

/** Parse `@type{` / `@type(`; null if this `@` does not start a block. */
function readEntryHead(text, at) {
  let p = at + 1;
  while (p < text.length && /[A-Za-z]/.test(text[p])) p++;
  const type = text.slice(at + 1, p).toLowerCase();
  if (!type) return null;
  while (p < text.length && /\s/.test(text[p])) p++;
  const open = text[p];
  if (open !== '{' && open !== '(') return null;
  return { type, open, close: open === '{' ? '}' : ')', openPos: p, bodyStart: p + 1 };
}

/** After an error: the next `@` that starts a line (whitespace allowed before it). */
function resync(text, from) {
  let i = text.indexOf('@', from);
  while (i >= 0) {
    let j = i - 1;
    while (j >= 0 && (text[j] === ' ' || text[j] === '\t')) j--;
    if (j < 0 || text[j] === '\n') return i;
    i = text.indexOf('@', i + 1);
  }
  return text.length;
}

function skipWs(cur) {
  while (cur.pos < cur.text.length && /\s/.test(cur.text[cur.pos])) cur.pos++;
}

function readToken(cur, re) {
  const start = cur.pos;
  while (cur.pos < cur.text.length && re.test(cur.text[cur.pos])) cur.pos++;
  return cur.text.slice(start, cur.pos);
}

/**
 * Brace-match table for the whole input, built lazily (once per parse) the
 * first time a scan runs off the end of the text. `match[i]` is the index of
 * the `}` closing the `{` at `i`, or -1. Uses the same escape rule as the
 * readers (a backslash hides the next character), so for every `{` the readers
 * are positioned at, the table agrees with their local scan. Well-formed input
 * never builds it; corrupted input pays one O(n) pass and then O(1) per
 * unbalanced entry instead of a scan to EOF each time.
 */
function braceMatches(cur) {
  if (cur.shared.braceMatch) return cur.shared.braceMatch;
  const { text } = cur;
  const match = new Int32Array(text.length).fill(-1);
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') stack.push(i);
    else if (ch === '}' && stack.length) match[stack.pop()] = i;
  }
  cur.shared.braceMatch = match;
  return match;
}

/** Read `{...}` at cur.pos; returns the inner text. */
function readBraced(cur) {
  const { text } = cur;
  const start = cur.pos;
  const table = cur.shared.braceMatch;
  if (table) {
    const end = table[start];
    if (end < 0) throw new BibParseError(`Unbalanced braces in entry "${cur.key}"`, start);
    cur.pos = end + 1;
    return text.slice(start + 1, end);
  }
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        cur.pos = i + 1;
        return text.slice(start + 1, i);
      }
    }
  }
  braceMatches(cur);
  throw new BibParseError(`Unbalanced braces in entry "${cur.key}"`, start);
}

/** Read `"..."` at cur.pos (braces may nest inside); returns the inner text. */
function readQuoted(cur) {
  const { text } = cur;
  const start = cur.pos;
  const table = cur.shared.braceMatch;
  let depth = 0;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') {
      if (table) {
        // An unmatched `{` can never let the scan return to depth 0.
        if (table[i] < 0) throw new BibParseError(`Unterminated quoted value in entry "${cur.key}"`, start);
        i = table[i];
        continue;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth < 0) throw new BibParseError(`Unbalanced braces in quoted value in entry "${cur.key}"`, start);
    } else if (ch === '"' && depth === 0) {
      cur.pos = i + 1;
      return text.slice(start + 1, i);
    }
  }
  braceMatches(cur);
  throw new BibParseError(`Unterminated quoted value in entry "${cur.key}"`, start);
}

const BARE_TOKEN_RE = /[^\s,#{}()"=]/;
const FIELD_NAME_RE = /[^\s,#{}()"=]/;

/** Read a field value: concatenation of braced / quoted / bare parts. */
function readValue(cur, macros) {
  const parts = [];
  for (;;) {
    skipWs(cur);
    const ch = cur.text[cur.pos];
    if (ch === '{') parts.push(readBraced(cur));
    else if (ch === '"') parts.push(readQuoted(cur));
    else {
      const tok = readToken(cur, BARE_TOKEN_RE);
      if (!tok) break;
      parts.push(/^\d+$/.test(tok) ? tok : (macros.get(tok.toLowerCase()) ?? tok));
    }
    skipWs(cur);
    if (cur.text[cur.pos] !== '#') break;
    cur.pos++;
  }
  return parts.join('');
}

/** Parse `name = value, ...` up to and including the closing delimiter. */
function readFields(cur, macros) {
  const fields = {};
  const { text } = cur;
  for (;;) {
    skipWs(cur);
    const ch = text[cur.pos];
    if (ch === undefined) throw new BibParseError(`Unexpected end of input inside entry "${cur.key}"`, cur.openPos);
    if (ch === cur.close) { cur.pos++; return fields; }
    if (ch === ',') { cur.pos++; continue; }
    const name = readToken(cur, FIELD_NAME_RE);
    if (!name) throw new BibParseError(`Unexpected character "${ch}" in entry "${cur.key}"`, cur.pos);
    skipWs(cur);
    if (text[cur.pos] !== '=') throw new BibParseError(`Expected "=" after field name "${name}" in entry "${cur.key}"`, cur.pos);
    cur.pos++;
    fields[name.toLowerCase()] = readValue(cur, macros);
    skipWs(cur);
    const after = text[cur.pos];
    if (after === ',') { cur.pos++; continue; }
    if (after === cur.close) { cur.pos++; return fields; }
    if (after === undefined) throw new BibParseError(`Unexpected end of input inside entry "${cur.key}"`, cur.openPos);
    if (/[A-Za-z_]/.test(after)) continue; // missing comma between fields: tolerate
    throw new BibParseError(`Expected "," or "${cur.close}" after field "${name}" in entry "${cur.key}"`, cur.pos);
  }
}

/** Skip the body of @comment / @preamble up to the matching close delimiter. */
function skipBody(cur) {
  const { text } = cur;
  const table = cur.shared.braceMatch;
  if (table && cur.close === '}') {
    // Same rule as the loop below, in O(local): the body ends at the first
    // `}` seen at body level, or right after the first body-level group.
    for (let i = cur.pos; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '{') {
        if (table[i] < 0) break;
        cur.pos = table[i] + 1;
        return;
      }
      if (ch === '}') { cur.pos = i + 1; return; }
    }
    throw new BibParseError('Unterminated @comment or @preamble', cur.openPos);
  }
  let depth = 0;
  for (let i = cur.pos; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth <= 0 && (ch === cur.close || (cur.close === ')' && ch === '}' && depth < 0))) {
      cur.pos = i + 1;
      return;
    }
  }
  braceMatches(cur);
  throw new BibParseError('Unterminated @comment or @preamble', cur.openPos);
}

/** Read the citation key (may be empty) and the following comma. */
function readKey(cur) {
  skipWs(cur);
  const { text } = cur;
  if (text[cur.pos] === cur.close) return '';
  const start = cur.pos;
  while (cur.pos < text.length && !/[\s,=]/.test(text[cur.pos]) && text[cur.pos] !== cur.close) cur.pos++;
  const key = text.slice(start, cur.pos);
  skipWs(cur);
  const ch = text[cur.pos];
  if (ch === '=') { cur.pos = start; return ''; } // no key: first token was a field name
  if (ch === ',') { cur.pos++; return key; }
  if (ch === cur.close || ch === undefined) return key;
  if (key && /[A-Za-z_]/.test(ch)) return key; // missing comma after key
  throw new BibParseError(`Expected "," after citation key "${key}"`, cur.pos);
}

/**
 * Parse a BibTeX database.
 * @param {string} input
 * @returns {{ entries: Array<{type:string,key:string,fields:Record<string,string>,raw:string}>, errors: Array<{message:string,line:number}> }}
 */
function parseBibtex(input) {
  const text = normalizeInput(input);
  const entries = [];
  const errors = [];
  const macros = new Map(Object.entries(MONTH_MACROS));
  const lineOf = makeLineLocator(text);
  const shared = { braceMatch: null }; // see braceMatches()
  let pos = 0;
  while (pos < text.length) {
    const at = findNextAt(text, pos);
    if (at < 0) break;
    const head = readEntryHead(text, at);
    if (!head) { pos = at + 1; continue; }
    const cur = { text, pos: head.bodyStart, close: head.close, openPos: head.openPos, key: '', shared };
    try {
      if (head.type === 'comment' || head.type === 'preamble') {
        skipBody(cur);
      } else if (head.type === 'string') {
        for (const [name, value] of Object.entries(readFields(cur, macros))) macros.set(name, value);
      } else {
        cur.key = readKey(cur);
        const fields = readFields(cur, macros);
        entries.push({ type: head.type, key: cur.key, fields, raw: text.slice(at, cur.pos) });
      }
      pos = cur.pos;
    } catch (e) {
      if (!(e instanceof BibParseError)) throw e;
      errors.push({ message: `${e.message} (line ${lineOf(e.pos)}; entry starts at line ${lineOf(at)})`, line: lineOf(e.pos) });
      pos = resync(text, at + 1);
    }
  }
  return { entries, errors };
}

// ---------------------------------------------------------------------------
// latexToUnicode / stripBraces
// ---------------------------------------------------------------------------

/** Accent command -> combining mark. */
const ACCENT_MARKS = Object.freeze({
  '"': '̈', "'": '́', '`': '̀', '^': '̂', '~': '̃',
  '=': '̄', '.': '̇', u: '̆', v: '̌', H: '̋', c: '̧',
  k: '̨', r: '̊', d: '̣', b: '̱', t: '͡',
});

/** What an accent with an empty argument produces (`\~{}` -> ~). */
const SPACING_ACCENTS = Object.freeze({
  '̈': '¨', '́': '´', '̀': '`', '̂': '^', '̃': '~',
  '̄': '¯', '̇': '˙', '̊': '˚', '̧': '¸',
});

/** Argument-less commands -> replacement text. */
const SYMBOLS = Object.freeze({
  o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', ss: 'ß', SS: 'SS', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ',
  aa: 'å', AA: 'Å', i: 'ı', j: 'ȷ', dh: 'ð', DH: 'Ð', th: 'þ', TH: 'Þ', ng: 'ŋ', NG: 'Ŋ',
  dj: 'đ', DJ: 'Đ',
  textendash: '–', textemdash: '—', textquotedblleft: '“', textquotedblright: '”',
  textquoteleft: '‘', textquoteright: '’', textquotesingle: "'", quotesinglbase: '‚',
  quotedblbase: '„', guillemotleft: '«', guillemotright: '»',
  ldots: '…', dots: '…', textellipsis: '…', cdots: '⋯',
  LaTeX: 'LaTeX', LaTeXe: 'LaTeX2e', TeX: 'TeX', BibTeX: 'BibTeX', XeTeX: 'XeTeX',
  textasciitilde: '~', textasciicircum: '^', textbackslash: '\\', textbar: '|',
  textless: '<', textgreater: '>', textunderscore: '_', textdollar: '$',
  textbraceleft: '\\{', textbraceright: '\\}', lbrace: '\\{', rbrace: '\\}',
  textregistered: '®', texttrademark: '™', copyright: '©', textcopyright: '©',
  textdegree: '°', degree: '°', pounds: '£', textsterling: '£', texteuro: '€', euro: '€',
  S: '§', P: '¶', dag: '†', ddag: '‡', textbullet: '•', textperiodcentered: '·',
  textminus: '−', times: '×', pm: '±', textpm: '±', textmu: 'µ', micro: 'µ',
  textquestiondown: '¿', textexclamdown: '¡', textordfeminine: 'ª', textordmasculine: 'º',
  quad: ' ', qquad: ' ', enspace: ' ', thinspace: ' ', space: ' ', newline: ' ',
  linebreak: ' ', newblock: ' ', par: ' ',
  relax: '', protect: '', noindent: '', em: '', bf: '', it: '', sc: '', rm: '', sl: '',
  tt: '', sf: '', tiny: '', small: '', large: '', Large: '', LARGE: '', huge: '', Huge: '',
  normalsize: '', footnotesize: '', scriptsize: '', boldmath: '', unboldmath: '',
});

/** Symbol commands after which TeX swallows following whitespace (`Stra\ss e`). */
const GOBBLE_SPACE = new Set([
  'o', 'O', 'l', 'L', 'ss', 'SS', 'ae', 'AE', 'oe', 'OE', 'aa', 'AA', 'i', 'j', 'dh', 'DH',
  'th', 'TH', 'ng', 'NG', 'dj', 'DJ', 'relax', 'protect', 'noindent', 'em', 'bf', 'it', 'sc',
  'rm', 'sl', 'tt', 'sf', 'tiny', 'small', 'large', 'Large', 'LARGE', 'huge', 'Huge',
  'normalsize', 'footnotesize', 'scriptsize', 'boldmath', 'unboldmath',
]);

/** Commands whose single braced argument is kept (decoded) and the command dropped. */
const WRAPPERS = new Set([
  'textit', 'emph', 'textbf', 'textsc', 'textsf', 'texttt', 'textrm', 'textup', 'textsl',
  'textnormal', 'textmd', 'textsuperscript', 'textsubscript', 'mbox', 'hbox', 'fbox',
  'underline', 'uppercase', 'lowercase', 'MakeUppercase', 'MakeLowercase', 'mathrm',
  'mathbf', 'mathit', 'mathcal', 'mathsf', 'mathtt', 'text', 'textnormal', 'ensuremath',
  'enquote', 'citetitle', 'mkbibquote', 'mkbibemph', 'mkbibitalic', 'mkbibbold',
]);

/** A braced group after optional whitespace, or null. */
function readGroupAfter(s, j) {
  let k = j;
  while (k < s.length && /\s/.test(s[k])) k++;
  if (s[k] !== '{') return null;
  return readBalancedGroup(s, k);
}

/** Apply a combining mark to the first code point of `base` and compose. */
function applyAccent(base, mark) {
  if (!base) return SPACING_ACCENTS[mark] ?? '';
  const cps = Array.from(base);
  let first = cps[0];
  if (first === 'ı') first = 'i';
  else if (first === 'ȷ') first = 'j';
  return (first + mark).normalize('NFC') + cps.slice(1).join('');
}

/** Read the argument of an accent command starting at index j. */
function readAccentArg(s, j, mark) {
  let k = j;
  while (k < s.length && /\s/.test(s[k])) k++;
  if (k >= s.length) return { text: applyAccent('', mark), end: k };
  if (s[k] === '{') {
    const g = readBalancedGroup(s, k);
    const inner = g.inner.trim();
    const dotless = /^\\([ij])$/.exec(inner);
    return { text: applyAccent(dotless ? dotless[1] : decodeLatex(inner), mark), end: g.end };
  }
  if (s[k] === '\\') {
    const dotless = /^\\([ij])(?![A-Za-z])/.exec(s.slice(k, k + 3));
    if (dotless) return { text: applyAccent(dotless[1], mark), end: k + 2 };
    const r = decodeCommand(s, k);
    return { text: applyAccent(r.text, mark), end: r.end };
  }
  const cp = String.fromCodePoint(s.codePointAt(k));
  return { text: applyAccent(cp, mark), end: k + cp.length };
}

/** Decode the control sequence starting at the backslash at index i. */
function decodeCommand(s, i) {
  const next = s[i + 1];
  if (next === undefined) return { text: '', end: i + 1 };
  if (/[A-Za-z]/.test(next)) {
    let j = i + 1;
    while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
    const name = s.slice(i + 1, j);
    if (s[j] === '*') j++;
    if (name.length === 1 && Object.hasOwn(ACCENT_MARKS, name)) return readAccentArg(s, j, ACCENT_MARKS[name]);
    if (name === 'url' || name === 'path' || name === 'nolinkurl') {
      const g = readGroupAfter(s, j);
      return g ? { text: g.inner.trim(), end: g.end } : { text: '', end: j };
    }
    if (name === 'href') {
      const g1 = readGroupAfter(s, j);
      if (!g1) return { text: '', end: j };
      const g2 = readGroupAfter(s, g1.end);
      return g2 ? { text: decodeLatex(g2.inner), end: g2.end } : { text: g1.inner.trim(), end: g1.end };
    }
    if (WRAPPERS.has(name)) {
      const g = readGroupAfter(s, j);
      return g ? { text: decodeLatex(g.inner), end: g.end } : { text: '', end: j };
    }
    if (Object.hasOwn(SYMBOLS, name)) {
      let end = j;
      if (s[end] === '{' && s[end + 1] === '}') end += 2;
      else if (GOBBLE_SPACE.has(name)) while (end < s.length && /\s/.test(s[end])) end++;
      return { text: SYMBOLS[name], end };
    }
    const opt = /^\s*\[[^\]]*\]/.exec(s.slice(j));
    const argStart = opt ? j + opt[0].length : j;
    const g = readGroupAfter(s, argStart);
    return g ? { text: decodeLatex(g.inner), end: g.end } : { text: '', end: argStart };
  }
  if (Object.hasOwn(ACCENT_MARKS, next)) return readAccentArg(s, i + 2, ACCENT_MARKS[next]);
  switch (next) {
    case '&': case '%': case '$': case '_': case '#':
      return { text: next, end: i + 2 };
    case '{': case '}':
      return { text: `\\${next}`, end: i + 2 };
    case '\\': case ',': case ';': case ':': case ' ': case '\n': case '\t':
      return { text: ' ', end: i + 2 };
    case '!': case '-': case '/': case '@':
      return { text: '', end: i + 2 };
    default:
      return { text: next, end: i + 2 };
  }
}

/** Inline math starting at `$`; null if unterminated. */
function readMath(s, i) {
  const double = s[i + 1] === '$';
  const open = double ? 2 : 1;
  let k = i + open;
  while (k < s.length) {
    if (s[k] === '\\') { k += 2; continue; }
    if (s[k] === '$' && (!double || s[k + 1] === '$')) {
      return { text: s.slice(i + open, k), end: k + open };
    }
    k++;
  }
  return null;
}

/** Core decoder (no URL check, no normalisation). */
function decodeLatex(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === '\\') {
      const r = decodeCommand(s, i);
      out += r.text;
      i = r.end;
    } else if (ch === '$') {
      const r = readMath(s, i);
      if (r) { out += r.text; i = r.end; } else { out += ch; i++; }
    } else if (ch === '-' && s[i + 1] === '-') {
      if (s[i + 2] === '-') { out += '—'; i += 3; } else { out += '–'; i += 2; }
    } else if (ch === '`') {
      if (s[i + 1] === '`') { out += '“'; i += 2; } else { out += '‘'; i++; }
    } else if (ch === "'") {
      if (s[i + 1] === "'") { out += '”'; i += 2; } else { out += '’'; i++; }
    } else if (ch === '~') {
      out += ' ';
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const HTML_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });
const HTML_ENTITY_RE = /&(?:(amp|lt|gt|quot|apos|nbsp)|#(\d{1,7})|#x([0-9a-f]{1,6}));/gi;

/**
 * Decode the HTML entities some exporters leave in BibTeX values (Crossref's
 * x-bibtex emits `Knowledge Discovery &amp; Data Mining`). Only the explicit
 * named set and numeric references are decoded; other `&name;` text is kept.
 */
function decodeHtmlEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(HTML_ENTITY_RE, (m, name, dec, hex) => {
    if (name) return HTML_ENTITIES[name.toLowerCase()];
    const cp = dec ? Number(dec) : parseInt(hex, 16);
    return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : m;
  });
}

/**
 * Decode LaTeX markup to Unicode (NFC). Braces are kept; `\{` `\}` stay escaped.
 * @param {string} input
 * @returns {string}
 */
function latexToUnicode(input) {
  if (input === null || input === undefined) return '';
  const s = String(input);
  if (URL_LIKE_RE.test(s)) return s;
  return decodeLatex(decodeHtmlEntities(s)).normalize('NFC');
}

/**
 * Remove unescaped braces; turn `\{` `\}` into literal braces.
 * @param {string} input
 * @returns {string}
 */
function stripBraces(input) {
  if (input === null || input === undefined) return '';
  const s = String(input);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && (s[i + 1] === '{' || s[i + 1] === '}')) { out += s[i + 1]; i++; continue; }
    if (ch === '{' || ch === '}') continue;
    out += ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// parseNames
// ---------------------------------------------------------------------------

const AND_RE = /\s+and\s+/iy;

/** Split an author field on " and " at brace depth 0. */
function splitNames(s) {
  const names = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(ch)) {
      AND_RE.lastIndex = i;
      const m = AND_RE.exec(s);
      if (m) {
        names.push(s.slice(start, i));
        i += m[0].length;
        start = i;
        continue;
      }
    }
    i++;
  }
  names.push(s.slice(start));
  return names.map((x) => x.trim()).filter(Boolean);
}

/** Split on a separator character at brace depth 0. */
function splitDepth0(s, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === sep) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** Whitespace-separated words at depth 0 (brace groups are single words). */
function tokenizeWords(s) {
  const words = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { cur += ch + (s[i + 1] ?? ''); i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) words.push(cur);
  return words;
}

/** Is the whole string one brace group, e.g. "{Barnes and Noble}"? */
function isWholeGroup(s) {
  return s[0] === '{' && readBalancedGroup(s, 0).end === s.length;
}

/** BibTeX "von" test: first letter at depth 0 is lowercase. Brace-led words are caseless. */
function isLowerWord(word) {
  if (word[0] === '{' && word[1] !== '\\') return false;
  const plain = stripBraces(latexToUnicode(word));
  const m = /\p{L}/u.exec(plain);
  return m ? /\p{Ll}/u.test(m[0]) : false;
}

/** Build a Name object, dropping empty parts. */
function nameObj({ family, given, particle, suffix }) {
  const out = {};
  const f = cleanText(family ?? '');
  const g = cleanText(given ?? '');
  const p = cleanText(particle ?? '');
  const sfx = cleanText(suffix ?? '');
  if (f) out.family = f;
  if (g) out.given = g;
  if (p) out.particle = p;
  if (sfx) out.suffix = sfx;
  if (!out.family && !out.given) return null;
  if (!out.family && out.given) {
    out.family = out.given;
    delete out.given;
  }
  return out;
}

/** "First von Last" form. */
function fromFirstVonLast(words) {
  if (words.length === 0) return null;
  if (words.length === 1) return nameObj({ family: words[0] });
  let vonStart = -1;
  for (let i = 0; i < words.length - 1; i++) {
    if (isLowerWord(words[i])) { vonStart = i; break; }
  }
  if (vonStart < 0) {
    return nameObj({ given: words.slice(0, -1).join(' '), family: words[words.length - 1] });
  }
  let vonEnd = vonStart;
  for (let i = words.length - 2; i > vonStart; i--) {
    if (isLowerWord(words[i])) { vonEnd = i; break; }
  }
  return nameObj({
    given: words.slice(0, vonStart).join(' '),
    particle: words.slice(vonStart, vonEnd + 1).join(' '),
    family: words.slice(vonEnd + 1).join(' '),
  });
}

/** "von Last" part of the comma forms -> { particle, family }. */
function splitVonLast(words) {
  let i = 0;
  while (i < words.length - 1 && isLowerWord(words[i])) i++;
  return { particle: words.slice(0, i).join(' '), family: words.slice(i).join(' ') };
}

/** Parse one name (no "and"). */
function parseSingleName(raw) {
  let s = raw.trim();
  if (!s) return null;
  if (/^others$/i.test(s)) return { literal: 'others' };
  s = s.replace(/(?<!\\)~/g, ' ');
  if (isWholeGroup(s)) {
    const literal = cleanText(s);
    return literal ? { literal } : null;
  }
  const parts = splitDepth0(s, ',').map((p) => p.trim());
  if (parts.length === 1) return fromFirstVonLast(tokenizeWords(parts[0]));
  const [lastPart, ...rest] = parts;
  const suffix = rest.length > 1 ? rest[0] : '';
  const given = rest.length > 1 ? rest.slice(1).filter(Boolean).join(', ') : rest[0];
  const { particle, family } = splitVonLast(tokenizeWords(lastPart));
  return nameObj({ family, given, particle, suffix });
}

/**
 * Parse a BibTeX author/editor field.
 * @param {string} input
 * @returns {import('./model.js').Name[]}
 */
function parseNames(input) {
  if (input === null || input === undefined) return [];
  const s = String(input).replace(/\\newline\b/g, ' ').replace(/^\s*and\s+/i, '').replace(/\s+and\s*$/i, '');
  return splitNames(s).map(parseSingleName).filter(Boolean);
}

// ---------------------------------------------------------------------------
// bibtexToReference
// ---------------------------------------------------------------------------

const BIB_TYPE_TO_REF = Object.freeze({
  article: 'article-journal', inproceedings: 'paper-conference', conference: 'paper-conference',
  book: 'book', booklet: 'book', proceedings: 'book', collection: 'book',
  incollection: 'chapter', inbook: 'chapter', inreference: 'chapter',
  phdthesis: 'thesis', mastersthesis: 'thesis', thesis: 'thesis',
  techreport: 'report', report: 'report',
  software: 'software', dataset: 'dataset', manual: 'generic', patent: 'patent',
  misc: 'generic', unpublished: 'manuscript', online: 'webpage', electronic: 'webpage',
  www: 'webpage', webpage: 'webpage', manuscript: 'manuscript',
});

const MISC_LIKE = new Set(['misc', 'unpublished', 'online', 'electronic', 'www', 'webpage', 'manuscript']);

/** Month text ("jun", "June", "6", "Dec.", "June 12") -> { month, day }. */
function parseMonthField(text) {
  if (!text) return {};
  const t = text.toLowerCase();
  const num = /^\s*(\d{1,2})\s*$/.exec(t);
  if (num) {
    const m = Number(num[1]);
    return m >= 1 && m <= 12 ? { month: m } : {};
  }
  const word = /([a-z]{3,})/.exec(t);
  if (!word) return {};
  const idx = MONTH_NAMES.findIndex((name) => name.toLowerCase().startsWith(word[1].slice(0, 3)));
  if (idx < 0) return {};
  const out = { month: idx + 1 };
  const day = /\b(\d{1,2})\b/.exec(t);
  if (day && Number(day[1]) >= 1 && Number(day[1]) <= 31) out.day = Number(day[1]);
  return out;
}

/** Index of a month name (full or abbreviated), 1-12, or 0. */
function monthFromWord(word) {
  const w = word.toLowerCase().slice(0, 3);
  const idx = MONTH_NAMES.findIndex((name) => name.toLowerCase().startsWith(w));
  return idx + 1;
}

/**
 * Parse a free-form date ("2017-06-12", "2017/06", "12 June 2024",
 * "Dec. 1, 2023", "12-June-2024", "2017") -> { year, month, day }.
 */
function parseDateParts(text) {
  if (!text) return {};
  const t = text.trim();
  let m = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?(?![\d])/.exec(t);
  if (m) return pickDate(m[1], m[2], m[3]);
  m = /(\d{1,2})(?:st|nd|rd|th)?[\s\-.,]+([A-Za-z]{3,})\.?[\s\-.,]+(\d{4})/.exec(t);
  if (m && monthFromWord(m[2])) return pickDate(m[3], monthFromWord(m[2]), m[1]);
  m = /([A-Za-z]{3,})\.?[\s\-.,]+(\d{1,2})(?:st|nd|rd|th)?[\s\-.,]+(\d{4})/.exec(t);
  if (m && monthFromWord(m[1])) return pickDate(m[3], monthFromWord(m[1]), m[2]);
  m = /([A-Za-z]{3,})\.?[\s\-.,]+(\d{4})/.exec(t);
  if (m && monthFromWord(m[1])) return pickDate(m[2], monthFromWord(m[1]));
  m = /(\d{4})/.exec(t);
  return m ? pickDate(m[1]) : {};
}

function pickDate(y, mo, d) {
  const out = { year: Number(y) };
  const month = Number(mo);
  const day = Number(d);
  if (mo !== undefined && month >= 1 && month <= 12) out.month = month;
  if (out.month && d !== undefined && day >= 1 && day <= 31) out.day = day;
  return out;
}

/** { year, month, day } -> "YYYY-MM-DD" (or shorter when parts are missing). */
function toIsoDate({ year, month, day }) {
  if (!year) return '';
  const pad = (n) => String(n).padStart(2, '0');
  if (month && day) return `${year}-${pad(month)}-${pad(day)}`;
  if (month) return `${year}-${pad(month)}`;
  return String(year);
}

/** Pages "4171--4186" -> "4171-4186"; "pp. 1–5" -> "1-5"; "e0123" untouched. */
function normalizePages(text) {
  if (!text) return undefined;
  return text.replace(/^pp?\.?\s*/i, '').replace(/\s*[-‐-―−]+\s*/g, '-').trim();
}

/** Minimal decoding for identifiers (DOI, URL, eprint): no accent/quote rules. */
function cleanIdentifier(raw) {
  if (raw === undefined) return undefined;
  let s = String(raw).trim();
  s = s.replace(/\\(?:url|href|path|nolinkurl)\s*\{([^}]*)\}/g, '$1');
  s = stripBraces(s.replace(/\\([&%$_#])/g, '$1').replace(/\\~\{\}/g, '~'));
  return collapseSpace(s);
}

function cleanDoi(raw) {
  const s = cleanIdentifier(raw);
  if (!s) return undefined;
  const doi = s.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
  return doi || undefined;
}

function cleanUrl(raw) {
  const s = cleanIdentifier(raw);
  if (!s) return undefined;
  const first = s.split(/\s+/)[0];
  return first || undefined;
}

/** Extract an arXiv id mentioned in free text, without version suffix. */
function extractArxivId(text) {
  if (!text) return undefined;
  for (const re of ARXIV_MENTION_RES) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return undefined;
}

function normalizeArxivId(text) {
  const m = ARXIV_ID_ONLY_RE.exec(text.trim());
  return m ? m[1] : text.trim().replace(/^arxiv:\s*/i, '');
}

/** Detect eprint archive information. */
function detectArchive({ eprint, prefix, journal, volume, howpublished, note, url, doi }) {
  if (eprint) {
    if ((prefix && prefix.toLowerCase() === 'arxiv') || ARXIV_ID_ONLY_RE.test(eprint)) {
      return { archive: 'arXiv', archiveId: normalizeArxivId(eprint) };
    }
    if (prefix) return { archive: prefix, archiveId: eprint };
  }
  for (const v of [journal, howpublished, note, url, doi]) {
    const id = extractArxivId(v);
    if (id) return { archive: 'arXiv', archiveId: id };
  }
  if (journal && /^(arxiv|corr)$/i.test(journal) && volume) {
    const bare = volume.replace(/^abs\//i, '');
    if (ARXIV_ID_ONLY_RE.test(bare)) return { archive: 'arXiv', archiveId: normalizeArxivId(bare) };
  }
  return null;
}

/** Genre for thesis entries. */
function thesisGenre(bibType, typeField) {
  if (typeField) {
    const t = typeField.toLowerCase();
    if (/^(phdthesis|phd thesis|doctoral)/.test(t) && t.length < 20) return 'Doctoral dissertation';
    if (/^(mathesis|master'?s thesis|master’s thesis)$/.test(t)) return "Master's thesis";
    return typeField;
  }
  if (bibType === 'mastersthesis') return "Master's thesis";
  if (bibType === 'phdthesis') return 'Doctoral dissertation';
  return 'Thesis';
}

/** Interpret the note field: accessed date / software marker / plain note. */
function interpretNote(note) {
  if (!note) return {};
  const out = {};
  let rest = note;
  const acc = /^\[?(?:online)?[;.,]?\s*(?:accessed|retrieved|visited|viewed|last accessed)[:\s]+(?:on\s+)?(.+?)\]?\.?$/i.exec(rest);
  if (acc) {
    const parts = parseDateParts(acc[1]);
    if (parts.year) {
      out.accessed = toIsoDate(parts);
      rest = '';
    }
  }
  const marker = /^(.*?)\s*\[?\b(computer software|software|data ?set)\b\]?\.?$/i.exec(rest);
  if (marker && (marker[1] === '' || /\[/.test(rest))) {
    out.kind = /data/i.test(marker[2]) ? 'dataset' : 'software';
    rest = marker[1].replace(/[.;,]\s*$/, '');
  }
  const manuscript = MANUSCRIPT_NOTE_RE.exec(rest);
  if (manuscript) {
    // The whole note is a manuscript-status phrase: it is the kind (and, when
    // not the APA default, the genre). The caller drops it from `note` when
    // the entry resolves to a manuscript; other types keep it as a note.
    out.kind = 'manuscript';
    const phrase = manuscript[1].replace(/\s+/g, ' ');
    if (!isDefaultManuscriptGenre(phrase)) out.genre = phrase[0].toUpperCase() + phrase.slice(1);
  }
  if (rest) out.note = rest;
  return out;
}

const DEFAULT_MANUSCRIPT_GENRE = 'Unpublished manuscript';
const MANUSCRIPT_NOTE_RE = /^\[?(unpublished manuscript|manuscript (?:in preparation|submitted for publication|under review)|in preparation|submitted for publication|under review)\]?\.?$/i;

function isDefaultManuscriptGenre(genre) {
  return String(genre).trim().toLowerCase() === DEFAULT_MANUSCRIPT_GENRE.toLowerCase();
}

/**
 * Convert a parsed BibTeX entry into a Reference.
 * @param {{type:string,key:string,fields:Record<string,string>}} entry
 * @returns {import('./model.js').Reference}
 */
function bibtexToReference(entry) {
  const fields = {};
  for (const [k, v] of Object.entries((entry && entry.fields) || {})) fields[k.toLowerCase()] = v;
  const raw = (...names) => {
    for (const n of names) {
      const v = fields[n];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
    return undefined;
  };
  const txt = (...names) => { const v = raw(...names); return v === undefined ? undefined : cleanText(v); };
  const ttl = (...names) => { const v = raw(...names); return v === undefined ? undefined : cleanTitle(v); };
  const bibType = String((entry && entry.type) || 'misc').toLowerCase();

  const ref = makeReference();
  if (entry && entry.key) ref.id = String(entry.key);
  ref.author = parseNames(raw('author'));
  const editors = parseNames(raw('editor'));
  if (editors.length) ref.editor = editors;

  const title = ttl('title');
  const subtitle = ttl('subtitle');
  ref.title = title && subtitle ? `${title}: ${subtitle}` : (title || subtitle);

  // Dates
  const date = parseDateParts(txt('date'));
  const yearMatch = /(\d{4})/.exec(txt('year') || '');
  const monthInfo = parseMonthField(txt('month'));
  ref.year = yearMatch ? Number(yearMatch[1]) : date.year;
  ref.month = monthInfo.month ?? date.month;
  const dayField = /(\d{1,2})/.exec(txt('day') || '');
  ref.day = dayField ? Number(dayField[1]) : (monthInfo.day ?? date.day);
  const urldate = parseDateParts(txt('urldate'));
  if (urldate.year) ref.accessed = toIsoDate(urldate);
  else if (raw('urldate')) ref.accessed = txt('urldate');

  // Identifiers
  let doi = cleanDoi(raw('doi'));
  let url = cleanUrl(raw('url'));
  const howRaw = raw('howpublished');
  const howAsUrl = howRaw && URL_LIKE_RE.test(cleanIdentifier(howRaw)) ? cleanUrl(howRaw) : undefined;
  const howText = howRaw && !howAsUrl ? txt('howpublished') : undefined;
  const howPublisher = howText && !/^\[?online\]?$/i.test(howText) ? howText : undefined;
  if (!url && howAsUrl) url = howAsUrl;
  if (!doi && url) {
    const m = /doi\.org\/(10\.\S+)/i.exec(url);
    if (m) doi = m[1];
  }

  const journal = txt('journal', 'journaltitle');
  const booktitle = ttl('booktitle', 'maintitle');
  const series = txt('series');
  const publisher = txt('publisher');
  const organization = txt('organization');
  const address = txt('address', 'location');
  const institution = txt('institution');
  const school = txt('school');
  const volume = txt('volume');
  const number = txt('number');
  const issue = txt('issue');
  const pages = normalizePages(txt('pages'));
  const articleNumber = txt('articleno', 'eid', 'article-number');
  const edition = txt('edition');
  const typeField = txt('type');
  const noteInfo = interpretNote(txt('note'));
  const version = txt('version');

  const archive = detectArchive({
    eprint: txt('eprint'), prefix: txt('archiveprefix', 'eprinttype'), journal, volume,
    howpublished: howText, note: txt('note'), url, doi,
  });

  // Type resolution
  let type = BIB_TYPE_TO_REF[bibType] || 'generic';
  const arxivJournal = journal && /\barxiv\b|^corr$/i.test(journal);
  if (bibType === 'article' && (arxivJournal || (!journal && archive && archive.archive === 'arXiv'))) {
    type = 'preprint';
  } else if (MISC_LIKE.has(bibType)) {
    const hasUrl = Boolean(url);
    const hasPublisher = Boolean(publisher || howPublisher);
    if (archive || arxivJournal) type = 'preprint';
    else if (noteInfo.kind) type = noteInfo.kind;
    else if (type === 'webpage') type = hasUrl ? 'webpage' : 'generic';
    else if (type === 'manuscript') type = 'manuscript';
    else type = hasUrl && !hasPublisher ? 'webpage' : 'generic';
  }
  ref.type = type;

  switch (type) {
    case 'article-journal':
      Object.assign(ref, {
        containerTitle: journal, volume, issue: number || issue, page: pages, articleNumber,
        publisher, publisherPlace: address,
      });
      break;
    case 'preprint':
      if (publisher && !(archive && publisher.toLowerCase() === archive.archive.toLowerCase())) ref.publisher = publisher;
      if (!archive && journal && !arxivJournal) ref.containerTitle = journal;
      break;
    case 'paper-conference':
      Object.assign(ref, {
        containerTitle: booktitle || journal, collectionTitle: series, volume, issue: number || issue,
        page: pages, articleNumber, publisher: publisher || organization, publisherPlace: address,
      });
      break;
    case 'book':
      Object.assign(ref, {
        publisher: publisher || organization, publisherPlace: address, edition, volume,
        collectionTitle: series,
      });
      break;
    case 'chapter':
      Object.assign(ref, {
        containerTitle: booktitle, collectionTitle: series, volume, page: pages,
        publisher: publisher || organization, publisherPlace: address, edition,
      });
      break;
    case 'thesis':
      Object.assign(ref, {
        institution: school || institution, genre: thesisGenre(bibType, typeField), publisherPlace: address,
      });
      break;
    case 'report':
      Object.assign(ref, {
        institution: institution || school || organization, number, genre: typeField || 'Technical report',
        publisherPlace: address,
      });
      break;
    case 'patent':
      Object.assign(ref, {
        number, genre: typeField, publisher: txt('assignee', 'holder') || publisher, publisherPlace: address,
      });
      break;
    case 'software':
    case 'dataset':
      Object.assign(ref, { publisher: publisher || organization || institution || howPublisher, publisherPlace: address });
      break;
    case 'webpage':
      Object.assign(ref, { containerTitle: organization || journal || publisher || institution });
      break;
    case 'manuscript':
      Object.assign(ref, { genre: typeField || noteInfo.genre, publisherPlace: address });
      break;
    default:
      Object.assign(ref, {
        containerTitle: journal || booktitle, volume, issue: number || issue, page: pages,
        publisher: publisher || howPublisher || organization || institution, publisherPlace: address,
        edition, genre: typeField,
      });
  }

  if (doi) ref.doi = doi;
  if (url) ref.url = url;
  if (archive) {
    ref.archive = archive.archive;
    ref.archiveId = archive.archiveId;
  }
  if (noteInfo.accessed && !ref.accessed) ref.accessed = noteInfo.accessed;
  // A manuscript-status note is represented by the type/genre, not repeated as a note.
  if (noteInfo.note && !(type === 'manuscript' && noteInfo.kind === 'manuscript')) ref.note = noteInfo.note;
  ref.language = txt('language', 'langid');
  if (version) ref.version = version;
  return compactReference(ref);
}

// ---------------------------------------------------------------------------
// referenceToBibtex
// ---------------------------------------------------------------------------

const KEY_STOPWORDS = new Set([
  'a', 'an', 'the', 'on', 'of', 'for', 'in', 'to', 'and', 'with', 'towards', 'toward', 'is',
  'are', 'do', 'does', 'how', 'what', 'why', 'when', 'at', 'by', 'from', 'into', 'about', 'via',
]);

const ASCII_FOLD = Object.freeze({
  'ß': 'ss', 'ø': 'o', 'Ø': 'O', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ł': 'l', 'Ł': 'L',
  'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th', 'ı': 'i',
});

/** Lowercase ASCII letters/digits only, for citation keys. */
function asciiKeyPart(s) {
  return Array.from(stripBraces(s || ''))
    .map((c) => ASCII_FOLD[c] ?? c)
    .join('')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** First significant title word (lowercase ASCII) for the key. */
function firstSignificantWord(title) {
  const words = stripBraces(title || '').split(/[^\p{L}\p{N}]+/u).map(asciiKeyPart).filter(Boolean);
  return words.find((w) => !KEY_STOPWORDS.has(w)) || words[0] || '';
}

function makeKey(ref) {
  const first = Array.isArray(ref.author) ? ref.author[0] : undefined;
  const who = first ? asciiKeyPart(first.family || first.literal || first.given || '') : '';
  const year = Number.isFinite(ref.year) ? String(ref.year) : '';
  const word = firstSignificantWord(ref.title);
  const key = who ? `${who}${year}${word}` : `${word}${year}`;
  return key || 'ref';
}

/**
 * Escape BibTeX special characters in a plain-text value: & % # _ $ get a
 * backslash (already-escaped ones are left alone), a literal ~ becomes
 * \textasciitilde{} and nbsp -> ~. A bare backslash is NOT escaped: values
 * legitimately carry control sequences left by math (`\pi`) and `\{` `\}`.
 */
function bibEscape(s) {
  return String(s)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/ /g, '~')
    .replace(/(?<!\\)([&%#_$])/g, '\\$1');
}

/** Word segmentation shared with apa.js sentenceCase (keep the two in sync). */
const WORD_RE = /[\p{L}\p{N}](?:[\p{L}\p{N}'’]|\.(?=[\p{L}\p{N}]))*/gu;

/** Does a word (as apa.js sentenceCase sees it) have an uppercase letter after its first character? */
function hasInternalCapital(word) {
  return /\p{Lu}/u.test(Array.from(word).slice(1).join(''));
}

/**
 * Wrap tokens that sentence-casing would damage in braces, leaving existing
 * groups alone. A whitespace-delimited token is protected when one of its
 * words has an inner capital ("GPT-4", "ReLU", "LLMs", "BERT-base", "AI/ML");
 * Title-Case compounds ("Zero-Shot", "Coarse-to-Fine") are left alone because
 * apa.js treats their hyphen-separated parts as separate words and lowercases
 * them. Leading punctuation stays outside the braces; a token whose core
 * starts with a control sequence ("\pi-Tuning") is returned unchanged so no
 * brace is ever inserted right after a backslash.
 */
function protectTitle(title) {
  if (!title) return title;
  const tokens = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < title.length; i++) {
    const ch = title[i];
    if (ch === '\\') { cur += ch + (title[i + 1] ?? ''); i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) tokens.push(cur);
      tokens.push(ch);
      cur = '';
    } else cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens.map((tok) => {
    if (/\s/.test(tok) || /[{}]/.test(tok)) return tok;
    // The prefix group never swallows a backslash, so `\pi-Tuning` keeps its
    // control sequence in the core (and is then skipped) instead of becoming `\{pi-Tuning}`.
    const m = /^([^\p{L}\p{N}\\]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(tok);
    const core = m[2];
    if (!core || core.startsWith('\\')) return tok;
    const needsProtection = [...core.matchAll(WORD_RE)].some((w) => hasInternalCapital(w[0]));
    return needsProtection ? `${m[1]}{${core}}${m[3]}` : tok;
  }).join('');
}

/** Name -> "von Last, Jr., First" / "{Literal}". */
function formatBibName(n) {
  if (!n || typeof n !== 'object') return '';
  if (n.literal) return /^others$/i.test(n.literal.trim()) ? 'others' : `{${bibEscape(n.literal)}}`;
  // A part containing " and " or a comma must be braced or it re-parses as two people / wrong form.
  const guard = (s) => (/(^|[\s~])and([\s~]|$)/i.test(s) || s.includes(',') ? `{${s}}` : s);
  let family = n.family ? guard(bibEscape(n.family)) : '';
  if (family && /^\p{Ll}/u.test(family.trim())) family = `{${family}}`;
  const vonLast = [n.particle ? guard(bibEscape(n.particle)) : '', family].filter(Boolean).join(' ');
  const given = n.given ? guard(bibEscape(n.given)) : '';
  if (!vonLast) return given;
  const parts = [vonLast];
  if (n.suffix) parts.push(guard(bibEscape(n.suffix)));
  if (given) parts.push(given);
  return parts.join(', ');
}

/** "4171-4186" -> "4171--4186" (only between alphanumerics). */
function pagesToBib(page) {
  return String(page).replace(/(?<=[\p{L}\p{N}])\s*[-‐-―−]+\s*(?=[\p{L}\p{N}])/gu, '--');
}

function bibTypeFor(ref) {
  switch (ref.type) {
    case 'article-journal': return 'article';
    case 'paper-conference': return 'inproceedings';
    case 'book': return 'book';
    case 'chapter': return 'incollection';
    case 'thesis': return /master/i.test(ref.genre || '') ? 'mastersthesis' : 'phdthesis';
    case 'report': return 'techreport';
    case 'patent': return 'patent';
    case 'manuscript': return 'unpublished';
    default: return 'misc';
  }
}

/**
 * Serialise a Reference as a BibTeX entry.
 * @param {import('./model.js').Reference} ref
 * @returns {string}
 */
function referenceToBibtex(ref) {
  const r = ref && typeof ref === 'object' ? ref : {};
  const type = bibTypeFor(r);
  const authors = Array.isArray(r.author) ? r.author : [];
  const editors = Array.isArray(r.editor) ? r.editor : [];
  const isArxiv = r.archive && /^arxiv$/i.test(r.archive);
  const fields = [];
  const add = (name, value, opts = {}) => {
    if (value === undefined || value === null) return;
    const s = String(value).trim();
    if (!s) return;
    fields.push([name, opts.verbatim ? s : bibEscape(s), opts.bare === true]);
  };
  const text = (names) => names.map(formatBibName).filter(Boolean).join(' and ');

  add('author', text(authors));
  add('editor', text(editors));
  add('title', protectTitle(r.title));

  switch (type) {
    case 'article':
      add('journal', r.containerTitle);
      add('volume', r.volume);
      add('number', r.issue);
      add('pages', r.page ? pagesToBib(r.page) : r.articleNumber);
      break;
    case 'inproceedings':
    case 'incollection':
      add('booktitle', protectTitle(r.containerTitle));
      add('series', r.collectionTitle);
      add('volume', r.volume);
      add('number', r.issue);
      add('pages', r.page ? pagesToBib(r.page) : r.articleNumber);
      break;
    case 'book':
      add('series', r.collectionTitle);
      add('volume', r.volume);
      break;
    case 'techreport':
      add('number', r.number);
      break;
    case 'patent':
      add('number', r.number);
      break;
    default:
      if (r.type === 'preprint') {
        if (isArxiv && r.archiveId) add('journal', `arXiv preprint arXiv:${r.archiveId}`);
      } else if (r.type !== 'webpage') {
        add('journal', r.containerTitle);
        add('volume', r.volume);
        add('number', r.issue || r.number);
        if (r.page) add('pages', pagesToBib(r.page));
      }
  }

  add('year', Number.isFinite(r.year) ? r.year : undefined);
  if (Number.isInteger(r.month) && r.month >= 1 && r.month <= 12) {
    add('month', MONTH_NAMES[r.month - 1].slice(0, 3).toLowerCase(), { bare: true });
    // `day` (read back by bibtexToReference and understood by biblatex) keeps
    // web-page dates like "(2023, March 27)" intact; classic styles ignore it.
    if (Number.isInteger(r.day) && r.day >= 1 && r.day <= 31) add('day', r.day);
  }

  if (type === 'misc' && r.type === 'webpage') {
    add('organization', r.containerTitle);
  } else if (type === 'misc' && r.type === 'preprint') {
    if (r.publisher && !(isArxiv && /^arxiv$/i.test(r.publisher))) add('publisher', r.publisher);
    else if (r.archive && !isArxiv && !r.publisher) add('publisher', r.archive);
  } else if (!['phdthesis', 'mastersthesis', 'techreport'].includes(type)) {
    add('publisher', r.publisher);
  }
  add('address', r.publisherPlace);
  if (type === 'techreport') add('institution', r.institution);
  if (type === 'phdthesis' || type === 'mastersthesis') {
    add('school', r.institution);
    const defaultGenre = type === 'phdthesis' ? 'Doctoral dissertation' : "Master's thesis";
    if (r.genre && r.genre !== defaultGenre) add('type', r.genre);
  } else if (type === 'techreport') {
    if (r.genre && r.genre !== 'Technical report') add('type', r.genre);
  } else if (type === 'patent') {
    add('type', r.genre);
  } else if (type === 'unpublished') {
    if (r.genre && !isDefaultManuscriptGenre(r.genre)) add('type', r.genre);
  }
  add('edition', r.edition);
  add('version', r.version);
  add('language', r.language);
  add('doi', r.doi, { verbatim: true });
  if (r.type !== 'webpage') add('url', r.url, { verbatim: true });
  if (r.type === 'preprint' && r.archiveId) {
    add('eprint', r.archiveId, { verbatim: true });
    add('archivePrefix', r.archive || 'arXiv');
    if (isArxiv) add('primaryClass', r.primaryClass);
  }
  if (r.type === 'webpage' && r.url) add('howpublished', `\\url{${r.url}}`, { verbatim: true });

  let note = r.note || '';
  if (r.type === 'webpage' && r.accessed) note = [note, `Accessed: ${r.accessed}`].filter(Boolean).join('. ');
  if (r.type === 'software') note = note ? `${note} [Computer software]` : 'Computer software';
  if (r.type === 'dataset') note = note ? `${note} [Data set]` : 'Data set';
  // The default genre travels as the standard @unpublished note; a non-default
  // genre is already emitted as `type`, so no note is invented for it.
  if (type === 'unpublished' && !note && !(r.genre && !isDefaultManuscriptGenre(r.genre))) note = DEFAULT_MANUSCRIPT_GENRE;
  add('note', note);
  add('urldate', r.accessed, { verbatim: true });

  const lines = fields.map(([name, value, bare]) => `  ${name} = ${bare ? value : `{${value}}`}`);
  return `@${type}{${makeKey(r)},\n${lines.join(',\n')}\n}`;
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/**
 * Parse BibTeX text straight into References.
 * @param {string} text
 * @returns {{ references: import('./model.js').Reference[], errors: Array<{message:string,line:number}> }}
 */
function parseBibtexToReferences(text) {
  const { entries, errors } = parseBibtex(text);
  return { references: entries.map(bibtexToReference), errors };
}
