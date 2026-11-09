// URL → APA citation page logic. The resolver talks to the public metadata APIs
// directly from the browser; ordinary web pages go through this site's small
// stateless /api/meta endpoint (with the Internet Archive as fallback). When
// the site has Cloudflare Turnstile configured (GET /api/config says so), a
// token is obtained silently and sent with that request. The formatter renders
// APA + BibTeX locally.
import { detectIdentifier, resolveReference, ResolveError, todayIso } from '../assets/resolve.js';
import { formatApa } from '../assets/apa.js';
import { referenceToBibtex, parseNames } from '../assets/bibtex.js';
import { REFERENCE_TYPES, compactReference, makeReference } from '../assets/model.js';
import { $, toast, copyToClipboard, persist, debounce } from '../assets/ui.js';

/** @typedef {import('../assets/model.js').Reference} Reference */
/** @typedef {import('../assets/model.js').Name} Name */

const urlInput = $('#url');
const status = $('#status');
const sourcesEl = $('#sources');
const errorEl = $('#error');
const resultEl = $('#result');
const apaEl = $('#apa');
const warningsEl = $('#warnings');
const bibtexEl = $('#bibtex');
const editEl = $('#edit');
const partialNote = $('#partial-note');
const authorStyle = $('#opt-author-style');
const sentenceCase = $('#opt-sentence-case');
const includeLinks = $('#opt-include-links');

const fields = {
  type: $('#f-type'),
  authors: $('#f-authors'),
  title: $('#f-title'),
  containerTitle: $('#f-container'),
  year: $('#f-year'),
  month: $('#f-month'),
  day: $('#f-day'),
  volume: $('#f-volume'),
  issue: $('#f-issue'),
  page: $('#f-pages'),
  publisher: $('#f-publisher'),
  archiveId: $('#f-archive-id'),
  doi: $('#f-doi'),
  url: $('#f-url'),
  accessed: $('#f-accessed'),
};

/** Plain text fields copied 1:1 between the form and the Reference. */
const TEXT_FIELDS = ['title', 'containerTitle', 'volume', 'issue', 'page', 'publisher', 'archiveId', 'doi', 'url', 'accessed'];
/** Integer fields. */
const NUMBER_FIELDS = ['year', 'month', 'day'];

const TYPE_LABELS = {
  'article-journal': 'Journal article',
  'paper-conference': 'Conference paper',
  book: 'Book',
  chapter: 'Book chapter',
  thesis: 'Thesis / dissertation',
  report: 'Report',
  preprint: 'Preprint (arXiv, bioRxiv, …)',
  webpage: 'Web page',
  software: 'Software',
  dataset: 'Dataset',
  manuscript: 'Manuscript',
  patent: 'Patent',
  generic: 'Other',
};

const KIND_LABELS = {
  doi: 'DOI', arxiv: 'arXiv', pmid: 'PubMed ID', pmcid: 'PMC ID', openreview: 'OpenReview',
  acl: 'ACL Anthology', s2: 'Semantic Scholar', isbn: 'ISBN', url: 'web page',
};

const SOURCE_LABELS = {
  crossref: 'Crossref', datacite: 'DataCite', 'doi.org': 'doi.org', arxiv: 'arXiv', semanticscholar: 'Semantic Scholar',
  openreview: 'OpenReview', pubmed: 'PubMed', openlibrary: 'Open Library',
  'html-meta': 'the page’s own metadata', wayback: 'an Internet Archive snapshot of the page', 'url-only': 'the URL alone',
};

/** Labels for the resolver's `sources` entries (every API / step it tried). */
const ATTEMPT_LABELS = {
  crossref: 'Crossref', datacite: 'DataCite', 'doi.org': 'doi.org', arxiv: 'arXiv API', semanticscholar: 'Semantic Scholar',
  'openreview-api2': 'OpenReview', 'openreview-api1': 'OpenReview (API 1)', pubmed: 'PubMed', pmc: 'PubMed Central',
  openlibrary: 'Open Library', 'api-meta': 'this site’s page fetcher', direct: 'the page directly', wayback: 'Internet Archive',
};

/** The reference as returned by the resolver (or the partial one); edits are overlaid on it. */
let baseReference = null;
/** Warnings from the resolver for the current reference. */
let resolverWarnings = [];
/** Last formatted result, kept for the copy buttons. */
let lastFormatted = null;
/** Last BibTeX text, kept for the copy button. */
let lastBibtex = '';
/** AbortController of the lookup in flight. */
let inflight = null;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Read the option controls into formatApa options. */
function currentOptions() {
  return {
    authorStyle: authorStyle.value === 'scholar' ? 'scholar' : 'apa7',
    sentenceCase: sentenceCase.checked,
    includeDoi: includeLinks.checked,
    includeUrl: includeLinks.checked,
  };
}

// ---------------------------------------------------------------------------
// Names <-> textarea lines
// ---------------------------------------------------------------------------

/**
 * Serialise one Name as a BibTeX-style line ("von Last, Jr, First" / "{Literal}").
 * @param {Name} name
 * @returns {string}
 */
function nameToLine(name) {
  if (!name || typeof name !== 'object') return '';
  if (name.literal) return name.literal === 'others' ? 'others' : `{${name.literal}}`;
  const family = [name.particle, name.family].filter(Boolean).join(' ');
  const parts = [family];
  if (name.suffix) parts.push(name.suffix);
  if (name.given) parts.push(name.given);
  return parts.filter(Boolean).join(', ');
}

/**
 * Parse the authors textarea (one name per line) into Name objects.
 * @param {string} text
 * @returns {Name[]}
 */
function linesToNames(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  try {
    return parseNames(lines.join(' and '));
  } catch (_) {
    return lines.map((literal) => ({ literal }));
  }
}

// ---------------------------------------------------------------------------
// Reference <-> form
// ---------------------------------------------------------------------------

/** Fill the type select with friendly labels. */
function populateTypeSelect() {
  for (const type of REFERENCE_TYPES) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = TYPE_LABELS[type] || type;
    fields.type.appendChild(opt);
  }
}

/** Strip a doi.org prefix so the DOI stays bare. */
function bareDoi(value) {
  return String(value).trim().replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
}

/** Keep only ISO "YYYY-MM-DD" strings for the date input (partial dates would be rejected). */
function dateInputValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : '';
}

/**
 * Load a Reference into the edit form.
 * @param {Reference} ref
 */
function fillForm(ref) {
  fields.type.value = REFERENCE_TYPES.includes(ref.type) ? ref.type : 'generic';
  fields.authors.value = (ref.author || []).map(nameToLine).filter(Boolean).join('\n');
  for (const key of TEXT_FIELDS) {
    const value = ref[key];
    fields[key].value = value === undefined || value === null ? '' : String(value);
  }
  fields.accessed.value = dateInputValue(ref.accessed);
  for (const key of NUMBER_FIELDS) {
    fields[key].value = Number.isFinite(ref[key]) ? String(ref[key]) : '';
  }
}

/** Parse an integer form field; undefined when empty or not a number. */
function intField(el) {
  const n = parseInt(el.value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build the Reference to format: the resolved base reference with every form
 * field overlaid, then compacted so cleared fields disappear.
 * @returns {Reference}
 */
function referenceFromForm() {
  const ref = { ...(baseReference || makeReference()) };
  ref.type = fields.type.value || 'generic';
  ref.author = linesToNames(fields.authors.value);
  for (const key of TEXT_FIELDS) ref[key] = fields[key].value;
  ref.doi = bareDoi(fields.doi.value);
  for (const key of NUMBER_FIELDS) ref[key] = intField(fields[key]);
  if (ref.archiveId && !ref.archive) ref.archive = 'arXiv';
  return compactReference(ref);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Replace the children of a list with one <li> per message. */
function renderList(listEl, messages) {
  listEl.textContent = '';
  for (const message of messages) {
    const li = document.createElement('li');
    li.textContent = message;
    listEl.appendChild(li);
  }
  listEl.hidden = messages.length === 0;
}

/** Format the current reference and update the APA preview + BibTeX block. */
function render() {
  if (!baseReference) return;
  const ref = referenceFromForm();
  lastFormatted = formatApa(ref, currentOptions());
  apaEl.innerHTML = `<p class="ref">${lastFormatted.html}</p>`;
  const bibRef = ref.archiveClass && !ref.primaryClass ? { ...ref, primaryClass: ref.archiveClass } : ref;
  lastBibtex = referenceToBibtex(bibRef);
  bibtexEl.textContent = lastBibtex;
  renderList(warningsEl, [...new Set([...resolverWarnings, ...lastFormatted.warnings])]);
  resultEl.hidden = false;
}

const renderSoon = debounce(render, 150);

/**
 * Install a reference as the editable base, fill the form and render.
 * @param {Reference} ref
 * @param {string[]} warnings
 * @param {{ openEditor?: boolean, partial?: boolean }} [opts]
 */
function showReference(ref, warnings, opts = {}) {
  baseReference = compactReference({ ...ref });
  resolverWarnings = warnings || [];
  fillForm(baseReference);
  editEl.hidden = false;
  partialNote.hidden = !opts.partial;
  const incomplete = !baseReference.title || baseReference.author.length === 0;
  editEl.open = Boolean(opts.openEditor || opts.partial || incomplete);
  render();
}

/** Show (or hide, with empty text) the error paragraph. */
function showError(message) {
  errorEl.textContent = message || '';
  errorEl.hidden = !message;
}

/**
 * Render the "Sources tried" line: "Crossref ✓ · Semantic Scholar ✗ (rate limited)".
 * @param {Array<{name: string, status: string, detail?: string}>} [sources]
 */
function renderSources(sources) {
  sourcesEl.textContent = '';
  const list = Array.isArray(sources) ? sources : [];
  sourcesEl.hidden = list.length === 0;
  if (!list.length) return;
  sourcesEl.appendChild(document.createTextNode('Sources tried: '));
  list.forEach((s, i) => {
    if (i) sourcesEl.appendChild(document.createTextNode(' · '));
    const item = document.createElement('span');
    item.className = `source source-${s.status}`;
    const mark = s.status === 'ok' ? '✓' : (s.status === 'failed' ? '✗' : '–');
    const detail = s.status === 'ok' ? '' : ` (${s.status === 'skipped' ? `skipped: ${s.detail || 'not needed'}` : (s.detail || 'failed')})`;
    item.textContent = `${ATTEMPT_LABELS[s.name] || s.name} ${mark}${detail}`;
    sourcesEl.appendChild(item);
  });
}

/** Update the status line; `busy` adds a spinner. */
function setStatus(text, busy = false) {
  status.textContent = '';
  if (busy) {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    status.appendChild(spinner);
  }
  status.appendChild(document.createTextNode(text));
}

/** "Detected: DOI 10.1038/nature14539" for a detectIdentifier() result. */
function describeIdentifier(identifier) {
  if (!identifier) return '';
  const label = KIND_LABELS[identifier.kind] || identifier.kind;
  const id = identifier.kind === 'url' ? identifier.url : identifier.id;
  return `Detected: ${label} ${id}`;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** Resolver warnings minus the per-source failure messages (those are shown in the sources line). */
function userWarnings(warnings, sources) {
  const failures = new Set((sources || []).map((s) => s.message).filter(Boolean));
  return (warnings || []).filter((w) => !failures.has(w) && !/^Could not reach /.test(w));
}

/** Put the current query into the address bar so results are bookmarkable. */
function rememberQuery(query) {
  try {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
  } catch (_) { /* history unavailable */ }
}

/**
 * Resolve the input and render the result; errors render as a friendly
 * message plus an editable (partial) reference whenever possible.
 * @param {string} rawInput
 */
// ---------------------------------------------------------------------------
// Turnstile (bot check for the page fetcher)
// ---------------------------------------------------------------------------

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__papertoolsTurnstileReady';
// Note: the host element must not be id="turnstile" — named window access would shadow the API global.
const turnstileHost = $('#turnstile-host');
/** @type {Promise<{ siteKey: string, action: string }|null>} the server's Turnstile config (null = off). */
const turnstileConfig = (async () => {
  try {
    const res = await fetch(new URL('/api/config', location.origin), { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const cfg = await res.json();
    if (typeof cfg.turnstileSiteKey !== 'string' || !cfg.turnstileSiteKey) return null;
    return { siteKey: cfg.turnstileSiteKey, action: typeof cfg.turnstileAction === 'string' ? cfg.turnstileAction : 'fetch-page' };
  } catch {
    return null; // static hosting without the Worker: no fetcher, no bot check
  }
})();
let turnstileApi = null;
let turnstileWidget;              // the one widget id we keep and reset (tokens are single-use)
let turnstilePending = null;      // { resolve, reject } of the token request in flight

/** Load the Turnstile script once. */
function loadTurnstile() {
  if (turnstileApi) return turnstileApi;
  turnstileApi = new Promise((resolve, reject) => {
    if (window.turnstile && typeof window.turnstile.render === 'function') { resolve(window.turnstile); return; }
    window.__papertoolsTurnstileReady = () => {
      if (window.turnstile && typeof window.turnstile.render === 'function') resolve(window.turnstile);
      else { turnstileApi = null; reject(new Error('the bot-check script did not initialise')); }
    };
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onerror = () => { turnstileApi = null; reject(new Error('the bot-check script could not be loaded')); };
    document.head.appendChild(script);
  });
  return turnstileApi;
}

/**
 * Obtain a fresh Turnstile token (tokens are single-use, so the retained
 * widget is reset before each request). Resolves to null when Turnstile is
 * not configured on this deployment. The widget renders into #turnstile-host
 * and only becomes visible if Cloudflare needs an interaction.
 */
async function turnstileToken() {
  const cfg = await turnstileConfig;
  if (!cfg || !turnstileHost) return null;
  const ts = await loadTurnstile();
  if (turnstilePending) turnstilePending.reject(new Error('superseded by a newer request'));
  return new Promise((resolve, reject) => {
    turnstilePending = { resolve, reject };
    turnstileHost.classList.add('active');
    if (turnstileWidget !== undefined) {
      ts.reset(turnstileWidget);
      return;
    }
    const settle = (fn) => (value) => {
      turnstileHost.classList.remove('active');
      const pending = turnstilePending;
      turnstilePending = null;
      if (pending) pending[fn](value);
    };
    turnstileWidget = ts.render(turnstileHost, {
      sitekey: cfg.siteKey,
      action: cfg.action,
      appearance: 'interaction-only',
      callback: settle('resolve'),
      'error-callback': () => settle('reject')(new Error('the bot check could not be completed')),
      'expired-callback': () => { if (turnstileWidget !== undefined) ts.reset(turnstileWidget); },
      'unsupported-callback': () => settle('reject')(new Error('this browser is not supported by the bot check')),
    });
  });
}

async function lookup(rawInput) {
  const query = String(rawInput || '').trim();
  if (!query) {
    setStatus('Paste a URL, DOI or identifier to start.');
    urlInput.focus();
    return;
  }
  if (inflight) inflight.abort();
  const controller = new AbortController();
  inflight = controller;
  rememberQuery(query);
  showError('');
  renderSources([]);
  const identifier = detectIdentifier(query);
  setStatus(`Looking up … ${describeIdentifier(identifier) || 'checking the input'}`, true);

  try {
    const result = await resolveReference(query, { signal: controller.signal, metaToken: turnstileToken });
    if (controller.signal.aborted) return;
    // Failed attempts are listed in the sources line; keep only the other notes as warnings.
    showReference(result.reference, userWarnings(result.warnings, result.sources));
    setStatus(`${describeIdentifier(result.identifier)} · via ${SOURCE_LABELS[result.source] || result.source}`);
    renderSources(result.sources);
  } catch (err) {
    if (controller.signal.aborted) return;
    const message = err && err.message ? err.message : String(err);
    showError(message);
    if (err instanceof ResolveError && err.partial) {
      const { partial } = err;
      // The error paragraph already explains why the lookup failed and the
      // sources line lists every failed attempt; drop their duplicates.
      const extraWarnings = userWarnings(partial.warnings, partial.sources).filter((w) => w !== message);
      showReference(partial.reference, extraWarnings, {
        partial: partial.source === 'url-only' && partial.identifier && partial.identifier.kind === 'url',
        openEditor: true,
      });
      setStatus(`${describeIdentifier(partial.identifier)} · could not be looked up; fill in the fields below`);
      renderSources(partial.sources);
    } else {
      showReference(makeReference({ type: 'webpage', title: '', accessed: todayIso() }), [], { openEditor: true });
      setStatus('Could not recognise the input; fill in the fields below to build a reference by hand.');
    }
  } finally {
    if (inflight === controller) inflight = null;
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

populateTypeSelect();

for (const [el, key] of [
  [authorStyle, 'url.authorStyle'], [sentenceCase, 'url.sentenceCase'], [includeLinks, 'url.includeLinks'],
]) {
  persist(el, key);
  el.addEventListener('change', render);
}

$('#lookup').addEventListener('submit', (e) => {
  e.preventDefault();
  lookup(urlInput.value);
});

$('#examples').addEventListener('click', (e) => {
  const chip = e.target.closest('button[data-q]');
  if (!chip) return;
  urlInput.value = chip.dataset.q;
  lookup(chip.dataset.q);
});

for (const el of Object.values(fields)) {
  el.addEventListener('input', renderSoon);
  el.addEventListener('change', render);
}

$('#reset-fields').addEventListener('click', () => {
  if (!baseReference) return;
  fillForm(baseReference);
  render();
});

/** Wire a copy button to a getter of the text (and optional HTML) to copy. */
function wireCopy(id, label, getText, getHtml) {
  $(id).addEventListener('click', async () => {
    const text = getText();
    if (!text) { toast('Nothing to copy yet'); return; }
    const ok = await copyToClipboard(text, getHtml ? getHtml() : undefined);
    toast(ok ? `Copied ${label}` : 'Copy failed');
  });
}

wireCopy('#copy-rich', 'rich text', () => lastFormatted && lastFormatted.plain, () => `<p>${lastFormatted.html}</p>`);
wireCopy('#copy-markdown', 'Markdown', () => lastFormatted && lastFormatted.markdown);
wireCopy('#copy-latex', 'LaTeX', () => lastFormatted && lastFormatted.latex);
wireCopy('#copy-plain', 'plain text', () => lastFormatted && lastFormatted.plain);
wireCopy('#copy-bibtex', 'BibTeX', () => lastBibtex);

const initialQuery = new URLSearchParams(window.location.search).get('q');
if (initialQuery) {
  urlInput.value = initialQuery;
  lookup(initialQuery);
} else {
  setStatus('Paste a URL, DOI or identifier to start.');
}
urlInput.focus();
