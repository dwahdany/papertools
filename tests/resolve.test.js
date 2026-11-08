import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  detectIdentifier, resolveReference, ResolveError,
  fromCrossref, fromDatacite, fromDataciteArxiv, fromCsl, fromArxivAtom, fromSemanticScholar, fromOpenReview,
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

  test('Springer chapter with the series listed first (real PubMed 31452104 -> Crossref order)', () => {
    const ref = fromCrossref({
      type: 'book-chapter', title: ['Molegro Virtual Docker for Docking'], DOI: '10.1007/978-1-4939-9752-7_10',
      'container-title': ['Methods in Molecular Biology', 'Docking Screens for Drug Discovery'], issued: { 'date-parts': [[2019]] },
      author: [{ given: 'Gabriela', family: 'Bitencourt-Ferreira' }, { given: 'Walter Filgueira', family: 'de Azevedo', suffix: 'Jr.' }],
      page: '149-167', publisher: 'Springer New York',
    });
    assert.equal(ref.type, 'chapter');
    assert.equal(ref.containerTitle, 'Docking Screens for Drug Discovery');
    assert.equal(ref.collectionTitle, 'Methods in Molecular Biology');
    assert.deepEqual(ref.author[1], n('de Azevedo', 'Walter Filgueira', { suffix: 'Jr.' }));
    const noHint = fromCrossref({ type: 'book-chapter', 'container-title': ['Some Series', 'Some Book'] });
    assert.equal(noHint.containerTitle, 'Some Book');
    assert.equal(noHint.collectionTitle, 'Some Series');
  });

  test('Springer LNCS chapter (real): series and book split, ISBN, pages', () => {
    const ref = fromCrossref(json('crossref-book-chapter.json').message);
    assert.equal(ref.type, 'chapter');
    assert.equal(ref.title, 'SSD: Single Shot MultiBox Detector');
    assert.equal(ref.containerTitle, 'Computer Vision – ECCV 2016');
    assert.equal(ref.collectionTitle, 'Lecture Notes in Computer Science');
    assert.equal(ref.author.length, 7);
    assert.deepEqual(ref.author[6], n('Berg', 'Alexander C.'));
    assert.equal(ref.page, '21-37');
    assert.equal(ref.publisher, 'Springer International Publishing');
    assert.equal(ref.isbn, '9783319464473');
    assert.equal(ref.year, 2016);
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
    assert.equal(ref.doi, '10.48550/arXiv.1706.03762', 'DataCite lower-cases the DOI; it is normalised');
  });

  test('Zenodo software record (real): version kept, team as sole author', () => {
    const ref = fromDatacite(json('datacite-zenodo-software.json').data.attributes);
    assert.equal(ref.type, 'software');
    assert.equal(ref.title, 'pandas-dev/pandas: Pandas');
    assert.equal(ref.version, 'v3.1.1');
    assert.equal(ref.publisher, 'Zenodo');
    assert.deepEqual([ref.year, ref.month, ref.day], [2026, 11, 4]);
    assert.equal(ref.author.length, 1);
    assert.equal(ref.doi, '10.5281/zenodo.3509134');
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

describe('fromDataciteArxiv', () => {
  test('real DataCite record -> preprint dated by the earliest Submitted date (v1)', () => {
    const ref = fromDataciteArxiv(json('datacite-arxiv.json').data.attributes, '1706.03762');
    assert.equal(ref.type, 'preprint');
    assert.equal(ref.archive, 'arXiv');
    assert.equal(ref.archiveId, '1706.03762');
    assert.equal(ref.title, 'Attention Is All You Need');
    assert.equal(ref.author.length, 8);
    assert.deepEqual(ref.author[0], n('Vaswani', 'Ashish'));
    assert.deepEqual(ref.author[5], n('Gomez', 'Aidan N.'));
    assert.deepEqual([ref.year, ref.month, ref.day], [2017, 6, 12], 'v1 submission date, not the 2023 v7 revision');
    assert.equal(ref.doi, '10.48550/arXiv.1706.03762');
    assert.equal(ref.url, 'https://arxiv.org/abs/1706.03762');
    assert.equal(ref.containerTitle, undefined);
  });

  test('id derived from the DOI; publicationYear fallback; organisational creator', () => {
    const ref = fromDataciteArxiv({
      doi: '10.48550/arxiv.2401.00001', titles: [{ title: 'T' }], publicationYear: 2024, dates: [{ date: '2024', dateType: 'Issued' }],
      creators: [{ name: 'OpenAI', nameType: 'Organizational' }, { givenName: 'Ada', familyName: 'Lovelace', nameType: 'Personal' }],
      publisher: 'arXiv', types: { resourceTypeGeneral: 'Preprint' },
    });
    assert.equal(ref.archiveId, '2401.00001');
    assert.equal(ref.doi, '10.48550/arXiv.2401.00001');
    assert.deepEqual([ref.year, ref.month], [2024, undefined]);
    assert.deepEqual(ref.author, [{ literal: 'OpenAI' }, n('Lovelace', 'Ada')]);
    assert.equal(fromDataciteArxiv(null, 'hep-th/9901001').archiveId, 'hep-th/9901001');
    assert.equal(fromDataciteArxiv(undefined).type, 'preprint');
  });
});

describe('fromCsl', () => {
  test('Crossref CSL-JSON for the Nature article (real doi.org body)', () => {
    const ref = fromCsl(json('csl-nature14539.json'));
    assert.equal(ref.type, 'article-journal');
    assert.equal(ref.title, 'Deep learning');
    assert.deepEqual(ref.author, [n('LeCun', 'Yann'), n('Bengio', 'Yoshua'), n('Hinton', 'Geoffrey')]);
    assert.equal(ref.containerTitle, 'Nature');
    assert.equal(ref.volume, '521');
    assert.equal(ref.issue, '7553');
    assert.equal(ref.page, '436-444');
    assert.deepEqual([ref.year, ref.month, ref.day], [2015, 5, 27]);
    assert.equal(ref.doi, '10.1038/nature14539');
    assert.equal(ref.url, 'https://doi.org/10.1038/nature14539');
    assert.equal(ref.publisher, 'Springer Science and Business Media LLC');
  });

  test('DataCite CSL-JSON: software with a team author, arXiv "article" -> preprint', () => {
    const sw = fromCsl(json('csl-zenodo-software.json'));
    assert.equal(sw.type, 'software');
    assert.equal(sw.title, 'pandas-dev/pandas: Pandas');
    assert.deepEqual(sw.author, [{ literal: 'The pandas development team' }]);
    assert.equal(sw.version, 'v3.1.1');
    assert.equal(sw.publisher, 'Zenodo');
    assert.equal(sw.url, 'https://zenodo.org/doi/10.5281/zenodo.3509134');
    assert.deepEqual([sw.year, sw.month, sw.day], [2026, 11, 4]);
    const ax = fromCsl(json('csl-arxiv-1706.03762.json'));
    assert.equal(ax.type, 'preprint');
    assert.equal(ax.archive, 'arXiv');
    assert.equal(ax.archiveId, '1706.03762');
    assert.equal(ax.doi, '10.48550/arXiv.1706.03762');
    assert.equal(ax.url, 'https://arxiv.org/abs/1706.03762');
    assert.equal(ax.author.length, 8);
    assert.equal(ax.year, 2017);
  });

  test('type map, literal authors, event title, thesis/report institution, malformed input', () => {
    assert.equal(fromCsl({ type: 'paper-conference', title: 'P', 'event-title': 'NeurIPS 2020' }).containerTitle, 'NeurIPS 2020');
    assert.equal(fromCsl({ type: 'book', title: ['B'], ISBN: ['123'] }).isbn, '123');
    assert.equal(fromCsl({ type: 'chapter', 'container-title': 'Big Book' }).containerTitle, 'Big Book');
    const thesis = fromCsl({ type: 'thesis', publisher: 'MIT', genre: 'PhD thesis' });
    assert.equal(thesis.type, 'thesis');
    assert.equal(thesis.institution, 'MIT');
    assert.equal(thesis.genre, 'PhD thesis');
    assert.equal(fromCsl({ type: 'report', number: 'TR-1' }).number, 'TR-1');
    assert.equal(fromCsl({ type: 'dataset' }).type, 'dataset');
    assert.equal(fromCsl({ type: 'webpage' }).type, 'webpage');
    assert.equal(fromCsl({ type: 'post-weblog' }).type, 'webpage');
    assert.equal(fromCsl({ type: 'article', 'container-title': 'J' }).type, 'article-journal');
    assert.equal(fromCsl({ type: 'article' }).type, 'generic');
    assert.deepEqual(fromCsl({ author: [{ literal: 'WHO' }, { family: 'Plato' }, { family: 'van der Maaten', given: 'L' }] }).author,
      [{ literal: 'WHO' }, { family: 'Plato' }, n('van der Maaten', 'L')]);
    assert.deepEqual(fromCsl(null), { type: 'generic', author: [] });
    assert.deepEqual(fromCsl([]), { type: 'generic', author: [] });
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

  test('real PMLR head: 12 "Given Family" authors, conference title, volume from the path', () => {
    const ref = fromHtmlMeta(fixture('html-pmlr-real-head.html'), 'https://proceedings.mlr.press/v139/radford21a.html', NOW);
    assert.equal(ref.type, 'paper-conference');
    assert.equal(ref.title, 'Learning Transferable Visual Models From Natural Language Supervision');
    assert.equal(ref.author.length, 12);
    assert.deepEqual(ref.author[0], n('Radford', 'Alec'));
    assert.deepEqual(ref.author[11], n('Sutskever', 'Ilya'));
    assert.equal(ref.containerTitle, 'International Conference on Machine Learning');
    assert.equal(ref.volume, '139');
    assert.equal(ref.page, '8748-8763');
    assert.equal(ref.publisher, 'PMLR');
    assert.deepEqual([ref.year, ref.month, ref.day], [2021, 7, 1]);
    assert.equal(ref.url, 'https://proceedings.mlr.press/v139/radford21a.html');
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
  // Node has no `location`, so /api/meta is skipped unless metaEndpoint is given.
  const opts = (f, extra = {}) => ({ fetch: f, now: NOW, sleep: noSleep, ...extra });
  const META = 'https://papertools.pages.dev/api/meta';
  const names = (r) => r.sources.map((x) => `${x.name}:${x.status}`);

  test('DOI happy path via Crossref records a single ok source', async () => {
    const f = fakeFetch([['https://api.crossref.org/works/10.1038%2Fnature14539', ok(json('crossref-journal-article.json'))]]);
    const r = await resolveReference('https://doi.org/10.1038/nature14539', opts(f));
    assert.equal(r.source, 'crossref');
    assert.equal(r.reference.title, 'Deep learning');
    assert.equal(r.identifier.kind, 'doi');
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.sources, [{ name: 'crossref', status: 'ok' }]);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init.headers.Accept, 'application/json');
  });

  test('DOI 404 at Crossref (text/plain body) -> DataCite fallback with warning and sources', async () => {
    const f = fakeFetch([
      ['https://api.crossref.org/', () => ({ status: 404, text: fixture('crossref-404.txt') })],
      ['https://api.datacite.org/dois/10.5281%2Fzenodo.3509134', ok(json('datacite-zenodo-software.json'))],
    ]);
    const r = await resolveReference('10.5281/zenodo.3509134', opts(f));
    assert.equal(r.source, 'datacite');
    assert.equal(r.reference.type, 'software');
    assert.deepEqual(r.warnings, ['Crossref returned 404 for 10.5281/zenodo.3509134 (not found)']);
    assert.deepEqual(r.sources, [
      { name: 'crossref', status: 'failed', detail: 'not found', message: 'Crossref returned 404 for 10.5281/zenodo.3509134 (not found)' },
      { name: 'datacite', status: 'ok' },
    ]);
    assert.deepEqual(f.hosts(), ['api.crossref.org', 'api.datacite.org']);
  });

  test('DOI unknown at Crossref and DataCite -> doi.org CSL-JSON fallback (input casing kept)', async () => {
    const f = fakeFetch([
      ['https://api.crossref.org/', status(404)],
      ['https://api.datacite.org/', status(404)],
      ['https://doi.org/10.5281/ZENODO.3509134', ok(json('csl-zenodo-software.json'))],
    ]);
    const r = await resolveReference('10.5281/ZENODO.3509134', opts(f));
    assert.equal(r.source, 'doi.org');
    assert.equal(r.reference.type, 'software');
    assert.equal(r.reference.doi, '10.5281/ZENODO.3509134');
    assert.equal(f.calls[2].init.headers.Accept, 'application/vnd.citationstyles.csl+json');
    assert.deepEqual(names(r), ['crossref:failed', 'datacite:failed', 'doi.org:ok']);
  });

  test('DOI unknown everywhere -> ResolveError with partial carrying the DOI and all three sources', async () => {
    const f = fakeFetch([['https://api.crossref.org/', status(404)], ['https://api.datacite.org/', status(404)], ['https://doi.org/', status(404)]]);
    await assert.rejects(resolveReference('10.1000/nothing', opts(f)), (e) => {
      assert.ok(e instanceof ResolveError);
      assert.match(e.message, /No metadata source knows the DOI 10\.1000\/nothing \(Crossref: not found; DataCite: not found; doi\.org: not found\)/);
      assert.equal(e.partial.source, 'url-only');
      assert.equal(e.partial.reference.doi, '10.1000/nothing');
      assert.equal(e.partial.reference.url, 'https://doi.org/10.1000/nothing');
      assert.equal(e.partial.warnings.length, 4);
      assert.deepEqual(e.partial.sources.map((x) => x.name), ['crossref', 'datacite', 'doi.org']);
      assert.ok(e.partial.sources.every((x) => x.status === 'failed' && x.detail === 'not found'));
      return true;
    });
  });

  test('arXiv DOI skips Crossref and uses the arXiv chain (DataCite)', async () => {
    const f = fakeFetch([['https://api.datacite.org/dois/10.48550%2FarXiv.1706.03762', ok(json('datacite-arxiv.json'))]]);
    const r = await resolveReference('https://doi.org/10.48550/arXiv.1706.03762', opts(f));
    assert.equal(r.source, 'datacite');
    assert.equal(r.identifier.kind, 'doi');
    assert.equal(r.reference.type, 'preprint');
    assert.equal(r.reference.archiveId, '1706.03762');
    assert.equal(r.reference.doi, '10.48550/arXiv.1706.03762');
    assert.deepEqual(r.sources, [{ name: 'crossref', status: 'skipped', detail: 'arXiv DOIs are registered with DataCite' }, { name: 'datacite', status: 'ok' }]);
    assert.deepEqual(f.hosts(), ['api.datacite.org']);
  });

  test('arXiv happy path via DataCite: preprint dated by v1 submission, no warnings, no S2 call', async () => {
    const f = fakeFetch([['https://api.datacite.org/dois/10.48550%2FarXiv.1706.03762', ok(json('datacite-arxiv.json'))]]);
    const r = await resolveReference('arXiv:1706.03762v5', opts(f));
    assert.equal(r.source, 'datacite');
    assert.equal(r.reference.type, 'preprint');
    assert.equal(r.reference.archiveId, '1706.03762');
    assert.equal(r.identifier.version, '5');
    assert.deepEqual([r.reference.year, r.reference.month, r.reference.day], [2017, 6, 12]);
    assert.equal(r.reference.author.length, 8);
    assert.equal(r.reference.url, 'https://arxiv.org/abs/1706.03762');
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.sources, [{ name: 'datacite', status: 'ok' }]);
    assert.deepEqual(f.hosts(), ['api.datacite.org']);
  });

  test('arXiv: DataCite 404 -> Semantic Scholar ARXIV: lookup; published DOI becomes a warning, preprint is cited', async () => {
    const f = fakeFetch([
      ['https://api.datacite.org/', status(404)],
      ['https://api.semanticscholar.org/graph/v1/paper/ARXIV:1706.03762?fields=', ok(json('s2-acl-bert.json'))],
    ]);
    const r = await resolveReference('https://arxiv.org/abs/1706.03762', opts(f));
    assert.equal(r.source, 'semanticscholar');
    assert.equal(r.reference.type, 'preprint');
    assert.equal(r.reference.archive, 'arXiv');
    assert.equal(r.reference.archiveId, '1706.03762');
    assert.equal(r.reference.doi, '10.48550/arXiv.1706.03762');
    assert.equal(r.reference.containerTitle, undefined);
    assert.equal(r.reference.url, 'https://arxiv.org/abs/1706.03762');
    assert.equal(r.warnings.length, 2);
    assert.match(r.warnings[0], /DataCite returned 404/);
    assert.match(r.warnings[1], /A published version exists \(DOI 10\.18653\/v1\/N19-1423\)/);
    assert.deepEqual(names(r), ['datacite:failed', 'semanticscholar:ok']);
    assert.deepEqual(f.hosts(), ['api.datacite.org', 'api.semanticscholar.org'], 'no Crossref re-resolve, no arXiv API');
  });

  test('arXiv: S2 arXiv-only record -> preprint without a published-version warning', async () => {
    const f = fakeFetch([
      ['https://api.datacite.org/', status(404)],
      ['https://api.semanticscholar.org/graph/v1/paper/ARXIV:2401.00001?fields=', ok(json('s2-preprint-only.json'))],
    ]);
    const r = await resolveReference('2401.00001', opts(f));
    assert.equal(r.source, 'semanticscholar');
    assert.equal(r.reference.type, 'preprint');
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /DataCite returned 404/);
  });

  test('arXiv: DataCite and S2 fail -> arXiv Atom API last; journal_ref/DOI produce a "published version" warning', async () => {
    const f = fakeFetch([
      ['https://api.datacite.org/', status(404)],
      [/semanticscholar/, status(404)],
      ['https://export.arxiv.org/api/query?id_list=hep-th%2F9711200', text(fixture('arxiv-hep-th-9711200.atom'))],
    ]);
    const r = await resolveReference('https://arxiv.org/abs/hep-th/9711200v3', opts(f));
    assert.equal(r.source, 'arxiv');
    assert.equal(r.reference.type, 'preprint');
    assert.equal(r.reference.doi, '10.1023/A:1026654312961');
    assert.equal(r.warnings.length, 3);
    assert.match(r.warnings[2], /A published version exists \(DOI 10\.1023\/A:1026654312961\)/);
    assert.match(f.calls[2].init.headers.Accept, /atom/);
    assert.deepEqual(names(r), ['datacite:failed', 'semanticscholar:failed', 'arxiv:failed'].slice(0, 2).concat('arxiv:ok'));
  });

  test('arXiv unknown everywhere (real "no entry" feed) -> ResolveError with preprint partial', async () => {
    const f = fakeFetch([
      ['https://api.datacite.org/', status(404)],
      [/semanticscholar/, status(404)],
      ['https://export.arxiv.org/', text(fixture('arxiv-unknown.atom'))],
    ]);
    await assert.rejects(resolveReference('9999.99999', opts(f)), (e) => {
      assert.ok(e instanceof ResolveError);
      assert.match(e.message, /Could not find arXiv:9999\.99999 \(DataCite: not found; Semantic Scholar: not found; arXiv API: /);
      assert.equal(e.partial.reference.type, 'preprint');
      assert.equal(e.partial.reference.archiveId, '9999.99999');
      assert.equal(e.partial.sources.length, 3);
      return true;
    });
  });

  test('arXiv API requests are serialised (one at a time)', async () => {
    let inFlight = 0; let maxInFlight = 0;
    const f = async (url) => {
      if (!/export\.arxiv\.org/.test(url)) return new Response('{}', { status: 404 });
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(fixture('arxiv-1706.03762.atom'), { status: 200 });
    };
    const results = await Promise.all(['1706.03762', '1706.03762v2', 'arXiv:1706.03762'].map((id) => resolveReference(id, opts(f))));
    assert.equal(maxInFlight, 1);
    assert.ok(results.every((r) => r.source === 'arxiv'));
  });

  test('OpenReview API2 happy path exposes bibtex', async () => {
    const f = fakeFetch([['https://api2.openreview.net/notes?forum=rJXMpikCZ', ok(json('openreview-api2.json'))]]);
    const r = await resolveReference('https://openreview.net/pdf?id=rJXMpikCZ', opts(f));
    assert.equal(r.source, 'openreview');
    assert.equal(r.reference.containerTitle, 'International Conference on Learning Representations');
    assert.equal(r.reference.bibtex, undefined);
    assert.match(r.bibtex, /karras2018progressive/);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.sources, [{ name: 'openreview-api2', status: 'ok' }]);
  });

  test('OpenReview API2 failure -> API1 -> S2 URL fallback with the full forum URL encoded', async () => {
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
    assert.deepEqual(names(r), ['openreview-api2:failed', 'openreview-api1:failed', 'semanticscholar:ok']);
  });

  test('OpenReview anti-bot challenge (real 403 body) everywhere -> ResolveError mentioning OpenReview with a conference partial', async () => {
    const f = fakeFetch([
      [/^https:\/\/api2?\.openreview\.net\//, status(403, json('openreview-challenge-403.json'))],
      [/semanticscholar/, status(404)],
    ]);
    await assert.rejects(resolveReference('https://openreview.net/forum?id=rJXMpikCZ', opts(f)), (e) => {
      assert.ok(e instanceof ResolveError);
      assert.match(e.message, /OpenReview blocked the request from your browser \(anti-bot challenge\)/);
      assert.match(e.message, /arXiv link/);
      assert.deepEqual(e.partial.reference, { type: 'paper-conference', author: [], title: '', url: 'https://openreview.net/forum?id=rJXMpikCZ', accessed: '2026-11-08' });
      assert.equal(e.partial.source, 'url-only');
      assert.deepEqual(e.partial.sources.map((x) => [x.name, x.status, x.detail]), [
        ['openreview-api2', 'failed', 'blocked by anti-bot challenge'],
        ['openreview-api1', 'failed', 'blocked by anti-bot challenge'],
        ['semanticscholar', 'failed', 'not found'],
      ]);
      return true;
    });
    assert.equal(f.calls.length, 3);
  });

  test('PubMed -> Crossref re-resolve, falling back to the PubMed mapping when the DOI chain fails', async () => {
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
    assert.deepEqual(names(r), ['pubmed:ok', 'crossref:ok']);

    const f2 = fakeFetch([
      ['https://eutils.ncbi.nlm.nih.gov/', ok(json('pubmed-esummary.json'))],
      ['https://api.crossref.org/', corsFailure],
      ['https://api.datacite.org/', status(404)],
      ['https://doi.org/', status(404)],
    ]);
    const r2 = await resolveReference('https://pubmed.ncbi.nlm.nih.gov/31452104/', opts(f2));
    assert.equal(r2.source, 'pubmed');
    assert.deepEqual(r2.reference.author[1], n('Smith', 'M W'));
    assert.equal(r2.warnings.length, 3);
    assert.deepEqual(names(r2), ['pubmed:ok', 'crossref:failed', 'datacite:failed', 'doi.org:failed']);
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
    assert.deepEqual(names(r), ['pmc:ok', 'crossref:ok']);
  });

  test('ISBN via Open Library', async () => {
    const f = fakeFetch([['https://openlibrary.org/api/books?bibkeys=ISBN%3A9780262035613&format=json&jscmd=data', ok(json('openlibrary-9780262035613.json'))]]);
    const r = await resolveReference('978-0-262-03561-3', opts(f));
    assert.equal(r.source, 'openlibrary');
    assert.equal(r.reference.type, 'book');
    assert.equal(r.reference.publisher, 'The MIT Press');
    assert.deepEqual(r.sources, [{ name: 'openlibrary', status: 'ok' }]);
    const f2 = fakeFetch([['https://openlibrary.org/', ok({})]]);
    await assert.rejects(resolveReference('9780262035613', opts(f2)), (e) => e instanceof ResolveError && /Open Library has no record for ISBN 9780262035613/.test(e.message) && e.partial.sources[0].detail === 'no record');
  });

  test('ACL id: Crossref 10.18653/v1/<id> first; S2 ACL: lookup only when Crossref fails', async () => {
    const f = fakeFetch([
      ['https://api.crossref.org/works/10.18653%2Fv1%2FN19-1423', ok({ message: { type: 'proceedings-article', title: ['BERT'], DOI: '10.18653/v1/N19-1423', 'container-title': ['Proceedings of NAACL-HLT 2019'], issued: { 'date-parts': [[2019, 6]] }, author: [{ given: 'Jacob', family: 'Devlin' }] } })],
    ]);
    const r = await resolveReference('https://aclanthology.org/N19-1423/', opts(f));
    assert.equal(r.source, 'crossref');
    assert.equal(r.reference.containerTitle, 'Proceedings of NAACL-HLT 2019');
    assert.deepEqual(f.hosts(), ['api.crossref.org']);

    const f2 = fakeFetch([
      ['https://api.crossref.org/', status(404)],
      ['https://api.semanticscholar.org/graph/v1/paper/ACL:P15-1001?fields=title,authors,year,venue,journal,externalIds,publicationVenue,publicationTypes', ok(json('s2-acl-bert.json'))],
    ]);
    const r2 = await resolveReference('P15-1001', opts(f2));
    assert.equal(r2.source, 'semanticscholar');
    assert.deepEqual(f2.hosts(), ['api.crossref.org', 'api.semanticscholar.org'], 'the S2 DOI is not re-resolved (Crossref just failed)');
    assert.deepEqual(names(r2), ['crossref:failed', 'semanticscholar:ok']);

    const f3 = fakeFetch([['https://api.crossref.org/', status(404)], [/semanticscholar/, status(404)]]);
    await assert.rejects(resolveReference('P15-1001', opts(f3)), /Could not find ACL Anthology paper P15-1001 \(Crossref: not found; Semantic Scholar: not found\)/);
  });

  test('S2 paper id and CorpusID lookups; DOI chain failure falls back to the S2 mapping', async () => {
    const f = fakeFetch([
      ['https://api.semanticscholar.org/graph/v1/paper/a4cec122a08216fe8a3bc19b22e78fbaea096256?fields=', ok(json('s2-journal.json'))],
      ['https://api.crossref.org/', status(500)],
      ['https://api.datacite.org/', status(500)],
      ['https://doi.org/', status(500)],
    ]);
    const r = await resolveReference('https://www.semanticscholar.org/paper/Deep-Learning-LeCun/a4cec122a08216fe8a3bc19b22e78fbaea096256', opts(f));
    assert.equal(r.source, 'semanticscholar');
    assert.equal(r.reference.type, 'article-journal');
    assert.equal(r.warnings.length, 3);
    assert.deepEqual(names(r), ['semanticscholar:ok', 'crossref:failed', 'datacite:failed', 'doi.org:failed']);
    const f2 = fakeFetch([['https://api.semanticscholar.org/graph/v1/paper/CorpusID:13756489?fields=', ok(json('s2-arxiv-attention.json'))]]);
    const r2 = await resolveReference('https://api.semanticscholar.org/CorpusID:13756489', opts(f2));
    assert.equal(r2.source, 'semanticscholar');
    assert.equal(r2.reference.containerTitle, 'Neural Information Processing Systems');
  });

  test('S2 429 (real body) -> waits 2 s and retries once; a TypeError counts as rate limiting too', async () => {
    let n429 = 0;
    const f = fakeFetch([[/semanticscholar/, () => (n429++ === 0 ? { status: 429, body: json('s2-429.json') } : { body: json('s2-preprint-only.json') })]]);
    const sleeps = [];
    const r = await resolveReference('https://api.semanticscholar.org/CorpusID:999999', { fetch: f, now: NOW, sleep: async (ms) => { sleeps.push(ms); } });
    assert.equal(r.source, 'semanticscholar');
    assert.deepEqual(sleeps, [2000]);
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every((c) => c.init.headers.Accept === 'application/json'), 'Accept header always sent');

    const always429 = fakeFetch([[/semanticscholar/, status(429, json('s2-429.json'))]]);
    await assert.rejects(resolveReference('CorpusID:1', opts(always429)), (e) => {
      assert.match(e.message, /Semantic Scholar is rate-limited right now \(HTTP 429 for CorpusID:1\)/);
      assert.deepEqual(e.partial.sources, [{ name: 'semanticscholar', status: 'failed', detail: 'rate limited', message: e.message }]);
      return true;
    });
    assert.equal(always429.calls.length, 2);

    let nFail = 0;
    const typeErrorThenOk = fakeFetch([[/semanticscholar/, () => (nFail++ === 0 ? { reject: new TypeError('Failed to fetch') } : { body: json('s2-preprint-only.json') })]]);
    const r3 = await resolveReference('CorpusID:2', opts(typeErrorThenOk));
    assert.equal(r3.source, 'semanticscholar');
    assert.equal(typeErrorThenOk.calls.length, 2);

    const alwaysTypeError = fakeFetch([[/semanticscholar/, corsFailure]]);
    await assert.rejects(resolveReference('CorpusID:3', opts(alwaysTypeError)), (e) => /rate-limited right now \(request blocked for CorpusID:3\)/.test(e.message) && e.partial.sources[0].detail === 'rate limited');
    assert.equal(alwaysTypeError.calls.length, 2);
  });

  test('URL on a host Semantic Scholar knows -> S2 URL lookup first, DOI re-resolved', async () => {
    const f = fakeFetch([
      [/^https:\/\/api\.semanticscholar\.org\/graph\/v1\/paper\/URL:https%3A%2F%2Fdl\.acm\.org%2Fconference%2Ffaccct\?fields=/, ok(json('s2-journal.json'))],
      ['https://api.crossref.org/works/10.1038%2Fnature14539', ok(json('crossref-journal-article.json'))],
    ]);
    const r = await resolveReference('https://dl.acm.org/conference/faccct', opts(f));
    assert.equal(r.source, 'crossref');
    assert.equal(r.identifier.kind, 'url');
    assert.deepEqual(names(r), ['semanticscholar:ok', 'crossref:ok']);
  });

  test('URL (a): the page-fetching function returns the head -> html-meta with the final URL', async () => {
    const head = '<head><title>Workers AI: serverless GPU-powered inference</title><meta property="og:title" content="Workers AI: serverless GPU-powered inference on Cloudflare’s global network"><meta property="og:site_name" content="The Cloudflare Blog"><meta property="article:published_time" content="2023-09-27T13:00:00.000Z"><meta name="author" content="Phil Wittig"><link rel="canonical" href="https://blog.cloudflare.com/workers-ai/"></head>';
    const f = fakeFetch([
      [`${META}?url=https%3A%2F%2Fblog.cloudflare.com%2Fworkers-ai`, ok({ ok: true, url: 'https://blog.cloudflare.com/workers-ai/', status: 200, contentType: 'text/html', head })],
    ]);
    const r = await resolveReference('https://blog.cloudflare.com/workers-ai', opts(f, { metaEndpoint: META }));
    assert.equal(r.source, 'html-meta');
    assert.equal(r.reference.type, 'webpage');
    assert.equal(r.reference.title, 'Workers AI: serverless GPU-powered inference on Cloudflare’s global network');
    assert.equal(r.reference.containerTitle, 'The Cloudflare Blog');
    assert.deepEqual(r.reference.author, [n('Wittig', 'Phil')]);
    assert.deepEqual([r.reference.year, r.reference.month, r.reference.day], [2023, 9, 27]);
    assert.equal(r.reference.url, 'https://blog.cloudflare.com/workers-ai/');
    assert.equal(r.reference.accessed, '2026-11-08');
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.sources, [{ name: 'api-meta', status: 'ok' }]);
    assert.equal(f.calls.length, 1, 'no direct fetch, no Wayback');
    assert.equal(f.calls[0].init.headers.Accept, 'application/json');
  });

  test('URL (a) -> (b): function 404 (static hosting) then direct fetch of a CORS-enabled page', async () => {
    const f = fakeFetch([
      [META, () => ({ status: 404, text: 'Not found' })],
      ['https://proceedings.mlr.press/v139/radford21a.html', text(fixture('html-pmlr-real-head.html'))],
    ]);
    const r = await resolveReference('https://proceedings.mlr.press/v139/radford21a.html', opts(f, { metaEndpoint: META }));
    assert.equal(r.source, 'html-meta');
    assert.equal(r.reference.type, 'paper-conference');
    assert.equal(r.reference.author.length, 12);
    assert.equal(r.reference.volume, '139');
    assert.deepEqual(r.sources, [
      { name: 'api-meta', status: 'failed', detail: 'not available here', message: 'The page-fetching function (/api/meta) is not available on this host' },
      { name: 'direct', status: 'ok' },
    ]);
    assert.match(f.calls[1].init.headers.Accept, /text\/html/);
  });

  test('URL: without a metaEndpoint (Node default) the function step is skipped', async () => {
    const f = fakeFetch([['https://proceedings.mlr.press/v139/radford21a.html', text(fixture('html-citation-pmlr.html'))]]);
    const r = await resolveReference('https://proceedings.mlr.press/v139/radford21a.html', opts(f));
    assert.equal(r.source, 'html-meta');
    assert.equal(r.reference.containerTitle, 'Proceedings of the 38th International Conference on Machine Learning');
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.sources, [{ name: 'api-meta', status: 'skipped', detail: 'no page-fetching function configured' }, { name: 'direct', status: 'ok' }]);
    const r2 = await resolveReference('https://proceedings.mlr.press/v139/radford21a.html', opts(f, { metaEndpoint: null }));
    assert.equal(r2.sources[0].status, 'skipped');
  });

  test('URL (a) function error JSON -> (b) CORS failure -> (c) Wayback snapshot via the id_ raw URL, original URL kept', async () => {
    const f = fakeFetch([
      [META, status(502, { ok: false, error: 'The page could not be reached.' })],
      ['https://openai.com/', corsFailure],
      ['https://archive.org/wayback/available?url=https%3A%2F%2Fopenai.com%2Findex%2Fgpt-4-research%2F', ok(json('wayback-available.json'))],
      ['https://web.archive.org/web/20261104165307id_/https://openai.com/index/gpt-4-research/', text('<html><head><title>GPT-4 | OpenAI</title><meta property="og:title" content="GPT-4"><meta property="og:site_name" content="OpenAI"><meta property="og:url" content="https://web.archive.org/web/20261104165307/https://openai.com/index/gpt-4-research/"><meta property="article:published_time" content="2023-03-14"></head><body></body></html>')],
    ]);
    const r = await resolveReference('https://openai.com/index/gpt-4-research/', opts(f, { metaEndpoint: META }));
    assert.equal(r.source, 'wayback');
    assert.equal(r.reference.type, 'webpage');
    assert.equal(r.reference.title, 'GPT-4');
    assert.equal(r.reference.containerTitle, 'OpenAI');
    assert.equal(r.reference.url, 'https://openai.com/index/gpt-4-research/', 'archive URL in og:url is replaced by the original');
    assert.deepEqual([r.reference.year, r.reference.month, r.reference.day], [2023, 3, 14]);
    assert.equal(r.warnings.length, 3);
    assert.match(r.warnings[0], /Could not fetch openai\.com: The page could not be reached\./);
    assert.match(r.warnings[1], /Could not reach openai\.com/);
    assert.match(r.warnings[2], /^Metadata read from an Internet Archive snapshot dated 2026-11-04/);
    assert.deepEqual(r.sources.map((x) => [x.name, x.status, x.detail]), [
      ['api-meta', 'failed', 'page unreachable'],
      ['direct', 'failed', 'unreachable (blocked by CORS, rate-limited or offline)'],
      ['wayback', 'ok', undefined],
    ]);
    assert.deepEqual(f.hosts(), ['papertools.pages.dev', 'openai.com', 'archive.org', 'web.archive.org']);
  });

  test('URL (c): Wayback snapshot carrying citation_doi re-resolves through Crossref', async () => {
    const f = fakeFetch([
      ['https://www.nature.com/', corsFailure],
      ['https://archive.org/wayback/available', ok({ archived_snapshots: { closest: { available: true, timestamp: '20240101000000', status: '200', url: 'http://web.archive.org/web/20240101000000/https://www.nature.com/articles/nature14539' } } })],
      ['https://web.archive.org/web/20240101000000id_/https://www.nature.com/articles/nature14539', text(fixture('html-citation-doi.html'))],
      ['https://api.crossref.org/works/10.1038%2Fnature14539', ok(json('crossref-journal-article.json'))],
    ]);
    const r = await resolveReference('https://www.nature.com/articles/nature14539', opts(f));
    assert.equal(r.source, 'crossref');
    assert.equal(r.reference.publisher, 'Springer Science and Business Media LLC');
    assert.deepEqual(names(r), ['api-meta:skipped', 'direct:failed', 'crossref:ok', 'wayback:ok']);
  });

  test('URL (d): everything fails -> ResolveError with url-only partial and the full sources list', async () => {
    const f = fakeFetch([
      ['https://www.sciencedirect.com/', corsFailure],
      ['https://archive.org/wayback/available', ok({ url: 'x', archived_snapshots: {} })],
    ]);
    await assert.rejects(resolveReference('https://www.sciencedirect.com/science/article/pii/S0893608014002135', opts(f)), (e) => {
      assert.ok(e instanceof ResolveError);
      assert.match(e.message, /CORS/);
      assert.match(e.message, /sciencedirect\.com/);
      assert.match(e.message, /Internet Archive/);
      assert.equal(e.partial.source, 'url-only');
      assert.deepEqual(e.partial.reference, {
        type: 'webpage', author: [], title: '', containerTitle: 'sciencedirect.com',
        url: 'https://www.sciencedirect.com/science/article/pii/S0893608014002135', accessed: '2026-11-08',
      });
      assert.equal(e.partial.identifier.kind, 'url');
      assert.deepEqual(e.partial.sources.map((x) => [x.name, x.status, x.detail]), [
        ['api-meta', 'skipped', 'no page-fetching function configured'],
        ['direct', 'failed', 'unreachable (blocked by CORS, rate-limited or offline)'],
        ['wayback', 'failed', 'no snapshot'],
      ]);
      assert.equal(e.partial.warnings.length, 2);
      assert.match(e.partial.warnings[0], /Could not reach sciencedirect\.com/);
      assert.match(e.partial.warnings[1], /no snapshot/);
      return true;
    });
    assert.equal(f.calls.length, 2, 'unknown hosts must not be sent to Semantic Scholar');
    assert.match(f.calls[0].init.headers.Accept, /text\/html/);

    const f2 = fakeFetch([['https://www.sciencedirect.com/', corsFailure]]);
    await assert.rejects(resolveReference('https://www.sciencedirect.com/x', opts(f2, { wayback: false })), (e) => e.partial.sources[2].status === 'skipped' && f2.calls.length === 1);
  });

  test('URL: page HTML with citation_doi -> Crossref re-resolve; citation_arxiv_id -> arXiv chain', async () => {
    const f = fakeFetch([
      ['https://www.nature.com/articles/nature14539', text(fixture('html-citation-doi.html'))],
      ['https://api.crossref.org/works/10.1038%2Fnature14539', ok(json('crossref-journal-article.json'))],
    ]);
    const r = await resolveReference('https://www.nature.com/articles/nature14539', opts(f));
    assert.equal(r.source, 'crossref');
    assert.equal(r.reference.publisher, 'Springer Science and Business Media LLC');
    assert.deepEqual(f.hosts(), ['www.nature.com', 'api.crossref.org']);

    const f2 = fakeFetch([
      ['https://example.org/paper', text('<head><meta name="citation_title" content="Attention"><meta name="citation_arxiv_id" content="1706.03762"></head>')],
      ['https://api.datacite.org/', ok(json('datacite-arxiv.json'))],
    ]);
    const r2 = await resolveReference('https://example.org/paper', opts(f2));
    assert.equal(r2.source, 'datacite');
    assert.equal(r2.reference.author.length, 8);
    assert.deepEqual(names(r2), ['api-meta:skipped', 'datacite:ok', 'direct:ok']);
  });

  test('URL: page HTML with citation_doi keeps the html-meta result when the DOI chain fails', async () => {
    const f = fakeFetch([
      ['https://www.nature.com/articles/nature14539', text(fixture('html-citation-doi.html'))],
      [/crossref|datacite|doi\.org/, status(503)],
    ]);
    const r = await resolveReference('https://www.nature.com/articles/nature14539', opts(f));
    assert.equal(r.source, 'html-meta');
    assert.equal(r.reference.doi, '10.1038/nature14539');
    assert.equal(r.warnings.length, 3);
  });

  test('URL with only OG meta -> webpage; a page without any title is a failure and the chain continues', async () => {
    const f = fakeFetch([['https://www.dailyexample.com/', text(fixture('html-og-only.html'))]]);
    const r = await resolveReference('https://www.dailyexample.com/news/story', opts(f));
    assert.equal(r.source, 'html-meta');
    assert.equal(r.reference.type, 'webpage');
    assert.equal(r.reference.title, 'Some news story & more');
    const f2 = fakeFetch([
      ['https://www.example.org/', text('<html><body>nothing</body></html>')],
      ['https://archive.org/wayback/available', ok({ archived_snapshots: {} })],
    ]);
    await assert.rejects(resolveReference('https://www.example.org/empty', opts(f2)), (e) => {
      assert.deepEqual(e.partial.sources.map((x) => [x.name, x.status, x.detail]), [
        ['api-meta', 'skipped', 'no page-fetching function configured'],
        ['direct', 'failed', 'no usable metadata'],
        ['wayback', 'failed', 'no snapshot'],
      ]);
      assert.match(e.partial.warnings[0], /example\.org has no usable metadata \(no title found\)/);
      return true;
    });
  });

  test('unrecognised input rejects with ResolveError', async () => {
    await assert.rejects(resolveReference('not a url at all', opts(fakeFetch([]))), (e) => e instanceof ResolveError && e.partial === undefined && /Could not recognise/.test(e.message));
    await assert.rejects(resolveReference('', opts(fakeFetch([]))), ResolveError);
  });

  test('fetch failures never escape as raw errors', async () => {
    const f = fakeFetch([]); // every route throws TypeError
    await assert.rejects(resolveReference('10.1038/nature14539', opts(f)), (e) => e instanceof ResolveError && e.partial.reference.doi === '10.1038/nature14539' && e.partial.sources.length === 3);
    await assert.rejects(resolveReference('arXiv:1706.03762', opts(f)), (e) => e instanceof ResolveError && e.partial.reference.archiveId === '1706.03762' && e.partial.sources.length === 3 && e.partial.warnings.length === 4);
  });

  test('abort signal stops the chain instead of falling through', async () => {
    const controller = new AbortController();
    const f = async (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    const p = resolveReference('10.1038/nature14539', { fetch: f, now: NOW, sleep: noSleep, signal: controller.signal });
    controller.abort();
    await assert.rejects(p, (e) => e instanceof ResolveError && /cancelled/.test(e.message) && e.partial.sources.length === 0);
  });
});

test('resolveReference sends a Turnstile token to /api/meta when metaToken is given, and reports a refused token', async () => {
  const seen = [];
  const htmlHead = '<head><title>Guarded page</title><meta property="og:site_name" content="Example"><meta property="article:published_time" content="2024-02-03"></head>';
  const fakeFetch = async (url, init) => {
    seen.push({ url: String(url), headers: init && init.headers ? { ...init.headers } : {} });
    if (String(url).startsWith('https://meta.test/api/meta')) {
      const token = seen[seen.length - 1].headers['cf-turnstile-response'];
      if (token !== 'tok-1') return new Response(JSON.stringify({ ok: false, error: 'Bot check failed.', code: 'turnstile-failed' }), { status: 403, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true, url: 'https://example.com/post', status: 200, contentType: 'text/html', head: htmlHead }), { headers: { 'content-type': 'application/json' } });
    }
    throw new TypeError('Failed to fetch');
  };
  const ok = await resolveReference('https://example.com/post', { fetch: fakeFetch, metaEndpoint: 'https://meta.test/api/meta', wayback: false, metaToken: async () => 'tok-1' });
  assert.equal(ok.reference.title, 'Guarded page');
  assert.equal(seen[0].headers['cf-turnstile-response'], 'tok-1');

  await assert.rejects(
    resolveReference('https://example.com/post', { fetch: fakeFetch, metaEndpoint: 'https://meta.test/api/meta', wayback: false, metaToken: async () => 'stale' }),
    (err) => err instanceof ResolveError && err.partial.sources.some((s) => s.name === 'api-meta' && s.status === 'failed' && /bot check/i.test(s.detail)),
  );
});
