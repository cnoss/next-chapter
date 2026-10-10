// Markdown rendering with marked, plus a small sanitizer and link rewriting.
// The content is ours, but parts of it are copied from job ads, so we sanitize anyway.

import { marked } from './vendor/marked.esm.js';
import { PAGES } from './config.js';

marked.setOptions({ gfm: true, breaks: false });

const ALLOWED_TAGS = new Set([
  'A', 'P', 'BR', 'STRONG', 'EM', 'B', 'I', 'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'HR', 'DEL',
]);
const ALLOWED_ATTRS = new Set(['href', 'title', 'align']);

/** Render block markdown to a sanitized DocumentFragment. */
export function renderMarkdown(markdown, { shiftHeadings = 0 } = {}) {
  return sanitize(marked.parse(markdown), shiftHeadings);
}

/** Render inline markdown (field values) to a sanitized DocumentFragment. */
export function renderInline(markdown) {
  return sanitize(marked.parseInline(markdown), 0);
}

function sanitize(html, shiftHeadings) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;

  for (const el of [...root.querySelectorAll('*')]) {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    for (const attr of [...el.attributes]) {
      if (!ALLOWED_ATTRS.has(attr.name)) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') rewriteLink(el);
    if (el.tagName === 'TABLE') wrapTable(el);
    if (shiftHeadings && /^H[1-6]$/.test(el.tagName)) {
      const level = Math.min(6, Number(el.tagName[1]) + shiftHeadings);
      const heading = document.createElement(`h${level}`);
      heading.append(...el.childNodes);
      el.replaceWith(heading);
    }
  }
  return root;
}

function rewriteLink(a) {
  const href = a.getAttribute('href') || '';
  const page = PAGES.find((p) => href === p.file || href.endsWith(`/${p.file}`));

  if (/^\s*(javascript|data|vbscript):/i.test(href)) {
    a.removeAttribute('href');
  } else if (page) {
    a.setAttribute('href', `#/seite/${page.slug}`);
  } else if (/(^|\/)digest-\d{4}-\d{2}-\d{2}\.md$/.test(href)) {
    a.setAttribute('href', '#/karten');
  } else if (/^https?:/i.test(href)) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
}

// Wide tables scroll inside their own container instead of the page.
function wrapTable(table) {
  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll';
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', 'Tabelle, seitlich scrollbar');
  table.replaceWith(wrapper);
  wrapper.append(table);
}
