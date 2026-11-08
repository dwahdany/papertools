import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  detectIdentifier, resolveReference, ResolveError,
  fromCrossref, fromDatacite, fromArxivAtom, fromSemanticScholar, fromOpenReview,
  fromPubmedSummary, fromOpenLibrary, fromHtmlMeta,
  canonicalUrl, todayIso, fetchJson, fetchText, parseXml, scanHtml, decodeEntities,
  parseFullName, parseDate,
} from '../public/assets/resolve.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(fixture(name));
const NOW = new Date(2026, 10, 8, 12, 0, 0); // 8 Nov 2026, local time
const n = (family, given, extra = {}) => ({ family, given, ...extra });

// ---------------------------------------------------------------------------
// Fake fetch: routes by URL prefix / regex, records calls, supports failures.
// ---------------------------------------------------------------------------

/**
 * @param {Array<[string|RegExp, (url: string, init: any) => Response|Promise<Response>|{status?: number, body?: any, text?: string, reject?: Error}]>} routes
 */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    for (const [matcher, responder] of routes) {
      const hit = matcher instanceof RegExp ? matcher.test(url) : url.startsWith(matcher);
      if (!hit) continue;
      const out = await responder(url, init);
      if (out instanceof Response) return out;
      if (out.reject) throw out.reject;
      if (out.text !== undefined) return new Response(out.text, { status: out.status ?? 200, headers: { 'content-type': 'text/plain' } });
      return new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    throw new TypeError(`fakeFetch: no route for ${url}`);
  };
  fn.calls = calls;
  fn.hosts = () => calls.map((c) => new URL(c.url).hostname);
  return fn;
}

const ok = (body) => () => ({ body });
const text = (t) => () => ({ text: t });
const status = (code, body = {}) => () => ({ status: code, body });
const corsFailure = () => ({ reject: new TypeError('Failed to fetch') });
const noSleep = async () => {};

// ---------------------------------------------------------------------------
// detectIdentifier
// ---------------------------------------------------------------------------

describe('detectIdentifier', () => {
  const cases = [
    ['10.1038/nature14539', 'doi', '10.1038/nature14539'],
    ['doi:10.1038/nature14539', 'doi', '10.1038/nature14539'],
    ['DOI: 10.1038/nature14539', 'doi', '10.1038/nature14539'],
    ['https://doi.org/10.1038/nature14539', 'doi', '10.1038/nature14539'],
    ['https://dx.doi.org/10.1038/nature14539', 'doi', '10.1038/nature14539'],
    ['https://www.nature.com/articles/nature14539', 'url', 'https://www.nature.com/articles/nature14539'],
    ['https://dl.acm.org/doi/10.1145/3442188.3445922', 'doi', '10.1145/3442188.3445922'],
    ['https://dl.acm.org/doi/abs/10.1145/3442188.3445922', 'doi', '10.1145/3442188.3445922'],
    ['https://link.springer.com/article/10.1007/s11263-015-0816-y', 'doi', '10.1007/s11263-015-0816-y'],
    ['https://ieeexplore.ieee.org/document/7780459', 'url', 'https://ieeexplore.ieee.org/document/7780459'],
    ['https://onlinelibrary.wiley.com/doi/full/10.1002/abc.123', 'doi', '10.1002/abc.123'],
    ['https://onlinelibrary.wiley.com/doi/epdf/10.1002/abc.123', 'doi', '10.1002/abc.123'],
    ['https://www.sciencedirect.com/science/article/pii/S0893608014002135', 'url', 'https://www.sciencedirect.com/science/article/pii/S0893608014002135'],
    ['https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0123456', 'doi', '10.1371/journal.pone.0123456'],
    ['https://www.tandfonline.com/doi/abs/10.1080/01621459.2017.1319839?journalCode=uasa20', 'doi', '10.1080/01621459.2017.1319839'],
    ['https://www.pnas.org/doi/10.1073/pnas.1611835114', 'doi', '10.1073/pnas.1611835114'],
    ['arXiv:1706.03762', 'arxiv', '1706.03762'],
    ['arxiv:1706.03762v5', 'arxiv', '1706.03762'],
    ['1706.03762', 'arxiv', '1706.03762'],
    ['2301.00001v2', 'arxiv', '2301.00001'],
    ['https://arxiv.org/abs/1706.03762v2', 'arxiv', '1706.03762'],
    ['https://arxiv.org/pdf/1706.03762.pdf', 'arxiv', '1706.03762'],
    ['https://arxiv.org/pdf/1706.03762v1', 'arxiv', '1706.03762'],
    ['http://arxiv.org/abs/1706.03762', 'arxiv', '1706.03762'],
    ['hep-th/9901001', 'arxiv', 'hep-th/9901001'],
    ['https://arxiv.org/abs/hep-th/9901001', 'arxiv', 'hep-th/9901001'],
    ['https://arxiv.org/abs/math.GT/0309136', 'arxiv', 'math.GT/0309136'],
    ['https://openreview.net/forum?id=rJXMpikCZ', 'openreview', 'rJXMpikCZ'],
    ['https://openreview.net/pdf?id=rJXMpikCZ', 'openreview', 'rJXMpikCZ'],
    ['https://openreview.net/forum?id=rJXMpikCZ&noteId=xyz', 'openreview', 'rJXMpikCZ'],
    ['https://pubmed.ncbi.nlm.nih.gov/31452104/', 'pmid', '31452104'],
    ['https://pubmed.ncbi.nlm.nih.gov/31452104', 'pmid', '31452104'],
    ['PMID: 31452104', 'pmid', '31452104'],
    ['pmid 31452104', 'pmid', '31452104'],
    ['PMC6763765', 'pmcid', 'PMC6763765'],
    ['https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6763765/', 'pmcid', 'PMC6763765'],
    ['https://pmc.ncbi.nlm.nih.gov/articles/PMC6763765/', 'pmcid', 'PMC6763765'],
    ['https://aclanthology.org/N19-1423/', 'acl', 'N19-1423'],
    ['https://aclanthology.org/2020.acl-main.1.pdf', 'acl', '2020.acl-main.1'],
    ['https://www.aclweb.org/anthology/N19-1423', 'acl', 'N19-1423'],
    ['N19-1423', 'acl', 'N19-1423'],
    ['https://www.semanticscholar.org/paper/Attention-is-All-you-Need-Vaswani-Shazeer/204e3073870fae3d05bcbc2f6a8e263d9b72e776', 's2', '204e3073870fae3d05bcbc2f6a8e263d9b72e776'],
    ['https://www.semanticscholar.org/paper/204e3073870fae3d05bcbc2f6a8e263d9b72e776', 's2', '204e3073870fae3d05bcbc2f6a8e263d9b72e776'],
    ['https://api.semanticscholar.org/CorpusID:13756489', 's2', 'CorpusID:13756489'],
    ['978-0-262-03561-3', 'isbn', '9780262035613'],
    ['ISBN 0262035618', 'isbn', '0262035618'],
    ['ISBN-13: 978-0262035613', 'isbn', '9780262035613'],
    ['9780262035613', 'isbn', '9780262035613'],
    ['0-306-40615-X', 'isbn', '030640615X'],
    ['https://proceedings.mlr.press/v139/radford21a.html', 'url', 'https://proceedings.mlr.press/v139/radford21a.html'],
    ['https://proceedings.neurips.cc/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html', 'url', 'https://proceedings.neurips.cc/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html'],
    ['https://www.biorxiv.org/content/10.1101/2020.01.01.123456v1', 'doi', '10.1101/2020.01.01.123456'],
    ['https://www.biorxiv.org/content/10.1101/2020.01.01.123456v1.full.pdf', 'doi', '10.1101/2020.01.01.123456'],
    ['https://www.medrxiv.org/content/10.1101/2021.02.02.21251234v2.full', 'doi', '10.1101/2021.02.02.21251234'],
    ['https://www.ssrn.com/abstract=1234567', 'url', 'https://www.ssrn.com/abstract=1234567'],
    ['https://hal.science/hal-01234567', 'url', 'https://hal.science/hal-01234567'],
    ['https://github.com/dwahdany/papertools', 'url', 'https://github.com/dwahdany/papertools'],
    ['www.example.com/page', 'url', 'https://www.example.com/page'],
  ];
  for (const [input, kind, id] of cases) {
    test(`${JSON.stringify(input)} -> ${kind} ${id}`, () => {
      const got = detectIdentifier(input);
      assert.ok(got, 'expected a match');
      assert.equal(got.kind, kind);
      assert.equal(got.id, id);
      assert.equal(got.url, canonicalUrl(got));
    });
  }

  test('returns null for junk', () => {
    for (const bad of ['not a url at all', '', '   ', null, undefined, 42, 'hello', '12345', 'ftp://example.com/x', 'mailto:a@b.c']) {
      assert.equal(detectIdentifier(bad), null, JSON.stringify(bad));
    }
  });

  test('arXiv versions are kept separately', () => {
    assert.equal(detectIdentifier('arxiv:1706.03762v5').version, '5');
    assert.equal(detectIdentifier('https://arxiv.org/abs/1706.03762v2').version, '2');
    assert.equal(detectIdentifier('1706.03762').version, undefined);
    assert.equal(detectIdentifier('1706.03762').url, 'https://arxiv.org/abs/1706.03762');
  });

  test('DOIs: trailing punctuation and publisher suffixes are trimmed, case kept', () => {
    assert.equal(detectIdentifier('10.1023/A:1026654312961.').id, '10.1023/A:1026654312961');
    assert.equal(detectIdentifier('(https://doi.org/10.1000/xyz123)').id, '10.1000/xyz123');
    assert.equal(detectIdentifier('<10.1000/xyz123>').id, '10.1000/xyz123');
    assert.equal(detectIdentifier('10.1016/S0140-6736(20)30183-5').id, '10.1016/S0140-6736(20)30183-5');
    assert.equal(detectIdentifier('https://doi.org/10.1000/xyz123),').id, '10.1000/xyz123');
    assert.equal(detectIdentifier('https://doi.org/10.1000/Mixed.Case/ABC;').id, '10.1000/Mixed.Case/ABC');
    assert.equal(detectIdentifier('https://doi.org/10.1000/abc%2Fdef').id, '10.1000/abc/def');
    assert.equal(detectIdentifier('  10.1038/nature14539  ').id, '10.1038/nature14539');
    assert.equal(detectIdentifier('https://royalsocietypublishing.org/doi/pdf/10.1098/rspa.2020.0001').id, '10.1098/rspa.2020.0001');
  });

  test('canonicalUrl covers every kind', () => {
    assert.equal(canonicalUrl({ kind: 'doi', id: '10.1/x' }), 'https://doi.org/10.1/x');
    assert.equal(canonicalUrl({ kind: 'arxiv', id: '1706.03762' }), 'https://arxiv.org/abs/1706.03762');
    assert.equal(canonicalUrl({ kind: 'pmid', id: '1' }), 'https://pubmed.ncbi.nlm.nih.gov/1/');
    assert.equal(canonicalUrl({ kind: 'pmcid', id: 'PMC1' }), 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/');
    assert.equal(canonicalUrl({ kind: 'openreview', id: 'abc' }), 'https://openreview.net/forum?id=abc');
    assert.equal(canonicalUrl({ kind: 'acl', id: 'N19-1423' }), 'https://aclanthology.org/N19-1423/');
    assert.equal(canonicalUrl({ kind: 's2', id: 'CorpusID:5' }), 'https://api.semanticscholar.org/CorpusID:5');
    assert.equal(canonicalUrl({ kind: 'isbn', id: '9780262035613' }), 'https://openlibrary.org/isbn/9780262035613');
    assert.equal(canonicalUrl({ kind: 'url', id: 'https://x.y/z' }), 'https://x.y/z');
    assert.equal(canonicalUrl(null), '');
  });
});

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

describe('helpers', () => {
  test('decodeEntities', () => {
    assert.equal(decodeEntities('&amp; &lt;b&gt; &quot;q&quot; &#39;a&#39; &#x27;b&#x27; &#8211; &eacute;'), '& <b> "q" \'a\' \'b\' – é');
    assert.equal(decodeEntities('&unknown; &#xZZ; plain'), '&unknown; &#xZZ; plain');
    assert.equal(decodeEntities(''), '');
    assert.equal(decodeEntities(null), '');
  });

  test('parseFullName', () => {
    assert.deepEqual(parseFullName('Ashish Vaswani'), n('Vaswani', 'Ashish'));
    assert.deepEqual(parseFullName('Aidan N. Gomez'), n('Gomez', 'Aidan N.'));
    assert.deepEqual(parseFullName('Gomez, Aidan N.'), n('Gomez', 'Aidan N.'));
    assert.deepEqual(parseFullName('Laurens van der Maaten'), n('Maaten', 'Laurens', { particle: 'van der' }));
    assert.deepEqual(parseFullName('Martin Luther King Jr.'), n('King', 'Martin Luther', { suffix: 'Jr.' }));
    assert.deepEqual(parseFullName('OpenAI'), { literal: 'OpenAI' });
    assert.deepEqual(parseFullName('  Yann   LeCun '), n('LeCun', 'Yann'));
    assert.equal(parseFullName(''), null);
    assert.equal(parseFullName(undefined), null);
  });

  test('parseDate', () => {
    assert.deepEqual(parseDate('2017/06/12'), { year: 2017, month: 6, day: 12 });
    assert.deepEqual(parseDate('2017-06-12'), { year: 2017, month: 6, day: 12 });
    assert.deepEqual(parseDate('2017'), { year: 2017 });
    assert.deepEqual(parseDate('2019 Aug 27'), { year: 2019, month: 8, day: 27 });
    assert.deepEqual(parseDate('2017 Dec'), { year: 2017, month: 12 });
    assert.deepEqual(parseDate('Nov 18, 2016'), { year: 2016, month: 11, day: 18 });
    assert.deepEqual(parseDate('18 November 2016'), { year: 2016, month: 11, day: 18 });
    assert.deepEqual(parseDate('2026-03-04T09:30:00+01:00'), { year: 2026, month: 3, day: 4 });
    assert.deepEqual(parseDate('garbage'), {});
    assert.deepEqual(parseDate(null), {});
  });

  test('todayIso uses the local calendar date', () => {
    assert.equal(todayIso(NOW), '2026-11-08');
    assert.equal(todayIso(new Date(2026, 0, 5)), '2026-01-05');
    assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(todayIso(new Date('invalid')), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('parseXml handles declarations, comments, CDATA, namespaces, self-closing tags', () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><feed xmlns="x"><entry><id>a &amp; b</id><x:cat term="cs.CL"/><s><![CDATA[<raw>]]></s></entry></feed>');
    const feed = root.children[0];
    assert.equal(feed.name, 'feed');
    const entry = feed.children[0];
    assert.equal(entry.children[0].text, 'a & b');
    assert.equal(entry.children[1].name, 'x:cat');
    assert.equal(entry.children[1].attrs.term, 'cs.CL');
    assert.equal(entry.children[2].text, '<raw>');
    assert.doesNotThrow(() => parseXml('<a><b></a>'));
    assert.doesNotThrow(() => parseXml(''));
    assert.doesNotThrow(() => parseXml(null));
  });

  test('scanHtml reads meta in either attribute order, title, canonical, JSON-LD', () => {
    const scan = scanHtml(fixture('html-citation-pmlr.html'));
    assert.equal(scan.meta.citation_title[0], 'Learning Transferable Visual Models From Natural Language Supervision');
    assert.deepEqual(scan.meta.citation_author, ['Radford, Alec', 'Kim, Jong Wook', 'Hallacy, Chris', 'Sutskever, Ilya']);
    assert.equal(scan.canonical, 'https://proceedings.mlr.press/v139/radford21a.html');
    assert.equal(scan.title, 'Learning Transferable Visual Models From Natural Language Supervision');
    const ld = scanHtml(fixture('html-jsonld-blog.html'));
    assert.equal(ld.jsonLd[0]['@type'], 'BlogPosting');
    assert.equal(ld.title, 'Why we built papertools – Example Blog');
    assert.deepEqual(scanHtml('<meta name=viewport content="width=device-width"><script type="application/ld+json">{broken</script>').jsonLd, []);
  });
});

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

describe('fromCrossref', () => {
  test('journal article golden', () => {
    const ref = fromCrossref(json('crossref-journal-article.json').message);
    assert.deepEqual(ref, {
      type: 'article-journal',
      author: [n('LeCun', 'Yann'), n('Bengio', 'Yoshua'), n('Hinton', 'Geoffrey')],
      title: 'Deep learning',
      containerTitle: 'Nature',
      year: 2015, month: 5, day: 27,
      volume: '521', issue: '7553', page: '436-444',
      publisher: 'Springer Science and Business Media LLC',
      doi: '10.1038/nature14539',
      url: 'https://doi.org/10.1038/nature14539',
    });
  });

  test('proceedings article: subtitle appended, literal author, event ignored when container present', () => {
    const ref = fromCrossref(json('crossref-proceedings-article.json').message);
    assert.equal(ref.type, 'paper-conference');
    assert.equal(ref.title, 'On the Dangers of Stochastic Parrots: Can Language Models Be Too Big? 🦜');
    assert.equal(ref.containerTitle, 'Proceedings of the 2021 ACM Conference on Fairness, Accountability, and Transparency');
    assert.equal(ref.collectionTitle, undefined);
    assert.deepEqual(ref.author[3], n('Shmitchell', 'Shmargaret'));
    assert.equal(ref.page, '610-623');
    assert.equal(ref.publisher, 'ACM');
    assert.equal(ref.isbn, '9781450383097');
    assert.deepEqual([ref.year, ref.month, ref.day], [2021, 3, 3]);
  });

  test('proceedings article without container-title falls back to event name', () => {
    const item = { ...json('crossref-proceedings-article.json').message };
    delete item['container-title'];
    assert.equal(fromCrossref(item).containerTitle, "FAccT '21: 2021 ACM Conference on Fairness, Accountability, and Transparency");
  });

  test('bioRxiv posted-content -> preprint with archive, tags stripped, particles kept', () => {
    const ref = fromCrossref(json('crossref-posted-content.json').message);
    assert.equal(ref.type, 'preprint');
    assert.equal(ref.archive, 'bioRxiv');
    assert.equal(ref.title, 'A very important preprint about neurons');
    assert.deepEqual(ref.author[1], n('van der Maaten', 'Laurens'));
    assert.equal(ref.doi, '10.1101/2020.01.01.123456');
  });

  test('arXiv posted-content -> archive arXiv with archiveId from the DOI', () => {
    const ref = fromCrossref({
      type: 'posted-content', subtype: 'preprint', institution: [{ name: 'arXiv' }],
      DOI: '10.48550/arXiv.1706.03762', title: ['Attention Is All You Need'],
      author: [{ given: 'Ashish', family: 'Vaswani' }], issued: { 'date-parts': [[2017]] },
    });
    assert.equal(ref.archive, 'arXiv');
    assert.equal(ref.archiveId, '1706.03762');
    assert.equal(ref.url, 'https://doi.org/10.48550/arXiv.1706.03762');
    assert.equal(ref.year, 2017);
  });

  test('subtitle already contained in title is not duplicated; JATS tags stripped', () => {
    const ref = fromCrossref({
      type: 'journal-article', title: ['Deep <i>learning</i>: a &amp; b'], subtitle: ['A &amp; B'],
      'container-title': ['J'], 'published-print': { 'date-parts': [[2019, 2]] },
    });
    assert.equal(ref.title, 'Deep learning: a & b');
    assert.deepEqual([ref.year, ref.month, ref.day], [2019, 2, undefined]);
  });

  test('type mapping, editors, article-number, series container, date fallbacks', () => {
    assert.equal(fromCrossref({ type: 'book' }).type, 'book');
    assert.equal(fromCrossref({ type: 'monograph' }).type, 'book');
    assert.equal(fromCrossref({ type: 'edited-book' }).type, 'book');
    assert.equal(fromCrossref({ type: 'dataset' }).type, 'dataset');
    assert.equal(fromCrossref({ type: 'peer-review' }).type, 'generic');
    assert.equal(fromCrossref({ type: 'nonsense' }).type, 'generic');
    const chapter = fromCrossref({
      type: 'book-chapter', 'container-title': ['Computer Vision – ECCV 2016', 'Lecture Notes in Computer Science'],
      editor: [{ given: 'Bastian', family: 'Leibe' }], 'article-number': '12', created: { 'date-parts': [[2016, 9, 17]] },
    });
    assert.equal(chapter.type, 'chapter');
    assert.equal(chapter.containerTitle, 'Computer Vision – ECCV 2016');
    assert.equal(chapter.collectionTitle, 'Lecture Notes in Computer Science');
    assert.deepEqual(chapter.editor, [n('Leibe', 'Bastian')]);
    assert.equal(chapter.articleNumber, '12');
    assert.equal(chapter.year, 2016);
    const thesis = fromCrossref({ type: 'dissertation', institution: [{ name: 'MIT' }], degree: ['PhD'] });
    assert.equal(thesis.type, 'thesis');
    assert.equal(thesis.institution, 'MIT');
    const report = fromCrossref({ type: 'report', publisher: 'RAND' });
    assert.equal(report.type, 'report');
    assert.equal(report.institution, 'RAND');
  });

  test('never throws on malformed input', () => {
    assert.deepEqual(fromCrossref(null), { type: 'generic', author: [] });
    assert.deepEqual(fromCrossref({ title: 42, author: 'nope', issued: {} }).author, []);
  });
});

describe('fromDatacite', () => {
  test('arXiv record golden', () => {
    const ref = fromDatacite(json('datacite-arxiv.json').data.attributes);
    assert.equal(ref.type, 'preprint');
    assert.equal(ref.archive, 'arXiv');
    assert.equal(ref.archiveId, '1706.03762');
    assert.equal(ref.title, 'Attention Is All You Need');
    assert.equal(ref.author.length, 8);
    assert.deepEqual(ref.author[5], n('Gomez', 'Aidan N.'));
    assert.equal(ref.year, 2017);
    assert.equal(ref.publisher, 'arXiv');
    assert.equal(ref.url, 'https://arxiv.org/abs/1706.03762');
    assert.equal(ref.doi, '10.48550/arxiv.1706.03762');
  });

  test('dataset with organisational creator, container and publisher object', () => {
    const ref = fromDatacite({
      doi: '10.5281/zenodo.123', titles: [{ title: 'Some data' }, { title: 'Subtitle here', titleType: 'Subtitle' }],
      creators: [{ name: 'World Health Organization', nameType: 'Organizational' }, { name: 'Doe, Jane' }],
      publisher: { name: 'Zenodo' }, publicationYear: 2021, dates: [{ date: '2021-03-04', dateType: 'Issued' }],
      types: { resourceTypeGeneral: 'Dataset' }, container: { type: 'Journal', title: 'Data J', volume: '3', firstPage: '1', lastPage: '9' },
    });
    assert.equal(ref.type, 'dataset');
    assert.equal(ref.title, 'Some data: Subtitle here');
    assert.deepEqual(ref.author, [{ literal: 'World Health Organization' }, n('Doe', 'Jane')]);
    assert.equal(ref.publisher, 'Zenodo');
    assert.deepEqual([ref.year, ref.month, ref.day], [2021, 3, 4]);
    assert.equal(ref.containerTitle, 'Data J');
    assert.equal(ref.page, '1-9');
    assert.equal(ref.url, 'https://doi.org/10.5281/zenodo.123');
  });

  test('never throws on malformed input', () => {
    assert.deepEqual(fromDatacite(undefined), { type: 'generic', author: [] });
    assert.equal(fromDatacite({ types: 'x', titles: 'y', creators: 7 }).type, 'generic');
  });
});

describe('fromArxivAtom', () => {
  test('1706.03762 golden (version stripped, whitespace collapsed, names split)', () => {
    const ref = fromArxivAtom(fixture('arxiv-1706.03762.atom'), '1706.03762');
    assert.deepEqual(ref, {
      type: 'preprint',
      author: [
        n('Vaswani', 'Ashish'), n('Shazeer', 'Noam'), n('Parmar', 'Niki'), n('Uszkoreit', 'Jakob'),
        n('Jones', 'Llion'), n('Gomez', 'Aidan N.'), n('Kaiser', 'Lukasz'), n('Polosukhin', 'Illia'),
      ],
      archive: 'arXiv',
      archiveId: '1706.03762',
      title: 'Attention Is All You Need',
      year: 2017, month: 6, day: 12,
      archiveClass: 'cs.CL',
      url: 'https://arxiv.org/abs/1706.03762',
    });
  });

  test('old-style id with DOI and journal_ref', () => {
    const ref = fromArxivAtom(fixture('arxiv-hep-th-9711200.atom'), 'hep-th/9711200');
    assert.equal(ref.archiveId, 'hep-th/9711200');
    assert.equal(ref.doi, '10.1023/A:1026654312961');
    assert.equal(ref.note, 'Published as: Adv.Theor.Math.Phys.2:231-252,1998');
    assert.deepEqual(ref.author, [n('Maldacena', 'Juan M.')]);
    assert.equal(ref.archiveClass, 'hep-th');
    assert.equal(ref.year, 1997);
  });

  test('error entry / empty feed -> ResolveError', () => {
    assert.throws(() => fromArxivAtom(fixture('arxiv-error.atom'), '1234.5678999'), (e) => e instanceof ResolveError && /arXiv has no paper with id 1234\.5678999/.test(e.message));
    assert.throws(() => fromArxivAtom(fixture('arxiv-empty.atom'), '1706.99999'), (e) => e instanceof ResolveError && /1706\.99999/.test(e.message));
    assert.throws(() => fromArxivAtom('<html>not atom</html>', 'x'), ResolveError);
    assert.throws(() => fromArxivAtom('', 'x'), ResolveError);
  });
});

describe('fromSemanticScholar', () => {
  test('conference paper (ArXiv id + conference venue)', () => {
    const ref = fromSemanticScholar(json('s2-arxiv-attention.json'));
    assert.equal(ref.type, 'paper-conference');
    assert.equal(ref.containerTitle, 'Neural Information Processing Systems');
    assert.equal(ref.volume, undefined, 'the fake ArXiv journal volume must not leak');
    assert.equal(ref.year, 2017);
    assert.equal(ref.archiveId, '1706.03762');
    assert.deepEqual(ref.author[1], n('Shazeer', 'Noam M.'));
    assert.equal(ref.url, 'https://www.semanticscholar.org/paper/204e3073870fae3d05bcbc2f6a8e263d9b72e776');
  });

  test('ACL conference paper with DOI and pages', () => {
    const ref = fromSemanticScholar(json('s2-acl-bert.json'));
    assert.equal(ref.type, 'paper-conference');
    assert.equal(ref.doi, '10.18653/v1/N19-1423');
    assert.equal(ref.page, '4171-4186');
    assert.deepEqual(ref.author[1], n('Chang', 'Ming-Wei'));
  });

  test('journal article', () => {
    const ref = fromSemanticScholar(json('s2-journal.json'));
    assert.equal(ref.type, 'article-journal');
    assert.equal(ref.containerTitle, 'Nature');
    assert.equal(ref.volume, '521');
    assert.equal(ref.page, '436-444');
    assert.equal(ref.pmid, '26017442');
  });

  test('arXiv-only record -> preprint; literal author; null fields tolerated', () => {
    const ref = fromSemanticScholar(json('s2-preprint-only.json'));
    assert.equal(ref.type, 'preprint');
    assert.equal(ref.archive, 'arXiv');
    assert.equal(ref.archiveId, '2401.00001');
    assert.deepEqual(ref.author[1], { literal: 'OpenAI' });
  });

  test('book and generic types; malformed input', () => {
    assert.equal(fromSemanticScholar({ paperId: 'x', title: 'B', publicationTypes: ['Book'] }).type, 'book');
    assert.equal(fromSemanticScholar({ paperId: 'x', title: 'B', publicationTypes: ['BookSection'] }).type, 'chapter');
    assert.equal(fromSemanticScholar({ paperId: 'x', title: 'B', venue: 'Somewhere' }).type, 'generic');
    assert.deepEqual(fromSemanticScholar('x'), { type: 'generic', author: [] });
  });
});

describe('fromOpenReview', () => {
  test('API2 root note -> ICLR paper with expanded venue and bibtex', () => {
    const ref = fromOpenReview(json('openreview-api2.json').notes[0]);
    assert.equal(ref.type, 'paper-conference');
    assert.equal(ref.title, 'Progressive Growing of GANs for Improved Quality, Stability, and Variation');
    assert.deepEqual(ref.author, [n('Karras', 'Tero'), n('Aila', 'Timo'), n('Laine', 'Samuli'), n('Lehtinen', 'Jaakko')]);
    assert.equal(ref.containerTitle, 'International Conference on Learning Representations');
    assert.equal(ref.year, 2018);
    assert.equal(ref.url, 'https://openreview.net/forum?id=rJXMpikCZ');
    assert.match(ref.bibtex, /^@inproceedings\{/);
  });

  test('API1 plain values, "Submitted to" -> preprint on OpenReview', () => {
    const ref = fromOpenReview(json('openreview-api1-submitted.json').notes[0]);
    assert.equal(ref.type, 'preprint');
    assert.equal(ref.archive, 'OpenReview');
    assert.equal(ref.year, 2024);
    assert.equal(ref.note, 'Submitted to ICLR 2024');
    assert.deepEqual(ref.author, [n('Lovelace', 'Ada'), n('Babbage', 'Charles')]);
    assert.equal(ref.bibtex, undefined);
  });

  test('venue expansions and year from cdate', () => {
    const mk = (venue, cdate) => fromOpenReview({ id: 'x', forum: 'x', cdate, content: { title: 'T', authors: ['A B'], venue } });
    assert.equal(mk('NeurIPS 2023 poster').containerTitle, 'NeurIPS poster');
    assert.equal(mk('NeurIPS 2023').containerTitle, 'Advances in Neural Information Processing Systems');
    assert.equal(mk('ICML 2024').containerTitle, 'International Conference on Machine Learning');
    assert.equal(mk('CoRL 2022').containerTitle, 'CoRL');
    assert.equal(mk('CoRL 2022').year, 2022);
    assert.equal(mk('', Date.UTC(2021, 4, 6)).year, 2021);
    assert.deepEqual(fromOpenReview({}), { type: 'paper-conference', author: [] });
  });
});

describe('fromPubmedSummary', () => {
  test('esummary golden', () => {
    const ref = fromPubmedSummary(json('pubmed-esummary.json').result['31452104']);
    assert.equal(ref.type, 'article-journal');
    assert.equal(ref.title, 'An illustrative article about deep learning in medicine');
    assert.deepEqual(ref.author, [n('Vaswani', 'A'), n('Smith', 'M W'), n('de la Torre', 'J M'), { literal: 'The Example Consortium' }]);
    assert.equal(ref.containerTitle, 'Nature communications');
    assert.equal(ref.volume, '10');
    assert.equal(ref.issue, '1');
    assert.equal(ref.page, '3859');
    assert.deepEqual([ref.year, ref.month, ref.day], [2019, 8, 27]);
    assert.equal(ref.doi, '10.1038/s41467-019-11786-6');
    assert.equal(ref.pmid, '31452104');
    assert.equal(ref.pmcid, 'PMC6763765');
    assert.equal(ref.url, 'https://doi.org/10.1038/s41467-019-11786-6');
  });

  test('DOI from elocationid, source fallback, url from PMID', () => {
    const ref = fromPubmedSummary({ uid: '1', title: 'T.', source: 'J Abbrev', pubdate: '2001 Jan', elocationid: 'doi: 10.1000/abc', authors: [] });
    assert.equal(ref.doi, '10.1000/abc');
    assert.equal(ref.containerTitle, 'J Abbrev');
    assert.deepEqual([ref.year, ref.month], [2001, 1]);
    const noDoi = fromPubmedSummary({ uid: '7', title: 'T', articleids: [{ idtype: 'pubmed', value: '7' }] });
    assert.equal(noDoi.url, 'https://pubmed.ncbi.nlm.nih.gov/7/');
    assert.deepEqual(fromPubmedSummary([]), { type: 'article-journal', author: [] });
  });
});

describe('fromOpenLibrary', () => {
  test('book golden', () => {
    const ref = fromOpenLibrary(json('openlibrary-9780262035613.json')['ISBN:9780262035613']);
    assert.equal(ref.type, 'book');
    assert.equal(ref.title, 'Deep Learning: Adaptive Computation and Machine Learning series');
    assert.deepEqual(ref.author, [n('Goodfellow', 'Ian'), n('Bengio', 'Yoshua'), n('Courville', 'Aaron')]);
    assert.equal(ref.publisher, 'The MIT Press');
    assert.deepEqual([ref.year, ref.month, ref.day], [2016, 11, 18]);
    assert.equal(ref.isbn, '9780262035613');
    assert.equal(ref.url, 'https://openlibrary.org/books/OL26485827M/Deep_Learning');
  });

  test('year-only date and fallbacks', () => {
    const ref = fromOpenLibrary({ title: 'X', publish_date: '2016', identifiers: { isbn_10: ['0262035618'] } });
    assert.deepEqual([ref.year, ref.month], [2016, undefined]);
    assert.equal(ref.url, 'https://openlibrary.org/isbn/0262035618');
    assert.deepEqual(fromOpenLibrary(42), { type: 'book', author: [] });
  });
});

describe('fromHtmlMeta', () => {
  test('citation_* tags -> conference paper (PMLR)', () => {
    const ref = fromHtmlMeta(fixture('html-citation-pmlr.html'), 'https://proceedings.mlr.press/v139/radford21a.html?x=1', NOW);
    assert.deepEqual(ref, {
      type: 'paper-conference',
      author: [n('Radford', 'Alec'), n('Kim', 'Jong Wook'), n('Hallacy', 'Chris'), n('Sutskever', 'Ilya')],
      title: 'Learning Transferable Visual Models From Natural Language Supervision',
      year: 2021, month: 7, day: 1,
      containerTitle: 'Proceedings of the 38th International Conference on Machine Learning',
      volume: '139',
      page: '8748-8763',
      publisher: 'PMLR',
      pdfUrl: 'http://proceedings.mlr.press/v139/radford21a/radford21a.pdf',
      url: 'https://proceedings.mlr.press/v139/radford21a.html',
      accessed: '2026-11-08',
    });
  });

  test('citation_* journal article with DOI, "First Last" authors', () => {
    const ref = fromHtmlMeta(fixture('html-citation-doi.html'), 'https://www.nature.com/articles/nature14539', NOW);
    assert.equal(ref.type, 'article-journal');
    assert.equal(ref.doi, '10.1038/nature14539');
    assert.equal(ref.containerTitle, 'Nature');
    assert.deepEqual(ref.author[0], n('LeCun', 'Yann'));
    assert.equal(ref.issue, '7553');
    assert.equal(ref.page, '436-444');
    assert.deepEqual([ref.year, ref.month, ref.day], [2015, 5, 27]);
  });

  test('JSON-LD BlogPosting -> webpage with entities decoded and org author', () => {
    const ref = fromHtmlMeta(fixture('html-jsonld-blog.html'), 'https://blog.example.com/posts/why-papertools?utm=1', NOW);
    assert.equal(ref.type, 'webpage');
    assert.equal(ref.title, "Why we built papertools & what's next");
    assert.deepEqual(ref.author, [n('Public', 'Jane Q.'), { literal: 'Example Labs' }]);
    assert.deepEqual([ref.year, ref.month, ref.day], [2026, 3, 4]);
    assert.equal(ref.containerTitle, 'Example Blog');
    assert.equal(ref.url, 'https://blog.example.com/posts/why-papertools');
    assert.equal(ref.accessed, '2026-11-08');
  });

  test('Open Graph / standard meta -> webpage, URL-shaped authors skipped, hostname as site', () => {
    const ref = fromHtmlMeta(fixture('html-og-only.html'), 'https://www.dailyexample.com/news/story', NOW);
    assert.equal(ref.type, 'webpage');
    assert.equal(ref.title, 'Some news story & more');
    assert.deepEqual(ref.author, [n('Doe', 'John')]);
    assert.deepEqual([ref.year, ref.month, ref.day], [2024, 11, 5]);
    assert.equal(ref.containerTitle, 'dailyexample.com');
    assert.equal(ref.url, 'https://www.dailyexample.com/news/story');
  });

  test('other citation types and a DOM-like document', () => {
    const html = '<head><meta name="citation_title" content="Thesis T"><meta name="citation_author" content="Doe, J"><meta name="citation_dissertation_institution" content="MIT"><meta name="citation_date" content="2020"></head>';
    const ref = fromHtmlMeta(html, 'https://dspace.mit.edu/x', NOW);
    assert.equal(ref.type, 'thesis');
    assert.equal(ref.institution, 'MIT');
    assert.equal(ref.year, 2020);
    const arxiv = fromHtmlMeta('<meta name="citation_title" content="P"><meta name="citation_arxiv_id" content="arXiv:2401.00001">', 'https://arxiv.org/abs/2401.00001', NOW);
    assert.equal(arxiv.type, 'preprint');
    assert.equal(arxiv.archiveId, '2401.00001');
    const report = fromHtmlMeta('<meta name="citation_title" content="R"><meta name="citation_technical_report_institution" content="RAND"><meta name="citation_technical_report_number" content="RR-1"><meta name="citation_online_date" content="2019/05/01">', 'https://rand.org/x', NOW);
    assert.equal(report.type, 'report');
    assert.equal(report.number, 'RR-1');
    assert.deepEqual([report.year, report.month], [2019, 5]);
    const fakeDoc = { documentElement: { outerHTML: '<html><head><title>Doc title</title></head></html>' } };
    assert.equal(fromHtmlMeta(fakeDoc, 'https://www.example.org/', NOW).title, 'Doc title');
  });

  test('empty / malformed input never throws', () => {
    assert.deepEqual(fromHtmlMeta('', 'https://www.example.org/x', NOW), { type: 'webpage', author: [], containerTitle: 'example.org', url: 'https://www.example.org/x', accessed: '2026-11-08' });
    assert.equal(fromHtmlMeta(null, 'nonsense', NOW).type, 'webpage');
    assert.equal(fromHtmlMeta('<meta name="citation_title" content="x" <broken', 'https://a.b/', NOW).title, 'x');
  });
});

// ---------------------------------------------------------------------------
// fetch helpers
// ---------------------------------------------------------------------------

describe('fetchJson / fetchText', () => {
  test('sends an Accept header and parses JSON', async () => {
    const f = fakeFetch([['https://api.example/', ok({ a: 1 })]]);
    assert.deepEqual(await fetchJson('https://api.example/x', { fetch: f }), { a: 1 });
    assert.equal(f.calls[0].init.headers.Accept, 'application/json');
    assert.ok(f.calls[0].init.signal instanceof AbortSignal);
  });

  test('HTTP errors produce friendly messages with status', async () => {
    const f = fakeFetch([['https://api.crossref.org/', status(404)]]);
    await assert.rejects(fetchJson('https://api.crossref.org/works/10.1000/xyz', { fetch: f, service: 'Crossref', subject: '10.1000/xyz' }),
      (e) => e instanceof ResolveError && e.status === 404 && e.message === 'Crossref returned 404 for 10.1000/xyz (not found)');
    const f2 = fakeFetch([['https://x.y/', status(503)]]);
    await assert.rejects(fetchText('https://x.y/z', { fetch: f2 }), /x\.y returned 503 \(server error\)/);
  });

  test('network failures and invalid JSON are wrapped', async () => {
    const f = fakeFetch([['https://blocked.example/', corsFailure]]);
    await assert.rejects(fetchJson('https://blocked.example/x', { fetch: f }), (e) => e instanceof ResolveError && e.networkError === true && /Could not reach blocked\.example/.test(e.message));
    const f2 = fakeFetch([['https://x.y/', text('<html>')]]);
    await assert.rejects(fetchJson('https://x.y/', { fetch: f2, service: 'X' }), /not valid JSON/);
  });

  test('timeout aborts the request', async () => {
    const f = async (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason)); });
    await assert.rejects(fetchJson('https://slow.example/', { fetch: f, timeoutMs: 20, service: 'Slow' }), /Slow did not respond within 0 s/);
  });

  test('external abort signal is honoured', async () => {
    const controller = new AbortController();
    const f = async (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    const p = fetchJson('https://slow.example/', { fetch: f, signal: controller.signal });
    controller.abort();
    await assert.rejects(p, /cancelled/);
  });
});

// ---------------------------------------------------------------------------
// resolveReference end-to-end with routed fake fetch
// ---------------------------------------------------------------------------

describe('resolveReference', () => {
  const opts = (f) => ({ fetch: f, now: NOW, sleep: noSleep });

  test('DOI happy path via Crossref', async () => {
    const f = fakeFetch([['https://api.crossref.org/works/10.1038%2Fnature14539', ok(json('crossref-journal-article.json'))]]);
    const r = await resolveReference('https://doi.org/10.1038/nature14539', opts(f));
    assert.equal(r.source, 'crossref');
    assert.equal(r.reference.title, 'Deep learning');
    assert.equal(r.identifier.kind, 'doi');
    assert.deepEqual(r.warnings, []);
    assert.equal(f.calls.length, 1);
  });

  test('DOI 404 at Crossref -> DataCite fallback with warning', async () => {
    const f = fakeFetch([
      ['https://api.crossref.org/', status(404)],
      ['https://api.datacite.org/dois/10.48550%2FarXiv.1706.03762', ok(json('datacite-arxiv.json'))],
    ]);
    const r = await resolveReference('10.48550/arXiv.1706.03762', opts(f));
    assert.equal(r.source, 'datacite');
    assert.equal(r.reference.archiveId, '1706.03762');
    assert.deepEqual(r.warnings, ['Crossref returned 404 for 10.48550/arXiv.1706.03762 (not found)']);
    assert.deepEqual(f.hosts(), ['api.crossref.org', 'api.datacite.org']);
  });

  test('DOI unknown everywhere -> ResolveError with partial carrying the DOI', async () => {
    const f = fakeFetch([['https://api.crossref.org/', status(404)], ['https://api.datacite.org/', status(404)]]);
    await assert.rejects(resolveReference('10.1000/nothing', opts(f)), (e) => {
      assert.ok(e instanceof ResolveError);
      assert.match(e.message, /DataCite returned 404/);
      assert.equal(e.partial.source, 'url-only');
      assert.equal(e.partial.reference.doi, '10.1000/nothing');
      assert.equal(e.partial.reference.url, 'https://doi.org/10.1000/nothing');
      assert.equal(e.partial.warnings.length, 2);
      return true;
    });
  });

  test('arXiv happy path; journal_ref/DOI produce a "published version" warning', async () => {
    const f = fakeFetch([['https://export.arxiv.org/api/query?id_list=hep-th%2F9711200', text(fixture('arxiv-hep-th-9711200.atom'))]]);
    const r = await resolveReference('https://arxiv.org/abs/hep-th/9711200v3', opts(f));
    assert.equal(r.source, 'arxiv');
    assert.equal(r.reference.type, 'preprint');
    assert.equal(r.reference.doi, '10.1023/A:1026654312961');
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /A published version exists \(DOI 10\.1023\/A:1026654312961\)/);
    assert.match(f.calls[0].init.headers.Accept, /atom/);
  });

  test('arXiv plain happy path has no warnings', async () => {
    const f = fakeFetch([['https://export.arxiv.org/api/query?id_list=1706.03762', text(fixture('arxiv-1706.03762.atom'))]]);
    const r = await resolveReference('arXiv:1706.03762v5', opts(f));
    assert.equal(r.reference.archiveId, '1706.03762');
    assert.equal(r.identifier.version, '5');
    assert.deepEqual(r.warnings, []);
  });

  test('arXiv unknown id -> Semantic Scholar fallback (no Crossref re-resolve for arXiv DOIs)', async () => {
    const f = fakeFetch([
      ['https://export.arxiv.org/', text(fixture('arxiv-error.atom'))],
      ['https://api.semanticscholar.org/graph/v1/paper/ARXIV:2401.00001?fields=', ok(json('s2-preprint-only.json'))],
    ]);
    const r = await resolveReference('2401.00001', opts(f));
    assert.equal(r.source, 'semanticscholar');
    assert.equal(r.reference.type, 'preprint');
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /arXiv has no paper with id 2401\.00001/);
    assert.deepEqual(f.hosts(), ['export.arxiv.org', 'api.semanticscholar.org']);
  });

  test('arXiv requests are serialised (one at a time)', async () => {
    let inFlight = 0; let maxInFlight = 0;
    const f = async (url) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(fixture('arxiv-1706.03762.atom'), { status: 200 });
    };
    await Promise.all(['1706.03762', '1706.03762v2', 'arXiv:1706.03762'].map((id) => resolveReference(id, opts(f))));
    assert.equal(maxInFlight, 1);
  });

  test('OpenReview API2 happy path exposes bibtex', async () => {
    const f = fakeFetch([['https://api2.openreview.net/notes?forum=rJXMpikCZ', ok(json('openreview-api2.json'))]]);
    const r = await resolveReference('https://openreview.net/pdf?id=rJXMpikCZ', opts(f));
    assert.equal(r.source, 'openreview');
    assert.equal(r.reference.containerTitle, 'International Conference on Learning Representations');
    assert.equal(r.reference.bibtex, undefined);
    assert.match(r.bibtex, /karras2018progressive/);
    assert.deepEqual(r.warnings, []);
  });

  test('OpenReview API2 failure -> API1 -> S2 URL fallback', async () => {
    const f = fakeFetch([
      ['https://api2.openreview.net/', status(500)],
      ['https://api.openreview.net/', ok({ notes: [] })],
      [/^https:\/\/api\.semanticscholar\.org\/graph\/v1\/paper\/URL:https%3A%2F%2Fopenreview\.net%2Fforum%3Fid%3DrJXMpikCZ\?fields=/, ok(json('s2-arxiv-attention.json'))],
    ]);
    const r = await resolveReference('https://openreview.net/forum?id=rJXMpikCZ', opts(f));
    assert.equal(r.source, 'semanticscholar');
    assert.equal(r.warnings.length, 2);
    assert.match(r.warnings[0], /OpenReview API2 returned 500/);
    assert.match(r.warnings[1], /OpenReview API1 has no note for rJXMpikCZ/);
  });

  test('PubMed -> Crossref re-resolve, falling back to the PubMed mapping when Crossref fails', async () => {
    const f = fakeFetch([
      ['https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=31452104&retmode=json', ok(json('pubmed-esummary.json'))],
      ['https://api.crossref.org/works/10.1038%2Fs41467-019-11786-6', ok(json('crossref-s41467.json'))],
    ]);
    const r = await resolveReference('PMID: 31452104', opts(f));
    assert.equal(r.source, 'crossref');
    assert.equal(r.reference.containerTitle, 'Nature Communications');
    assert.equal(r.reference.articleNumber, '3859');
    assert.deepEqual(r.reference.author[1], n('Smith', 'Mary W.'));
    assert.deepEqual(f.hosts(), ['eutils.ncbi.nlm.nih.gov', 'api.crossref.org']);

    const f2 = fakeFetch([
      ['https://eutils.ncbi.nlm.nih.gov/', ok(json('pubmed-esummary.json'))],
      ['https://api.crossref.org/', corsFailure],
      ['https://api.datacite.org/', status(404)],
    ]);
    const r2 = await resolveReference('https://pubmed.ncbi.nlm.nih.gov/31452104/', opts(f2));
    assert.equal(r2.source, 'pubmed');
    assert.deepEqual(r2.reference.author[1], n('Smith', 'M W'));
    assert.equal(r2.warnings.length, 2);
  });

  test('PMCID -> esummary db=pmc -> Crossref', async () => {
    const pmcRecord = { ...json('pubmed-esummary.json').result['31452104'] };
    const f = fakeFetch([
      ['https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=6763765&retmode=json', ok({ result: { uids: ['6763765'], 6763765: pmcRecord } })],
      ['https://api.crossref.org/', ok(json('crossref-s41467.json'))],
    ]);
    const r = await resolveReference('PMC6763765', opts(f));
    assert.equal(r.source, 'crossref');
    assert.equal(r.identifier.kind, 'pmcid');
  });

  test('ISBN via Open Library', async () => {
    const f = fakeFetch([['https://openlibrary.org/api/books?bibkeys=ISBN%3A9780262035613&format=json&jscmd=data', ok(json('openlibrary-9780262035613.json'))]]);
    const r = await resolveReference('978-0-262-03561-3', opts(f));
    assert.equal(r.source, 'openlibrary');
    assert.equal(r.reference.type, 'book');
    assert.equal(r.reference.publisher, 'The MIT Press');
    const f2 = fakeFetch([['https://openlibrary.org/', ok({})]]);
    await assert.rejects(resolveReference('9780262035613', opts(f2)), /Open Library has no record for ISBN 9780262035613/);
  });

  test('ACL id via Semantic Scholar, DOI re-resolved through Crossref', async () => {
    const f = fakeFetch([
      ['https://api.semanticscholar.org/graph/v1/paper/ACL:N19-1423?fields=title,authors,year,venue,journal,externalIds,publicationVenue,publicationTypes', ok(json('s2-acl-bert.json'))],
      ['https://api.crossref.org/works/10.18653%2Fv1%2FN19-1423', ok({ message: { type: 'proceedings-article', title: ['BERT'], DOI: '10.18653/v1/N19-1423', 'container-title': ['Proceedings of NAACL-HLT 2019'], issued: { 'date-parts': [[2019, 6]] }, author: [{ given: 'Jacob', family: 'Devlin' }] } })],
    ]);
    const r = await resolveReference('https://aclanthology.org/N19-1423/', opts(f));
    assert.equal(r.source, 'crossref');
    assert.equal(r.reference.containerTitle, 'Proceedings of NAACL-HLT 2019');
    assert.deepEqual(f.hosts(), ['api.semanticscholar.org', 'api.crossref.org']);
  });

  test('S2 paper id and CorpusID lookups; Crossref failure falls back to the S2 mapping', async () => {
    const f = fakeFetch([
      ['https://api.semanticscholar.org/graph/v1/paper/a4cec122a08216fe8a3bc19b22e78fbaea096256?fields=', ok(json('s2-journal.json'))],
      ['https://api.crossref.org/', status(500)],
      ['https://api.datacite.org/', status(500)],
    ]);
    const r = await resolveReference('https://www.semanticscholar.org/paper/Deep-Learning-LeCun/a4cec122a08216fe8a3bc19b22e78fbaea096256', opts(f));
    assert.equal(r.source, 'semanticscholar');
    assert.equal(r.reference.type, 'article-journal');
    assert.equal(r.warnings.length, 2);
    const f2 = fakeFetch([['https://api.semanticscholar.org/graph/v1/paper/CorpusID:13756489?fields=', ok(json('s2-arxiv-attention.json'))]]);
    const r2 = await resolveReference('https://api.semanticscholar.org/CorpusID:13756489', opts(f2));
    assert.equal(r2.source, 'semanticscholar');
    assert.equal(r2.reference.containerTitle, 'Neural Information Processing Systems');
  });

  test('S2 429 -> waits 1.5 s and retries once', async () => {
    let n429 = 0;
    const f = fakeFetch([[/semanticscholar/, () => (n429++ === 0 ? { status: 429 } : { body: json('s2-preprint-only.json') })]]);
    const sleeps = [];
    const r = await resolveReference('https://api.semanticscholar.org/CorpusID:999999', { fetch: f, now: NOW, sleep: async (ms) => { sleeps.push(ms); } });
    assert.equal(r.source, 'semanticscholar');
    assert.deepEqual(sleeps, [1500]);
    assert.equal(f.calls.length, 2);

    const always429 = fakeFetch([[/semanticscholar/, status(429)]]);
    await assert.rejects(resolveReference('CorpusID:1', opts(always429)), /Semantic Scholar returned 429 for CorpusID:1 \(rate limited/);
    assert.equal(always429.calls.length, 2);
  });

  test('URL on a known host -> S2 URL lookup first', async () => {
    const f = fakeFetch([
      [/^https:\/\/api\.semanticscholar\.org\/graph\/v1\/paper\/URL:https%3A%2F%2Fdl\.acm\.org%2Fconference%2Ffaccct\?fields=/, ok(json('s2-journal.json'))],
      ['https://api.crossref.org/works/10.1038%2Fnature14539', ok(json('crossref-journal-article.json'))],
    ]);
    const r = await resolveReference('https://dl.acm.org/conference/faccct', opts(f));
    assert.equal(r.source, 'crossref');
    assert.equal(r.identifier.kind, 'url');
  });

  test('URL with CORS-like failure -> ResolveError with url-only partial', async () => {
    const f = fakeFetch([['https://www.sciencedirect.com/', corsFailure]]);
    await assert.rejects(resolveReference('https://www.sciencedirect.com/science/article/pii/S0893608014002135', opts(f)), (e) => {
      assert.ok(e instanceof ResolveError);
      assert.match(e.message, /CORS/);
      assert.match(e.message, /sciencedirect\.com/);
      assert.equal(e.partial.source, 'url-only');
      assert.deepEqual(e.partial.reference, {
        type: 'webpage', author: [], title: '', containerTitle: 'sciencedirect.com',
        url: 'https://www.sciencedirect.com/science/article/pii/S0893608014002135', accessed: '2026-11-08',
      });
      assert.equal(e.partial.identifier.kind, 'url');
      assert.equal(e.partial.warnings.length, 1);
      assert.match(e.partial.warnings[0], /Could not reach sciencedirect\.com/);
      return true;
    });
    assert.equal(f.calls.length, 1, 'unknown hosts must not be sent to Semantic Scholar');
    assert.match(f.calls[0].init.headers.Accept, /text\/html/);
  });

  test('URL whose HTML has citation_* tags -> html-meta', async () => {
    const f = fakeFetch([['https://proceedings.mlr.press/v139/radford21a.html', text(fixture('html-citation-pmlr.html'))]]);
    const r = await resolveReference('https://proceedings.mlr.press/v139/radford21a.html', opts(f));
    assert.equal(r.source, 'html-meta');
    assert.equal(r.reference.type, 'paper-conference');
    assert.equal(r.reference.containerTitle, 'Proceedings of the 38th International Conference on Machine Learning');
    assert.equal(r.reference.accessed, '2026-11-08');
    assert.deepEqual(r.warnings, []);
  });

  test('URL whose HTML has citation_doi -> Crossref re-resolve', async () => {
    const f = fakeFetch([
      ['https://www.nature.com/articles/nature14539', text(fixture('html-citation-doi.html'))],
      ['https://api.crossref.org/works/10.1038%2Fnature14539', ok(json('crossref-journal-article.json'))],
    ]);
    const r = await resolveReference('https://www.nature.com/articles/nature14539', opts(f));
    assert.equal(r.source, 'crossref');
    assert.equal(r.reference.publisher, 'Springer Science and Business Media LLC');
    assert.deepEqual(f.hosts(), ['www.nature.com', 'api.crossref.org']);
  });

  test('URL whose HTML has citation_arxiv_id -> arXiv re-resolve', async () => {
    const f = fakeFetch([
      ['https://example.org/paper', text('<head><meta name="citation_title" content="Attention"><meta name="citation_arxiv_id" content="1706.03762"></head>')],
      ['https://export.arxiv.org/', text(fixture('arxiv-1706.03762.atom'))],
    ]);
    const r = await resolveReference('https://example.org/paper', opts(f));
    assert.equal(r.source, 'arxiv');
    assert.equal(r.reference.author.length, 8);
  });

  test('URL with only OG meta -> webpage; page without metadata warns', async () => {
    const f = fakeFetch([['https://www.dailyexample.com/', text(fixture('html-og-only.html'))]]);
    const r = await resolveReference('https://www.dailyexample.com/news/story', opts(f));
    assert.equal(r.source, 'html-meta');
    assert.equal(r.reference.type, 'webpage');
    assert.equal(r.reference.title, 'Some news story & more');
    const f2 = fakeFetch([['https://www.example.org/', text('<html><body>nothing</body></html>')]]);
    const r2 = await resolveReference('https://www.example.org/empty', opts(f2));
    assert.equal(r2.source, 'html-meta');
    assert.equal(r2.warnings.length, 1);
    assert.match(r2.warnings[0], /no usable metadata/);
  });

  test('unrecognised input rejects with ResolveError', async () => {
    await assert.rejects(resolveReference('not a url at all', opts(fakeFetch([]))), (e) => e instanceof ResolveError && e.partial === undefined && /Could not recognise/.test(e.message));
    await assert.rejects(resolveReference('', opts(fakeFetch([]))), ResolveError);
  });

  test('fetch failures never escape as raw errors', async () => {
    const f = fakeFetch([]); // every route throws TypeError
    await assert.rejects(resolveReference('10.1038/nature14539', opts(f)), (e) => e instanceof ResolveError && e.partial.reference.doi === '10.1038/nature14539');
    await assert.rejects(resolveReference('arXiv:1706.03762', opts(f)), (e) => e instanceof ResolveError && e.partial.reference.archiveId === '1706.03762' && e.partial.warnings.length === 2);
  });
});
