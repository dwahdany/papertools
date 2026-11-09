import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatApa, formatMany, applyCase, formatAuthors, formatInitials,
  normalizePageRange, defaultOptions,
} from '../public/assets/apa.js';
import { REFERENCE_TYPES, makeReference } from '../public/assets/model.js';
import { parseBibtexToReferences } from '../public/assets/bibtex.js';

const n = (family, given, extra = {}) => ({ family, given, ...extra });
const SCHOLAR = { authorStyle: 'scholar' };

/** Assert plain / markdown / html at once; `md` is the reference string with *italics*. */
function expectAll(result, md, { html } = {}) {
  assert.equal(result.markdown, md);
  assert.equal(result.plain, md.replace(/\*/g, ''));
  assert.equal(result.html, html ?? md.replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/&/g, '&amp;'));
}

const vaswaniAuthors = [
  n('Vaswani', 'Ashish'), n('Shazeer', 'Noam'), n('Parmar', 'Niki'), n('Uszkoreit', 'Jakob'),
  n('Jones', 'Llion'), n('Gomez', 'Aidan N.'), n('Kaiser', 'Łukasz'), n('Polosukhin', 'Illia'),
];

describe('Google Scholar golden outputs', () => {
  test('1. article-journal, 8 authors, volume only (scholar)', () => {
    const r = formatApa({
      type: 'article-journal', author: vaswaniAuthors, title: 'Attention is all you need',
      containerTitle: 'Advances in Neural Information Processing Systems', volume: 30, year: 2017,
    }, SCHOLAR);
    expectAll(r, 'Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., ... & Polosukhin, I. (2017). Attention is all you need. *Advances in neural information processing systems*, *30*.');
    assert.deepEqual(r.warnings, []);
  });

  test('2. article-journal with DOI: apa7 appends it, scholar omits it', () => {
    const ref = {
      type: 'article-journal', author: [n('LeCun', 'Yann'), n('Bengio', 'Yoshua'), n('Hinton', 'Geoffrey')],
      title: 'Deep learning', containerTitle: 'Nature', volume: 521, issue: 7553, page: '436-444',
      year: 2015, doi: '10.1038/nature14539',
    };
    expectAll(formatApa(ref), 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. *Nature*, *521*(7553), 436–444. https://doi.org/10.1038/nature14539');
    expectAll(formatApa(ref, SCHOLAR), 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. *Nature*, *521*(7553), 436–444.');
    assert.equal(formatApa(ref).latex, 'LeCun, Y., Bengio, Y., \\& Hinton, G. (2015). Deep learning. \\emph{Nature}, \\emph{521}(7553), 436--444. \\url{https://doi.org/10.1038/nature14539}');
  });

  test('3. arXiv preprint (scholar) and apa7 fallback URL / DOI', () => {
    const ref = {
      type: 'preprint', author: [n('Kingma', 'Diederik P.'), n('Ba', 'Jimmy')],
      title: 'Adam: A Method for Stochastic Optimization', archive: 'arXiv', archiveId: '1412.6980', year: 2014,
    };
    expectAll(formatApa(ref, SCHOLAR), 'Kingma, D. P., & Ba, J. (2014). Adam: A method for stochastic optimization. *arXiv preprint arXiv:1412.6980*.');
    expectAll(formatApa(ref), 'Kingma, D. P., & Ba, J. (2014). Adam: A method for stochastic optimization. *arXiv preprint arXiv:1412.6980*. https://arxiv.org/abs/1412.6980');
    expectAll(formatApa({ ...ref, doi: '10.48550/arXiv.1412.6980' }), 'Kingma, D. P., & Ba, J. (2014). Adam: A method for stochastic optimization. *arXiv preprint arXiv:1412.6980*. https://doi.org/10.48550/arXiv.1412.6980');
    assert.equal(formatApa(ref, { includeUrl: false }).plain, 'Kingma, D. P., & Ba, J. (2014). Adam: A method for stochastic optimization. arXiv preprint arXiv:1412.6980.');
  });

  test('4. paper-conference without publisher (scholar)', () => {
    const r = formatApa({
      type: 'paper-conference', author: [n('He', 'Kaiming'), n('Zhang', 'Xiangyu'), n('Ren', 'Shaoqing'), n('Sun', 'Jian')],
      title: 'Deep Residual Learning for Image Recognition',
      containerTitle: 'Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition',
      page: '770--778', year: 2016,
    }, SCHOLAR);
    expectAll(r, 'He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. In *Proceedings of the IEEE conference on computer vision and pattern recognition* (pp. 770–778).');
  });

  test('5. paper-conference with month: scholar prints (Year, Month), apa7 (Year)', () => {
    const ref = {
      type: 'paper-conference',
      author: [n('Radford', 'Alec'), n('Kim', 'Jong Wook'), n('Hallacy', 'Chris'), n('Ramesh', 'Aditya'),
        n('Goh', 'Gabriel'), n('Agarwal', 'Sandhini'), n('Sastry', 'Girish'), n('Sutskever', 'Ilya')],
      title: 'Learning transferable visual models from natural language supervision',
      containerTitle: 'International Conference on Machine Learning', page: '8748-8763',
      publisher: 'PMLR', year: 2021, month: 7,
    };
    expectAll(formatApa(ref, SCHOLAR), 'Radford, A., Kim, J. W., Hallacy, C., Ramesh, A., Goh, G., Agarwal, S., ... & Sutskever, I. (2021, July). Learning transferable visual models from natural language supervision. In *International conference on machine learning* (pp. 8748–8763). PMLR.');
    expectAll(formatApa(ref), 'Radford, A., Kim, J. W., Hallacy, C., Ramesh, A., Goh, G., Agarwal, S., Sastry, G., & Sutskever, I. (2021). Learning transferable visual models from natural language supervision. In *International conference on machine learning* (pp. 8748–8763). PMLR.');
  });

  test('6. book', () => {
    const r = formatApa({
      type: 'book', author: [n('Goodfellow', 'Ian'), n('Bengio', 'Yoshua'), n('Courville', 'Aaron')],
      title: 'Deep Learning', publisher: 'MIT Press', year: 2016,
    }, SCHOLAR);
    expectAll(r, 'Goodfellow, I., Bengio, Y., & Courville, A. (2016). *Deep learning*. MIT Press.');
  });

  test('7. BERT: braces protect spans in container title, hyphenated given name, colon capitalisation', () => {
    const r = formatApa({
      type: 'paper-conference',
      author: [n('Devlin', 'Jacob'), n('Chang', 'Ming-Wei'), n('Lee', 'Kenton'), n('Toutanova', 'Kristina')],
      title: '{BERT}: Pre-training of Deep Bidirectional Transformers for Language Understanding',
      containerTitle: 'Proceedings of the 2019 Conference of the {North American} Chapter of the {Association for Computational Linguistics}: {Human} Language Technologies, Volume 1 (Long and Short Papers)',
      page: '4171--4186', publisher: 'Association for Computational Linguistics', doi: '10.18653/v1/N19-1423', year: 2019,
    });
    expectAll(r, 'Devlin, J., Chang, M.-W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers for language understanding. In *Proceedings of the 2019 conference of the North American chapter of the Association for Computational Linguistics: Human language technologies, volume 1 (long and short papers)* (pp. 4171–4186). Association for Computational Linguistics. https://doi.org/10.18653/v1/N19-1423');
  });

  test('8. chapter with editors and edition', () => {
    const r = formatApa({
      type: 'chapter', author: [n('Smith', 'John A.'), n('Doe', 'Richard')],
      editor: [n('Editor', 'Eve'), n('Other', 'Fred')], title: 'A chapter title',
      containerTitle: 'The Book Title', edition: '2nd', page: '12-34', publisher: 'Springer',
      doi: '10.1000/xyz', year: 2020,
    });
    expectAll(r, 'Smith, J. A., & Doe, R. (2020). A chapter title. In E. Editor & F. Other (Eds.), *The book title* (2nd ed., pp. 12–34). Springer. https://doi.org/10.1000/xyz');
  });

  test('9. thesis', () => {
    const r = formatApa({
      type: 'thesis', author: [n('Nguyen', 'Thanh')], title: 'Thesis Title Here',
      institution: 'Stanford University', url: 'https://example.org/thesis', year: 2018,
    });
    expectAll(r, 'Nguyen, T. (2018). *Thesis title here* [Doctoral dissertation, Stanford University]. https://example.org/thesis');
  });

  test('10. report by corporate author equal to institution (publisher omitted)', () => {
    const r = formatApa({
      type: 'report', author: [{ literal: 'World Health Organization' }], title: 'Report Title',
      number: 'WHO/123', institution: 'World Health Organization', url: 'https://who.int/report', year: 2020,
    });
    expectAll(r, 'World Health Organization. (2020). *Report title* (Report No. WHO/123). https://who.int/report');
    const other = formatApa({ type: 'report', author: [n('Doe', 'Jane')], title: 'Report title', number: 7, institution: 'RAND', year: 2020 });
    assert.equal(other.plain, 'Doe, J. (2020). Report title (Report No. 7). RAND.');
  });

  test('11. web page: author == site name, retrieval date iff accessed, n.d.', () => {
    const ref = {
      type: 'webpage', author: [{ literal: 'Anthropic' }], title: 'Introducing {Claude} 3',
      containerTitle: 'Anthropic', url: 'https://www.anthropic.com/news/claude-3',
      year: 2024, month: 3, day: 4, accessed: '2026-11-08',
    };
    expectAll(formatApa(ref), 'Anthropic. (2024, March 4). *Introducing Claude 3*. Retrieved November 8, 2026, from https://www.anthropic.com/news/claude-3');
    // Only the URL itself is a url run: the "Retrieved …, from" prose stays plain text and outside \url{}.
    assert.equal(formatApa(ref).latex, 'Anthropic. (2024, March 4). \\emph{Introducing Claude 3}. Retrieved November 8, 2026, from \\url{https://www.anthropic.com/news/claude-3}');
    assert.deepEqual(formatApa(ref).segments.at(-1), { text: 'https://www.anthropic.com/news/claude-3', italic: false, url: true });
    assert.equal(formatApa(ref).segments.at(-2).text, '. Retrieved November 8, 2026, from ');
    assert.equal(formatApa(ref).segments.at(-2).url, undefined);
    const { accessed, ...noAccess } = ref;
    expectAll(formatApa(noAccess), 'Anthropic. (2024, March 4). *Introducing Claude 3*. https://www.anthropic.com/news/claude-3');
    assert.equal(formatApa(noAccess).latex, 'Anthropic. (2024, March 4). \\emph{Introducing Claude 3}. \\url{https://www.anthropic.com/news/claude-3}');
    assert.deepEqual(formatApa(noAccess).segments.at(-1), { text: 'https://www.anthropic.com/news/claude-3', italic: false, url: true });
    assert.equal(formatApa({ ...noAccess, day: undefined }).plain, 'Anthropic. (2024, March). Introducing Claude 3. https://www.anthropic.com/news/claude-3');
    const nd = formatApa({ type: 'webpage', author: [{ literal: 'Anthropic' }], title: 'Title', containerTitle: 'Anthropic', url: 'https://www.anthropic.com/x' });
    assert.equal(nd.plain, 'Anthropic. (n.d.). Title. https://www.anthropic.com/x');
    assert.ok(nd.warnings.includes('No year found; using n.d.'));
    const site = formatApa({ type: 'webpage', author: [n('Doe', 'Jane')], title: 'Post', containerTitle: 'Some Blog', url: 'https://blog.example', year: 2020 }, SCHOLAR);
    assert.equal(site.plain, 'Doe, J. (2020). Post. Some Blog. https://blog.example');
  });

  test('12. no author: title moves to author position', () => {
    const generic = formatApa({ type: 'generic', title: 'Title of Thing', publisher: 'Publisher', url: 'https://example.org', year: 2021 });
    expectAll(generic, '*Title of thing*. (2021). Publisher. https://example.org');
    assert.ok(generic.warnings.some((w) => w.startsWith('No author')));
    const article = formatApa({ type: 'article-journal', title: 'Title of thing', containerTitle: 'Journal', volume: 1, page: '2-3', year: 2021 });
    expectAll(article, 'Title of thing. (2021). *Journal*, *1*, 2–3.');
  });

  test('13. 25 authors: apa7 ". . ." without ampersand; scholar "... &"', () => {
    const many = Array.from({ length: 25 }, (_, i) => n(`Author${i + 1}`, 'Xavier'));
    const head = (k) => Array.from({ length: k }, (_, i) => `Author${i + 1}, X.`).join(', ');
    assert.equal(formatAuthors(many, 'apa7'), `${head(19)}, . . . Author25, X.`);
    assert.equal(formatAuthors(many, 'scholar'), `${head(6)}, ... & Author25, X.`);
    assert.equal(formatAuthors(many.slice(0, 20), 'apa7'), `${head(19)}, & Author20, X.`);
    assert.equal(formatAuthors(many.slice(0, 7), 'scholar'), `${head(6)}, & Author7, X.`);
    assert.equal(formatAuthors(many.slice(0, 8), 'scholar'), `${head(6)}, ... & Author8, X.`);
  });

  test('14. "others" placeholder prints et al. without ampersand', () => {
    const r = formatApa({
      type: 'article-journal', author: [n('Vaswani', 'Ashish'), n('Shazeer', 'Noam'), { literal: 'others' }],
      title: 'Attention is all you need', containerTitle: 'NeurIPS', year: 2017,
    });
    expectAll(r, 'Vaswani, A., Shazeer, N., et al. (2017). Attention is all you need. *NeurIPS*.');
    assert.equal(formatAuthors([n('Doe', 'Jane'), { literal: 'et al.' }]), 'Doe, J., et al.');
  });

  test('15. editors as authors for an edited book', () => {
    const r = formatApa({ type: 'book', editor: [n('Editor', 'Eve'), n('Other', 'Fred')], title: 'Edited Book Title', publisher: 'Publisher', year: 2019 });
    expectAll(r, 'Editor, E., & Other, F. (Eds.). (2019). *Edited book title*. Publisher.');
    assert.deepEqual(r.warnings, []);
    const one = formatApa({ type: 'book', editor: [n('Editor', 'Eve')], title: 'Edited book', publisher: 'P', year: 2019 });
    assert.equal(one.plain, 'Editor, E. (Ed.). (2019). Edited book. P.');
  });

  test('16. software and dataset', () => {
    const sw = formatApa({
      type: 'software', author: [n('Van Rossum', 'Guido'), n('Drake', 'Fred L.')], title: 'Python 3 Reference Manual',
      publisher: 'CreateSpace', url: 'https://python.org', year: 2009,
    });
    expectAll(sw, 'Van Rossum, G., & Drake, F. L. (2009). *Python 3 reference manual* [Computer software]. CreateSpace. https://python.org');
    const ds = formatApa({ type: 'dataset', author: [n('Doe', 'Jane')], title: 'Big Data', version: '2.1', publisher: 'Zenodo', doi: '10.5281/zenodo.1', year: 2022 });
    expectAll(ds, 'Doe, J. (2022). *Big data* (Version 2.1) [Data set]. Zenodo. https://doi.org/10.5281/zenodo.1');
  });

  test('17. paper-conference with volume (NeurIPS, scholar)', () => {
    const r = formatApa({
      type: 'paper-conference',
      author: [n('Brown', 'Tom'), n('Mann', 'Benjamin'), n('Ryder', 'Nick'), n('Subbiah', 'Melanie'), n('Kaplan', 'Jared'),
        n('Dhariwal', 'Prafulla'), n('Neelakantan', 'Arvind'), n('Amodei', 'Dario')],
      title: 'Language models are few-shot learners', containerTitle: 'Advances in Neural Information Processing Systems',
      volume: 33, page: '1877–1901', publisher: 'Curran Associates, Inc.', year: 2020,
    }, SCHOLAR);
    expectAll(r, 'Brown, T., Mann, B., Ryder, N., Subbiah, M., Kaplan, J., Dhariwal, P., ... & Amodei, D. (2020). Language models are few-shot learners. In *Advances in neural information processing systems* (Vol. 33, pp. 1877–1901). Curran Associates, Inc.');
  });

  test('18. article number and pages without volume', () => {
    const base = { type: 'article-journal', author: [n('Doe', 'Jane')], title: 'T', containerTitle: 'Journal', year: 2020 };
    expectAll(formatApa({ ...base, volume: 12, issue: 3, articleNumber: 'e0123' }), 'Doe, J. (2020). T. *Journal*, *12*(3), Article e0123.');
    expectAll(formatApa({ ...base, volume: '12', issue: '3', articleNumber: '123' }), 'Doe, J. (2020). T. *Journal*, *12*(3), Article 123.');
    expectAll(formatApa({ ...base, page: '45-67' }), 'Doe, J. (2020). T. *Journal*, 45–67.');
    expectAll(formatApa({ ...base, page: 45 }), 'Doe, J. (2020). T. *Journal*, 45.');
  });

  test('19. particles, suffixes, literals and mononyms', () => {
    const r = formatApa({
      type: 'article-journal', author: [n('Maaten', 'Laurens', { particle: 'van der' }), n('Hinton', 'Geoffrey')],
      title: 'Visualizing data using t-SNE', containerTitle: 'Journal of Machine Learning Research', volume: 9, issue: 11, year: 2008,
    });
    expectAll(r, 'van der Maaten, L., & Hinton, G. (2008). Visualizing data using t-SNE. *Journal of Machine Learning Research*, *9*(11).');
    assert.equal(formatAuthors([n('King', 'Martin Luther', { suffix: 'Jr.' })]), 'King, M. L., Jr.');
    assert.equal(formatApa({ type: 'book', author: [n('King', 'Martin Luther', { suffix: 'Jr.' })], title: 'T', year: 1963 }).plain, 'King, M. L., Jr. (1963). T.');
    assert.equal(formatApa({ type: 'book', author: [{ literal: 'OpenAI' }], title: 'T', year: 2023 }).plain, 'OpenAI. (2023). T.');
    assert.equal(formatApa({ type: 'book', author: [{ given: 'Plato' }], title: 'Republic', year: 2000 }).plain, 'Plato. (2000). Republic.');
    assert.equal(formatAuthors([{ family: 'Plato' }]), 'Plato');
    assert.equal(formatAuthors(['ACME Corp']), 'ACME Corp');
  });

  test('20. initials', () => {
    const cases = {
      'Ashish': 'A.', 'Jean-Pierre': 'J.-P.', 'Ming Wei': 'M. W.', 'A.N.': 'A. N.', 'A. N.': 'A. N.',
      'Ashish N': 'A. N.', 'José Ángel': 'J. Á.', 'Ø.': 'Ø.', 'Maria de los': 'M. d. l.',
      'Ming-Wei': 'M.-W.', 'William (Bill)': 'W.', '  Yann  ': 'Y.', '': '',
    };
    for (const [given, expected] of Object.entries(cases)) assert.equal(formatInitials(given), expected, given);
    assert.equal(formatInitials(null), '');
    assert.equal(formatInitials(undefined), '');
    assert.equal(formatInitials(42), '');
  });
});

describe('applyCase', () => {
  test('sentence mode lowercases Capitalized-only words and keeps internal capitals', () => {
    assert.equal(applyCase('Self-Supervised Learning With GPT-4 and LLMs on ImageNet', 'sentence'),
      'Self-supervised learning with GPT-4 and LLMs on ImageNet');
    assert.equal(applyCase('A Survey Of iPhone COVID-19 DNA Sequencing', 'sentence'), 'A survey of iPhone COVID-19 DNA sequencing');
    assert.equal(applyCase('Deep Residual Learning For Image Recognition'), 'Deep residual learning for image recognition');
  });

  test('capitalises after sentence breaks and keeps single uppercase letters', () => {
    assert.equal(applyCase('Adam: a method for stochastic optimization'), 'Adam: A method for stochastic optimization');
    assert.equal(applyCase('Why? because. Really! yes — indeed'), 'Why? Because. Really! Yes — Indeed');
    assert.equal(applyCase('Learning With Vitamin X and I Alone'), 'Learning with vitamin X and I alone');
    assert.equal(applyCase('Pre-training Of Things'), 'Pre-training of things');
    assert.equal(applyCase('e.g. Things vs. Other'), 'E.g. things vs. other');
    assert.equal(applyCase('attention is all you need'), 'Attention is all you need');
  });

  test('brace-protected spans survive and braces are removed in both modes', () => {
    assert.equal(applyCase('{BERT}: pre-training of {Transformers} For {Natural Language}', 'sentence'),
      'BERT: Pre-training of Transformers for Natural Language');
    assert.equal(applyCase('The {Quick} Brown Fox', 'preserve'), 'The Quick Brown Fox');
    assert.equal(applyCase('Unbalanced } brace { Here', 'preserve'), 'Unbalanced  brace  Here');
  });

  test('escaped braces \\{ \\} from bibtex.js become literal, protected braces', () => {
    assert.equal(applyCase('Set \\{a\\} {NASA}', 'sentence'), 'Set {a} NASA');
    assert.equal(applyCase('Set \\{a\\} braces', 'sentence'), 'Set {a} braces');
    assert.equal(applyCase('Set notation \\{a, b\\} and {NASA} rules', 'preserve'), 'Set notation {a, b} and NASA rules');
    // The literal brace content is protected: "\\{A, B\\}" keeps its case in sentence mode.
    assert.equal(applyCase('The Set \\{A, B\\} Rules', 'sentence'), 'The set {A, B} rules');
    // A stray backslash that is not followed by a brace is an ordinary character.
    assert.equal(applyCase('A \\ B \\x {C}', 'preserve'), 'A \\ B \\x C');
  });

  test('ALL-CAPS titles are lowercased then capitalised', () => {
    assert.equal(applyCase('ATTENTION IS ALL YOU NEED'), 'Attention is all you need');
    assert.equal(applyCase('ADAM: A METHOD FOR OPTIMIZATION'), 'Adam: A method for optimization');
    assert.equal(applyCase('BERT MODEL'), 'BERT MODEL');
  });

  test('handles odd input', () => {
    assert.equal(applyCase(null), '');
    assert.equal(applyCase(undefined, 'preserve'), '');
    assert.equal(applyCase(42), '42');
    assert.equal(applyCase('  Spaced   Out  Title '), 'Spaced out title');
  });
});

describe('normalizePageRange', () => {
  test('dashes become en dash; single pages and odd input pass through', () => {
    const cases = {
      '770--778': '770–778', '770-778': '770–778', '770 – 778': '770–778', '770—778': '770–778',
      '770---778': '770–778', '5': '5', 'e1234': 'e1234', 'S1-S10': 'S1–S10', '123:1-123:20': '123:1–123:20',
      'pp. 1-3': '1–3', 'p. 7': '7', '': '',
    };
    for (const [input, expected] of Object.entries(cases)) assert.equal(normalizePageRange(input), expected, input);
    assert.equal(normalizePageRange(5), '5');
    assert.equal(normalizePageRange(null), '');
    assert.equal(normalizePageRange(undefined), '');
  });
});

describe('formatApa details', () => {
  test('editions are normalised', () => {
    const book = (edition) => formatApa({ type: 'book', author: [n('Doe', 'Jane')], title: 'T', edition, publisher: 'P', year: 2020 }).plain;
    assert.equal(book('2nd'), 'Doe, J. (2020). T (2nd ed.). P.');
    assert.equal(book('Second'), 'Doe, J. (2020). T (2nd ed.). P.');
    assert.equal(book('3'), 'Doe, J. (2020). T (3rd ed.). P.');
    assert.equal(book('11'), 'Doe, J. (2020). T (11th ed.). P.');
    assert.equal(book('2nd ed.'), 'Doe, J. (2020). T (2nd ed.). P.');
    assert.equal(book('Revised'), 'Doe, J. (2020). T (Rev. ed.). P.');
    assert.equal(book(''), 'Doe, J. (2020). T. P.');
  });

  test('book with volume and editors alongside an author; publisherPlace ignored', () => {
    const r = formatApa({
      type: 'book', author: [n('Doe', 'Jane')], editor: [n('Editor', 'Eve')], title: 'Collected Works',
      volume: 2, edition: '2nd', publisher: 'P', publisherPlace: 'New York', year: 2020,
    });
    // APA 7: semicolon between the editor element and the edition/volume element, comma within the latter.
    assert.equal(r.plain, 'Doe, J. (2020). Collected works (E. Editor, Ed.; 2nd ed., Vol. 2). P.');
    const two = formatApa({ type: 'book', author: [n('Doe', 'Jane')], editor: [n('Editor', 'Eve'), n('Other', 'Al')], title: 'T', volume: 2, edition: '2nd', publisher: 'P', year: 2020 });
    assert.equal(two.plain, 'Doe, J. (2020). T (E. Editor & A. Other, Eds.; 2nd ed., Vol. 2). P.');
    assert.equal(formatApa({ type: 'book', author: [n('Doe', 'Jane')], editor: [n('Editor', 'Eve')], title: 'T', publisher: 'P', year: 2020 }).plain,
      'Doe, J. (2020). T (E. Editor, Ed.). P.');
    assert.equal(formatApa({ type: 'book', author: [n('Doe', 'Jane')], title: 'T', volume: 3, edition: '2nd', publisher: 'P', year: 2020 }).plain,
      'Doe, J. (2020). T (2nd ed., Vol. 3). P.');
  });

  test('chapter without editors, with volume and single page', () => {
    const r = formatApa({ type: 'chapter', author: [n('Doe', 'Jane')], title: 'C', containerTitle: 'Book', volume: 3, page: '12', publisher: 'P', year: 2020 });
    assert.equal(r.plain, 'Doe, J. (2020). C. In Book (Vol. 3, p. 12). P.');
  });

  test('paper-conference: editors only in apa7, series in parentheses', () => {
    const ref = {
      type: 'paper-conference', author: [n('Doe', 'Jane')], editor: [n('Editor', 'Eve')], title: 'Paper',
      containerTitle: 'Proceedings of X', collectionTitle: 'Lecture Notes in Computer Science', volume: 1234, page: '1-10', publisher: 'Springer', year: 2020,
    };
    assert.equal(formatApa(ref).plain, 'Doe, J. (2020). Paper. In E. Editor (Ed.), Proceedings of X (Lecture notes in computer science, Vol. 1234, pp. 1–10). Springer.');
    assert.equal(formatApa(ref, SCHOLAR).plain, 'Doe, J. (2020). Paper. In Proceedings of X (Lecture notes in computer science, Vol. 1234, pp. 1–10). Springer.');
    assert.equal(formatApa({ type: 'paper-conference', author: [n('Doe', 'Jane')], title: 'Paper', collectionTitle: 'NeurIPS', year: 2020 }).plain,
      'Doe, J. (2020). Paper. In NeurIPS.');
  });

  test('preprint variants', () => {
    const base = { author: [n('Doe', 'Jane')], title: 'Preprint Title', year: 2021 };
    assert.equal(formatApa({ ...base, type: 'preprint', archive: 'bioRxiv', archiveId: '2021.01.01.425001', doi: '10.1101/2021.01.01.425001' }).markdown,
      'Doe, J. (2021). Preprint title. *bioRxiv*. https://doi.org/10.1101/2021.01.01.425001');
    assert.equal(formatApa({ ...base, type: 'preprint', archive: 'SSRN', doi: '10.2139/ssrn.1' }).markdown,
      'Doe, J. (2021). *Preprint title*. SSRN. https://doi.org/10.2139/ssrn.1');
    assert.equal(formatApa({ ...base, type: 'preprint', archiveId: '2101.00001' }, SCHOLAR).markdown,
      'Doe, J. (2021). Preprint title. *arXiv preprint arXiv:2101.00001*.');
    assert.equal(formatApa({ ...base, type: 'preprint', archive: 'arXiv', archiveId: '2101.00001', url: 'https://arxiv.org/pdf/2101.00001' }).plain,
      'Doe, J. (2021). Preprint title. arXiv preprint arXiv:2101.00001. https://arxiv.org/pdf/2101.00001');
  });

  test('DOI prefixes are stripped and includeDoi/includeUrl are honoured', () => {
    const ref = { type: 'article-journal', author: [n('Doe', 'Jane')], title: 'T', containerTitle: 'J', year: 2020, doi: 'https://doi.org/10.1/abc', url: 'https://example.org' };
    assert.equal(formatApa(ref).plain, 'Doe, J. (2020). T. J. https://doi.org/10.1/abc');
    assert.equal(formatApa({ ...ref, doi: 'doi:10.1/abc' }).plain, 'Doe, J. (2020). T. J. https://doi.org/10.1/abc');
    assert.equal(formatApa(ref, { includeDoi: false }).plain, 'Doe, J. (2020). T. J. https://example.org');
    assert.equal(formatApa(ref, { includeDoi: false, includeUrl: false }).plain, 'Doe, J. (2020). T. J.');
    assert.equal(formatApa(ref, SCHOLAR).plain, 'Doe, J. (2020). T. J.');
  });

  test('article-journal without any periodical data falls back to the publisher with a warning', () => {
    // Crossref's x-bibtex export of a bioRxiv preprint: @article with a publisher but no journal.
    const ref = {
      type: 'article-journal', author: [n('Baek', 'Seungdae'), n('Park', 'Youngjin'), n('Paik', 'Se-Bum')],
      title: 'Sparse long-range connections in visual cortex', year: 2020, month: 3,
      publisher: 'openRxiv', doi: '10.1101/2020.03.19.998468', url: 'http://dx.doi.org/10.1101/2020.03.19.998468',
    };
    const r = formatApa(ref);
    assert.equal(r.plain, 'Baek, S., Park, Y., & Paik, S.-B. (2020). Sparse long-range connections in visual cortex. openRxiv. https://doi.org/10.1101/2020.03.19.998468');
    assert.deepEqual(r.warnings, ['No journal, volume or pages found; using the publisher as the source']);
    assert.equal(formatApa(ref, SCHOLAR).plain, 'Baek, S., Park, Y., & Paik, S.-B. (2020). Sparse long-range connections in visual cortex. openRxiv.');
    // Corporate author equal to the publisher: the publisher is still omitted (APA 7 rule).
    assert.equal(formatApa({ type: 'article-journal', author: [{ literal: 'openRxiv' }], title: 'T', year: 2020, publisher: 'openRxiv' }).plain, 'openRxiv. (2020). T.');
    // No publisher either: nothing is added and no publisher warning is raised.
    const bare = formatApa({ type: 'article-journal', author: [n('Doe', 'Jane')], title: 'T', year: 2020 });
    assert.equal(bare.plain, 'Doe, J. (2020). T.');
    assert.deepEqual(bare.warnings, []);
    // Any periodical datum keeps the journal form and ignores the publisher.
    assert.equal(formatApa({ ...ref, containerTitle: 'bioRxiv', doi: undefined, url: undefined }).plain, 'Baek, S., Park, Y., & Paik, S.-B. (2020). Sparse long-range connections in visual cortex. bioRxiv.');
    assert.equal(formatApa({ type: 'article-journal', author: [n('Doe', 'Jane')], title: 'T', year: 2020, volume: 3, publisher: 'P' }).plain, 'Doe, J. (2020). T. 3.');
  });

  test('sentenceCase false preserves titles and strips braces', () => {
    const r = formatApa({ type: 'book', author: [n('Doe', 'Jane')], title: 'The {Quick} Brown Fox', publisher: 'P', year: 2020 }, { sentenceCase: false });
    assert.equal(r.plain, 'Doe, J. (2020). The Quick Brown Fox. P.');
  });

  test('punctuation: no doubled periods, titles ending in ? or ! keep them', () => {
    assert.equal(formatApa({ type: 'article-journal', author: [n('Doe', 'Jane')], title: 'Does it work?', containerTitle: 'J', year: 2020 }).plain, 'Doe, J. (2020). Does it work? J.');
    assert.equal(formatApa({ type: 'book', author: [n('Doe', 'Jane')], title: 'Wow!', publisher: 'Acme Inc.', year: 2020 }).plain, 'Doe, J. (2020). Wow! Acme Inc.');
    const r = formatApa({ type: 'article-journal', author: [n('Doe', 'Jane')], title: '  Spaced  title ', containerTitle: ' J ', year: 2020 });
    assert.ok(!/\s\s/.test(r.plain), r.plain);
    assert.ok(!/\.\./.test(r.plain), r.plain);
  });

  test('other types: manuscript, patent, generic with container, thesis with publisher', () => {
    assert.equal(formatApa({ type: 'manuscript', author: [n('Doe', 'Jane')], title: 'Draft', institution: 'MIT', year: 2020 }).plain, 'Doe, J. (2020). Draft [Unpublished manuscript]. MIT.');
    assert.equal(formatApa({ type: 'patent', author: [n('Doe', 'Jane')], title: 'Widget', number: '1,234', genre: 'U.S. Patent', publisher: 'U.S. Patent and Trademark Office', year: 2020 }).plain,
      'Doe, J. (2020). Widget (U.S. Patent No. 1,234). U.S. Patent and Trademark Office.');
    assert.equal(formatApa({ type: 'generic', author: [n('Doe', 'Jane')], title: 'Thing', containerTitle: 'Some Collection', year: 2020 }).markdown, 'Doe, J. (2020). *Thing*. Some Collection.');
    assert.equal(formatApa({ type: 'thesis', author: [n('Doe', 'Jane')], title: 'T', genre: "Master's thesis", institution: 'MIT', publisher: 'ProQuest', year: 2020 }).plain,
      "Doe, J. (2020). T [Master's thesis, MIT]. ProQuest.");
  });

  test('unknown type is treated as generic with a warning', () => {
    const r = formatApa({ type: 'weird', author: [n('Doe', 'Jane')], title: 'T', year: 2020 });
    assert.equal(r.plain, 'Doe, J. (2020). T.');
    assert.ok(r.warnings.includes('Unknown type "weird" treated as generic'));
  });

  test('never throws on malformed input', () => {
    for (const type of REFERENCE_TYPES) {
      const r = formatApa(makeReference({ type }));
      assert.equal(typeof r.plain, 'string');
      assert.ok(Array.isArray(r.segments));
      assert.ok(r.warnings.some((w) => w.startsWith('No author')));
      assert.ok(r.warnings.includes('No year found; using n.d.'));
      assert.ok(r.warnings.includes('No title found'));
      for (const style of ['apa7', 'scholar']) assert.doesNotThrow(() => formatApa({ type }, { authorStyle: style, sentenceCase: false }));
    }
    assert.doesNotThrow(() => formatApa(null));
    assert.doesNotThrow(() => formatApa('string'));
    assert.doesNotThrow(() => formatApa({ author: 'nope', editor: 42, volume: {}, page: 5, year: 'n.d.', title: 99, month: 'x', day: 99 }));
    assert.doesNotThrow(() => formatApa({ type: 'webpage', url: 'https://x', accessed: 'garbage', year: 2020 }));
    assert.doesNotThrow(() => formatApa({ type: 'book', author: [null, 'Literal', { family: '' }, { literal: 'others' }] }));
    assert.equal(formatApa({ type: 'book', author: [{ literal: 'others' }], title: 'T', year: 2020 }).plain, 'et al. (2020). T.');
    assert.equal(formatApa({ type: 'article-journal', author: [n('Doe', 'Jane')], title: 'T', containerTitle: 'J', year: '2020a', volume: '12', page: 7 }).plain, 'Doe, J. (2020a). T. J, 12, 7.');
  });

  test('empty reference', () => {
    const r = formatApa({});
    assert.equal(r.plain, '(n.d.).');
    assert.equal(r.html, '(n.d.).');
    assert.equal(r.latex, '(n.d.).');
  });
});

describe('output formats', () => {
  const ref = {
    type: 'article-journal', author: [n('Doe', 'Jane'), n('Roe', 'Richard')],
    title: 'Snakes & ladders: 100% <fun> with *stars*, under_scores and $5 {braces}',
    containerTitle: 'Journal of "Quotes"', volume: 1, page: '1-2', year: 2020, doi: '10.1/a_b#c',
  };
  const r = formatApa(ref, { sentenceCase: false });

  test('segments are ordered runs with italic flags and a url flag on the locator', () => {
    assert.equal(r.segments[0].text, 'Doe, J., & Roe, R. (2020). Snakes & ladders: 100% <fun> with *stars*, under_scores and $5 braces. ');
    assert.equal(r.segments[0].italic, false);
    assert.deepEqual(r.segments[1], { text: 'Journal of "Quotes"', italic: true });
    assert.deepEqual(r.segments[r.segments.length - 1], { text: 'https://doi.org/10.1/a_b#c', italic: false, url: true });
    for (const s of r.segments) assert.ok(s.text.length > 0);
  });

  test('plain', () => {
    assert.equal(r.plain, 'Doe, J., & Roe, R. (2020). Snakes & ladders: 100% <fun> with *stars*, under_scores and $5 braces. Journal of "Quotes", 1, 1–2. https://doi.org/10.1/a_b#c');
  });

  test('html escapes &<>"\' and wraps italics in <i>', () => {
    assert.equal(r.html, 'Doe, J., &amp; Roe, R. (2020). Snakes &amp; ladders: 100% &lt;fun&gt; with *stars*, under_scores and $5 braces. <i>Journal of &quot;Quotes&quot;</i>, <i>1</i>, 1–2. https://doi.org/10.1/a_b#c');
    assert.equal(formatApa({ type: 'book', author: [{ literal: "O'Reilly" }], title: 'T', year: 2020 }).html, 'O&#39;Reilly. (2020). <i>T</i>.');
  });

  test('markdown escapes * and _ in text, leaves URLs intact, italics close before punctuation', () => {
    assert.equal(r.markdown, 'Doe, J., & Roe, R. (2020). Snakes & ladders: 100% \\<fun> with \\*stars\\*, under\\_scores and $5 braces. *Journal of "Quotes"*, *1*, 1–2. https://doi.org/10.1/a_b#c');
    const nature = formatApa({ type: 'article-journal', author: [n('Doe', 'Jane')], title: 'T', containerTitle: 'Nature', volume: 5, year: 2020 });
    assert.equal(nature.markdown, 'Doe, J. (2020). T. *Nature*, *5*.');
  });

  test('latex escapes specials, uses \\emph and \\url, en dash as --', () => {
    assert.equal(r.latex, 'Doe, J., \\& Roe, R. (2020). Snakes \\& ladders: 100\\% <fun> with *stars*, under\\_scores and \\$5 braces. \\emph{Journal of "Quotes"}, \\emph{1}, 1--2. \\url{https://doi.org/10.1/a_b#c}');
    const t = formatApa({ type: 'book', author: [n('Doe', 'Jane')], title: 'C^2 ~ {x} \\ y #1', year: 2020 }, { sentenceCase: false }).latex;
    assert.equal(t, 'Doe, J. (2020). \\emph{C\\textasciicircum{}2 \\textasciitilde{} x \\textbackslash{} y \\#1}.');
  });

  test('escaped braces in titles render as literal braces in every output', () => {
    const ref = { type: 'article-journal', author: [n('Tester', 'Ann')], title: 'Set notation \\{a, b\\} and {NASA} rules', containerTitle: 'J', year: 2022 };
    const out = formatApa(ref);
    expectAll(out, 'Tester, A. (2022). Set notation {a, b} and NASA rules. *J*.');
    assert.equal(out.latex, 'Tester, A. (2022). Set notation \\{a, b\\} and NASA rules. \\emph{J}.');
    // End to end from BibTeX: bibtex.js passes \\{ \\} through escaped so case protection stays distinguishable.
    const { references: [parsed] } = parseBibtexToReferences('@article{a, author={Tester, Ann}, title={Set notation \\{a, b\\} and {NASA} rules}, journal={J}, year={2022}}');
    assert.equal(parsed.title, 'Set notation \\{a, b\\} and {NASA} rules');
    assert.equal(formatApa(parsed).plain, 'Tester, A. (2022). Set notation {a, b} and NASA rules. J.');
    assert.equal(formatApa(parsed).latex, 'Tester, A. (2022). Set notation \\{a, b\\} and NASA rules. \\emph{J}.');
  });
});

describe('options and helpers', () => {
  test('defaultOptions', () => {
    assert.deepEqual({ ...defaultOptions }, { authorStyle: 'apa7', sentenceCase: true, includeDoi: true, includeUrl: true });
    assert.ok(Object.isFrozen(defaultOptions));
  });

  test('invalid options fall back to defaults', () => {
    const ref = { type: 'article-journal', author: [n('Doe', 'Jane')], title: 'T', containerTitle: 'J', year: 2020, doi: '10.1/x' };
    assert.equal(formatApa(ref, { authorStyle: 'chicago', includeDoi: undefined }).plain, formatApa(ref).plain);
    assert.equal(formatApa(ref, null).plain, formatApa(ref).plain);
    assert.equal(formatApa(ref, 'scholar').plain, formatApa(ref).plain);
  });

  test('formatMany maps over refs and tolerates non-arrays', () => {
    const out = formatMany([
      { type: 'book', author: [n('Doe', 'Jane')], title: 'A', publisher: 'P', year: 2020 },
      null,
    ], SCHOLAR);
    assert.equal(out.length, 2);
    assert.equal(out[0].plain, 'Doe, J. (2020). A. P.');
    assert.equal(out[1].plain, '(n.d.).');
    assert.deepEqual(formatMany(null), []);
    assert.deepEqual(formatMany('x'), []);
  });

  test('formatAuthors edge cases', () => {
    assert.equal(formatAuthors([]), '');
    assert.equal(formatAuthors(null), '');
    assert.equal(formatAuthors([n('Doe', 'Jane')]), 'Doe, J.');
    assert.equal(formatAuthors([n('Doe', 'Jane'), n('Roe', 'Richard')]), 'Doe, J., & Roe, R.');
    assert.equal(formatAuthors([n('Doe', 'Jane'), n('Roe', 'Richard'), n('Poe', 'Edgar Allan')], 'scholar'), 'Doe, J., Roe, R., & Poe, E. A.');
    assert.equal(formatAuthors([{ literal: 'OpenAI' }, n('Doe', 'Jane')]), 'OpenAI, & Doe, J.');
  });
});
