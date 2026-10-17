import { REASON_TAGS, DEADLINE_WARNING_DAYS, SWIPE_THRESHOLD, CONTENT_BASE, DIGEST_DIR, MANIFEST, PAGES } from './config.js';
import { parseDigest, formatRating } from './digest.js';
import { getRating, saveRating, getPref, setPref } from './storage.js';
import { renderMarkdown, renderInline } from './markdown.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const status = document.getElementById('status');
const tabbar = document.getElementById('tabbar');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const isApp = document.documentElement.classList.contains('is-app');
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const state = {
  digests: [],      // file names from the manifest, newest first
  digestFile: null,
  digest: null,     // { intro, entries, sections }
  pages: [],        // PAGES that exist, with their markdown
  index: 0,         // current card
  pending: null,    // { verdict, tags, comment } while choosing reasons
};

// ---------------------------------------------------------------------------
// Helpers

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

// Replace the main content. Skips empty children like h() does (null, false, arrays).
function setMain(...children) {
  main.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false && c !== ''));
}

async function fetchText(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.text();
}

function announce(message) {
  status.textContent = '';
  // A new text node makes screen readers announce repeated messages too.
  requestAnimationFrame(() => { status.textContent = message; });
}

function formatDate(date) {
  return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

function digestDate(file) {
  const match = file?.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(match[1], match[2] - 1, match[3]) : null;
}

function digestLabel(file) {
  const date = digestDate(file);
  return date ? `Digest vom ${formatDate(date)}` : file;
}

/** When the entry landed in the tool: explicit "Hinzugefügt" field, else the digest date. */
function addedInfo(entry) {
  const date = entry.added || digestDate(state.digestFile);
  const isNew = state.digestFile === state.digests[0] && state.digests.length > 1;
  return { date, label: date ? `seit ${formatDate(date)}` : '', isNew };
}

function deadlineInfo(entry) {
  if (!entry.deadline) return { state: 'none', label: '' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((entry.deadline - today) / 86400000);
  if (days < 0) return { state: 'expired', label: 'abgelaufen' };
  const label = days === 0 ? 'heute' : days === 1 ? 'morgen' : `noch ${days} Tage`;
  return { state: days <= DEADLINE_WARNING_DAYS ? 'soon' : 'ok', label };
}

function ratedCount() {
  return state.digest.entries.filter((entry) => getRating(entry)).length;
}

function ratingText(rating) {
  const parts = [rating.verdict];
  if (rating.tags.length) parts.push(rating.tags.join(', '));
  if (rating.comment) parts.push(`„${rating.comment}“`);
  return parts.join(' · ');
}

function scrollIntoViewIfNeeded(el) {
  const rect = el.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    el.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  }
}

// ---------------------------------------------------------------------------
// Navigation and routing

function navItems() {
  const hasFristen = state.pages.some((p) => p.slug === 'fristen');
  return [
    { href: '#/karten', label: 'Karten', icon: 'cards', match: /^#\/(karten|karte\/)|^#?$/ },
    { href: '#/liste', label: 'Übersicht', icon: 'list', match: /^#\/liste/ },
    hasFristen && { href: '#/seite/fristen', label: 'Fristen', icon: 'clock', match: /^#\/seite\/fristen$/ },
    { href: '#/mehr', label: 'Mehr', icon: 'more', match: /^#\/(mehr|so-gehts|seite\/(?!fristen))/ },
  ].filter(Boolean);
}

// Same four items on top (browser) and in the bottom tab bar (home screen app).
function renderNav() {
  const items = navItems();
  nav.replaceChildren(...items.map((item) => h('li', null,
    h('a', { href: item.href, 'aria-current': item.match.test(location.hash) ? 'page' : null }, item.label))));
  tabbar.replaceChildren(...items.map((item) => {
    const icon = h('span', { class: 'tab-icon', 'aria-hidden': 'true' });
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="miter">${TAB_ICONS[item.icon]}</svg>`;
    return h('li', null, h('a', { href: item.href, 'aria-current': item.match.test(location.hash) ? 'page' : null }, icon, h('span', null, item.label)));
  }));
}

// Simple line icons for the tab bar (static markup, decorative).
const TAB_ICONS = {
  cards: '<rect x="7" y="2.5" width="12" height="16" transform="rotate(10 13 10.5)"/><rect x="4" y="5.5" width="12" height="16"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M3 5h2v2H3zM3 11h2v2H3zM3 17h2v2H3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2.5"/>',
  more: '<path d="M4 11h3v3H4zM10.5 11h3v3h-3zM17 11h3v3h-3z"/>',
};

function route() {
  const hash = location.hash;
  renderNav();
  state.pending = null;

  const page = hash.match(/^#\/seite\/([\w-]+)$/);
  if (page) return renderPage(page[1]);
  if (hash === '#/liste') return renderOverview();
  if (hash === '#/so-gehts') return renderIntro();
  if (hash === '#/mehr') return renderMore();

  const card = hash.match(/^#\/karte\/(.+)$/);
  if (card) {
    const index = state.digest.entries.findIndex((e) => e.id === decodeURIComponent(card[1]));
    if (index >= 0) state.index = index;
  }
  renderCardsView();
}

function focusMain() {
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Cards view

function renderCardsView() {
  const { entries, intro } = state.digest;
  // Open on first visit, then out of the way (on phones it pushes the card down).
  const introOpen = getPref('introOpen', ratedCount() === 0);
  const introMarkdown = intro.replace(/^# .*\n?/, '').trim();

  const introBlock = introMarkdown && h('details', {
    class: 'intro', open: introOpen,
    ontoggle: (e) => setPref('introOpen', e.target.open),
  }, h('summary', null, 'Worum es in diesem Digest geht'), h('div', { class: 'prose' }, renderMarkdown(introMarkdown, { shiftHeadings: 1 })));

  setMain(
    h('div', { class: 'digest-head' },
      h('h1', null, h('span', { class: 'mark' }, digestLabel(state.digestFile))),
      digestSwitcher(),
    ),
    h('div', { class: 'progress-area', id: 'progress' }),
    installHint(),
    introBlock,
    entries.length
      ? h('div', { class: 'card-stage', id: 'card-stage' })
      : h('p', null, 'In diesem Digest sind keine Stellen.'),
  );
  if (entries.length) updateCard();
  updateProgress();
}

// iPhone in Safari: suggest adding the tool to the home screen.
function installHint() {
  if (!isIOS || isApp || getPref('installHintDismissed', false)) return null;
  const hasLocalRatings = state.digest.entries.some((entry) => getRating(entry)?.source === 'local');
  const hint = h('section', { class: 'install-hint', 'aria-labelledby': 'install-title' },
    h('h2', { id: 'install-title' }, 'Mach eine App draus'),
    installSteps(),
    hasLocalRatings && h('p', null, h('strong', null, 'Wichtig: '), 'Die App hat ihren eigenen Speicher. Schick deine Bewertungen hier vorher ab, sonst fehlen sie in der App.'),
    h('button', {
      type: 'button', class: 'button',
      onclick: () => { setPref('installHintDismissed', true); hint.remove(); announce('Tipp ausgeblendet. Du findest ihn unter Mehr.'); },
    }, 'Okay, verstanden'),
  );
  return hint;
}

function installSteps() {
  return h('p', null, 'Tipp in Safari auf Teilen (das Quadrat mit dem Pfeil, je nach iOS hinter „…“) und dann auf „Zum Home-Bildschirm“. Dann startet Next Chapter im Vollbild und klappt auch offline.');
}

function digestSwitcher() {
  if (state.digests.length < 2) return null;
  const id = 'digest-select';
  return h('p', { class: 'digest-switch' },
    h('label', { for: id }, 'Anderer Digest: '),
    h('select', {
      id,
      onchange: async (e) => {
        await loadDigest(e.target.value);
        setPref('digest', e.target.value);
        history.replaceState(null, '', '#/karten');
        route();
      },
    }, state.digests.map((file) => h('option', { value: file, selected: file === state.digestFile }, digestLabel(file)))),
  );
}

function updateProgress() {
  const container = document.getElementById('progress');
  if (!container) return;
  const total = state.digest.entries.length;
  const done = ratedCount();
  const complete = total > 0 && done === total;
  container.replaceChildren(
    h('div', { class: 'progress-text' },
      h('p', null, complete ? 'Alles bewertet. Danke!' : `${done} von ${total} bewertet`),
      h('progress', { max: total || 1, value: done, 'aria-label': 'Fortschritt' }),
    ),
    h('button', { type: 'button', class: complete ? 'button button--primary' : 'button', onclick: openExport }, 'Bewertungen schicken'),
  );
}

function updateCard({ focus } = {}) {
  const stage = document.getElementById('card-stage');
  const entries = state.digest.entries;
  const entry = entries[state.index];
  const activeKey = document.activeElement?.dataset?.key;

  stage.replaceChildren(
    buildCard(entry),
    h('nav', { class: 'card-nav', 'aria-label': 'Karten blättern' },
      h('button', { type: 'button', class: 'button', 'data-key': 'prev', disabled: state.index === 0, onclick: () => goToCard(state.index - 1) }, 'Zurück'),
      h('p', null, `Karte ${state.index + 1} von ${entries.length}`),
      h('button', { type: 'button', class: 'button', 'data-key': 'next', disabled: state.index === entries.length - 1, onclick: () => goToCard(state.index + 1) }, 'Weiter'),
    ),
  );

  const target = focus
    ? stage.querySelector(`[data-key="${focus}"]`)
    : activeKey && stage.querySelector(`[data-key="${activeKey}"]:not([disabled])`);
  if (target) target.focus({ preventScroll: focus === 'card-title' ? false : true });
}

function goToCard(index, options = { focus: null }) {
  state.index = index;
  state.pending = null;
  history.replaceState(null, '', `#/karte/${encodeURIComponent(state.digest.entries[index].id)}`);
  updateCard(options);
}

function buildCard(entry) {
  const deadline = deadlineInfo(entry);
  const added = addedInfo(entry);
  const rating = getRating(entry);
  const pending = state.pending;
  const activeVerdict = pending ? pending.verdict : rating?.verdict;

  const fact = (label, value) => value && [h('dt', null, label), h('dd', null, renderInline(value))];

  const deadlineValue = h('dd', null,
    entry.deadlineText || 'keine Angabe',
    deadline.label && h('span', { class: `badge badge--${deadline.state}` }, deadline.label),
  );

  const card = h('article', {
    class: `card${deadline.state === 'expired' ? ' card--expired' : ''}`,
    'aria-labelledby': 'card-title',
  },
    h('span', { class: 'swipe-label swipe-label--yes', 'aria-hidden': 'true' }, 'passt'),
    h('span', { class: 'swipe-label swipe-label--no', 'aria-hidden': 'true' }, 'passt nicht'),
    h('header', { class: 'card-header' },
      h('p', { class: 'card-meta' },
        h('span', null, `Nr. ${entry.number}`),
        added.isNew && h('span', { class: 'badge badge--new' }, 'neu'),
        added.label && h('span', { class: 'added' }, added.label),
        scoreView(entry.score),
      ),
      h('h2', { id: 'card-title', tabindex: '-1', 'data-key': 'card-title' }, renderInline(entry.heading)),
      entry.title && h('p', { class: 'card-subtitle' }, renderInline(entry.title)),
    ),
    deadline.state === 'soon' && h('p', { class: 'deadline-alert' }, `Frist ${deadline.label}: ${formatDate(entry.deadline)}`),
    deadline.state === 'expired' && h('p', { class: 'deadline-alert deadline-alert--expired' }, 'Die Frist ist leider abgelaufen.'),
    h('dl', { class: 'facts' },
      fact('Organisation', entry.organisation),
      fact('Ort', entry.location),
      fact('Format', entry.format),
      fact('Dauer', entry.duration),
      fact('Start', entry.start),
      fact('Bezahlung', entry.pay),
      h('dt', null, 'Frist'), deadlineValue,
    ),
    entry.reasoning && h('div', { class: 'reasoning' },
      h('h3', null, 'Warum die Stelle drin ist'),
      h('p', null, renderInline(entry.reasoning)),
    ),
    entry.extra && h('div', { class: 'prose' }, renderMarkdown(entry.extra)),
    entry.link && h('p', null, h('a', { class: 'link-out', href: entry.link, target: '_blank', rel: 'noopener noreferrer' }, 'Zur Ausschreibung', h('span', { class: 'visually-hidden' }, ' (öffnet neuen Tab)'))),
    rating && !pending && h('p', { class: `current-rating current-rating--${rating.verdict === 'passt' ? 'yes' : 'no'}` },
      h('strong', null, 'Deine Bewertung: '), ratingText(rating),
      rating.source === 'file' && h('span', { class: 'muted' }, ' (schon übernommen)'),
    ),
    h('div', { class: 'verdict', role: 'group', 'aria-label': 'Bewertung' },
      h('button', { type: 'button', class: 'button verdict--no', 'data-key': 'no', 'aria-pressed': String(activeVerdict === 'passt nicht'), onclick: () => chooseVerdict('passt nicht') }, 'passt nicht'),
      h('button', { type: 'button', class: 'button verdict--yes', 'data-key': 'yes', 'aria-pressed': String(activeVerdict === 'passt'), onclick: () => chooseVerdict('passt') }, 'passt'),
    ),
    pending && reasonForm(entry, pending),
    h('p', { class: 'kbd-hint' }, 'Tastatur: Pfeil links oder rechts bewertet, Leertaste wählt Gründe, Enter speichert.'),
  );

  attachSwipe(card);
  return card;
}

function scoreView(score) {
  return h('span', { class: `score score--${score}` },
    h('span', { class: 'visually-hidden' }, `Score ${score} von 5`),
    h('span', { class: 'score-label', 'aria-hidden': 'true' }, 'Score'),
    h('span', { class: 'score-num', 'aria-hidden': 'true' }, String(score)),
    h('span', { class: 'score-max', 'aria-hidden': 'true' }, '/5'),
  );
}

function reasonForm(entry, pending) {
  const tags = [...REASON_TAGS[pending.verdict]];
  // Keep tags from older or hand-written ratings visible, even if not in the config.
  for (const tag of pending.tags) if (!tags.includes(tag)) tags.push(tag);

  const form = h('form', { class: 'reasons', onsubmit: (e) => { e.preventDefault(); submitRating(); } },
    h('fieldset', null,
      h('legend', null, pending.verdict === 'passt' ? 'Was gefällt dir?' : 'Was passt nicht?'),
      h('div', { class: 'tags' }, tags.map((tag) => h('button', {
        type: 'button',
        class: 'tag',
        'data-key': `tag-${tag}`,
        'aria-pressed': String(pending.tags.includes(tag)),
        onclick: () => toggleTag(tag),
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submitRating(); } },
      }, tag))),
    ),
    h('p', { class: 'field' },
      h('label', { for: 'comment' }, 'Kommentar (optional)'),
      h('input', {
        id: 'comment', type: 'text', 'data-key': 'comment', autocomplete: 'off',
        value: pending.comment,
        oninput: (e) => { state.pending.comment = e.target.value; },
      }),
    ),
    h('div', { class: 'form-actions' },
      h('button', { type: 'submit', class: 'button button--primary', 'data-key': 'save' }, 'Speichern'),
      h('button', { type: 'button', class: 'button button--quiet', onclick: cancelRating }, 'Abbrechen'),
    ),
  );
  return form;
}

function chooseVerdict(verdict, { via = 'button' } = {}) {
  const entry = state.digest.entries[state.index];
  const existing = state.pending || getRating(entry);
  const sameVerdict = existing && existing.verdict === verdict;
  state.pending = {
    verdict,
    tags: sameVerdict ? [...existing.tags] : [],
    comment: existing ? existing.comment : '',
  };
  updateCard({ focus: via === 'keyboard' ? `tag-${REASON_TAGS[verdict][0]}` : null });
  const form = document.querySelector('.reasons');
  if (form && via === 'swipe') scrollIntoViewIfNeeded(form);
  announce(`${verdict}. Jetzt Gründe wählen.`);
}

function toggleTag(tag) {
  const tags = state.pending.tags;
  state.pending.tags = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
  updateCard();
}

function cancelRating() {
  state.pending = null;
  updateCard({ focus: 'card-title' });
}

function submitRating() {
  const entry = state.digest.entries[state.index];
  const ok = saveRating(entry, state.pending);
  const verdict = state.pending.verdict;
  state.pending = null;
  updateProgress();
  updateBadge();

  if (!ok) {
    updateCard();
    announce('Speichern hat nicht geklappt. Ist der private Modus an?');
    return;
  }

  const total = state.digest.entries.length;
  const next = findNextUnrated(state.index);
  if (next === -1) {
    updateCard({ focus: 'card-title' });
    announce(`Gespeichert: ${verdict}. Alles bewertet, jetzt nur noch abschicken.`);
  } else {
    goToCard(next, { focus: 'card-title' });
    announce(`Gespeichert: ${verdict}. ${ratedCount()} von ${total} bewertet.`);
  }
  scrollIntoViewIfNeeded(document.getElementById('card-stage'));
}

function findNextUnrated(from) {
  const entries = state.digest.entries;
  for (let step = 1; step <= entries.length; step++) {
    const i = (from + step) % entries.length;
    if (!getRating(entries[i])) return i;
  }
  return -1;
}

function attachSwipe(card) {
  let start = null;
  let dragging = false;

  const reset = () => {
    start = null;
    dragging = false;
    card.classList.remove('is-dragging');
    card.style.removeProperty('--dx');
    card.style.removeProperty('--swipe');
  };

  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('a, button, input, select, textarea, label, summary')) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });

  card.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!dragging) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        dragging = true;
        card.setPointerCapture(e.pointerId);
        card.classList.add('is-dragging');
      } else if (Math.abs(dy) > 10) {
        start = null; // vertical scroll, not a swipe
        return;
      } else {
        return;
      }
    }
    card.style.setProperty('--dx', `${dx}px`);
    card.style.setProperty('--swipe', Math.max(-1, Math.min(1, dx / SWIPE_THRESHOLD)).toFixed(2));
  });

  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const wasDragging = dragging;
    reset();
    if (!wasDragging) return;
    if (dx >= SWIPE_THRESHOLD) chooseVerdict('passt', { via: 'swipe' });
    else if (dx <= -SWIPE_THRESHOLD) chooseVerdict('passt nicht', { via: 'swipe' });
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', reset);
}

document.addEventListener('keydown', (e) => {
  if (!document.getElementById('card-stage') || document.querySelector('dialog[open]')) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const inField = e.target.closest('input, textarea, select, [contenteditable]');
  if (inField) return;

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    chooseVerdict('passt', { via: 'keyboard' });
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    chooseVerdict('passt nicht', { via: 'keyboard' });
  } else if (e.key === 'Enter' && state.pending && !e.target.closest('button, a, summary')) {
    e.preventDefault();
    submitRating();
  }
});

// ---------------------------------------------------------------------------
// Overview

function renderOverview() {
  const sort = getPref('sort', 'number');
  const entries = [...state.digest.entries];
  const far = Number.MAX_SAFE_INTEGER;
  if (sort === 'score') entries.sort((a, b) => b.score - a.score || a.number - b.number);
  if (sort === 'deadline') entries.sort((a, b) => (a.deadline?.getTime() ?? far) - (b.deadline?.getTime() ?? far) || a.number - b.number);
  if (sort === 'number') entries.sort((a, b) => a.number - b.number);

  const total = state.digest.entries.length;

  setMain(
    h('h1', null, h('span', { class: 'mark' }, 'Übersicht')),
    h('div', { class: 'toolbar' },
      h('p', null, `${digestLabel(state.digestFile)}: ${ratedCount()} von ${total} bewertet`),
      h('p', { class: 'field field--inline' },
        h('label', { for: 'sort' }, 'Sortieren nach'),
        h('select', {
          id: 'sort',
          onchange: (e) => { setPref('sort', e.target.value); renderOverview(); document.getElementById('sort').focus(); },
        },
          h('option', { value: 'number', selected: sort === 'number' }, 'Reihenfolge im Digest'),
          h('option', { value: 'score', selected: sort === 'score' }, 'Score'),
          h('option', { value: 'deadline', selected: sort === 'deadline' }, 'Frist'),
        ),
      ),
    ),
    h('ul', { class: 'overview' }, entries.map(overviewRow)),
    state.digest.sections.map((section) => h('section', { class: 'prose extra-section' }, renderMarkdown(section))),
    h('p', null, h('button', { type: 'button', class: 'button', onclick: openExport }, 'Bewertungen schicken')),
  );
  focusMain();
}

function overviewRow(entry) {
  const deadline = deadlineInfo(entry);
  const added = addedInfo(entry);
  const rating = getRating(entry);
  const ratingClass = rating ? (rating.verdict === 'passt' ? 'yes' : 'no') : 'open';

  return h('li', { class: `row${deadline.state === 'expired' ? ' row--expired' : ''}` },
    h('a', { href: `#/karte/${encodeURIComponent(entry.id)}` },
      h('span', { class: 'row-number' }, `${entry.number}.`),
      h('span', { class: 'row-main' },
        h('strong', null, renderInline(entry.heading)),
        h('span', { class: 'muted' }, [entry.organisation, entry.location].filter(Boolean).map((v) => renderInline(v).textContent).join(' · ')),
        h('span', { class: 'row-facts' },
          added.isNew && h('span', { class: 'badge badge--new' }, 'neu'),
          h('span', null, `Score ${entry.score}`),
          added.label && h('span', null, added.label),
          h('span', null, `Frist: ${entry.deadlineText || 'keine Angabe'}`),
          deadline.label && h('span', { class: `badge badge--${deadline.state}` }, deadline.label),
        ),
      ),
      h('span', { class: `chip chip--${ratingClass}` }, rating ? rating.verdict : 'offen'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Intro ("So geht's"), shown automatically on the first visit

function renderIntro() {
  setPref('onboarded', true);
  const count = state.digest.entries.length;
  // Decorative look-alikes of the real controls, so she recognises them later.
  const fake = (label, extra = '') => h('span', { class: `button fake-button ${extra}`, 'aria-hidden': 'true' }, label);

  const step = (title, ...content) => h('li', { class: 'step' }, h('h2', null, title), ...content);

  setMain(
    h('h1', null, h('span', { class: 'mark' }, 'Hi Marla!')),
    h('p', { class: 'lead' },
      `Hier landen Stellen, die zu dir passen könnten. Gerade liegen ${count} für dich bereit, alle paar Wochen kommt ein neuer Schwung. So funktioniert's:`,
    ),
    h('ol', { class: 'steps' },
      step('Anschauen',
        h('p', null, 'Jede Stelle ist eine Karte. Der Sticker oben rechts zeigt, wie gut sie zu deiner Suche passt, von 1 bis 5. Knappe Fristen sind gelb markiert.'),
      ),
      step('Bewerten',
        h('p', null, 'Wisch die Karte nach rechts, wenn sie passt, nach links, wenn nicht. Oder tipp auf die Buttons.'),
        h('div', { class: 'fake-row' }, fake('passt nicht', 'verdict--no'), fake('passt', 'verdict--yes')),
      ),
      step('Sagen, warum',
        h('p', null, 'Danach tippst du ein paar Gründe an, zum Beispiel „unbezahlt“ oder „Ort“. Fällt dir noch mehr ein, schreib es in den Kommentar. Ein „passt nicht“ mit Grund hilft genauso viel wie ein „passt“.'),
      ),
      step('Abschicken',
        h('p', null, 'Deine Bewertungen bleiben erst mal nur hier auf deinem Handy. Niemand sieht sie, auch Papa nicht. Wenn du durch bist oder zwischendurch, tipp auf diesen Button:'),
        h('div', { class: 'fake-row' }, fake('Bewertungen schicken')),
        h('p', null, 'Dann öffnet sich das Teilen-Menü. Schick den Text per Messenger oder Mail an Papa. Daraus wird die nächste Suche genauer.'),
      ),
    ),
    h('section', { class: 'good-to-know', 'aria-labelledby': 'gtk-title' },
      h('h2', { id: 'gtk-title' }, 'Gut zu wissen'),
      h('ul', null,
        h('li', null, 'Du bewirbst dich damit nirgends. Es geht nur darum, was dir gefällt und was nicht.'),
        h('li', null, 'Jede Bewertung kannst du später noch ändern.'),
        h('li', null, 'Reizt dich eine Stelle richtig? Über „Zur Ausschreibung“ kommst du zum Original. Behalt die Frist im Blick.'),
        h('li', null, 'Bleib am besten auf demselben Handy und im selben Browser. Im privaten Modus sind deine Bewertungen nach dem Schließen weg.'),
      ),
    ),
    h('p', { class: 'form-actions' },
      h('a', { class: 'button button--primary button--big', href: '#/karten' }, 'Los geht\'s'),
    ),
    h('p', { class: 'muted small' }, 'Diese Seite findest du jederzeit oben unter „So geht\'s“.'),
  );
  focusMain();
}

// ---------------------------------------------------------------------------
// "Mehr" (tab bar target in the app; also reachable in the browser)

function renderMore() {
  const pageLinks = [
    ...state.pages.filter((p) => p.slug !== 'fristen').map((p) => ({ href: `#/seite/${p.slug}`, label: p.label })),
    { href: '#/so-gehts', label: 'So geht\'s' },
  ];
  const canAskBadge = isApp && 'setAppBadge' in navigator && 'Notification' in window && Notification.permission === 'default';

  setMain(
    h('h1', null, h('span', { class: 'mark' }, 'Mehr')),
    h('ul', { class: 'more-list' }, pageLinks.map((link) => h('li', null, h('a', { href: link.href }, link.label)))),
    h('section', { class: 'more-section' },
      h('h2', null, 'Bewertungen'),
      h('p', null, `${ratedCount()} von ${state.digest.entries.length} bewertet. Schick sie ab, wann immer du magst, auch zwischendurch.`),
      h('button', { type: 'button', class: 'button button--primary', onclick: openExport }, 'Bewertungen schicken'),
    ),
    canAskBadge && h('section', { class: 'more-section' },
      h('h2', null, 'Zahl am App-Icon'),
      h('p', null, 'Das Icon kann zeigen, wie viele Karten noch offen sind. Dafür fragt dein iPhone nach Mitteilungen. Wir schicken dir keine, es geht nur um die Zahl.'),
      h('button', {
        type: 'button', class: 'button',
        onclick: async () => { await Notification.requestPermission(); updateBadge(); renderMore(); },
      }, 'Zahl anzeigen'),
    ),
    isApp && h('section', { class: 'more-section' },
      h('h2', null, 'App aktualisieren'),
      h('p', null, navigator.onLine
        ? 'Holt die neueste Version und neue Stellen. Deine Bewertungen bleiben, wo sie sind.'
        : 'Gerade bist du offline. Sobald du wieder Netz hast, klappt das.'),
      h('button', { type: 'button', class: 'button', disabled: !navigator.onLine, onclick: () => location.reload() }, 'Jetzt aktualisieren'),
    ),
    isIOS && !isApp && h('section', { class: 'more-section' },
      h('h2', null, 'Als App installieren'),
      installSteps(),
      h('p', null, 'Achtung: Die App hat ihren eigenen Speicher. Schick deine Bewertungen hier vorher ab.'),
    ),
  );
  focusMain();
}

// Number of open cards on the home screen icon (iOS needs notification permission for it).
function updateBadge() {
  if (!('setAppBadge' in navigator) || !state.digest) return;
  const open = state.digest.entries.length - ratedCount();
  (open ? navigator.setAppBadge(open) : navigator.clearAppBadge()).catch(() => {});
}

function setupApp() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((error) => console.error(error));
  }
  // Ask the browser not to evict the ratings.
  if (isApp && navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  const offline = document.getElementById('offline');
  const sync = () => { offline.hidden = navigator.onLine; };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
}

// ---------------------------------------------------------------------------
// Content pages

function renderPage(slug) {
  const page = state.pages.find((p) => p.slug === slug);
  if (!page) {
    setMain(h('h1', null, 'Seite nicht gefunden'), h('p', null, h('a', { href: '#/karten' }, 'Zurück zu den Karten')));
  } else {
    setMain(h('div', { class: 'prose page' }, renderMarkdown(page.markdown)));
  }
  focusMain();
}

// ---------------------------------------------------------------------------
// Export

const dialog = document.getElementById('export-dialog');
const exportText = document.getElementById('export-text');
const exportStatus = document.getElementById('export-status');
const shareButton = document.getElementById('export-share');

function buildExport() {
  const rated = state.digest.entries
    .map((entry) => ({ entry, rating: getRating(entry) }))
    .filter(({ rating }) => rating && rating.source === 'local');
  if (!rated.length) return '';

  const lines = [
    `# Bewertungen von Marla zu ${state.digestFile}`,
    '',
    `Stand ${formatDate(new Date())}, ${rated.length} neue oder geänderte Bewertungen.`,
  ];
  for (const { entry, rating } of rated) {
    lines.push('', `## ${entry.number}. ${entry.heading}`, '', `- **ID:** \`${entry.id}\``, formatRating(rating));
  }
  return `${lines.join('\n')}\n`;
}

function openExport() {
  const text = buildExport();
  exportText.value = text || 'Noch nichts Neues zum Schicken. Bewerte erst ein paar Karten.';
  exportStatus.textContent = '';
  for (const button of dialog.querySelectorAll('[data-needs-text]')) button.disabled = !text;
  shareButton.hidden = !navigator.share;
  dialog.showModal();
}

document.getElementById('export-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(exportText.value);
    exportStatus.textContent = 'Kopiert. Jetzt einfach einfügen und abschicken.';
  } catch {
    exportText.select();
    exportStatus.textContent = 'Kopieren ging nicht automatisch. Der Text ist markiert, kopier ihn bitte selbst.';
  }
});

document.getElementById('export-download').addEventListener('click', () => {
  const blob = new Blob([exportText.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `bewertungen-${state.digestFile}` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  exportStatus.textContent = 'Datei ist heruntergeladen.';
});

shareButton.addEventListener('click', async () => {
  try {
    await navigator.share({ title: 'Bewertungen von Marla', text: exportText.value });
    exportStatus.textContent = 'Geteilt. Danke!';
  } catch (error) {
    if (error.name !== 'AbortError') exportStatus.textContent = 'Teilen hat nicht geklappt. Probier Kopieren.';
  }
});

document.getElementById('export-close').addEventListener('click', () => dialog.close());

// ---------------------------------------------------------------------------
// Startup

async function loadDigest(file) {
  state.digestFile = file;
  state.digest = parseDigest(await fetchText(`${DIGEST_DIR}${file}`));
  state.index = Math.max(0, state.digest.entries.findIndex((entry) => !getRating(entry)));
}

async function loadPages() {
  const results = await Promise.all(PAGES.map(async (page) => {
    try {
      return { ...page, markdown: await fetchText(`${CONTENT_BASE}${page.file}`) };
    } catch {
      return null; // not there (e.g. profil.md is not committed): hide it
    }
  }));
  state.pages = results.filter(Boolean);
}

async function init() {
  try {
    const manifest = JSON.parse(await fetchText(MANIFEST));
    state.digests = [...manifest.digests].sort().reverse();
    if (!state.digests.length) throw new Error('Keine Digests im Manifest');
    const preferred = getPref('digest', null);
    // A newer digest than at the last visit wins over the remembered choice.
    const newest = state.digests[0];
    const knownNewest = getPref('newestSeen', null);
    setPref('newestSeen', newest);
    const start = knownNewest === newest && state.digests.includes(preferred) ? preferred : newest;
    await Promise.all([
      loadDigest(start),
      loadPages(),
    ]);
  } catch (error) {
    console.error(error);
    setMain(
      h('h1', null, 'Da hat etwas nicht geklappt'),
      h('p', null, 'Der Digest ließ sich nicht laden. Lad die Seite bitte nochmal.'),
      location.protocol === 'file:' && h('p', null, 'Hinweis: Die Seite muss über einen Server laufen, zum Beispiel mit „npx serve“.'),
    );
    return;
  }
  if (!getPref('onboarded', false) && /^#?(\/karten)?$/.test(location.hash)) {
    history.replaceState(null, '', '#/so-gehts');
  }
  window.addEventListener('hashchange', route);
  route();
  updateBadge();
}

setupApp();
init();
