// APA 7 reference formatter. Consumes a Reference (see model.js) and produces
// a rich-text reference list entry.
//
// CONTRACT (implementers must keep these signatures; UI pages depend on them):
//
//   formatApa(ref, options?) -> {
//     segments: Array<{ text: string, italic: boolean }>,  // ordered runs
//     plain: string,      // italics dropped
//     html: string,       // runs wrapped in <i>…</i>, text HTML-escaped
//     markdown: string,   // italics as *…*, special chars escaped
//     latex: string,      // italics as \emph{…}, special chars escaped
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
//     ": " / "? " / "! " / "— ", brace-protected spans, words with an uppercase
//     letter after position 0 (acronyms, CamelCase), single-letter words "I"/"A"?
//     (keep "I"), proper nouns are NOT detected (impossible without a dictionary).
//
//   formatAuthors(names, style) -> string      // "Vaswani, A., Shazeer, N., & Polosukhin, I."
//   formatInitials(given) -> string            // "Ashish" -> "A.", "Jean-Pierre" -> "J.-P.", "A. N." -> "A. N."
//   normalizePageRange(page) -> string         // "123--145" / "123-145" -> "123–145"
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

export { formatApa, applyCase, formatAuthors, formatInitials, normalizePageRange };

function notImplemented() { throw new Error('apa.js: not implemented yet'); }
function formatApa() { notImplemented(); }
function applyCase() { notImplemented(); }
function formatAuthors() { notImplemented(); }
function formatInitials() { notImplemented(); }
function normalizePageRange() { notImplemented(); }
