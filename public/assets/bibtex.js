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
//
//   latexToUnicode(s) -> string
//     Decodes LaTeX accents/commands: \"{o} \"o {\"o} \'e \`e \^e \~n \c{c} \v{s}
//     \H{o} \k{a} \={a} \.{z} \u{g} \r{a} \o \O \l \L \ss \ae \AE \oe \OE \aa \AA
//     \i \j, ligatures, \& \% \$ \_ \# \{ \}, ~ -> nbsp (U+00A0), -- -> –,
//     --- -> —, `` '' -> “ ”, ` ' -> ‘ ’, \textit{x}/\emph{x}/\textbf{x} -> x,
//     \url{x} -> x, \mbox{x} -> x, \ldots -> …, \\ -> space, \, \; \  -> space,
//     math $...$ kept as-is minus the dollars, unknown \commands removed (keep argument).
//     Braces are left in place by this function (callers decide); use
//     stripBraces(s) to remove them.
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
//       misc/unpublished/online/electronic -> preprint if eprint/archivePrefix=arXiv or
//         journal/howpublished mentions arXiv, else webpage if url and no publisher, else generic
//       software -> software, dataset -> dataset, manual -> generic, patent -> patent
//     Also: eprint + archiveprefix/primaryclass -> archive/archiveId; doi (strip
//     https://doi.org/ prefix); url; year (int), month (name or number -> 1-12),
//     date (biblatex "2017-06-12") -> year/month/day; urldate -> accessed;
//     title/booktitle: latexToUnicode but KEEP braces; everything else decoded
//     and brace-stripped. Preserve the citation key in `id`.
//
//   referenceToBibtex(ref) -> string
//     Inverse mapping, producing a tidy entry with a generated key like
//     `vaswani2017attention` (first author family lowercase + year + first
//     significant title word), escaping &, %, and protecting acronyms in title
//     with braces. Used by the URL tool.

export { parseBibtex, latexToUnicode, stripBraces, parseNames, bibtexToReference, referenceToBibtex };

function notImplemented() { throw new Error('bibtex.js: not implemented yet'); }
function parseBibtex() { notImplemented(); }
function latexToUnicode() { notImplemented(); }
function stripBraces() { notImplemented(); }
function parseNames() { notImplemented(); }
function bibtexToReference() { notImplemented(); }
function referenceToBibtex() { notImplemented(); }
