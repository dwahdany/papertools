import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  compactMarkdown, compactRow, splitCells, isDelimiterRow, defaultOptions, normalizeOptions,
} from '../public/assets/compact.js';

const out = (text, options) => compactMarkdown(text, options).output;

describe('splitCells', () => {
  test('outer pipes are dropped, cells trimmed, inner whitespace kept', () => {
    assert.deepEqual(splitCells('| a b |  c  |'), { cells: ['a b', 'c'], leadingPipe: true, trailingPipe: true });
  });
  test('leading pipe only keeps the last cell (reference defect fixed)', () => {
    assert.deepEqual(splitCells('| a | b'), { cells: ['a', 'b'], leadingPipe: true, trailingPipe: false });
  });
  test('no outer pipes', () => {
    assert.deepEqual(splitCells('a | b'), { cells: ['a', 'b'], leadingPipe: false, trailingPipe: false });
  });
  test('escaped pipes do not split and are kept verbatim', () => {
    assert.deepEqual(splitCells('| a \\| b | c |').cells, ['a \\| b', 'c']);
    assert.equal(splitCells('| a \\|').trailingPipe, false);
  });
  test('pipes inside code spans do not split', () => {
    assert.deepEqual(splitCells('| `x|y` | z |').cells, ['`x|y`', 'z']);
    assert.deepEqual(splitCells('| `` a|`b `` | z |').cells, ['`` a|`b ``', 'z']);
  });
  test('unclosed backtick is literal and pipes after it still split', () => {
    assert.deepEqual(splitCells('| `x | y |').cells, ['`x', 'y']);
  });
  test('backslash-escaped backtick does not open a code span', () => {
    assert.deepEqual(splitCells('| \\`a | b` |').cells, ['\\`a', 'b`']);
  });
  test('empty cells survive', () => {
    assert.deepEqual(splitCells('| | b | |').cells, ['', 'b', '']);
    assert.deepEqual(splitCells('|').cells, []);
    assert.deepEqual(splitCells(''), { cells: [''], leadingPipe: false, trailingPipe: false });
  });
  test('trailing backslash at end of row is harmless', () => {
    assert.deepEqual(splitCells('| a | b\\').cells, ['a', 'b\\']);
  });
});

describe('isDelimiterRow', () => {
  test('accepts GFM delimiter rows', () => {
    for (const row of ['| --- | --- |', '---|---', ':-|-:|:-:', '| :--- | ---: |', '|-|', '---', '  | - | - |  ']) {
      assert.equal(isDelimiterRow(row), true, row);
    }
  });
  test('rejects non-delimiter rows', () => {
    for (const row of ['| a | b |', '| --- | b |', '| |', '', '|:|', '| -- - |', '| --- ||']) {
      assert.equal(isDelimiterRow(row), false, JSON.stringify(row));
    }
  });
});

describe('compactRow', () => {
  test('strips padding and outer pipes', () => {
    assert.equal(compactRow('| Name   | Score |'), 'Name|Score');
  });
  test('keep mode always emits both outer pipes', () => {
    assert.equal(compactRow('Name | Score', { outerPipes: 'keep' }), '|Name|Score|');
    assert.equal(compactRow('| | b |', { outerPipes: 'keep' }), '||b|');
  });
  test('single-cell rows keep their pipes', () => {
    assert.equal(compactRow('| only |'), '|only|');
    assert.equal(compactRow('| only'), '|only|');
  });
  test('empty edge cells keep the pipe on that side', () => {
    assert.equal(compactRow('| | b |'), '||b');
    assert.equal(compactRow('| a | |'), 'a||');
    assert.equal(compactRow('| | |'), '|||');
    assert.equal(compactRow('| a | | c |'), 'a||c');
  });
  test('collapses delimiter rows keeping alignment colons', () => {
    assert.equal(compactRow('| ---- | :--- | ---: | :---: |'), '-|:-|-:|:-:');
    assert.equal(compactRow('| ---- | :--- |', { collapseSeparators: false }), '----|:---');
  });
  test('does not collapse dashes in body cells', () => {
    assert.equal(compactRow('| --- | text |'), '---|text');
  });
  test('rows without pipes are returned trimmed', () => {
    assert.equal(compactRow('  just text  '), 'just text');
    assert.equal(compactRow('|'), '|');
  });
  test('never throws on odd input', () => {
    assert.equal(compactRow(null), '');
    assert.equal(compactRow(undefined), '');
    assert.equal(compactRow(42), '42');
  });
});

describe('options', () => {
  test('defaults are frozen and complete', () => {
    assert.deepEqual(defaultOptions, {
      outerPipes: 'strip', trimTrailingWhitespace: true, collapseSeparators: true, skipCodeBlocks: true,
    });
    assert.ok(Object.isFrozen(defaultOptions));
  });
  test('normalizeOptions coerces garbage', () => {
    assert.deepEqual(normalizeOptions(), defaultOptions);
    assert.deepEqual(normalizeOptions(null), defaultOptions);
    assert.deepEqual(normalizeOptions({ outerPipes: 'bogus', skipCodeBlocks: 0, trimTrailingWhitespace: 'yes' }),
      { outerPipes: 'strip', trimTrailingWhitespace: true, collapseSeparators: true, skipCodeBlocks: false });
    assert.equal(normalizeOptions({ outerPipes: 'keep' }).outerPipes, 'keep');
  });
});

describe('compactMarkdown — golden outputs', () => {
  const padded = [
    '| Model      | Params | Acc.  |',
    '|:-----------|-------:|:-----:|',
    '| ResNet-50  | 25M    | 76.1  |',
    '| ViT-B/16   | 86M    | 81.8  |',
  ].join('\n');

  test('padded table (strip)', () => {
    const r = compactMarkdown(padded);
    assert.equal(r.output, 'Model|Params|Acc.\n:-|-:|:-:\nResNet-50|25M|76.1\nViT-B/16|86M|81.8');
    assert.deepEqual(r.stats, {
      inputChars: 127, outputChars: 64, saved: 63, percent: 50, tablesFound: 1, rowsChanged: 4,
    });
  });

  test('padded table (keep)', () => {
    assert.equal(out(padded, { outerPipes: 'keep' }), '|Model|Params|Acc.|\n|:-|-:|:-:|\n|ResNet-50|25M|76.1|\n|ViT-B/16|86M|81.8|');
  });

  test('table without outer pipes is detected via the delimiter row', () => {
    assert.equal(out('a   | b\n--- | ---\n1   | 2'), 'a|b\n-|-\n1|2');
  });

  test('prose with a pipe is left alone', () => {
    const text = 'Choose either a | b here.\n\nMore text   ';
    assert.equal(out(text), 'Choose either a | b here.\n\nMore text');
    assert.equal(compactMarkdown(text).stats.tablesFound, 0);
  });

  test('a standalone line starting with a pipe is compacted (reference compat)', () => {
    assert.equal(out('| a   | b |'), 'a|b');
    assert.equal(compactMarkdown('| a   | b |').stats.tablesFound, 0);
    assert.equal(compactMarkdown('| a   | b |').stats.rowsChanged, 1);
  });

  test('table block ends at a blank line; following text is untouched', () => {
    const text = '| a | b |\n| - | - |\n| 1 | 2 |\n\nx | y stays';
    assert.equal(out(text), 'a|b\n-|-\n1|2\n\nx | y stays');
  });

  test('two tables are counted', () => {
    const text = '| a | b |\n|---|---|\n\n| c | d |\n|---|---|\n| 1 | 2 |';
    const r = compactMarkdown(text);
    assert.equal(r.output, 'a|b\n-|-\n\nc|d\n-|-\n1|2');
    assert.equal(r.stats.tablesFound, 2);
    assert.equal(r.stats.rowsChanged, 5);
  });

  test('rowsChanged ignores rows that were already compact', () => {
    assert.equal(compactMarkdown('a|b\n-|-\n1 | 2').stats.rowsChanged, 1);
  });
});

describe('compactMarkdown — edge cases', () => {
  test('escaped pipes and code spans survive inside a table', () => {
    const text = '| op   | meaning |\n|------|---------|\n| `a\\|b` | pipe in code |\n| a \\| b | escaped |';
    assert.equal(out(text), 'op|meaning\n-|-\n`a\\|b`|pipe in code\na \\| b|escaped');
  });

  test('fenced code blocks are left untouched (only trimEnd)', () => {
    const text = '```\n| a   | b |  \n|-----|---|\n```\n| c   | d |';
    assert.equal(out(text), '```\n| a   | b |\n|-----|---|\n```\nc|d');
    assert.equal(out(text, { trimTrailingWhitespace: false }), '```\n| a   | b |  \n|-----|---|\n```\nc|d');
    assert.equal(compactMarkdown(text).stats.tablesFound, 0);
  });

  test('tilde fences and longer closing fences', () => {
    const text = '~~~md\n| a | b |\n~~~~\n| x   | y |\n~~~\n| a   | b |';
    assert.equal(out(text), '~~~md\n| a | b |\n~~~~\nx|y\n~~~\n| a   | b |');
  });

  test('a backtick fence is not closed by a tilde fence or a shorter fence', () => {
    assert.equal(out('````\n| a   |\n~~~\n```\n````\n| a   |'), '````\n| a   |\n~~~\n```\n````\n|a|');
  });

  test('skipCodeBlocks:false compacts rows inside fences', () => {
    assert.equal(out('```\n| a   | b |\n```', { skipCodeBlocks: false }), '```\na|b\n```');
  });

  test('unclosed fence swallows the rest of the document', () => {
    assert.equal(out('```\n| a   | b |\n| c   | d |'), '```\n| a   | b |\n| c   | d |');
  });

  test('indentation up to 3 spaces is stripped; 4+ or a tab is indented code', () => {
    assert.equal(out('   | a   | b |\n   |-----|---|'), 'a|b\n-|-');
    assert.equal(out('    | a   | b |'), '    | a   | b |');
    assert.equal(out('\t| a   | b |'), '\t| a   | b |');
  });

  test('blockquoted tables keep their prefix', () => {
    const text = '> | a   | b |\n> |-----|---|\n> | 1   | 2 |';
    assert.equal(out(text), '> a|b\n> -|-\n> 1|2');
    assert.equal(compactMarkdown(text).stats.tablesFound, 1);
    assert.equal(out('> > | a | b |\n> > |---|---|'), '> > a|b\n> > -|-');
    assert.equal(out('>| a | b |'), '>a|b');
  });

  test('a delimiter row at a different blockquote depth does not form a table', () => {
    assert.equal(out('> a | b\n--- | ---'), '> a | b\n--- | ---');
  });

  test('setext headings are not tables', () => {
    assert.equal(out('Title\n-----'), 'Title\n-----');
    assert.equal(out('a | b\n-----'), 'a | b\n-----');
  });

  test('single-column tables keep their pipes', () => {
    assert.equal(out('| Item   |\n|--------|\n| apple  |'), '|Item|\n|-|\n|apple|');
  });

  test('empty edge cells keep the pipe on that side', () => {
    assert.equal(out('|     | b |\n|-----|---|\n| a   |   |'), '||b\n-|-\na||');
  });

  test('a row without pipes ends the block', () => {
    assert.equal(out('| a | b |\n|---|---|\nplain   text\n| 1   | 2 |'), 'a|b\n-|-\nplain   text\n1|2');
  });

  test('a fence opener ends a table block', () => {
    assert.equal(out('| a | b |\n|---|---|\n```\n| x   | y |\n```'), 'a|b\n-|-\n```\n| x   | y |\n```');
  });

  test('CRLF input is normalised to LF; trailing newline preserved', () => {
    const r = compactMarkdown('| a   | b |\r\n|---|---|\r\n');
    assert.equal(r.output, 'a|b\n-|-\n');
    assert.equal(r.stats.inputChars, 24);
    assert.equal(r.stats.outputChars, 8);
    assert.equal(out('| a |\n'), '|a|\n');
    assert.equal(out('| a |'), '|a|');
    assert.equal(out('a\n\n\n'), 'a\n\n\n');
  });

  test('trimTrailingWhitespace:false leaves non-table lines byte-identical', () => {
    assert.equal(out('text   \n| a   | b |  ', { trimTrailingWhitespace: false }), 'text   \na|b');
    assert.equal(out('text   '), 'text');
  });

  test('empty, null and non-string input', () => {
    assert.deepEqual(compactMarkdown(''), {
      output: '', stats: { inputChars: 0, outputChars: 0, saved: 0, percent: 0, tablesFound: 0, rowsChanged: 0 },
    });
    assert.equal(out(null), '');
    assert.equal(out(undefined), '');
    assert.equal(out(123), '123');
  });

  test('keep mode can make a row longer; saved may be negative', () => {
    const r = compactMarkdown('a|b', { outerPipes: 'keep' });
    assert.equal(r.output, 'a|b');
    assert.equal(r.stats.saved, 0);
    const r2 = compactMarkdown('a|b\n-|-', { outerPipes: 'keep' });
    assert.equal(r2.output, '|a|b|\n|-|-|');
    assert.equal(r2.stats.saved, -4);
    assert.equal(r2.stats.percent, -57);
  });

  test('a pipe-only line is left as is', () => {
    assert.equal(out('|'), '|');
  });

  test('header/delimiter cell count mismatch is not a table (GFM)', () => {
    const text = 'a | b | c\n--- | ---';
    assert.equal(out(text), text);
    assert.equal(compactMarkdown(text).stats.tablesFound, 0);
  });

  test('large realistic document round-trip', () => {
    const doc = [
      '# Results',
      '',
      'We compare models in Table 1.',
      '',
      '| Model        | Params | Top-1 | Notes            |',
      '| :----------- | -----: | :---: | ---------------- |',
      '| ResNet-50    |    25M |  76.1 | baseline         |',
      '| ViT-B/16     |    86M |  81.8 | `lr\\|wd` sweep   |',
      '| ConvNeXt-T   |    28M |  82.1 | a \\| b           |',
      '',
      '```python',
      'print("| not | a | table |")',
      '```',
      '',
      '> | q | r |',
      '> |---|---|',
      '> | 1 | 2 |',
      '',
    ].join('\n');
    const r = compactMarkdown(doc);
    assert.equal(r.output, [
      '# Results',
      '',
      'We compare models in Table 1.',
      '',
      'Model|Params|Top-1|Notes',
      ':-|-:|:-:|-',
      'ResNet-50|25M|76.1|baseline',
      'ViT-B/16|86M|81.8|`lr\\|wd` sweep',
      'ConvNeXt-T|28M|82.1|a \\| b',
      '',
      '```python',
      'print("| not | a | table |")',
      '```',
      '',
      '> q|r',
      '> -|-',
      '> 1|2',
      '',
    ].join('\n'));
    assert.equal(r.stats.tablesFound, 2);
    assert.equal(r.stats.rowsChanged, 8);
    assert.equal(r.stats.saved, doc.length - r.output.length);
  });
});
