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

export { compactMarkdown };

function compactMarkdown() { throw new Error('compact.js: not implemented yet'); }
