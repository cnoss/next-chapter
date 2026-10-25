import { REASON_TAGS, DEADLINE_WARNING_DAYS, SWIPE_THRESHOLD, CONTENT_BASE, DIGEST_DIR, MANIFEST, PAGES } from './config.js';
import { parseDigest, formatRating } from './digest.js';
import { getRating, saveRating, getPref, setPref, isFavorite, setFavorite, favoriteStates } from './storage.js';
import { digestDate, mergeDigests, isExpired, matchesFilter, sortRecords, FILTERS } from './collection.js';
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
  cache: {},        // file -> parsed digest, all rounds loaded once
  merged: new Map(), // id -> { id, entry, file, firstSeen, added } across all rounds
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

function digestLabel(file) {
  const date = digestDate(file);
  return date ? `Digest vom ${formatDate(date)}` : file;
}

/**
 * When the entry landed in the tool: explicit "Hinzugefügt" field, else the first round
 * that contains the ID. "Neu" means: in the newest round and not carried over.
 */
function addedInfo(entry, file = state.digestFile) {
  const date = entry.added || state.merged.get(entry.id)?.firstSeen || digestDate(file);
  const newest = digestDate(state.digests[0]);
  const isNew = state.digests.length > 1 && file === state.digests[0] && !!date && date >= newest;
  return { date, label: date ? `seit ${formatDate(date)}` : '', isNew };
}

function formatShortDate(date) {
  return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
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
    const id = decodeURIComponent(card[1]);
    // Not in the open round: switch to the newest round that has it.
    const record = state.merged.get(id);
    if (!state.digest.entries.some((e) => e.id === id) && record && state.cache[record.file]) {
      showDigest(record.file);
      setPref('digest', record.file);
    }
    const index = state.digest.entries.findIndex((e) => e.id === id);
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
      onchange: (e) => {
        showDigest(e.target.value);
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
    h('div', { class: 'card-actions' },
      entry.link && h('a', { class: 'link-out', href: entry.link, target: '_blank', rel: 'noopener noreferrer' }, 'Zur Ausschreibung', h('span', { class: 'visually-hidden' }, ' (öffnet neuen Tab)')),
      favButton(entry),
    ),
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
// Favorites

const STAR = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2.8l2.7 6 6.5.6-4.9 4.3 1.5 6.4L12 16.8l-5.8 3.3 1.5-6.4-4.9-4.3 6.5-.6z" stroke="currentColor" stroke-width="2" stroke-linejoin="miter"/></svg>';

function favButton(entry, { compact = false } = {}) {
  const on = isFavorite(entry.id);
  const icon = h('span', { class: 'fav-icon' });
  icon.innerHTML = STAR;
  return h('button', {
    type: 'button',
    class: compact ? 'fav fav--compact' : 'fav',
    'data-key': `fav-${entry.id}`,
    'aria-pressed': String(on),
    // In lists every row has a star, so the name says which job it is.
    'aria-label': compact ? `Favorit: ${renderInline(entry.heading).textContent}` : null,
    onclick: () => toggleFavorite(entry),
  }, icon, !compact && h('span', null, 'Favorit'));
}

/** Favorites that still exist in one of the rounds. */
function favoriteCount() {
  return Object.entries(favoriteStates()).filter(([id, on]) => on && state.merged.has(id)).length;
}

function toggleFavorite(entry) {
  const value = !isFavorite(entry.id);
  if (!setFavorite(entry.id, value)) {
    announce('Speichern hat nicht geklappt. Ist der private Modus an?');
    return;
  }
  const count = favoriteCount();
  let message = value ? `Favorit gesetzt. Du hast jetzt ${plural(count, 'Favorit', 'Favoriten')}.` : `Favorit entfernt. Noch ${plural(count, 'Favorit', 'Favoriten')}.`;
  if (value && count > 3) message += ' Mehr als 3 Favoriten: Welche sind deine Top 3?';

  if (location.hash === '#/liste') renderOverview({ focusKey: `fav-${entry.id}`, silent: true });
  else updateCard();
  announce(message);
}

// ---------------------------------------------------------------------------
// Overview: all rounds (default) or one round, with filters

const FILTER_LABELS = { 'passt': 'passt', 'offen': 'offen', 'passt nicht': 'passt nicht', 'alle': 'alle', 'favoriten': 'Favoriten' };

const EMPTY_TEXTS = {
  'passt': 'Noch nichts mit „passt“ markiert. Wisch dich durch die Karten, dann füllt sich hier deine Merkliste.',
  'offen': 'Alles bewertet. Stark!',
  'passt nicht': 'Noch nichts aussortiert.',
  'alle': 'Hier ist gerade nichts.',
  'favoriten': 'Noch keine Favoriten. Tipp auf den Stern bei deinen Top 3.',
};

function overviewPrefs() {
  const scope = getPref('overviewScope', 'all') === 'round' ? 'round' : 'all';
  const filter = getPref(`overviewFilter:${scope}`, scope === 'all' ? 'passt' : 'alle');
  let sort = getPref('overviewSort', 'deadline');
  if (scope === 'all' && sort === 'number') sort = 'deadline';
  return {
    scope,
    filter: FILTERS.includes(filter) ? filter : 'alle',
    sort,
    showExpired: getPref('overviewShowExpired', false),
  };
}

/** Records for the list, with rating and favorite looked up once. */
function overviewPool(scope) {
  const records = scope === 'all'
    ? [...state.merged.values()].filter((record) => state.cache[record.file])
    : state.digest.entries.map((entry) => ({
      id: entry.id,
      entry,
      file: state.digestFile,
      added: entry.added || state.merged.get(entry.id)?.firstSeen || digestDate(state.digestFile),
    }));
  return records.map((record) => ({
    ...record,
    rating: getRating(record.entry),
    favorite: isFavorite(record.id),
    expired: isExpired(record.entry),
  }));
}

function renderOverview({ focusKey = null, silent = false } = {}) {
  const { scope, filter, sort, showExpired } = overviewPrefs();
  const pool = overviewPool(scope);
  // Expired deadlines are hidden in "all rounds" unless asked for.
  const hideExpired = scope === 'all' && !showExpired;
  const visible = hideExpired ? pool.filter((r) => !r.expired) : pool;
  const counts = Object.fromEntries(FILTERS.map((f) => [f, visible.filter((r) => matchesFilter(f, r)).length]));
  const inFilter = pool.filter((r) => matchesFilter(filter, r));
  const expiredInFilter = inFilter.filter((r) => r.expired).length;
  const shown = sortRecords(hideExpired ? inFilter.filter((r) => !r.expired) : inFilter, sort);
  const favorites = favoriteCount();

  const change = (pref, value, key) => {
    setPref(pref, value);
    renderOverview({ focusKey: key });
  };

  const segment = (label, pressed, key, onclick) => h('button', {
    type: 'button', class: 'segment', 'data-key': key, 'aria-pressed': String(pressed), onclick,
  }, label);

  const sortOptions = [
    ['deadline', 'Frist'],
    ['score', 'Score'],
    ['added', 'Neueste zuerst'],
    scope === 'round' && ['number', 'Reihenfolge im Digest'],
  ].filter(Boolean);

  setMain(
    h('h1', null, h('span', { class: 'mark' }, 'Übersicht')),
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Welche Runden' },
      segment('Alle Runden', scope === 'all', 'scope-all', () => change('overviewScope', 'all', 'scope-all')),
      segment('Diese Runde', scope === 'round', 'scope-round', () => change('overviewScope', 'round', 'scope-round')),
    ),
    scope === 'round' && state.digests.length > 1 && h('p', { class: 'field field--inline round-select' },
      h('label', { for: 'round' }, 'Runde'),
      h('select', {
        id: 'round', 'data-key': 'round',
        onchange: (e) => { showDigest(e.target.value); setPref('digest', e.target.value); renderOverview({ focusKey: 'round' }); },
      }, state.digests.filter((file) => state.cache[file]).map((file) => h('option', { value: file, selected: file === state.digestFile }, digestLabel(file)))),
    ),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter' },
      FILTERS.map((f) => segment(`${FILTER_LABELS[f]} (${counts[f]})`, f === filter, `filter-${f}`,
        () => change(`overviewFilter:${scope}`, f, `filter-${f}`))),
    ),
    h('div', { class: 'toolbar' },
      h('p', { class: 'field field--inline' },
        h('label', { for: 'sort' }, 'Sortieren nach'),
        h('select', { id: 'sort', 'data-key': 'sort', onchange: (e) => change('overviewSort', e.target.value, 'sort') },
          sortOptions.map(([value, label]) => h('option', { value, selected: value === sort }, label))),
      ),
      scope === 'all' && (expiredInFilter > 0 || showExpired) && h('p', { class: 'check' },
        h('input', {
          type: 'checkbox', id: 'show-expired', 'data-key': 'show-expired', checked: showExpired,
          onchange: (e) => change('overviewShowExpired', e.target.checked, 'show-expired'),
        }),
        h('label', { for: 'show-expired' }, `Abgelaufene zeigen (${expiredInFilter})`),
      ),
    ),
    favorites > 3 && h('p', { class: 'fav-hint' }, 'Mehr als 3 Favoriten: Welche sind deine Top 3?'),
    h('p', { class: 'result-count', id: 'result-count', tabindex: '-1' }, plural(shown.length, 'Stelle', 'Stellen')),
    shown.length
      ? h('ul', { class: 'overview' }, shown.map((record) => overviewRow(record, scope)))
      : h('p', { class: 'empty' }, EMPTY_TEXTS[filter],
        hideExpired && expiredInFilter > 0 && ` ${plural(expiredInFilter, 'abgelaufene ist', 'abgelaufene sind')} ausgeblendet.`),
    scope === 'round' && state.digest.sections.map((section) => h('section', { class: 'prose extra-section' }, renderMarkdown(section))),
    h('p', null, h('button', { type: 'button', class: 'button', onclick: openExport }, 'Bewertungen schicken')),
  );

  if (!focusKey) {
    focusMain();
    return;
  }
  // Keep the focus on the control that was used; if it is gone (e.g. the row left
  // the favorites filter), go to the result count.
  const target = main.querySelector(`[data-key="${CSS.escape(focusKey)}"]`) || document.getElementById('result-count');
  target.focus({ preventScroll: true });
  if (!silent) announce(`${plural(shown.length, 'Stelle', 'Stellen')} in der Liste.`);
}

function overviewRow(record, scope) {
  const { entry, file } = record;
  const deadline = deadlineInfo(entry);
  const added = addedInfo(entry, file);
  const rating = record.rating;
  const ratingClass = rating ? (rating.verdict === 'passt' ? 'yes' : 'no') : 'open';
  const round = scope === 'all'
    ? record.added && `aus Runde vom ${formatShortDate(record.added)}`
    : added.label;

  return h('li', { class: `row${deadline.state === 'expired' ? ' row--expired' : ''}` },
    h('a', { class: 'row-link', href: `#/karte/${encodeURIComponent(entry.id)}` },
      scope === 'round' && h('span', { class: 'row-number' }, `${entry.number}.`),
      h('span', { class: 'row-main' },
        h('strong', null, renderInline(entry.heading)),
        h('span', { class: 'muted' }, [entry.organisation, entry.location].filter(Boolean).map((v) => renderInline(v).textContent).join(' · ')),
        h('span', { class: 'row-facts' },
          added.isNew && h('span', { class: 'badge badge--new' }, 'neu'),
          h('span', null, `Score ${entry.score}`),
          round && h('span', null, round),
          h('span', null, `Frist: ${entry.deadlineText || 'keine Angabe'}`),
          deadline.label && h('span', { class: `badge badge--${deadline.state}` }, deadline.label),
        ),
      ),
      h('span', { class: `chip chip--${ratingClass}` }, rating ? rating.verdict : 'offen'),
    ),
    favButton(entry, { compact: true }),
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
  const favorites = favoriteStates();
  const byFile = new Map();
  for (const record of state.merged.values()) {
    if (!state.cache[record.file]) continue;
    const rating = getRating(record.entry);
    const localRating = rating?.source === 'local' ? rating : null;
    const favorite = record.id in favorites ? favorites[record.id] : null;
    if (!localRating && favorite === null) continue;
    if (!byFile.has(record.file)) byFile.set(record.file, []);
    byFile.get(record.file).push({ entry: record.entry, rating: localRating, favorite });
  }
  if (!byFile.size) return '';

  const today = formatDate(new Date());
  const blocks = [...byFile.keys()].sort().reverse().map((file) => {
    const items = byFile.get(file).sort((a, b) => a.entry.number - b.entry.number);
    const lines = [
      `# Bewertungen von Marla zu ${file}`,
      '',
      `Stand ${today}, ${plural(items.length, 'neuer oder geänderter Eintrag', 'neue oder geänderte Einträge')}.`,
    ];
    for (const { entry, rating, favorite } of items) {
      lines.push('', `## ${entry.number}. ${entry.heading}`, '', `- **ID:** \`${entry.id}\``);
      if (rating) lines.push(formatRating(rating));
      if (favorite !== null) lines.push(`- **Favorit:** ${favorite ? 'ja' : 'nein'}`);
    }
    return lines.join('\n');
  });
  return `${blocks.join('\n\n')}\n`;
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
  const a = h('a', { href: url, download: `bewertungen-${new Date().toISOString().slice(0, 10)}.md` });
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

/** Load and parse every digest from the manifest once; failed ones are skipped. */
async function loadAllDigests() {
  const loaded = (await Promise.all(state.digests.map(async (file) => {
    try {
      return { file, digest: parseDigest(await fetchText(`${DIGEST_DIR}${file}`)) };
    } catch (error) {
      console.error(error);
      return null;
    }
  }))).filter(Boolean);
  if (!loaded.length) throw new Error('Kein Digest ließ sich laden');
  for (const { file, digest } of loaded) state.cache[file] = digest;
  state.merged = mergeDigests(loaded);
}

/** Open one round in the cards view (from memory). */
function showDigest(file) {
  state.digestFile = file;
  state.digest = state.cache[file];
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
    const wanted = knownNewest === newest && state.digests.includes(preferred) ? preferred : newest;
    await Promise.all([loadAllDigests(), loadPages()]);
    showDigest(state.cache[wanted] ? wanted : state.digests.find((file) => state.cache[file]));
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
