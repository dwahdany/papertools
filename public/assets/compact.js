// Markdown table compactor.
//
// CONTRACT:
//   compactMarkdown(text, options?) -> { output: string, stats: { inputChars, outputChars, saved, percent, tablesFound, rowsChanged } }
//
//   options = {
//     outerPipes: 'strip' | 'keep',   // default 'strip' (like sprintml/markdown-compaction: "| a | b |" -> "a|b")
//     trimTrailingWhitespace: true,   // trimEnd every line (also non-table lines)
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
//   - Cells are split on unescaped pipes outside backtick spans, each cell
//     trimmed; empty leading/trailing cells produced by outer pipes are dropped
//     ONLY if the line started/ended with a pipe (so "| a | b" keeps both cells).
//   - Separator cells matching /^:?-+:?$/ are collapsed keeping the colons.
//   - With outerPipes:'strip' cells are joined with "|". A row that would
//     become ambiguous (a single-cell table) keeps leading/trailing pipes.
//     With 'keep' the row becomes "|a|b|".
//   - Escaped pipes `\|` and pipes in `code spans` are preserved verbatim.
//   - Internal whitespace inside cells is preserved; only edges are trimmed.
//   - Lines inside fenced code blocks are only trimEnd-ed (if that option is on).
//
// ADDITIONAL EXPORTS (helpers, also usable on their own):
//   defaultOptions                         frozen defaults listed above
//   normalizeOptions(options?) -> options  fills defaults, coerces bad values
//   splitCells(row) -> { cells, leadingPipe, trailingPipe }
//                                          pipe-aware cell splitter (escapes + code spans)
//   isDelimiterRow(row) -> boolean         GFM delimiter row test ("| :--- | ---: |")
//   compactRow(row, options?) -> string    compact a single table row (no blockquote prefix)

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
 * Split a table row into trimmed cells. A backslash escapes the next
 * character, a run of N backticks opens a code span closed by the next run
 * of exactly N backticks, and only pipes outside both split cells. The empty
 * pieces produced by a leading / trailing pipe are dropped.
 * @param {string} row
 * @returns {{ cells: string[], leadingPipe: boolean, trailingPipe: boolean }}
 */
function splitCells(row) {
  const body = String(row ?? '').trim();
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
  return { cells: pieces.map((c) => c.trim()), leadingPipe, trailingPipe };
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
  return allDelimiterCells(splitCells(row).cells);
}

/** Does the split row contain at least one cell-splitting pipe? */
function hasPipe(split) {
  return split.leadingPipe || split.trailingPipe || split.cells.length > 1;
}

/**
 * Compact one table row (without any blockquote prefix / indentation).
 * @param {string} row
 * @param {Partial<CompactOptions>} [options]
 * @returns {string}
 */
function compactRow(row, options) {
  const opts = normalizeOptions(options);
  const split = splitCells(row);
  const trimmed = String(row ?? '').trim();
  if (split.cells.length === 0 || !hasPipe(split)) return trimmed;
  const cells = opts.collapseSeparators && allDelimiterCells(split.cells)
    ? split.cells.map((c) => c.replace(/-+/, '-'))
    : split.cells;
  if (opts.outerPipes === 'keep' || cells.length === 1) return `|${cells.join('|')}|`;
  const lead = cells[0] === '' ? '|' : '';
  const tail = cells[cells.length - 1] === '' ? '|' : '';
  return `${lead}${cells.join('|')}${tail}`;
}

/**
 * Break a source line into blockquote prefix, indentation and trimmed body.
 * @param {string} line
 */
function parseLine(line) {
  const quote = /^((?: {0,3}>[ \t]?)*)/.exec(line)[1];
  const rest = line.slice(quote.length);
  const indent = /^[ \t]*/.exec(rest)[0];
  const body = rest.trim();
  return {
    line,
    quote,
    quoteDepth: (quote.match(/>/g) || []).length,
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
  return allDelimiterCells(delim.split.cells) && delim.split.cells.length === head.split.cells.length;
}

/** Can line `j` continue the table block started on `head`? */
function continuesTable(parsed, j, head, opts) {
  const p = parsed[j];
  if (!p || p.body === '' || p.quoteDepth !== head.quoteDepth || !hasPipe(p.split)) return false;
  return !(opts.skipCodeBlocks && openFence(p));
}

/**
 * Assign a role ('row' | 'code' | 'text') to every parsed line.
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
      let j = i;
      while (j < i + 2 || continuesTable(parsed, j, p, opts)) roles[j++] = 'row';
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
    if (roles[i] === 'row') {
      const line = p.quote + compactRow(p.body, opts);
      if (line !== p.line) rowsChanged++;
      return line;
    }
    return opts.trimTrailingWhitespace ? p.line.trimEnd() : p.line;
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
