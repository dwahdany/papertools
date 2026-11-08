// Markdown table compactor page logic.
import { compactMarkdown } from '../assets/compact.js';
import { $, toast, copyToClipboard, persist, debounce } from '../assets/ui.js';

const input = $('#input');
const output = $('#output');
const stats = $('#stats');
const keepPipes = $('#opt-keep-pipes');
const skipCode = $('#opt-skip-code');
const collapse = $('#opt-collapse');
const trim = $('#opt-trim');

const IDLE_TEXT = 'Paste Markdown to see how much you save. Ctrl/⌘+Enter compacts.';

const EXAMPLE = [
  '# Results',
  '',
  'Table 1 compares the baselines; `a | b` in prose is left alone.',
  '',
  '| Model        | Params | Top-1 | Notes             |',
  '| :----------- | -----: | :---: | ----------------- |',
  '| ResNet-50    |    25M |  76.1 | baseline          |',
  '| ViT-B/16     |    86M |  81.8 | `lr\\|wd` sweep    |',
  '| ConvNeXt-T   |    28M |  82.1 | either a \\| b     |',
  '',
  '```python',
  'print("| this | is | code |")',
  '```',
  '',
  '> | Quoted | Table |',
  '> |--------|-------|',
  '> | yes    | works |',
  '',
].join('\n');

/** Read the option checkboxes into compactMarkdown options. */
function currentOptions() {
  return {
    outerPipes: keepPipes.checked ? 'keep' : 'strip',
    skipCodeBlocks: skipCode.checked,
    collapseSeparators: collapse.checked,
    trimTrailingWhitespace: trim.checked,
  };
}

/** Pluralise a count. */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Build the stats line, e.g. "123 → 98 chars · 25 chars saved (20%) · 1 table". */
function describeStats(s) {
  const delta = s.saved >= 0
    ? `${plural(s.saved, 'char')} saved (${s.percent}%)`
    : `${plural(-s.saved, 'char')} added (${-s.percent}%)`;
  return `${s.inputChars} → ${s.outputChars} chars · ${delta} · ${plural(s.tablesFound, 'table')}`;
}

/** Run the compactor and update output + stats. */
function run() {
  const text = input.value;
  if (text === '') {
    output.value = '';
    stats.textContent = IDLE_TEXT;
    return;
  }
  const { output: result, stats: s } = compactMarkdown(text, currentOptions());
  output.value = result;
  stats.textContent = describeStats(s);
}

const runSoon = debounce(run, 120);

for (const [el, key] of [
  [keepPipes, 'compact.keepPipes'], [skipCode, 'compact.skipCode'],
  [collapse, 'compact.collapse'], [trim, 'compact.trim'],
]) {
  persist(el, key);
  el.addEventListener('change', run);
}

input.addEventListener('input', runSoon);
input.addEventListener('paste', () => setTimeout(run, 0));
$('#compact').addEventListener('click', run);

$('#copy').addEventListener('click', async () => {
  if (!output.value) { toast('Nothing to copy yet'); return; }
  toast((await copyToClipboard(output.value)) ? 'Copied compacted Markdown' : 'Copy failed');
});

$('#clear').addEventListener('click', () => {
  input.value = '';
  run();
  input.focus();
});

$('#load-example').addEventListener('click', (e) => {
  e.preventDefault();
  input.value = EXAMPLE;
  run();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    run();
  }
});

run();
