import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBibtex, latexToUnicode, stripBraces, parseNames, bibtexToReference,
  referenceToBibtex, parseBibtexToReferences,
} from '../public/assets/bibtex.js';

// ---------------------------------------------------------------------------
// Realistic samples (one per common source)
// ---------------------------------------------------------------------------

const ACL = `@inproceedings{devlin-etal-2019-bert,
    title = "{BERT}: Pre-training of Deep Bidirectional Transformers for Language Understanding",
    author = "Devlin, Jacob  and
      Chang, Ming-Wei  and
      Lee, Kenton  and
      Toutanova, Kristina",
    editor = "Burstein, Jill  and
      Doran, Christy  and
      Solorio, Thamar",
    booktitle = "Proceedings of the 2019 Conference of the North {A}merican Chapter of the Association for Computational Linguistics: Human Language Technologies, Volume 1 (Long and Short Papers)",
    month = jun,
    year = "2019",
    address = "Minneapolis, Minnesota",
    publisher = "Association for Computational Linguistics",
    url = "https://aclanthology.org/N19-1423",
    doi = "10.18653/v1/N19-1423",
    pages = "4171--4186",
    abstract = "We introduce a new language representation model called BERT.",
}`;

const DBLP = `@inproceedings{DBLP:conf/nips/VaswaniSPUJGKP17,
  author       = {Ashish Vaswani and
                  Noam Shazeer and
                  Niki Parmar and
                  Jakob Uszkoreit and
                  Llion Jones and
                  Aidan N. Gomez and
                  Lukasz Kaiser and
                  Illia Polosukhin},
  editor       = {Isabelle Guyon and
                  Ulrike von Luxburg and
                  Samy Bengio},
  title        = {Attention is All you Need},
  booktitle    = {Advances in Neural Information Processing Systems 30: Annual Conference
                  on Neural Information Processing Systems 2017, December 4-9, 2017,
                  Long Beach, CA, {USA}},
  pages        = {5998--6008},
  year         = {2017},
  url          = {https://proceedings.neurips.cc/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html},
  timestamp    = {Thu, 21 Jan 2021 15:15:21 +0100},
  biburl       = {https://dblp.org/rec/conf/nips/VaswaniSPUJGKP17.bib},
  bibsource    = {dblp computer science bibliography, https://dblp.org}
}`;

const DBLP_CORR = `@article{DBLP:journals/corr/abs-1810-04805,
  author       = {Jacob Devlin and
                  Ming{-}Wei Chang and
                  Kenton Lee and
                  Kristina Toutanova},
  title        = {{BERT:} Pre-training of Deep Bidirectional Transformers for Language
                  Understanding},
  journal      = {CoRR},
  volume       = {abs/1810.04805},
  year         = {2018},
  url          = {http://arxiv.org/abs/1810.04805},
  eprinttype    = {arXiv},
  eprint       = {1810.04805},
  timestamp    = {Tue, 30 Oct 2018 20:39:56 +0100},
  biburl       = {https://dblp.org/rec/journals/corr/abs-1810-04805.bib},
  bibsource    = {dblp computer science bibliography, https://dblp.org}
}`;

const SCHOLAR_PMLR = `@inproceedings{radford2021learning,
  title={Learning transferable visual models from natural language supervision},
  author={Radford, Alec and Kim, Jong Wook and Hallacy, Chris and Ramesh, Aditya and Goh, Gabriel and Agarwal, Sandhini and Sastry, Girish and Askell, Amanda and Mishkin, Pamela and Clark, Jack and others},
  booktitle={International conference on machine learning},
  pages={8748--8763},
  year={2021},
  organization={PMLR}
}`;

const SCHOLAR_ARXIV = `@article{kaplan2020scaling,
  title={Scaling laws for neural language models},
  author={Kaplan, Jared and McCandlish, Sam and Henighan, Tom and Brown, Tom B and Chess, Benjamin and Child, Rewon and Gray, Scott and Radford, Alec and Wu, Jeffrey and Amodei, Dario},
  journal={arXiv preprint arXiv:2001.08361},
  year={2020}
}`;

const SCHOLAR_JOURNAL = `@article{lecun2015deep,
  title={Deep learning},
  author={LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal={nature},
  volume={521},
  number={7553},
  pages={436--444},
  year={2015},
  publisher={Nature Publishing Group UK London}
}`;

const ARXIV_EXPORT = `@misc{touvron2023llama,
      title={LLaMA: Open and Efficient Foundation Language Models},
      author={Hugo Touvron and Thibaut Lavril and Gautier Izacard and Xavier Martinet and Marie-Anne Lachaux},
      year={2023},
      eprint={2302.13971},
      archivePrefix={arXiv},
      primaryClass={cs.CL}
}`;

const ZOTERO_BIBLATEX = `@online{vaswani_attention_2017,
	title = {Attention Is All You Need},
	url = {http://arxiv.org/abs/1706.03762},
	abstract = {The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.},
	number = {{arXiv}:1706.03762},
	publisher = {{arXiv}},
	author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Lukasz and Polosukhin, Illia},
	urldate = {2024-01-15},
	date = {2017-12-05},
	eprinttype = {arxiv},
	eprint = {1706.03762},
	eprintclass = {cs},
	keywords = {Computer Science - Computation and Language},
}

@article{hochreiter_long_1997,
	title = {Long Short-Term Memory},
	volume = {9},
	issn = {0899-7667},
	doi = {10.1162/neco.1997.9.8.1735},
	pages = {1735--1780},
	number = {8},
	journaltitle = {Neural Computation},
	shortjournal = {Neural Comput.},
	author = {Hochreiter, Sepp and Schmidhuber, J{\\"u}rgen},
	date = {1997-11},
	langid = {english},
}`;

const IEEE = `@ARTICLE{9048533,
  author={He, Kaiming and Zhang, Xiangyu and Ren, Shaoqing and Sun, Jian},
  journal={IEEE Transactions on Pattern Analysis and Machine Intelligence},
  title={Deep Residual Learning for Image Recognition},
  year={2016},
  volume={38},
  number={12},
  pages={2481-2495},
  keywords={Training;Convolution},
  doi={10.1109/TPAMI.2016.2577031},
  ISSN={1939-3539},
  month={Dec.},}`;

const SPRINGER = `@InProceedings{10.1007/978-3-030-58452-8_13,
author="Carion, Nicolas
and Massa, Francisco
and Synnaeve, Gabriel
and Usunier, Nicolas
and Kirillov, Alexander
and Zagoruyko, Sergey",
editor="Vedaldi, Andrea
and Bischof, Horst
and Brox, Thomas
and Frahm, Jan-Michael",
title="End-to-End Object Detection with Transformers",
booktitle="Computer Vision -- ECCV 2020",
year="2020",
publisher="Springer International Publishing",
address="Cham",
pages="213--229",
abstract="We present a new method that views object detection as a direct set prediction problem.",
isbn="978-3-030-58452-8"
}`;

const ACM = `@inproceedings{10.1145/3442188.3445922,
author = {Bender, Emily M. and Gebru, Timnit and McMillan-Major, Angelina and Shmitchell, Shmargaret},
title = {On the Dangers of Stochastic Parrots: Can Language Models Be Too Big? \\includegraphics[scale=0.2]{parrot.png}},
year = {2021},
isbn = {9781450383097},
publisher = {Association for Computing Machinery},
address = {New York, NY, USA},
url = {https://doi.org/10.1145/3442188.3445922},
doi = {10.1145/3442188.3445922},
booktitle = {Proceedings of the 2021 ACM Conference on Fairness, Accountability, and Transparency},
pages = {610–623},
numpages = {14},
location = {Virtual Event, Canada},
series = {FAccT '21}
}`;

const ACM_JOURNAL = `@article{10.1145/3560815,
author = {Liu, Pengfei and Yuan, Weizhe and Fu, Jinlan and Jiang, Zhengbao and Hayashi, Hiroaki and Neubig, Graham},
title = {Pre-train, Prompt, and Predict: A Systematic Survey of Prompting Methods in Natural Language Processing},
year = {2023},
issue_date = {September 2023},
publisher = {Association for Computing Machinery},
volume = {55},
number = {9},
issn = {0360-0300},
url = {https://doi.org/10.1145/3560815},
doi = {10.1145/3560815},
journal = {ACM Comput. Surv.},
month = jan,
articleno = {195},
numpages = {35}
}`;

const SEMANTIC_SCHOLAR = `@article{Vaswani2017AttentionIA,
  title={Attention is All you Need},
  author={Ashish Vaswani and Noam M. Shazeer and Niki Parmar and Jakob Uszkoreit and Llion Jones and Aidan N. Gomez and Lukasz Kaiser and Illia Polosukhin},
  journal={ArXiv},
  year={2017},
  volume={abs/1706.03762},
  url={https://api.semanticscholar.org/CorpusID:13756489}
}`;

const HANDWRITTEN = `% My thesis references
@string{mit = "Massachusetts Institute of Technology"}
@STRING{LNCS = "Lecture Notes in Computer Science"}
@preamble{"\\newcommand{\\noop}[1]{}"}
@comment{This whole block is {ignored} by the parser}

@phdthesis{sutskever2013training,
  author = {Ilya Sutskever},
  title  = {Training Recurrent Neural Networks},
  school = {University of Toronto},
  address = {Toronto, ON},
  year   = 2013
}

@mastersthesis{doe2020,
  author = {Jane Doe},
  title = {A Study of Things},
  school = mit,
  year = {2020},
  month = sep # "~15"
}

@techreport{brown1990statistical,
  author = {Peter F. Brown and John Cocke and Stephen A. Della Pietra and Vincent J. Della Pietra},
  title = {A Statistical Approach to Language Translation},
  institution = {IBM T. J. Watson Research Center},
  number = {RC 14773},
  type = {Research Report},
  year = 1990
}

@book{Goodfellow-et-al-2016,
    title={Deep Learning},
    author={Ian Goodfellow and Yoshua Bengio and Aaron Courville},
    publisher={MIT Press},
    address = {Cambridge, MA},
    edition = {1st},
    note={\\url{http://www.deeplearningbook.org}},
    year={2016}
}

@incollection{hinton1986learning,
  author = {Hinton, G. E. and McClelland, J. L. and Rumelhart, D. E.},
  title = {Distributed Representations},
  booktitle = {Parallel Distributed Processing: Explorations in the Microstructure of Cognition, Vol. 1},
  editor = {Rumelhart, D. E. and McClelland, J. L.},
  publisher = {MIT Press},
  address = {Cambridge, MA},
  pages = {77--109},
  year = {1986},
  series = LNCS # " 42"
}

@misc{pytorch_docs,
  title = {{PyTorch} Documentation},
  author = {{PyTorch Contributors}},
  howpublished = {\\url{https://pytorch.org/docs/stable/index.html}},
  year = {2024},
  note = {Accessed: 2024-03-10}
}

@misc{wikipedia_transformer,
  author = "{Wikipedia contributors}",
  title = "Transformer (machine learning model) --- {Wikipedia}{,} The Free Encyclopedia",
  year = "2024",
  url = "https://en.wikipedia.org/w/index.php?title=Transformer_(machine_learning_model)&oldid=1200000000",
  note = "[Online; accessed 12-June-2024]"
}

@software{paszke_pytorch_2019,
  author = {Paszke, Adam and Gross, Sam and Chintala, Soumith},
  title = {{PyTorch}},
  version = {2.1.0},
  publisher = {Zenodo},
  url = {https://github.com/pytorch/pytorch},
  year = {2019}
}`;

const ALL_SAMPLES = [ACL, DBLP, DBLP_CORR, SCHOLAR_PMLR, SCHOLAR_ARXIV, SCHOLAR_JOURNAL, ARXIV_EXPORT,
  ZOTERO_BIBLATEX, IEEE, SPRINGER, ACM, ACM_JOURNAL, SEMANTIC_SCHOLAR, HANDWRITTEN].join('\n\n');

function one(text) {
  const { entries, errors } = parseBibtex(text);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(entries.length, 1);
  return entries[0];
}

function ref(text) {
  return bibtexToReference(one(text));
}

// ---------------------------------------------------------------------------
// parseBibtex
// ---------------------------------------------------------------------------

describe('parseBibtex', () => {
  test('ACL entry: quotes, month macro, trailing comma', () => {
    const e = one(ACL);
    assert.equal(e.type, 'inproceedings');
    assert.equal(e.key, 'devlin-etal-2019-bert');
    assert.equal(e.fields.title, '{BERT}: Pre-training of Deep Bidirectional Transformers for Language Understanding');
    assert.equal(e.fields.month, 'June');
    assert.equal(e.fields.pages, '4171--4186');
    assert.equal(e.fields.doi, '10.18653/v1/N19-1423');
    assert.ok(e.raw.startsWith('@inproceedings{') && e.raw.endsWith('}'));
  });

  test('IEEE entry: uppercase type, odd spacing, trailing comma before brace, mixed-case field names', () => {
    const e = one(IEEE);
    assert.equal(e.type, 'article');
    assert.equal(e.key, '9048533');
    assert.equal(e.fields.issn, '1939-3539');
    assert.equal(e.fields.month, 'Dec.');
    assert.equal(e.fields.pages, '2481-2495');
  });

  test('Springer entry: capitalised type, quoted values with newlines', () => {
    const e = one(SPRINGER);
    assert.equal(e.type, 'inproceedings');
    assert.equal(e.key, '10.1007/978-3-030-58452-8_13');
    assert.match(e.fields.author, /^Carion, Nicolas\nand Massa/);
    assert.equal(e.fields.isbn, '978-3-030-58452-8');
  });

  test('parentheses delimiters, bare numbers, no trailing comma, last field without comma', () => {
    const e = one('@Article(key1,\n title = {T},\n year = 1999,\n volume = 3\n)');
    assert.equal(e.type, 'article');
    assert.equal(e.key, 'key1');
    assert.deepEqual(e.fields, { title: 'T', year: '1999', volume: '3' });
  });

  test('all entry types lowercased; field names lowercased', () => {
    const e = one('@INPROCEEDINGS{k, TITLE={A}, Author={B}}');
    assert.equal(e.type, 'inproceedings');
    assert.deepEqual(Object.keys(e.fields), ['title', 'author']);
  });

  test('nested braces and quotes containing braces', () => {
    const e = one('@misc{k, title = {A {B {C}} D}, note = "Quote with {a "quoted" group} inside"}');
    assert.equal(e.fields.title, 'A {B {C}} D');
    assert.equal(e.fields.note, 'Quote with {a "quoted" group} inside');
  });

  test('concatenation with #, @string macros (case-insensitive), unknown macros kept', () => {
    const text = `@string{ACL = "Association for Computational Linguistics"}
      @string{short = {ACL}}
      @inproceedings{k, publisher = acl, booktitle = "Proc. of " # Short # { 2020}, series = unknownMacro # "-x", month = "Early " # jun}`;
    const { entries, errors } = parseBibtex(text);
    assert.equal(errors.length, 0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].fields.publisher, 'Association for Computational Linguistics');
    assert.equal(entries[0].fields.booktitle, 'Proc. of ACL 2020');
    assert.equal(entries[0].fields.series, 'unknownMacro-x');
    assert.equal(entries[0].fields.month, 'Early June');
  });

  test('@string with parentheses and macros referencing macros', () => {
    const text = '@string(a = "Foo")\n@string{b = a # " Bar"}\n@misc{k, title = b}';
    assert.equal(parseBibtex(text).entries[0].fields.title, 'Foo Bar');
  });

  test('@comment, @preamble, % comment lines and stray text are skipped', () => {
    const text = `Some stray text here with an email foo@bar.com and @ alone.
% @article{commented, title={no}}
   % indented comment @misc{x}
@comment{@article{inside, title = {nope}}}
@preamble{"\\newcommand{\\x}{y}"}
@misc{real, title = {Yes}}
More trailing junk } } {`;
    const { entries, errors } = parseBibtex(text);
    assert.equal(errors.length, 0);
    assert.deepEqual(entries.map((e) => e.key), ['real']);
  });

  test('% inside a value is not a comment', () => {
    const e = one('@misc{k, title = {100% sure}, note = {a\n% b\nc}}');
    assert.equal(e.fields.title, '100% sure');
    assert.equal(e.fields.note, 'a\n% b\nc');
  });

  test('BOM and CRLF line endings', () => {
    const text = '\uFEFF@article{k,\r\n  title = {A\r\n  B},\r\n  year = {2000}\r\n}\r\n';
    const e = one(text);
    assert.equal(e.key, 'k');
    assert.equal(e.fields.title, 'A\n  B');
  });

  test('entry without a key, entry with empty key, entry with no fields', () => {
    const { entries } = parseBibtex('@misc{, title = {A}}\n@misc{ title = {B} }\n@misc{onlykey}\n@misc{onlykey2,}');
    assert.equal(entries.length, 4);
    assert.equal(entries[0].key, '');
    assert.equal(entries[0].fields.title, 'A');
    assert.equal(entries[1].key, '');
    assert.equal(entries[1].fields.title, 'B');
    assert.equal(entries[2].key, 'onlykey');
    assert.deepEqual(entries[2].fields, {});
    assert.equal(entries[3].key, 'onlykey2');
  });

  test('missing comma between fields is tolerated', () => {
    const e = one('@misc{k,\n title = {A}\n year = {2000}\n}');
    assert.deepEqual(e.fields, { title: 'A', year: '2000' });
  });

  test('empty value tolerated', () => {
    const e = one('@misc{k, title = , year = {2000}}');
    assert.equal(e.fields.title, '');
    assert.equal(e.fields.year, '2000');
  });

  test('escaped braces inside values do not affect balance', () => {
    const e = one('@misc{k, title = {Set $\\{x\\}$ and \\{ alone}, year = {1}}');
    assert.equal(e.fields.title, 'Set $\\{x\\}$ and \\{ alone');
    assert.equal(e.fields.year, '1');
  });

  test('unbalanced braces: error with line number, later entries still parse', () => {
    const text = [
      '@article{good1, title = {Fine}, year = {2001}}',
      '',
      '@article{broken,',
      '  title = {Unbalanced {brace,',
      '  year = {2002}',
      '}',
      '@article{good2, title = {Also fine}, year = {2003}}',
      '@misc{good3, title = "Quoted" }',
    ].join('\n');
    const { entries, errors } = parseBibtex(text);
    assert.deepEqual(entries.map((e) => e.key), ['good1', 'good2', 'good3']);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].line, 4);
    assert.match(errors[0].message, /Unbalanced braces/);
    assert.match(errors[0].message, /broken/);
  });

  test('missing "=" produces an error and resyncs', () => {
    const { entries, errors } = parseBibtex('@misc{a, title {x}}\n@misc{b, title = {y}}');
    assert.deepEqual(entries.map((e) => e.key), ['b']);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].line, 1);
    assert.match(errors[0].message, /Expected "="/);
  });

  test('unterminated quoted value at end of input', () => {
    const { entries, errors } = parseBibtex('@misc{a, title = "never ends');
    assert.equal(entries.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].line, 1);
  });

  test('non-string input does not throw', () => {
    assert.deepEqual(parseBibtex(null), { entries: [], errors: [] });
    assert.deepEqual(parseBibtex(undefined), { entries: [], errors: [] });
    assert.deepEqual(parseBibtex(''), { entries: [], errors: [] });
    assert.equal(parseBibtex(12345).entries.length, 0);
  });

  test('all realistic samples parse without errors', () => {
    const { entries, errors } = parseBibtex(ALL_SAMPLES);
    assert.deepEqual(errors, []);
    assert.equal(entries.length, 22);
  });

  test('very long input parses in linear-ish time', () => {
    const block = '@article{k%d,\n  author = {Alice Smith and Bob Jones},\n  title = {A title with {Nested {Braces}} and "quotes"},\n  journal = {J},\n  year = {2000},\n  pages = {1--2}\n}\n';
    let text = '';
    for (let i = 0; i < 5000; i++) text += block.replace('%d', String(i));
    const t0 = Date.now();
    const { entries, errors } = parseBibtex(text);
    const elapsed = Date.now() - t0;
    assert.equal(entries.length, 5000);
    assert.equal(errors.length, 0);
    assert.ok(elapsed < 5000, `took ${elapsed}ms`);
    // a pathological unbalanced value spanning the whole file must not hang either
    const t1 = Date.now();
    parseBibtex('@misc{x, title = {' + 'a{'.repeat(50000) + '}\n' + text.slice(0, 20000));
    assert.ok(Date.now() - t1 < 5000);
  });
});

// ---------------------------------------------------------------------------
// latexToUnicode / stripBraces
// ---------------------------------------------------------------------------

describe('latexToUnicode', () => {
  const cases = [
    ['Schr\\"odinger', 'Schrödinger'],
    ['Schr\\"{o}dinger', 'Schrödinger'],
    ['Schr{\\"o}dinger', 'Schr{ö}dinger'],
    ["Caf\\'e", 'Café'],
    ['\\`a \\^e \\~n \\c{c} \\v{s} \\H{o} \\k{a} \\={a} \\.{z} \\u{g} \\r{a}', 'à ê ñ ç š ő ą ā ż ğ å'],
    ['\\c c \\v s \\u g', 'ç š ğ'],
    ['{\\"\\i} \\"{\\i} \\\'{\\j} \\i{} \\j{}', '{ï} ï j\u0301 ı ȷ'],
    ['\\o \\O \\l \\L \\ss \\ae \\AE \\oe \\OE \\aa \\AA', 'øØłŁßæÆœŒåÅ'],
    ['\\o{} \\O{} \\l{} \\L{} \\ss{} \\ae{} \\AE{} \\oe{} \\OE{} \\aa{} \\AA{}', 'ø Ø ł Ł ß æ Æ œ Œ å Å'],
    ['Stra\\ss e and {\\L}ukasz and \\o{}re', 'Straße and {Ł}ukasz and øre'],
    ['A \\& B 100\\% \\$5 a\\_b \\#1', 'A & B 100% $5 a_b #1'],
    ['pre -- post --- end', 'pre – post — end'],
    ["``quoted'' and `single'", '“quoted” and ‘single’'],
    ['Smith~and~Jones', 'Smith\u00A0and\u00A0Jones'],
    ['\\textit{x} \\emph{y} \\textbf{z} \\textsc{w} \\mbox{v}', 'x y z w v'],
    ['\\url{http://example.com/~user/a_b}', 'http://example.com/~user/a_b'],
    ['\\href{http://x.y}{Link text}', 'Link text'],
    ['a\\ldots b \\dots', 'a… b …'],
    ['line\\\\break and \\, \\; \\  spaces', 'line break and       spaces'],
    ['$\\alpha + \\beta$ and $$x^2$$', '\\alpha + \\beta and x^2'],
    ['\\unknowncmd{kept} \\anothercmd rest', 'kept  rest'],
    ['\\textsuperscript{2} \\textendash \\textemdash \\textquotedblleft q\\textquotedblright', '2 – — “ q”'],
    ['\\textasciitilde \\textbackslash \\LaTeX{} \\TeX', '~ \\ LaTeX TeX'],
    ['\\{braces\\}', '\\{braces\\}'],
    ['{\\em Emphasised} {\\bf bold}', '{Emphasised} {bold}'],
    ['\\textsuperscript{\\textregistered}', '®'],
    ['\\"{\\i}n', 'ïn'],
    ['\\\'{E}cole', 'École'],
    ['Nguy\\~{\\^e}n', 'Nguyễn'],
  ];
  for (const [input, expected] of cases) {
    test(JSON.stringify(input), () => {
      assert.equal(latexToUnicode(input), expected);
    });
  }

  test('output is NFC composed', () => {
    const out = latexToUnicode('\\"o');
    assert.equal(out.length, 1);
    assert.equal(out, out.normalize('NFC'));
  });

  test('URL-looking values are left intact (no tilde / dash / quote conversion)', () => {
    const url = "https://example.com/~user/path--x/it's?a=1&b=2";
    assert.equal(latexToUnicode(url), url);
    assert.equal(latexToUnicode('www.example.org/~x'), 'www.example.org/~x');
  });

  test('null / undefined / non-string', () => {
    assert.equal(latexToUnicode(null), '');
    assert.equal(latexToUnicode(undefined), '');
    assert.equal(latexToUnicode(42), '42');
  });

  test('malformed input does not throw', () => {
    assert.equal(latexToUnicode('\\'), '');
    assert.equal(latexToUnicode('\\"'), '\u00A8');
    assert.equal(latexToUnicode('{unbalanced'), '{unbalanced');
    assert.equal(latexToUnicode('\\emph{unterminated'), 'unterminated');
    assert.equal(latexToUnicode('$unterminated math'), '$unterminated math');
  });
});

describe('stripBraces', () => {
  test('removes unescaped braces, keeps escaped as literal braces', () => {
    assert.equal(stripBraces('{BERT}: {P}re-training'), 'BERT: Pre-training');
    assert.equal(stripBraces('a \\{b\\} c'), 'a {b} c');
    assert.equal(stripBraces(''), '');
    assert.equal(stripBraces(null), '');
  });
});

// ---------------------------------------------------------------------------
// parseNames
// ---------------------------------------------------------------------------

describe('parseNames', () => {
  const cases = [
    ['Vaswani, Ashish and Noam Shazeer and others', [
      { family: 'Vaswani', given: 'Ashish' }, { family: 'Shazeer', given: 'Noam' }, { literal: 'others' }]],
    ['Jean-Pierre Dupont', [{ family: 'Dupont', given: 'Jean-Pierre' }]],
    ['Ludwig van Beethoven', [{ family: 'Beethoven', given: 'Ludwig', particle: 'van' }]],
    ['de la Cruz, Juan', [{ family: 'Cruz', given: 'Juan', particle: 'de la' }]],
    ['Della Pietra, Stephen', [{ family: 'Della Pietra', given: 'Stephen' }]],
    ['Stephen A. Della Pietra', [{ family: 'Pietra', given: 'Stephen A. Della' }]],
    ['van der Maaten, Laurens', [{ family: 'Maaten', given: 'Laurens', particle: 'van der' }]],
    ['Laurens van der Maaten', [{ family: 'Maaten', given: 'Laurens', particle: 'van der' }]],
    ['{OpenAI}', [{ literal: 'OpenAI' }]],
    ['{Barnes and Noble}', [{ literal: 'Barnes and Noble' }]],
    ['{Barnes and Noble} and Smith, John', [{ literal: 'Barnes and Noble' }, { family: 'Smith', given: 'John' }]],
    ['others', [{ literal: 'others' }]],
    ['OTHERS', [{ literal: 'others' }]],
    ['Plato', [{ family: 'Plato' }]],
    ['Smith, J. R.', [{ family: 'Smith', given: 'J. R.' }]],
    ['Smith, Jr., John', [{ family: 'Smith', given: 'John', suffix: 'Jr.' }]],
    ['King, Jr., Martin Luther', [{ family: 'King', given: 'Martin Luther', suffix: 'Jr.' }]],
    ['von Luxburg, Ulrike', [{ family: 'Luxburg', given: 'Ulrike', particle: 'von' }]],
    ['Ulrike von Luxburg', [{ family: 'Luxburg', given: 'Ulrike', particle: 'von' }]],
    ['Jean de la Fontaine du Bois Joli', [{ family: 'Bois Joli', given: 'Jean', particle: 'de la Fontaine du' }]],
    ['{de la Cruz}, Juan', [{ family: 'de la Cruz', given: 'Juan' }]],
    ['Juan {de la Cruz}', [{ family: 'de la Cruz', given: 'Juan' }]],
    ['Ming{-}Wei Chang', [{ family: 'Chang', given: 'Ming-Wei' }]],
    ['Kaiser, {\\L}ukasz', [{ family: 'Kaiser', given: 'Łukasz' }]],
    ['Schmidhuber, J{\\"u}rgen', [{ family: 'Schmidhuber', given: 'Jürgen' }]],
    ['Jürgen Schmidhuber', [{ family: 'Schmidhuber', given: 'Jürgen' }]],
    ['Müller, Ömer', [{ family: 'Müller', given: 'Ömer' }]],
    ['Smith, J.~R.', [{ family: 'Smith', given: 'J. R.' }]],
    ['Donald~E. Knuth', [{ family: 'Knuth', given: 'Donald E.' }]],
    ['  Devlin,   Jacob   AND\n   Chang, Ming-Wei  ', [{ family: 'Devlin', given: 'Jacob' }, { family: 'Chang', given: 'Ming-Wei' }]],
    ['Alice Anderson\\newline and Bob Brown', [{ family: 'Anderson', given: 'Alice' }, { family: 'Brown', given: 'Bob' }]],
    ['Anderson and Brown', [{ family: 'Anderson' }, { family: 'Brown' }]],
    ['Sandra Bullock-Jones', [{ family: 'Bullock-Jones', given: 'Sandra' }]],
    ['{\\relax Ch}ristopher Manning', [{ family: 'Manning', given: 'Christopher' }]],
    ['Charles Louis Xavier Joseph de la Vall{\\\'e}e Poussin', [{ family: 'Vallée Poussin', given: 'Charles Louis Xavier Joseph', particle: 'de la' }]],
    ['Smith,', [{ family: 'Smith' }]],
    ['and Smith', [{ family: 'Smith' }]],
    ['Andrea Anderson', [{ family: 'Anderson', given: 'Andrea' }]],
    ['Brandon and Sandy Sanderson', [{ family: 'Brandon' }, { family: 'Sanderson', given: 'Sandy' }]],
  ];
  for (const [input, expected] of cases) {
    test(JSON.stringify(input), () => {
      assert.deepEqual(parseNames(input), expected);
    });
  }

  test('empty / null input', () => {
    assert.deepEqual(parseNames(''), []);
    assert.deepEqual(parseNames('   '), []);
    assert.deepEqual(parseNames(null), []);
    assert.deepEqual(parseNames(undefined), []);
  });

  test('"and" inside a name token is not a separator', () => {
    assert.deepEqual(parseNames('Alexander Anderson and Sandy Brandt'), [
      { family: 'Anderson', given: 'Alexander' }, { family: 'Brandt', given: 'Sandy' }]);
  });
});

// ---------------------------------------------------------------------------
// bibtexToReference
// ---------------------------------------------------------------------------

describe('bibtexToReference', () => {
  test('ACL inproceedings', () => {
    const r = ref(ACL);
    assert.equal(r.type, 'paper-conference');
    assert.equal(r.id, 'devlin-etal-2019-bert');
    assert.equal(r.title, '{BERT}: Pre-training of Deep Bidirectional Transformers for Language Understanding');
    assert.equal(r.containerTitle, 'Proceedings of the 2019 Conference of the North {A}merican Chapter of the Association for Computational Linguistics: Human Language Technologies, Volume 1 (Long and Short Papers)');
    assert.deepEqual(r.author, [
      { family: 'Devlin', given: 'Jacob' }, { family: 'Chang', given: 'Ming-Wei' },
      { family: 'Lee', given: 'Kenton' }, { family: 'Toutanova', given: 'Kristina' }]);
    assert.equal(r.editor.length, 3);
    assert.equal(r.year, 2019);
    assert.equal(r.month, 6);
    assert.equal(r.page, '4171-4186');
    assert.equal(r.publisher, 'Association for Computational Linguistics');
    assert.equal(r.publisherPlace, 'Minneapolis, Minnesota');
    assert.equal(r.doi, '10.18653/v1/N19-1423');
    assert.equal(r.url, 'https://aclanthology.org/N19-1423');
    assert.equal(r.abstract, undefined);
  });

  test('DBLP inproceedings: First Last names, multi-line booktitle, {USA} protection kept', () => {
    const r = ref(DBLP);
    assert.equal(r.type, 'paper-conference');
    assert.equal(r.author.length, 8);
    assert.deepEqual(r.author[5], { family: 'Gomez', given: 'Aidan N.' });
    assert.deepEqual(r.editor[1], { family: 'Luxburg', given: 'Ulrike', particle: 'von' });
    assert.match(r.containerTitle, /^Advances in Neural Information Processing Systems 30: Annual Conference on Neural/);
    assert.match(r.containerTitle, /Long Beach, CA, \{USA\}$/);
    assert.equal(r.page, '5998-6008');
    assert.equal(r.year, 2017);
    assert.equal(r.timestamp, undefined);
    assert.equal(r.biburl, undefined);
  });

  test('DBLP CoRR article -> preprint with archiveId', () => {
    const r = ref(DBLP_CORR);
    assert.equal(r.type, 'preprint');
    assert.equal(r.archive, 'arXiv');
    assert.equal(r.archiveId, '1810.04805');
    assert.equal(r.containerTitle, undefined);
    assert.equal(r.title, '{BERT:} Pre-training of Deep Bidirectional Transformers for Language Understanding');
    assert.deepEqual(r.author[1], { family: 'Chang', given: 'Ming-Wei' });
    assert.equal(r.url, 'http://arxiv.org/abs/1810.04805');
  });

  test('Google Scholar PMLR: organization -> publisher, others', () => {
    const r = ref(SCHOLAR_PMLR);
    assert.equal(r.type, 'paper-conference');
    assert.equal(r.publisher, 'PMLR');
    assert.equal(r.containerTitle, 'International conference on machine learning');
    assert.equal(r.page, '8748-8763');
    assert.deepEqual(r.author.at(-1), { literal: 'others' });
    assert.deepEqual(r.author[1], { family: 'Kim', given: 'Jong Wook' });
  });

  test('Google Scholar arXiv article -> preprint', () => {
    const r = ref(SCHOLAR_ARXIV);
    assert.equal(r.type, 'preprint');
    assert.equal(r.archive, 'arXiv');
    assert.equal(r.archiveId, '2001.08361');
    assert.equal(r.year, 2020);
    assert.equal(r.containerTitle, undefined);
  });

  test('Google Scholar journal article', () => {
    const r = ref(SCHOLAR_JOURNAL);
    assert.equal(r.type, 'article-journal');
    assert.equal(r.containerTitle, 'nature');
    assert.equal(r.volume, '521');
    assert.equal(r.issue, '7553');
    assert.equal(r.page, '436-444');
    assert.equal(r.publisher, 'Nature Publishing Group UK London');
    assert.deepEqual(r.author[0], { family: 'LeCun', given: 'Yann' });
  });

  test('arXiv export misc with eprint/archivePrefix/primaryClass', () => {
    const r = ref(ARXIV_EXPORT);
    assert.equal(r.type, 'preprint');
    assert.equal(r.archive, 'arXiv');
    assert.equal(r.archiveId, '2302.13971');
    assert.equal(r.title, 'LLaMA: Open and Efficient Foundation Language Models');
    assert.equal(r.primaryClass, undefined);
    assert.equal(r.year, 2023);
  });

  test('Zotero biblatex @online arXiv: date, urldate, eprinttype', () => {
    const { references, errors } = parseBibtexToReferences(ZOTERO_BIBLATEX);
    assert.equal(errors.length, 0);
    const [arx, lstm] = references;
    assert.equal(arx.type, 'preprint');
    assert.equal(arx.archive, 'arXiv');
    assert.equal(arx.archiveId, '1706.03762');
    assert.equal(arx.year, 2017);
    assert.equal(arx.month, 12);
    assert.equal(arx.day, 5);
    assert.equal(arx.accessed, '2024-01-15');
    assert.equal(arx.publisher, undefined);
    assert.equal(arx.url, 'http://arxiv.org/abs/1706.03762');
    assert.equal(lstm.type, 'article-journal');
    assert.equal(lstm.containerTitle, 'Neural Computation');
    assert.equal(lstm.year, 1997);
    assert.equal(lstm.month, 11);
    assert.equal(lstm.volume, '9');
    assert.equal(lstm.issue, '8');
    assert.equal(lstm.page, '1735-1780');
    assert.equal(lstm.doi, '10.1162/neco.1997.9.8.1735');
    assert.equal(lstm.language, 'english');
    assert.deepEqual(lstm.author[1], { family: 'Schmidhuber', given: 'Jürgen' });
  });

  test('IEEE article: month={Dec.}, single-hyphen pages', () => {
    const r = ref(IEEE);
    assert.equal(r.type, 'article-journal');
    assert.equal(r.month, 12);
    assert.equal(r.page, '2481-2495');
    assert.equal(r.containerTitle, 'IEEE Transactions on Pattern Analysis and Machine Intelligence');
    assert.equal(r.doi, '10.1109/TPAMI.2016.2577031');
    assert.equal(r.id, '9048533');
  });

  test('Springer InProceedings: -- in booktitle decoded to en dash', () => {
    const r = ref(SPRINGER);
    assert.equal(r.type, 'paper-conference');
    assert.equal(r.containerTitle, 'Computer Vision – ECCV 2020');
    assert.equal(r.publisher, 'Springer International Publishing');
    assert.equal(r.publisherPlace, 'Cham');
    assert.equal(r.page, '213-229');
    assert.equal(r.editor.length, 4);
    assert.deepEqual(r.editor[3], { family: 'Frahm', given: 'Jan-Michael' });
  });

  test('ACM inproceedings: unicode dash in pages, series, location, doi.org url kept, stray command removed', () => {
    const r = ref(ACM);
    assert.equal(r.page, '610-623');
    assert.equal(r.collectionTitle, 'FAccT ’21');
    assert.equal(r.publisherPlace, 'New York, NY, USA');
    assert.equal(r.doi, '10.1145/3442188.3445922');
    assert.equal(r.url, 'https://doi.org/10.1145/3442188.3445922');
    assert.equal(r.title, 'On the Dangers of Stochastic Parrots: Can Language Models Be Too Big? parrot.png');
  });

  test('ACM journal: articleno -> articleNumber, month macro', () => {
    const r = ref(ACM_JOURNAL);
    assert.equal(r.type, 'article-journal');
    assert.equal(r.articleNumber, '195');
    assert.equal(r.page, undefined);
    assert.equal(r.month, 1);
    assert.equal(r.volume, '55');
    assert.equal(r.issue, '9');
    assert.equal(r.containerTitle, 'ACM Comput. Surv.');
  });

  test('Semantic Scholar: journal ArXiv + volume abs/ID -> preprint', () => {
    const r = ref(SEMANTIC_SCHOLAR);
    assert.equal(r.type, 'preprint');
    assert.equal(r.archiveId, '1706.03762');
    assert.deepEqual(r.author[1], { family: 'Shazeer', given: 'Noam M.' });
  });

  test('arXiv DataCite-style misc (doi 10.48550, publisher arXiv)', () => {
    const r = ref(`@misc{https://doi.org/10.48550/arxiv.1706.03762,
      doi = {10.48550/ARXIV.1706.03762},
      url = {https://arxiv.org/abs/1706.03762v5},
      author = {Vaswani, Ashish and Shazeer, Noam},
      title = {Attention Is All You Need},
      publisher = {arXiv},
      year = {2017},
      copyright = {arXiv.org perpetual, non-exclusive license}
    }`);
    assert.equal(r.type, 'preprint');
    assert.equal(r.archiveId, '1706.03762');
    assert.equal(r.doi, '10.48550/ARXIV.1706.03762');
    assert.equal(r.publisher, undefined);
  });

  test('real journal article with arXiv eprint stays article-journal but records archive', () => {
    const r = ref(`@article{x, author={A B}, title={T}, journal={Physical Review D}, volume={100}, year={2019},
      eprint={1901.00001}, archivePrefix={arXiv}, primaryClass={hep-th}}`);
    assert.equal(r.type, 'article-journal');
    assert.equal(r.containerTitle, 'Physical Review D');
    assert.equal(r.archive, 'arXiv');
    assert.equal(r.archiveId, '1901.00001');
  });

  test('old-style arXiv id and version suffix stripping', () => {
    assert.equal(ref('@misc{x, title={T}, eprint={hep-th/9901001v2}, archivePrefix={arXiv}}').archiveId, 'hep-th/9901001');
    assert.equal(ref('@misc{x, title={T}, note={Preprint arXiv:2101.00001v3}}').archiveId, '2101.00001');
    assert.equal(ref('@misc{x, title={T}, howpublished={arXiv:2101.00002}}').type, 'preprint');
    assert.equal(ref('@unpublished{x, title={T}, note={Available at https://arxiv.org/pdf/2101.00003v1.pdf}}').archiveId, '2101.00003');
  });

  test('non-arXiv eprint archive (bioRxiv)', () => {
    const r = ref('@misc{x, title={T}, eprint={2020.01.01.123456}, archiveprefix={bioRxiv}, doi={10.1101/2020.01.01.123456}}');
    assert.equal(r.type, 'preprint');
    assert.equal(r.archive, 'bioRxiv');
    assert.equal(r.archiveId, '2020.01.01.123456');
  });

  test('handwritten file: theses, techreport, book, incollection, misc web pages, software', () => {
    const { references, errors } = parseBibtexToReferences(HANDWRITTEN);
    assert.equal(errors.length, 0);
    const byId = Object.fromEntries(references.map((r) => [r.id, r]));

    const phd = byId.sutskever2013training;
    assert.equal(phd.type, 'thesis');
    assert.equal(phd.genre, 'Doctoral dissertation');
    assert.equal(phd.institution, 'University of Toronto');
    assert.equal(phd.publisherPlace, 'Toronto, ON');
    assert.equal(phd.year, 2013);

    const ms = byId.doe2020;
    assert.equal(ms.type, 'thesis');
    assert.equal(ms.genre, "Master's thesis");
    assert.equal(ms.institution, 'Massachusetts Institute of Technology');
    assert.equal(ms.month, 9);
    assert.equal(ms.day, 15);

    const tr = byId.brown1990statistical;
    assert.equal(tr.type, 'report');
    assert.equal(tr.genre, 'Research Report');
    assert.equal(tr.number, 'RC 14773');
    assert.equal(tr.institution, 'IBM T. J. Watson Research Center');
    assert.deepEqual(tr.author[2], { family: 'Pietra', given: 'Stephen A. Della' });

    const book = byId['Goodfellow-et-al-2016'];
    assert.equal(book.type, 'book');
    assert.equal(book.publisher, 'MIT Press');
    assert.equal(book.publisherPlace, 'Cambridge, MA');
    assert.equal(book.edition, '1st');
    assert.equal(book.note, 'http://www.deeplearningbook.org');

    const chap = byId.hinton1986learning;
    assert.equal(chap.type, 'chapter');
    assert.equal(chap.containerTitle, 'Parallel Distributed Processing: Explorations in the Microstructure of Cognition, Vol. 1');
    assert.equal(chap.page, '77-109');
    assert.equal(chap.collectionTitle, 'Lecture Notes in Computer Science 42');
    assert.deepEqual(chap.editor, [{ family: 'Rumelhart', given: 'D. E.' }, { family: 'McClelland', given: 'J. L.' }]);
    assert.deepEqual(chap.author[0], { family: 'Hinton', given: 'G. E.' });

    const web = byId.pytorch_docs;
    assert.equal(web.type, 'webpage');
    assert.equal(web.url, 'https://pytorch.org/docs/stable/index.html');
    assert.equal(web.accessed, '2024-03-10');
    assert.equal(web.note, undefined);
    assert.deepEqual(web.author, [{ literal: 'PyTorch Contributors' }]);
    assert.equal(web.title, '{PyTorch} Documentation');

    const wiki = byId.wikipedia_transformer;
    assert.equal(wiki.type, 'webpage');
    assert.equal(wiki.accessed, '2024-06-12');
    assert.equal(wiki.url, 'https://en.wikipedia.org/w/index.php?title=Transformer_(machine_learning_model)&oldid=1200000000');
    assert.equal(wiki.title, 'Transformer (machine learning model) — {Wikipedia}{,} The Free Encyclopedia');

    const sw = byId.paszke_pytorch_2019;
    assert.equal(sw.type, 'software');
    assert.equal(sw.version, '2.1.0');
    assert.equal(sw.publisher, 'Zenodo');
    assert.equal(sw.url, 'https://github.com/pytorch/pytorch');
  });

  test('month variants', () => {
    for (const [m, expected] of [['jun', 6], ['June', 6], ['6', 6], ['Jun.', 6], ['{June}', 6], ['sept', 9], ['Dec.', 12], ['13', undefined], ['foo', undefined]]) {
      assert.equal(ref(`@misc{x, title={T}, month = {${m}}}`).month, expected, m);
    }
    assert.equal(ref('@misc{x, title={T}, month = jun}').month, 6);
    assert.equal(ref('@misc{x, title={T}, month = 6}').month, 6);
  });

  test('year variants: first 4-digit number, in press, from date', () => {
    assert.equal(ref('@misc{x, title={T}, year={2017}}').year, 2017);
    assert.equal(ref('@misc{x, title={T}, year={c. 2017 (reprinted 2019)}}').year, 2017);
    assert.equal(ref('@misc{x, title={T}, year={in press}}').year, undefined);
    assert.equal(ref('@misc{x, title={T}, date={2019}}').year, 2019);
    const d = ref('@misc{x, title={T}, date={2019-03-07}}');
    assert.deepEqual([d.year, d.month, d.day], [2019, 3, 7]);
    const range = ref('@misc{x, title={T}, date={2019-03/2019-04}}');
    assert.deepEqual([range.year, range.month], [2019, 3]);
    const both = ref('@misc{x, title={T}, year={2020}, month={feb}, day={29}}');
    assert.deepEqual([both.year, both.month, both.day], [2020, 2, 29]);
  });

  test('urldate variants', () => {
    assert.equal(ref('@misc{x, title={T}, urldate={2024-01-15}}').accessed, '2024-01-15');
    assert.equal(ref('@misc{x, title={T}, urldate={15 January 2024}}').accessed, '2024-01-15');
    assert.equal(ref('@misc{x, title={T}, urldate={Jan. 5, 2024}}').accessed, '2024-01-05');
    assert.equal(ref('@misc{x, title={T}, urldate={2024/01/15}}').accessed, '2024-01-15');
    assert.equal(ref('@misc{x, title={T}, urldate={sometime}}').accessed, 'sometime');
    assert.equal(ref('@misc{x, title={T}, note={Accessed Dec. 1, 2023}}').accessed, '2023-12-01');
  });

  test('DOI prefix stripping and escaped underscores', () => {
    for (const d of ['https://doi.org/10.1000/abc', 'http://dx.doi.org/10.1000/abc', 'doi:10.1000/abc', 'DOI: 10.1000/abc', '{10.1000/abc}']) {
      assert.equal(ref(`@misc{x, title={T}, doi={${d}}}`).doi, '10.1000/abc', d);
    }
    assert.equal(ref('@misc{x, title={T}, doi={10.1000/a\\_b}}').doi, '10.1000/a_b');
    assert.equal(ref('@misc{x, title={T}, url={https://doi.org/10.1000/xyz}}').doi, '10.1000/xyz');
  });

  test('url handling: \\url wrapper, escaped characters, tilde preserved, first URL only', () => {
    assert.equal(ref('@misc{x, title={T}, url={\\url{http://a.b/~c\\_d}}}').url, 'http://a.b/~c_d');
    assert.equal(ref('@misc{x, title={T}, url={http://a.b/x http://c.d/y}}').url, 'http://a.b/x');
    assert.equal(ref('@misc{x, title={T}, url={http://a.b/50\\%25}}').url, 'http://a.b/50%25');
  });

  test('howpublished: URL -> url (webpage), text -> publisher (generic)', () => {
    const a = ref('@misc{x, title={T}, howpublished={\\url{https://x.y/z}}}');
    assert.equal(a.type, 'webpage');
    assert.equal(a.url, 'https://x.y/z');
    const b = ref('@misc{x, title={T}, howpublished={Poster at ICLR}}');
    assert.equal(b.type, 'generic');
    assert.equal(b.publisher, 'Poster at ICLR');
    const c = ref('@misc{x, title={T}, howpublished={GitHub}, url={https://github.com/a/b}}');
    assert.equal(c.type, 'generic');
    assert.equal(c.publisher, 'GitHub');
    assert.equal(c.url, 'https://github.com/a/b');
  });

  test('@online with organization -> webpage with containerTitle', () => {
    const r = ref('@online{x, title={T}, url={https://x.y}, organization={Example Site}, urldate={2024-01-01}}');
    assert.equal(r.type, 'webpage');
    assert.equal(r.containerTitle, 'Example Site');
    assert.equal(r.accessed, '2024-01-01');
  });

  test('misc with nothing -> generic; dataset; patent; manual; proceedings', () => {
    assert.equal(ref('@misc{x, title={T}}').type, 'generic');
    assert.equal(ref('@dataset{x, title={T}, publisher={Zenodo}}').type, 'dataset');
    assert.equal(ref('@misc{x, title={T}, note={Data set}, url={https://a.b}}').type, 'dataset');
    const p = ref('@patent{x, author={A B}, title={T}, number={US1234}, year={2000}}');
    assert.equal(p.type, 'patent');
    assert.equal(p.number, 'US1234');
    const m = ref('@manual{x, title={T}, organization={Org}, edition={3rd}}');
    assert.equal(m.type, 'generic');
    assert.equal(m.publisher, 'Org');
    assert.equal(m.edition, '3rd');
    const pr = ref('@proceedings{x, title={T}, editor={A B and C D}, publisher={P}}');
    assert.equal(pr.type, 'book');
    assert.equal(pr.editor.length, 2);
    assert.deepEqual(pr.author, []);
    assert.equal(ref('@conference{x, title={T}, booktitle={B}}').type, 'paper-conference');
    assert.equal(ref('@inbook{x, title={T}, booktitle={B}}').type, 'chapter');
    assert.equal(ref('@weirdtype{x, title={T}}').type, 'generic');
  });

  test('biblatex @thesis with type keywords; @report', () => {
    assert.equal(ref('@thesis{x, title={T}, type={phdthesis}, institution={U}}').genre, 'Doctoral dissertation');
    assert.equal(ref('@thesis{x, title={T}, type={mathesis}, institution={U}}').genre, "Master's thesis");
    assert.equal(ref('@thesis{x, title={T}, institution={U}}').institution, 'U');
    assert.equal(ref('@phdthesis{x, title={T}, type={{PhD} Dissertation}}').genre, 'PhD Dissertation');
    const r = ref('@report{x, title={T}, institution={I}, number={7}}');
    assert.equal(r.type, 'report');
    assert.equal(r.genre, 'Technical report');
  });

  test('pages variants', () => {
    assert.equal(ref('@article{x, title={T}, pages={e0123}}').page, 'e0123');
    assert.equal(ref('@article{x, title={T}, pages={123:1--123:20}}').page, '123:1-123:20');
    assert.equal(ref('@article{x, title={T}, pages={pp. 10 -- 20}}').page, '10-20');
    assert.equal(ref('@article{x, title={T}, pages={1–5}}').page, '1-5');
    assert.equal(ref('@article{x, title={T}, pages={1—5}}').page, '1-5');
  });

  test('title keeps braces, subtitle appended, journal brace-stripped and decoded', () => {
    const r = ref('@article{x, title={The {GPT-4} Report}, subtitle={A {Study}}, journal={Journal of {AI} \\& Society}}');
    assert.equal(r.title, 'The {GPT-4} Report: A {Study}');
    assert.equal(r.containerTitle, 'Journal of AI & Society');
  });

  test('model field passthrough: edition, series, address, institution, language, version', () => {
    const r = ref('@inproceedings{x, title={T}, booktitle={B}, series={LNCS}, volume={12}, number={3}, address={Berlin}, edition={Second}, language={German}, version={1.2}}');
    assert.equal(r.collectionTitle, 'LNCS');
    assert.equal(r.volume, '12');
    assert.equal(r.issue, '3');
    assert.equal(r.publisherPlace, 'Berlin');
    assert.equal(r.language, 'German');
    assert.equal(r.version, '1.2');
  });

  test('tolerates malformed entries: missing fields, weird types, null', () => {
    assert.deepEqual(bibtexToReference({ type: 'article', key: '', fields: {} }), { type: 'article-journal', author: [] });
    assert.equal(bibtexToReference(null).type, 'generic');
    assert.equal(bibtexToReference({}).type, 'generic');
    assert.deepEqual(bibtexToReference({ type: 'misc', fields: { title: '', author: '   ' } }), { type: 'generic', author: [] });
  });
});

// ---------------------------------------------------------------------------
// referenceToBibtex
// ---------------------------------------------------------------------------

describe('referenceToBibtex', () => {
  test('golden: journal article', () => {
    const out = referenceToBibtex({
      type: 'article-journal',
      author: [{ family: 'LeCun', given: 'Yann' }, { family: 'Bengio', given: 'Yoshua' }, { family: 'Hinton', given: 'Geoffrey' }],
      title: 'Deep learning',
      containerTitle: 'Nature',
      volume: '521', issue: '7553', page: '436-444', year: 2015, month: 5,
      doi: '10.1038/nature14539',
    });
    assert.equal(out, [
      '@article{lecun2015deep,',
      '  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},',
      '  title = {Deep learning},',
      '  journal = {Nature},',
      '  volume = {521},',
      '  number = {7553},',
      '  pages = {436--444},',
      '  year = {2015},',
      '  month = may,',
      '  doi = {10.1038/nature14539}',
      '}',
    ].join('\n'));
  });

  test('golden: arXiv preprint (Google Scholar compatible)', () => {
    const out = referenceToBibtex({
      type: 'preprint',
      author: [{ family: 'Vaswani', given: 'Ashish' }, { family: 'Shazeer', given: 'Noam' }],
      title: 'Attention is all you need',
      year: 2017, archive: 'arXiv', archiveId: '1706.03762', primaryClass: 'cs.CL',
      url: 'https://arxiv.org/abs/1706.03762',
    });
    assert.equal(out, [
      '@misc{vaswani2017attention,',
      '  author = {Vaswani, Ashish and Shazeer, Noam},',
      '  title = {Attention is all you need},',
      '  journal = {arXiv preprint arXiv:1706.03762},',
      '  year = {2017},',
      '  url = {https://arxiv.org/abs/1706.03762},',
      '  eprint = {1706.03762},',
      '  archivePrefix = {arXiv},',
      '  primaryClass = {cs.CL}',
      '}',
    ].join('\n'));
  });

  test('golden: web page', () => {
    const out = referenceToBibtex({
      type: 'webpage',
      author: [{ literal: 'PyTorch Contributors' }],
      title: 'PyTorch documentation',
      containerTitle: 'PyTorch',
      year: 2024, url: 'https://pytorch.org/docs/stable/index.html', accessed: '2024-03-10',
    });
    assert.equal(out, [
      '@misc{pytorchcontributors2024pytorch,',
      '  author = {{PyTorch Contributors}},',
      '  title = {{PyTorch} documentation},',
      '  year = {2024},',
      '  organization = {PyTorch},',
      '  howpublished = {\\url{https://pytorch.org/docs/stable/index.html}},',
      '  note = {Accessed: 2024-03-10},',
      '  urldate = {2024-03-10}',
      '}',
    ].join('\n'));
  });

  test('title protection: acronyms, inner capitals, existing groups untouched, punctuation outside braces', () => {
    const out = referenceToBibtex({ type: 'generic', author: [], title: 'BERT: Pre-training of Deep Bidirectional Transformers (LLMs), GPT-4 and McDonald; I am {already Protected}' });
    assert.match(out, /title = \{\{BERT\}: Pre-training of Deep Bidirectional Transformers \(\{LLMs\}\), \{GPT-4\} and \{McDonald\}; I am \{already Protected\}\}/);
  });

  test('escaping of & % # _ in text fields, not in url/doi', () => {
    const out = referenceToBibtex({
      type: 'article-journal', author: [{ family: 'A&B', given: 'C' }], title: '100% of #tags_here & more',
      containerTitle: 'J & K', year: 2000, doi: '10.1000/a_b%c', url: 'https://x.y/a_b?c=d&e=f#frag',
    });
    assert.match(out, /author = \{A\\&B, C\}/);
    assert.match(out, /title = \{100\\% of \\#tags\\_here \\& more\}/);
    assert.match(out, /journal = \{J \\& K\}/);
    assert.match(out, /doi = \{10\.1000\/a_b%c\}/);
    assert.match(out, /url = \{https:\/\/x\.y\/a_b\?c=d&e=f#frag\}/);
  });

  test('name formatting: particle, suffix, literal, others, lowercase family protected, given-only', () => {
    const out = referenceToBibtex({
      type: 'book', year: 2001, title: 'T',
      author: [
        { family: 'Maaten', given: 'Laurens', particle: 'van der' },
        { family: 'King', given: 'Martin Luther', suffix: 'Jr.' },
        { literal: 'OpenAI' },
        { family: 'de la Cruz', given: 'Juan' },
        { given: 'Madonna' },
        { literal: 'others' },
      ],
    });
    assert.match(out, /author = \{van der Maaten, Laurens and King, Jr\., Martin Luther and \{OpenAI\} and \{de la Cruz\}, Juan and Madonna and others\}/);
    assert.match(out, /^@book\{maaten2001t,/);
  });

  test('key generation: ascii folding, stopwords, missing author / year / title', () => {
    assert.match(referenceToBibtex({ type: 'generic', author: [{ family: 'Müller-Lüdenscheidt', given: 'X' }], title: 'The On-Device Study', year: 2020 }), /^@misc\{mullerludenscheidt2020device,/);
    assert.match(referenceToBibtex({ type: 'generic', author: [{ family: 'Øster', given: 'X' }], title: 'A B', year: 2020 }), /^@misc\{oster2020b,/);
    assert.match(referenceToBibtex({ type: 'generic', author: [], title: 'Towards Robust Models', year: 2020 }), /^@misc\{robust2020,/);
    assert.match(referenceToBibtex({ type: 'generic', author: [{ family: 'Smith' }], title: 'On the' }), /^@misc\{smithon,/);
    assert.match(referenceToBibtex({ type: 'generic', author: [{ literal: 'World Health Organization' }], title: 'Report', year: 2021 }), /^@misc\{worldhealthorganization2021report,/);
    assert.match(referenceToBibtex({}), /^@misc\{ref,/);
    assert.match(referenceToBibtex(null), /^@misc\{ref,/);
  });

  test('type mapping and type-specific fields', () => {
    const conf = referenceToBibtex({ type: 'paper-conference', author: [{ family: 'A' }], title: 'T', containerTitle: 'Proceedings of NAACL', collectionTitle: 'S', page: '1-2', publisher: 'ACL', publisherPlace: 'Minneapolis', year: 2019, month: 6 });
    assert.match(conf, /^@inproceedings\{a2019t,/);
    assert.match(conf, /booktitle = \{Proceedings of \{NAACL\}\}/);
    assert.match(conf, /series = \{S\}/);
    assert.match(conf, /pages = \{1--2\}/);
    assert.match(conf, /month = jun,/);
    assert.match(conf, /address = \{Minneapolis\}/);

    const chap = referenceToBibtex({ type: 'chapter', author: [{ family: 'A' }], editor: [{ family: 'E', given: 'F' }], title: 'T', containerTitle: 'Book', page: '77-109', publisher: 'P', year: 1986 });
    assert.match(chap, /^@incollection\{/);
    assert.match(chap, /editor = \{E, F\}/);
    assert.match(chap, /booktitle = \{Book\}/);

    const phd = referenceToBibtex({ type: 'thesis', author: [{ family: 'A' }], title: 'T', institution: 'U', genre: 'Doctoral dissertation', year: 2013 });
    assert.match(phd, /^@phdthesis\{/);
    assert.match(phd, /school = \{U\}/);
    assert.doesNotMatch(phd, /type =/);

    const ms = referenceToBibtex({ type: 'thesis', author: [{ family: 'A' }], title: 'T', institution: 'U', genre: "Master's thesis", year: 2013 });
    assert.match(ms, /^@mastersthesis\{/);

    const rep = referenceToBibtex({ type: 'report', author: [{ family: 'A' }], title: 'T', institution: 'I', number: 'RC 1', genre: 'Research Report', year: 1990 });
    assert.match(rep, /^@techreport\{/);
    assert.match(rep, /institution = \{I\}/);
    assert.match(rep, /number = \{RC 1\}/);
    assert.match(rep, /type = \{Research Report\}/);

    const book = referenceToBibtex({ type: 'book', author: [{ family: 'A' }], title: 'T', publisher: 'P', publisherPlace: 'C', edition: '2nd', year: 2016 });
    assert.match(book, /^@book\{/);
    assert.match(book, /edition = \{2nd\}/);

    const sw = referenceToBibtex({ type: 'software', author: [{ family: 'A' }], title: 'T', version: '2.1', publisher: 'Zenodo', url: 'https://x.y', year: 2019 });
    assert.match(sw, /^@misc\{/);
    assert.match(sw, /version = \{2\.1\}/);
    assert.match(sw, /note = \{Computer software\}/);

    const ds = referenceToBibtex({ type: 'dataset', author: [{ family: 'A' }], title: 'T', note: 'v3', year: 2019 });
    assert.match(ds, /note = \{v3 \[Data set\]\}/);

    const gen = referenceToBibtex({ type: 'generic', author: [{ family: 'A' }], title: 'T', publisher: 'P', note: 'N', year: 2019 });
    assert.match(gen, /^@misc\{/);
    assert.match(gen, /publisher = \{P\}/);
    assert.match(gen, /note = \{N\}/);
  });

  test('field order is stable', () => {
    const out = referenceToBibtex({
      type: 'article-journal', author: [{ family: 'A' }], title: 'T', containerTitle: 'J', volume: '1', issue: '2', page: '3-4',
      year: 2000, month: 1, publisher: 'P', publisherPlace: 'X', edition: '2', doi: 'd', url: 'u', note: 'n', accessed: '2020-01-01',
    });
    const names = out.split('\n').slice(1, -1).map((l) => l.trim().split(' = ')[0]);
    assert.deepEqual(names, ['author', 'title', 'journal', 'volume', 'number', 'pages', 'year', 'month', 'publisher', 'address', 'edition', 'doi', 'url', 'note', 'urldate']);
  });

  test('nbsp becomes ~; empty values skipped', () => {
    const out = referenceToBibtex({ type: 'generic', author: [], title: 'Section\u00A02', publisher: '   ', year: NaN });
    assert.match(out, /title = \{Section~2\}/);
    assert.doesNotMatch(out, /publisher/);
    assert.doesNotMatch(out, /year/);
  });
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

const STABLE_KEYS = ['type', 'author', 'editor', 'containerTitle', 'collectionTitle', 'volume', 'issue', 'page',
  'publisher', 'publisherPlace', 'institution', 'edition', 'number', 'genre', 'year', 'month', 'doi', 'url',
  'accessed', 'archive', 'archiveId', 'note', 'version'];

function stableSubset(r) {
  const out = {};
  for (const k of STABLE_KEYS) if (r[k] !== undefined) out[k] = r[k];
  out.title = stripBraces(r.title || '');
  if (r.articleNumber && !r.page) out.page = r.articleNumber;
  if (out.containerTitle) out.containerTitle = stripBraces(out.containerTitle);
  return out;
}

describe('round trip', () => {
  test('parse -> reference -> bibtex -> parse -> reference is stable for all samples', () => {
    const first = parseBibtexToReferences(ALL_SAMPLES);
    assert.equal(first.errors.length, 0);
    assert.ok(first.references.length >= 10);
    const regenerated = first.references.map(referenceToBibtex).join('\n\n');
    const second = parseBibtexToReferences(regenerated);
    assert.deepEqual(second.errors, []);
    assert.equal(second.references.length, first.references.length);
    for (let i = 0; i < first.references.length; i++) {
      assert.deepEqual(stableSubset(second.references[i]), stableSubset(first.references[i]), `entry ${first.references[i].id}`);
    }
  });

  test('generated keys look like vaswani2017attention', () => {
    const { references } = parseBibtexToReferences(DBLP);
    assert.match(referenceToBibtex(references[0]), /^@inproceedings\{vaswani2017attention,/);
  });
});
