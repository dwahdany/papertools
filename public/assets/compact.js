// Markdown table compactor.
//
// CONTRACT:
//   compactMarkdown(text, options?) -> { output: string, stats: { inputChars, outputChars, saved, percent, tablesFound, rowsChanged } }
//
//   options = {
//     outerPipes: 'strip' | 'keep',   // default 'strip' (like sprintml/markdown-compaction: "| a | b |" -> "a|b")
//     trimTrailingWhitespace: true,   // trim trailing ASCII whitespace from every line (also non-table
//                                     // lines); a two-space GFM hard line break is kept as exactly two spaces
//     collapseSeparators: true,       // "----" -> "-", ":---" -> ":-", "---:" -> "-:", ":---:" -> ":-:"
//     skipCodeBlocks: true,           // leave fenced ``` / ~~~ blocks untouched
//   }
//
//   Behaviour (reimplemented from scratch, based on the behaviour of the
//   reference tool, with its edge cases fixed):
//   - Lines are processed independently; line endings preserved (\n; \r\n input
//     normalised to \n).
//   - A table row is a line whose trimmed form contains an unescaped `|`
//     (ignoring pipes inside backtick code spans) AND which either starts
//     with `|` or whose neighbouring lines form a GFM table (at least a header
//     + delimiter row). Simplest reliable rule: treat a line as a table row if,
//     after trimming, it starts with `|`, OR it is part of a block of ≥2
//     consecutive lines where one of them is a delimiter row (/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/).
//     A delimiter candidate that starts with a list marker followed by a
//     space/tab ("- | -") is a list item in GFM, not a delimiter row.
//   - Cells are split on unescaped pipes outside backtick spans, each cell
//     trimmed of ASCII whitespace (space, tab, FF, VT); NBSP and other Unicode
//     spaces are cell content, as in GFM. Empty leading/trailing cells produced
//     by outer pipes are dropped ONLY if the line started/ended with a pipe
//     (so "| a | b" keeps both cells).
//   - Separator cells matching /^:?-+:?$/ are collapsed keeping the colons —
//     only on the delimiter row of a detected table (a body row "| --- | --- |"
//     is content and stays as is).
//   - With outerPipes:'strip' cells are joined with "|". A row that would
//     become ambiguous (a single-cell table) keeps leading/trailing pipes, and
//     so does a row whose first cell would otherwise start a block at column 0
//     (">", "- x", "1. x", "# x", "```", "~~~", "<div", ...): "|> 0.05|x".
//     With 'keep' the row becomes "|a|b|".
//   - A cell ending in an unescaped backslash keeps one trailing space when a
//     pipe follows it ("C:\ |x"), otherwise "C:\|" would be an escaped pipe.
//   - Escaped pipes `\|` and pipes in `code spans` are preserved verbatim.
//   - Internal whitespace inside cells is preserved; only edges are trimmed.
//   - The blockquote prefix and the (up to 3 spaces of) indentation of a row
//     are kept, so tables nested in list items stay in the item.
//   - Lines inside fenced code blocks are only trimEnd-ed (if that option is on).
//
// ADDITIONAL EXPORTS (helpers, also usable on their own):
//   defaultOptions                         frozen defaults listed above
//   normalizeOptions(options?) -> options  fills defaults, coerces bad values
//   splitCells(row) -> { cells, leadingPipe, trailingPipe }
//                                          pipe-aware cell splitter (escapes + code spans)
//   isDelimiterRow(row) -> boolean         GFM delimiter row test ("| :--- | ---: |")
//   compactRow(row, options?, role?) -> string
//                                          compact a single table row (no blockquote prefix);
//                                          role = { delimiter: boolean } says whether the row is
//                                          the table's delimiter row (omit it: any all-dash row
//                                          is collapsed, as the standalone helper always did)

export {
  compactMarkdown, compactRow, splitCells, isDelimiterRow, defaultOptions, normalizeOptions,
};

/** @typedef {{ outerPipes: 'strip'|'keep', trimTrailingWhitespace: boolean, collapseSeparators: boolean, skipCodeBlocks: boolean }} CompactOptions */

/** @type {Readonly<CompactOptions>} */
const defaultOptions = Object.freeze({
  outerPipes: 'strip',
  trimTrailingWhitespace: true,
  collapseSeparators: true,
  skipCodeBlocks: true,
});

/** A GFM delimiter cell: dashes with optional alignment colons. */
const DELIMITER_CELL = /^:?-+:?$/;

/** A line starting like a bullet list item ("- x"); such a line is never a delimiter row. */
const LIST_ITEM_START = /^[-+*][ \t]/;

/**
 * Would this (already compacted, pipe-joined) row start a block at column 0?
 * ATX heading, blockquote, bullet / ordered list item, fence or HTML block.
 */
const BLOCK_START = /^(#{1,6}[ \t]|>|[-+*][ \t]|\d{1,9}[.)][ \t]|`{3,}|~{3,}|<[A-Za-z!?/])/;

/** Does the cell end in an unescaped backslash (an odd run of backslashes)? */
const ENDS_IN_BACKSLASH = /(^|[^\\])(\\\\)*\\$/;

/** Trim ASCII whitespace only (GFM does not trim NBSP or other Unicode spaces). */
const asciiTrim = (s) => s.replace(/^[ \t\f\v]+|[ \t\f\v]+$/g, '');
const asciiTrimEnd = (s) => s.replace(/[ \t\f\v]+$/, '');

/**
 * Fill in defaults and coerce unexpected values (never throws).
 * @param {Partial<CompactOptions>|null|undefined} [options]
 * @returns {CompactOptions}
 */
function normalizeOptions(options) {
  const o = options && typeof options === 'object' ? options : {};
  return {
    outerPipes: o.outerPipes === 'keep' ? 'keep' : 'strip',
    trimTrailingWhitespace: o.trimTrailingWhitespace === undefined ? true : Boolean(o.trimTrailingWhitespace),
    collapseSeparators: o.collapseSeparators === undefined ? true : Boolean(o.collapseSeparators),
    skipCodeBlocks: o.skipCodeBlocks === undefined ? true : Boolean(o.skipCodeBlocks),
  };
}

/** Length of the run of backticks starting at `from`. */
function backtickRun(s, from) {
  let n = 0;
  while (s[from + n] === '`') n++;
  return n;
}

/**
 * Index of the next run of exactly `length` backticks at or after `from`,
 * or -1 when the span is never closed.
 */
function findClosingRun(s, from, length) {
  let i = from;
  while (i < s.length) {
    if (s[i] !== '`') { i++; continue; }
    const run = backtickRun(s, i);
    if (run === length) return i;
    i += run;
  }
  return -1;
}

/**
 * Split a table row into cells trimmed of ASCII whitespace. A backslash
 * escapes the next character, a run of N backticks opens a code span closed
 * by the next run of exactly N backticks, and only pipes outside both split
 * cells. The empty pieces produced by a leading / trailing pipe are dropped.
 * @param {string} row
 * @returns {{ cells: string[], leadingPipe: boolean, trailingPipe: boolean }}
 */
function splitCells(row) {
  const body = asciiTrim(String(row ?? ''));
  const pieces = [];
  let cell = '';
  let lastPipe = -1;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '\\') {
      cell += body.slice(i, i + 2);
      i += 2;
    } else if (ch === '`') {
      const run = backtickRun(body, i);
      const close = findClosingRun(body, i + run, run);
      const end = close === -1 ? i + run : close + run;
      cell += body.slice(i, end);
      i = end;
    } else if (ch === '|') {
      pieces.push(cell);
      cell = '';
      lastPipe = i;
      i++;
    } else {
      cell += ch;
      i++;
    }
  }
  pieces.push(cell);
  const leadingPipe = body.startsWith('|');
  const trailingPipe = body.length > 0 && lastPipe === body.length - 1;
  if (leadingPipe) pieces.shift();
  if (trailingPipe && pieces.length) pieces.pop();
  return { cells: pieces.map(asciiTrim), leadingPipe, trailingPipe };
}

/** True when every cell is a delimiter cell. */
function allDelimiterCells(cells) {
  return cells.length > 0 && cells.every((c) => DELIMITER_CELL.test(c));
}

/**
 * Is this line a GFM delimiter row such as "| :--- | ---: |" or "---|---"?
 * @param {string} row
 * @returns {boolean}
 */
function isDelimiterRow(row) {
  const body = asciiTrim(String(row ?? ''));
  if (LIST_ITEM_START.test(body)) return false;
  return allDelimiterCells(splitCells(body).cells);
}

/** Does the split row contain at least one cell-splitting pipe? */
function hasPipe(split) {
  return split.leadingPipe || split.trailingPipe || split.cells.length > 1;
}

/**
 * Compact one table row (without any blockquote prefix / indentation).
 * @param {string} row
 * @param {Partial<CompactOptions>} [options]
 * @param {{ delimiter?: boolean }} [role] whether this is the table's delimiter
 *   row; when omitted any all-dash row is collapsed (standalone helper behaviour)
 * @returns {string}
 */
function compactRow(row, options, role) {
  const opts = normalizeOptions(options);
  const split = splitCells(row);
  const trimmed = asciiTrim(String(row ?? ''));
  if (split.cells.length === 0 || !hasPipe(split)) return trimmed;
  const mayCollapse = role === undefined || Boolean(role && role.delimiter);
  const collapsed = opts.collapseSeparators && mayCollapse && allDelimiterCells(split.cells)
    ? split.cells.map((c) => c.replace(/-+/, '-'))
    : split.cells;
  // A cell ending in an unescaped backslash would turn the joining pipe into
  // an escaped pipe ("C:\" + "|" -> "C:\|"), so keep one space before it.
  const outer = opts.outerPipes === 'keep' || collapsed.length === 1;
  const cells = collapsed.map((c, i) => (
    (i < collapsed.length - 1 || outer) && ENDS_IN_BACKSLASH.test(c) ? `${c} ` : c));
  const joined = cells.join('|');
  if (outer) return `|${joined}|`;
  // Keep the leading pipe when the first cell would otherwise start a
  // heading, blockquote, list item, fence or HTML block at column 0.
  const lead = cells[0] === '' || BLOCK_START.test(joined) ? '|' : '';
  const tail = cells[cells.length - 1] === '' ? '|' : '';
  return `${lead}${joined}${tail}`;
}

/**
 * Break a source line into blockquote prefix, indentation and trimmed body.
 * @param {string} line
 */
function parseLine(line) {
  const quote = /^((?: {0,3}>[ \t]?)*)/.exec(line)[1];
  const rest = line.slice(quote.length);
  const indent = /^[ \t]*/.exec(rest)[0];
  const body = asciiTrim(rest);
  return {
    line,
    quote,
    quoteDepth: (quote.match(/>/g) || []).length,
    indent,
    indentedCode: indent.includes('\t') || indent.length >= 4,
    body,
    split: splitCells(body),
  };
}

/**
 * If the parsed line opens a fenced code block, return the fence
 * description, otherwise null.
 */
function openFence(p) {
  if (p.indentedCode) return null;
  const m = /^(`{3,}|~{3,})(.*)$/.exec(p.body);
  if (!m) return null;
  if (m[1][0] === '`' && m[2].includes('`')) return null;
  return { char: m[1][0], length: m[1].length };
}

/** Does the parsed line close the given fence? */
function closesFence(p, fence) {
  if (p.indentedCode) return false;
  const m = /^(`{3,}|~{3,})$/.exec(p.body);
  return Boolean(m) && m[1][0] === fence.char && m[1].length >= fence.length;
}

/**
 * Is line `i` the header of a GFM table (next line is a delimiter row with
 * the same number of cells, at the same blockquote depth)?
 */
function startsTable(parsed, i) {
  const head = parsed[i];
  const delim = parsed[i + 1];
  if (!delim || head.indentedCode || delim.indentedCode) return false;
  if (head.quoteDepth !== delim.quoteDepth || !hasPipe(head.split)) return false;
  // "- | -" is a bullet list item in GFM (block structure wins), not a delimiter row.
  if (LIST_ITEM_START.test(delim.body)) return false;
  return allDelimiterCells(delim.split.cells) && delim.split.cells.length === head.split.cells.length;
}

/** Can line `j` continue the table block started on `head`? */
function continuesTable(parsed, j, head, opts) {
  const p = parsed[j];
  if (!p || p.body === '' || p.quoteDepth !== head.quoteDepth || !hasPipe(p.split)) return false;
  return !(opts.skipCodeBlocks && openFence(p));
}

/**
 * Assign a role ('row' | 'delimiter' | 'code' | 'text') to every parsed line.
 * 'delimiter' is the second line of a detected table; a standalone `|`-line
 * is always a 'row' (without a header above it, "| --- |" is content in GFM).
 * @returns {{ roles: string[], tablesFound: number }}
 */
function classifyLines(parsed, opts) {
  const roles = new Array(parsed.length).fill('text');
  let tablesFound = 0;
  let fence = null;
  let i = 0;
  while (i < parsed.length) {
    const p = parsed[i];
    if (fence) {
      roles[i] = 'code';
      if (closesFence(p, fence)) fence = null;
      i++;
    } else if (opts.skipCodeBlocks && openFence(p)) {
      fence = openFence(p);
      roles[i] = 'code';
      i++;
    } else if (startsTable(parsed, i)) {
      tablesFound++;
      roles[i] = 'row';
      roles[i + 1] = 'delimiter';
      let j = i + 2;
      while (continuesTable(parsed, j, p, opts)) roles[j++] = 'row';
      i = j;
    } else {
      if (!p.indentedCode && p.body.startsWith('|')) roles[i] = 'row';
      i++;
    }
  }
  return { roles, tablesFound };
}

/**
 * Compact every Markdown table in `text`.
 * @param {string} text
 * @param {Partial<CompactOptions>} [options]
 * @returns {{ output: string, stats: { inputChars: number, outputChars: number, saved: number, percent: number, tablesFound: number, rowsChanged: number } }}
 */
function compactMarkdown(text, options) {
  const opts = normalizeOptions(options);
  const source = text == null ? '' : String(text);
  const parsed = source.replace(/\r\n?/g, '\n').split('\n').map(parseLine);
  const { roles, tablesFound } = classifyLines(parsed, opts);
  let rowsChanged = 0;
  const out = parsed.map((p, i) => {
    if (roles[i] === 'row' || roles[i] === 'delimiter') {
      const line = p.quote + p.indent + compactRow(p.body, opts, { delimiter: roles[i] === 'delimiter' });
      if (line !== p.line) rowsChanged++;
      return line;
    }
    if (!opts.trimTrailingWhitespace) return p.line;
    const t = asciiTrimEnd(p.line);
    // Two or more trailing spaces are a GFM hard line break (<br>) when the
    // paragraph continues on the next line; keep exactly two of them.
    const next = parsed[i + 1];
    const hardBreak = roles[i] !== 'code' && t !== '' && /  $/.test(p.line) && next !== undefined && next.body !== '';
    return hardBreak ? `${t}  ` : t;
  });
  const output = out.join('\n');
  const inputChars = source.length;
  const saved = inputChars - output.length;
  return {
    output,
    stats: {
      inputChars,
      outputChars: output.length,
      saved,
      percent: inputChars ? Math.round((saved / inputChars) * 100) : 0,
      tablesFound,
      rowsChanged,
    },
  };
}
