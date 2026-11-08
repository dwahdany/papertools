// Small DOM helpers shared by the tool pages. No framework.

/** Show a transient toast message. */
export function toast(message, ms = 1600) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

/**
 * Copy text to the clipboard. If `html` is given, both a text/html and a
 * text/plain flavour are written so rich-text editors (Word, Google Docs)
 * keep italics while plain editors get plain text.
 * Falls back to execCommand for older browsers / insecure contexts; that path
 * has to focus a temporary textarea, so it restores focus to the element that
 * was active (normally the Copy button) afterwards.
 * @returns {Promise<boolean>} true on success
 */
export async function copyToClipboard(text, html) {
  try {
    if (html && navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    // fall through to legacy path
  }
  const prev = document.activeElement;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  } finally {
    // Removing the focused textarea drops focus on <body>; put it back where it was.
    if (prev && prev !== document.body && typeof prev.focus === 'function' && document.activeElement !== prev) {
      try { prev.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }
  }
}

/** Escape text for insertion into HTML. */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Shorthand querySelector. */
export const $ = (sel, root = document) => root.querySelector(sel);

/**
 * Persist a form control's value in localStorage under `key` and restore it
 * on load. Works for checkboxes, selects and text inputs.
 */
export function persist(el, key) {
  const k = `papertools:${key}`;
  try {
    const saved = localStorage.getItem(k);
    if (saved !== null) {
      if (el.type === 'checkbox') el.checked = saved === '1';
      else el.value = saved;
    }
  } catch (_) { /* storage unavailable */ }
  el.addEventListener('change', () => {
    try {
      localStorage.setItem(k, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value);
    } catch (_) { /* ignore */ }
  });
}

/** Debounce a function. */
export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
