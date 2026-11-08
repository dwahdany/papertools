// BibTeX → APA page logic: parse pasted BibTeX, format every entry as an APA 7
// reference and offer rich-text / Markdown / LaTeX / plain copies.
import { parseBibtexToReferences } from '../assets/bibtex.js';
import { formatApa } from '../assets/apa.js';
import { $, toast, copyToClipboard, escapeHtml, persist, debounce } from '../assets/ui.js';

/** @typedef {import('../assets/model.js').Reference} Reference */
/** @typedef {import('../assets/apa.js').ApaResult} ApaResult */

const input = $('#input');
const output = $('#output');
const errorList = $('#errors');
const fmtMarkdown = $('#fmt-markdown');
const fmtLatex = $('#fmt-latex');
const fmtPlain = $('#fmt-plain');
const authorStyle = $('#opt-author-style');
const sortOrder = $('#opt-sort');
const sentenceCase = $('#opt-sentence-case');
const includeDoi = $('#opt-doi');

const PLACEHOLDER = 'Paste BibTeX on the left; the APA references appear here.';
const HASH_PREFIX = '#bib=';
const MAX_SHARE_CHARS = 8000;
const DEBOUNCE_MS = 200;

const EXAMPLE = `@article{vaswani2017attention,
  title={Attention is all you need},
  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N and Kaiser, {\\L}ukasz and Polosukhin, Illia},
  journal={Advances in Neural Information Processing Systems},
  volume={30},
  pages={5998--6008},
  year={2017}
}

@inproceedings{devlin2019bert,
  title={{BERT}: Pre-training of Deep Bidirectional Transformers for Language Understanding},
  author={Devlin, Jacob and Chang, Ming-Wei and Lee, Kenton and Toutanova, Kristina},
  booktitle={Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics},
  pages={4171--4186},
  month=jun,
  year={2019},
  organization={Association for Computational Linguistics},
  doi={10.18653/v1/N19-1423}
}

@misc{brown2020language,
  title={Language Models are Few-Shot Learners},
  author={Brown, Tom B and Mann, Benjamin and Ryder, Nick and Subbiah, Melanie and Kaplan, Jared and Dhariwal, Prafulla and Neelakantan, Arvind and Shyam, Pranav and Amodei, Dario},
  year={2020},
  eprint={2005.14165},
  archivePrefix={arXiv},
  primaryClass={cs.CL}
}
`;

/**
 * One converted entry.
 * @typedef {Object} Entry
 * @property {Reference} ref
 * @property {ApaResult} result
 */

/** @type {Entry[]} The entries currently shown, in display order. */
let entries = [];

/** Read the option controls into formatApa options. */
function currentOptions() {
  return {
    authorStyle: authorStyle.value,
    sentenceCase: sentenceCase.checked,
    includeDoi: includeDoi.checked,
    includeUrl: includeDoi.checked,
  };
}

/**
 * Sort entries alphabetically by their plain reference text (APA reference
 * list order) when that option is selected; otherwise keep input order.
 * @param {Entry[]} list
 * @returns {Entry[]}
 */
function sortEntries(list) {
  if (sortOrder.value !== 'alpha') return list;
  return [...list].sort((a, b) => a.result.plain.localeCompare(b.result.plain, undefined, { sensitivity: 'base' }));
}

/**
 * Build the HTML for one rendered entry: the reference, a per-entry copy
 * button, the citation key and any warnings.
 * @param {Entry} entry
 * @param {number} index position in `entries`
 * @returns {string}
 */
function renderEntry({ ref, result }, index) {
  const key = ref.id ? `<code>${escapeHtml(ref.id)}</code>` : '<span>no citation key</span>';
  const warnings = result.warnings.length
    ? `<p class="warnings">${result.warnings.map(escapeHtml).join(' · ')}</p>`
    : '';
  return `<div class="entry">
<p class="ref">${result.html}</p>
<button type="button" class="copy-ref" data-index="${index}" title="Copy this reference as rich text">Copy</button>
<p class="meta muted">${key}</p>
${warnings}</div>`;
}

/**
 * Render parse errors (with line numbers) and page-level errors.
 * @param {Array<{message: string, line?: number}>} errors
 */
function renderErrors(errors) {
  errorList.innerHTML = errors.map(({ message, line }) => {
    const where = Number.isFinite(line) ? `Line ${line}: ` : '';
    return `<li>${escapeHtml(where + message)}</li>`;
  }).join('');
}

/** Update the three <pre> blocks in the "Formats" section. */
function renderFormats() {
  fmtMarkdown.textContent = joinFormat('markdown');
  fmtLatex.textContent = joinFormat('latex');
  fmtPlain.textContent = joinFormat('plain');
}

/**
 * Join one text flavour of every entry with blank lines.
 * @param {'markdown'|'latex'|'plain'} flavour
 * @returns {string}
 */
function joinFormat(flavour) {
  return entries.map((e) => e.result[flavour]).join('\n\n');
}

/**
 * The rich-text (text/html) flavour: one <p> per reference so Word / Google
 * Docs keep paragraphs and italics.
 * @param {Entry[]} list
 * @returns {string}
 */
function htmlFor(list) {
  return list.map((e) => `<p>${e.result.html}</p>`).join('\n');
}

/** Render the current `entries` into the output box and the Formats section. */
function render() {
  output.innerHTML = entries.length
    ? entries.map(renderEntry).join('')
    : `<p class="placeholder">${escapeHtml(PLACEHOLDER)}</p>`;
  renderFormats();
}

/** Parse the textarea, format every entry and refresh the page. Never throws. */
function convert() {
  try {
    const text = input.value;
    if (text.trim() === '') {
      entries = [];
      render();
      renderErrors([]);
      return;
    }
    const { references, errors } = parseBibtexToReferences(text);
    const options = currentOptions();
    entries = sortEntries(references.map((ref) => ({ ref, result: formatApa(ref, options) })));
    render();
    const noEntries = references.length === 0 && errors.length === 0
      ? [{ message: 'No BibTeX entries found. Entries start with "@type{key," — see the placeholder for an example.' }]
      : [];
    renderErrors([...errors, ...noEntries]);
  } catch (err) {
    console.error('BibTeX → APA conversion failed', err);
    entries = [];
    render();
    renderErrors([{ message: `Conversion failed: ${err && err.message ? err.message : String(err)}` }]);
  }
}

const convertSoon = debounce(convert, DEBOUNCE_MS);

/**
 * Copy a text flavour of all entries, toasting the outcome.
 * @param {string} text
 * @param {string} label shown in the toast
 * @param {string} [html] optional text/html flavour
 */
async function copyAll(text, label, html) {
  if (!entries.length) { toast('Nothing to copy yet'); return; }
  toast((await copyToClipboard(text, html)) ? `Copied ${label}` : 'Copy failed');
}

/** Put the current input into the URL fragment and copy the link. */
async function shareLink() {
  const text = input.value;
  if (text.trim() === '') { toast('Nothing to share yet'); return; }
  if (text.length >= MAX_SHARE_CHARS) {
    toast(`Input is too long to share as a link (${text.length} characters; the limit is ${MAX_SHARE_CHARS})`, 3200);
    return;
  }
  const url = new URL(location.href);
  url.hash = `bib=${encodeURIComponent(text)}`;
  history.replaceState(null, '', url);
  toast((await copyToClipboard(url.href)) ? 'Link copied; the BibTeX is in the URL fragment' : 'Link is in the address bar');
}

/** Load BibTeX from "#bib=…" in the URL, if present. */
function loadFromHash() {
  if (!location.hash.startsWith(HASH_PREFIX)) return false;
  try {
    input.value = decodeURIComponent(location.hash.slice(HASH_PREFIX.length));
    return true;
  } catch (err) {
    console.error('Could not decode #bib= fragment', err);
    toast('The shared link could not be decoded');
    return false;
  }
}

for (const [el, key] of [
  [authorStyle, 'bibtex.authorStyle'], [sortOrder, 'bibtex.sort'],
  [sentenceCase, 'bibtex.sentenceCase'], [includeDoi, 'bibtex.includeDoi'],
]) {
  persist(el, key);
  el.addEventListener('change', convert);
}

input.addEventListener('input', convertSoon);
input.addEventListener('paste', () => setTimeout(convert, 0));
$('#convert').addEventListener('click', convert);

$('#clear').addEventListener('click', () => {
  input.value = '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  convert();
  input.focus();
});

$('#load-example').addEventListener('click', () => {
  input.value = EXAMPLE;
  convert();
});

$('#share').addEventListener('click', shareLink);

$('#copy-rich').addEventListener('click', () => copyAll(joinFormat('plain'), 'rich text', htmlFor(entries)));
$('#copy-markdown').addEventListener('click', () => copyAll(joinFormat('markdown'), 'Markdown'));
$('#copy-latex').addEventListener('click', () => copyAll(joinFormat('latex'), 'LaTeX'));
$('#copy-plain').addEventListener('click', () => copyAll(joinFormat('plain'), 'plain text'));

output.addEventListener('click', async (e) => {
  const button = e.target.closest('.copy-ref');
  if (!button) return;
  const entry = entries[Number(button.dataset.index)];
  if (!entry) return;
  toast((await copyToClipboard(entry.result.plain, htmlFor([entry]))) ? 'Copied reference' : 'Copy failed');
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    convert();
  }
});

loadFromHash();
convert();
