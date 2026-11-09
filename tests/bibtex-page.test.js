// Browser-level checks for the BibTeX → APA page (public/bibtex-to-apa/).
// Serves public/ from an in-process static server and drives it with
// Playwright + Chromium; skipped when Playwright is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const PAGE_HTML = await readFile(join(PUBLIC, 'bibtex-to-apa/index.html'), 'utf8');

let chromium = null;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch (_) {
  // Playwright is optional; the browser tests below skip without it.
}
const browserSkip = chromium ? false : 'playwright is not installed';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

/** Serve public/ on an ephemeral port; resolves to { url, close }. */
function serveStatic() {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(PUBLIC, path));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(body);
    } catch (_) {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** Open the page in a fresh browser; the callback gets the Playwright page. */
async function withPage(fn) {
  const site = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${site.url}/bibtex-to-apa/`);
    await page.waitForSelector('#output .placeholder');
    await fn(page);
    assert.deepEqual(errors, [], 'no uncaught page errors');
  } finally {
    await browser.close();
    await site.close();
  }
}

test('markup: #output is a named region, not a live region; the live status line is separate', () => {
  const outputTag = PAGE_HTML.match(/<div[^>]*\bid="output"[^>]*>/)[0];
  assert.doesNotMatch(outputTag, /aria-live/, '#output must not be a live region');
  assert.match(outputTag, /role="region"/);
  assert.match(outputTag, /aria-labelledby="output-label"/);
  const labelTag = PAGE_HTML.match(/<(\w+)[^>]*\bid="output-label"[^>]*>/);
  assert.notEqual(labelTag[1], 'label', 'the output heading must not be a <label> (it has no control)');
  const statusTag = PAGE_HTML.match(/<p[^>]*\bid="output-status"[^>]*>/)[0];
  assert.match(statusTag, /aria-live="polite"/);
  assert.match(statusTag, /visually-hidden/);
});

test('markup: Notes do not promise a warning for unknown entry types', () => {
  assert.match(PAGE_HTML, /Unknown types are formatted generically\./);
  assert.doesNotMatch(PAGE_HTML, /generically with a warning/);
});

test('page: output region is named "APA references" and the status line counts references', { skip: browserSkip }, async () => {
  await withPage(async (page) => {
    const region = page.getByRole('region', { name: 'APA references' });
    await region.waitFor();
    assert.equal(await region.getAttribute('id'), 'output');
    assert.equal(await page.locator('#output-status').textContent(), 'No references');

    await page.click('#load-example');
    await page.waitForSelector('#output .entry');
    assert.equal(await page.locator('#output .entry').count(), 3);
    assert.equal(await page.locator('#output-status').textContent(), '3 references');

    await page.fill('#input', '@misc{k, title={Only one}, author={Doe, J}, year={2020}}');
    await page.waitForFunction(() => document.querySelectorAll('#output .entry').length === 1);
    assert.equal(await page.locator('#output-status').textContent(), '1 reference');

    await page.click('#clear');
    await page.waitForSelector('#output .placeholder');
    assert.equal(await page.locator('#output-status').textContent(), 'No references');
  });
});

test('page: typing a comment that leaves the references unchanged does not re-render #output', { skip: browserSkip }, async () => {
  await withPage(async (page) => {
    await page.click('#load-example');
    await page.waitForSelector('#output .entry');
    await page.evaluate(() => {
      window.__outputMutations = 0;
      window.__statusMutations = 0;
      new MutationObserver((m) => { window.__outputMutations += m.length; })
        .observe(document.querySelector('#output'), { childList: true, subtree: true, characterData: true });
      new MutationObserver((m) => { window.__statusMutations += m.length; })
        .observe(document.querySelector('#output-status'), { childList: true, subtree: true, characterData: true });
    });
    const textarea = page.locator('#input');
    await textarea.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n% a comment line typed slowly', { delay: 20 });
    // Let the 200 ms input debounce fire at least once after the last key.
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#output .entry').count(), 3, 'the references are still shown');
    assert.equal(await page.evaluate(() => window.__outputMutations), 0, '#output was not rewritten');
    assert.equal(await page.evaluate(() => window.__statusMutations), 0, 'the live status was not re-announced');
  });
});

test('page: the example keeps proper nouns in the ACL proceedings title capitalised', { skip: browserSkip }, async () => {
  await withPage(async (page) => {
    await page.check('#opt-sentence-case');
    await page.click('#load-example');
    await page.waitForSelector('#output .entry');
    const devlin = await page.locator('#output .entry .ref').nth(1).textContent();
    assert.match(devlin, /^Devlin, J\./);
    assert.match(devlin, /In Proceedings of the 2019 conference of the North American chapter of the Association for Computational Linguistics \(pp\. 4171–4186\)/);
    assert.doesNotMatch(devlin, /north american/);
  });
});
