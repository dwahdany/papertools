// Live checks against the real public APIs. Skipped unless LIVE=1:
//
//   LIVE=1 node --test tests/live-resolve.test.js
//
// They document what the resolver chain does with real data (CORS rules do
// not apply in Node, so the arXiv Atom API and direct page fetches work here
// even when they would not in a browser). Semantic Scholar's shared pool is
// often rate-limited; tests that depend on it skip with a message instead of
// failing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReference, ResolveError } from '../public/assets/resolve.js';

const LIVE = process.env.LIVE === '1';
const skipReason = LIVE ? false : 'set LIVE=1 to run against the real APIs';
const log = (label, value) => console.log(`[live] ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
const sourcesOf = (r) => r.sources.map((s) => `${s.name}:${s.status}${s.detail ? `(${s.detail})` : ''}`).join(' ');

/** Was Semantic Scholar's rate limit the reason an attempt failed? */
const rateLimited = (sources) => sources.some((s) => s.name === 'semanticscholar' && s.status === 'failed' && s.detail === 'rate limited');

test('DOI 10.1038/nature14539 -> LeCun et al. 2015 Nature article via Crossref', { skip: skipReason }, async () => {
  const r = await resolveReference('10.1038/nature14539');
  log('nature14539', sourcesOf(r));
  assert.equal(r.source, 'crossref');
  assert.equal(r.reference.type, 'article-journal');
  assert.equal(r.reference.title, 'Deep learning');
  assert.equal(r.reference.containerTitle, 'Nature');
  assert.equal(r.reference.volume, '521');
  assert.equal(r.reference.year, 2015);
  assert.deepEqual(r.reference.author.map((a) => a.family), ['LeCun', 'Bengio', 'Hinton']);
  assert.equal(r.reference.doi, '10.1038/nature14539');
});

test('arXiv 1706.03762 -> preprint with 8 authors (2017) via DataCite', { skip: skipReason }, async () => {
  const r = await resolveReference('https://arxiv.org/abs/1706.03762');
  log('arxiv 1706.03762', sourcesOf(r));
  log('arxiv warnings', r.warnings);
  assert.equal(r.source, 'datacite');
  assert.equal(r.reference.type, 'preprint');
  assert.equal(r.reference.archive, 'arXiv');
  assert.equal(r.reference.archiveId, '1706.03762');
  assert.equal(r.reference.title, 'Attention Is All You Need');
  assert.equal(r.reference.author.length, 8);
  assert.equal(r.reference.year, 2017);
  assert.equal(r.reference.doi, '10.48550/arXiv.1706.03762');
  assert.equal(r.reference.url, 'https://arxiv.org/abs/1706.03762');
});

test('PubMed 31452104 -> article with a DOI (PubMed indexes it as a journal article; Crossref knows it is a Springer book chapter)', { skip: skipReason }, async () => {
  const r = await resolveReference('https://pubmed.ncbi.nlm.nih.gov/31452104/');
  log('pubmed 31452104', sourcesOf(r));
  log('pubmed reference', r.reference);
  assert.ok(['article-journal', 'chapter'].includes(r.reference.type), r.reference.type);
  assert.equal(r.reference.doi, '10.1007/978-1-4939-9752-7_10');
  assert.match(r.reference.title, /^Molegro Virtual Docker for Docking$/);
  assert.equal(r.reference.author.length, 2);
  assert.equal(r.reference.author[0].family, 'Bitencourt-Ferreira');
  assert.equal(r.reference.year, 2019);
  if (r.source === 'crossref') {
    assert.equal(r.reference.type, 'chapter');
    assert.equal(r.reference.containerTitle, 'Docking Screens for Drug Discovery');
    assert.equal(r.reference.collectionTitle, 'Methods in Molecular Biology');
  }
});

test('ISBN 9780262035613 -> "Deep Learning" by Goodfellow et al. via Open Library', { skip: skipReason }, async () => {
  const r = await resolveReference('9780262035613');
  log('isbn', sourcesOf(r));
  assert.equal(r.source, 'openlibrary');
  assert.equal(r.reference.type, 'book');
  assert.match(r.reference.title, /^Deep Learning/);
  // Open Library lists Francis Bach (the series editor) as a fourth author and dates the
  // edition 3 January 2017; both are their data, so only the shape is asserted here.
  assert.deepEqual(r.reference.author.slice(0, 3).map((a) => a.family), ['Goodfellow', 'Bengio', 'Courville']);
  assert.ok(r.reference.author.length >= 3);
  assert.ok([2016, 2017].includes(r.reference.year), String(r.reference.year));
  assert.equal(r.reference.isbn, '9780262035613');
  assert.match(r.reference.publisher, /MIT Press/);
});

test('PMLR page -> conference paper via html-meta (direct fetch; PMLR sends CORS)', { skip: skipReason }, async () => {
  const r = await resolveReference('https://proceedings.mlr.press/v139/radford21a.html', { metaEndpoint: undefined });
  log('pmlr', sourcesOf(r));
  assert.equal(r.source, 'html-meta');
  assert.equal(r.reference.type, 'paper-conference');
  assert.match(r.reference.title, /^Learning transferable visual models from natural language supervision$/i);
  assert.equal(r.reference.author.length, 12);
  assert.equal(r.reference.author[0].family, 'Radford');
  assert.equal(r.reference.year, 2021);
  assert.equal(r.reference.volume, '139');
  assert.equal(r.reference.page, '8748-8763');
  assert.deepEqual(r.sources.map((s) => `${s.name}:${s.status}`), ['api-meta:skipped', 'direct:ok']);
});

test('OpenReview forum -> success, or a ResolveError that names OpenReview and keeps the URL', { skip: skipReason }, async (t) => {
  const url = 'https://openreview.net/forum?id=rJXMpikCZ';
  try {
    const r = await resolveReference(url);
    log('openreview', sourcesOf(r));
    log('openreview reference', r.reference);
    assert.ok(['openreview', 'semanticscholar', 'crossref', 'datacite', 'doi.org'].includes(r.source));
    assert.ok(r.reference.title);
  } catch (err) {
    assert.ok(err instanceof ResolveError, String(err));
    log('openreview error', err.message);
    log('openreview sources', sourcesOf(err.partial));
    assert.match(err.message, /OpenReview/);
    assert.equal(err.partial.reference.url, url);
    assert.equal(err.partial.reference.type, 'paper-conference');
    assert.ok(err.partial.reference.accessed);
    if (rateLimited(err.partial.sources)) t.diagnostic('Semantic Scholar was rate-limited during this run');
  }
});

test('Blog post without /api/meta -> html-meta via the Wayback Machine, or a url-only partial', { skip: skipReason }, async () => {
  const url = 'https://blog.cloudflare.com/workers-ai/';
  try {
    const r = await resolveReference(url, { metaEndpoint: undefined });
    log('cloudflare blog', sourcesOf(r));
    log('cloudflare reference', r.reference);
    log('cloudflare warnings', r.warnings);
    assert.ok(['html-meta', 'wayback'].includes(r.source), r.source);
    assert.equal(r.reference.type, 'webpage');
    assert.ok(r.reference.title);
    assert.match(r.reference.url, /^https:\/\/blog\.cloudflare\.com\//, 'the original URL is kept, not the archive URL');
    if (r.source === 'wayback') assert.ok(r.warnings.some((w) => /Internet Archive snapshot dated \d{4}-\d{2}-\d{2}/.test(w)));
  } catch (err) {
    assert.ok(err instanceof ResolveError, String(err));
    log('cloudflare error', err.message);
    log('cloudflare sources', sourcesOf(err.partial));
    assert.equal(err.partial.source, 'url-only');
    assert.equal(err.partial.reference.url, url);
    assert.equal(err.partial.reference.containerTitle, 'blog.cloudflare.com');
  }
});

test('Semantic Scholar: ACL id falls back to S2 only when Crossref fails; tolerate 429', { skip: skipReason }, async (t) => {
  const r = await resolveReference('https://aclanthology.org/N19-1423/');
  log('acl N19-1423', sourcesOf(r));
  assert.equal(r.source, 'crossref', 'Crossref has 2017+ ACL DOIs');
  assert.equal(r.reference.type, 'paper-conference');
  assert.match(r.reference.title, /^BERT/);
  assert.equal(r.reference.author[0].family, 'Devlin');
  try {
    const s2 = await resolveReference('https://api.semanticscholar.org/CorpusID:13756489');
    log('s2 CorpusID:13756489', sourcesOf(s2));
    assert.match(s2.reference.title, /attention is all you need/i);
  } catch (err) {
    assert.ok(err instanceof ResolveError, String(err));
    if (rateLimited(err.partial.sources)) { t.diagnostic(`Semantic Scholar rate-limited: ${err.message}`); return; }
    throw err;
  }
});
