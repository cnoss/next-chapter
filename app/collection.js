// All rounds at once: merge digests by ID, filter, sort. No DOM, so it can be tested in Node.

/** Date from a digest file name (digest-YYYY-MM-DD.md). */
export function digestDate(file) {
  const match = file?.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(match[1], match[2] - 1, match[3]) : null;
}

/**
 * Merge entries of several digests by ID.
 * The newest digest wins for the fields; `firstSeen` is the date of the oldest digest
 * that contains the ID. `added` is the explicit "Hinzugefügt" field or `firstSeen`.
 * @param {{file: string, digest: {entries: object[]}}[]} digests in any order
 * @returns {Map<string, {id: string, entry: object, file: string, firstSeen: Date, added: Date}>}
 */
export function mergeDigests(digests) {
  const byId = new Map();
  const oldestFirst = [...digests].sort((a, b) => a.file.localeCompare(b.file));
  for (const { file, digest } of oldestFirst) {
    for (const entry of digest.entries) {
      const known = byId.get(entry.id);
      byId.set(entry.id, {
        id: entry.id,
        entry,
        file,
        firstSeen: known ? known.firstSeen : digestDate(file),
      });
    }
  }
  for (const record of byId.values()) record.added = record.entry.added || record.firstSeen;
  return byId;
}

/** Days until the deadline (negative = expired), or null for text-only deadlines. */
export function daysLeft(entry, today = startOfToday()) {
  if (!entry.deadline) return null;
  return Math.round((entry.deadline - today) / 86400000);
}

export function isExpired(entry, today = startOfToday()) {
  const days = daysLeft(entry, today);
  return days !== null && days < 0;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export const FILTERS = ['passt', 'offen', 'passt nicht', 'alle', 'favoriten'];

/** Does a record match a filter? `rating` and `favorite` are looked up by the caller. */
export function matchesFilter(filter, { rating, favorite }) {
  switch (filter) {
    case 'passt': return rating?.verdict === 'passt';
    case 'passt nicht': return rating?.verdict === 'passt nicht';
    case 'offen': return !rating;
    case 'favoriten': return favorite;
    default: return true;
  }
}

/**
 * Sort records in place.
 * - deadline: dated (soonest first), then text-only ("laufend"), then expired
 * - score: highest first
 * - added: newest first ("seit")
 * - number: order in the digest
 * Ties fall back to the digest number, then the ID, so the order is stable.
 */
export function sortRecords(records, sort, today = startOfToday()) {
  const rank = (record) => {
    const days = daysLeft(record.entry, today);
    if (days === null) return [1, 0];
    return days < 0 ? [2, -days] : [0, days];
  };
  const tie = (a, b) => a.entry.number - b.entry.number || a.id.localeCompare(b.id);
  const comparators = {
    deadline: (a, b) => {
      const [ra, da] = rank(a);
      const [rb, db] = rank(b);
      return ra - rb || da - db || tie(a, b);
    },
    score: (a, b) => b.entry.score - a.entry.score || tie(a, b),
    added: (a, b) => (b.added?.getTime() ?? 0) - (a.added?.getTime() ?? 0) || tie(a, b),
    number: tie,
  };
  return records.sort(comparators[sort] || comparators.deadline);
}
