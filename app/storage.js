// Ratings in localStorage, keyed by entry ID.
//
// Conflict rule: the markdown file wins. Every local rating remembers which rating
// the file had when it was saved (`base`). If the file has changed since (e.g.
// Christian copied the export into the digest), the file rating takes over and the
// local one is dropped. Otherwise local edits stay in effect.

import { ratingKey } from './digest.js';

const KEY = 'marla:ratings:v1';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** Effective rating for an entry, applying the "file wins" rule. */
export function getRating(entry) {
  const all = readAll();
  const local = all[entry.id];
  const fileKey = ratingKey(entry.fileRating);

  if (local && local.base !== fileKey && entry.fileRating) {
    delete all[entry.id];
    writeAll(all);
    return { ...entry.fileRating, source: 'file' };
  }
  if (local) return { verdict: local.verdict, tags: local.tags, comment: local.comment, source: 'local' };
  if (entry.fileRating) return { ...entry.fileRating, source: 'file' };
  return null;
}

/** Save a rating. Returns false if storage is unavailable. */
export function saveRating(entry, { verdict, tags, comment }) {
  const all = readAll();
  all[entry.id] = {
    verdict,
    tags,
    comment,
    base: ratingKey(entry.fileRating),
    updatedAt: new Date().toISOString(),
  };
  return writeAll(all);
}

/** Small per-viewer preferences (sort order, collapsed intro, ...). */
export function getPref(name, fallback) {
  try {
    const value = localStorage.getItem(`marla:pref:${name}`);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function setPref(name, value) {
  try {
    localStorage.setItem(`marla:pref:${name}`, JSON.stringify(value));
  } catch {
    // Preferences are optional.
  }
}
