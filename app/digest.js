// Parsing of digest files and the rating line. The markdown format is a contract
// (see AGENTS.md): read it, never change it.

const ENTRY_HEADING = /^## (\d+)\. (.+) · Score (\d)\s*$/;
const H2 = /^## /;
const FIELD = /^- \*\*([^*]+):\*\*\s?(.*)$/;

const FIELD_KEYS = {
  'ID': 'id',
  'Titel': 'title',
  'Organisation': 'organisation',
  'Ort': 'location',
  'Format': 'format',
  'Dauer': 'duration',
  'Start': 'start',
  'Bezahlung': 'pay',
  'Frist': 'deadline',
  'Begründung': 'reasoning',
  'Link': 'link',
  'Hinzugefügt': 'added',
  'Marla': 'rating',
};

/**
 * Split a digest into intro, entries and trailing free-text sections.
 * @param {string} markdown
 */
export function parseDigest(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const intro = [];
  const entries = [];
  const sections = [];
  let current = null; // { type: 'entry' | 'section', ... }

  for (const line of lines) {
    if (H2.test(line)) {
      const match = line.match(ENTRY_HEADING);
      current = match
        ? { type: 'entry', number: Number(match[1]), heading: match[2].trim(), score: Number(match[3]), fields: {}, extra: [] }
        : { type: 'section', lines: [line] };
      (match ? entries : sections).push(current);
      continue;
    }
    if (!current) {
      intro.push(line);
    } else if (current.type === 'section') {
      current.lines.push(line);
    } else {
      const field = line.match(FIELD);
      if (field && FIELD_KEYS[field[1].trim()]) {
        current.fields[FIELD_KEYS[field[1].trim()]] = field[2].trim();
      } else if (line.trim() && line.trim() !== '---') {
        current.extra.push(line);
      }
    }
  }

  return {
    intro: stripTrailingRule(intro.join('\n')),
    entries: entries.map(toEntry).filter((entry) => entry.id),
    sections: sections.map((section) => stripTrailingRule(section.lines.join('\n'))),
  };
}

function toEntry(raw) {
  const f = raw.fields;
  return {
    number: raw.number,
    heading: raw.heading,
    score: raw.score,
    id: stripInline(f.id || ''),
    title: f.title || '',
    organisation: f.organisation || '',
    location: f.location || '',
    format: f.format || '',
    duration: f.duration || '',
    start: f.start || '',
    pay: f.pay || '',
    deadlineText: stripInline(f.deadline || ''),
    deadline: parseGermanDate(stripInline(f.deadline || '')),
    reasoning: f.reasoning || '',
    link: stripInline(f.link || ''),
    added: parseGermanDate(stripInline(f.added || '')), // optional, otherwise the digest date applies
    extra: raw.extra.join('\n'),
    fileRating: parseRating(f.rating || ''),
  };
}

function stripTrailingRule(text) {
  return text.replace(/\n\s*---\s*$/m, '').trim();
}

/** Remove inline markdown (bold, italics, code) for plain-text use. */
export function stripInline(text) {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1$2')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

/**
 * Parse a deadline that starts with a German date (1.1.2027, 27.10.2026, ...).
 * Text-only deadlines ("laufend") return null: no deadline logic for those.
 */
export function parseGermanDate(text) {
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (!match) return null;
  const [, d, m, y] = match.map(Number);
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 ? date : null;
}

/**
 * Parse the value of a "Marla:" line.
 * "passt / passt nicht · Grund:" (the empty template) returns null.
 * @returns {{verdict: string, tags: string[], comment: string} | null}
 */
export function parseRating(value) {
  const text = stripInline(value);
  const match = text.match(/^(passt nicht|passt)(?!\s*\/)(.*)$/);
  if (!match) return null;
  const rest = match[2];
  const reason = rest.match(/·\s*Grund:\s*(.*?)\s*(?=·\s*Kommentar:|$)/);
  const comment = rest.match(/·\s*Kommentar:\s*(.*)$/);
  return {
    verdict: match[1],
    tags: reason ? reason[1].split(',').map((t) => t.trim()).filter(Boolean) : [],
    comment: comment ? comment[1].trim() : '',
  };
}

/** Format a rating exactly as the "Marla:" line in the digest. */
export function formatRating({ verdict, tags, comment }) {
  // "·" separates the parts, so it must not appear inside them.
  const clean = (s) => s.replace(/\s*·\s*/g, ', ').replace(/\s+/g, ' ').trim();
  let line = `- **Marla:** ${verdict} · Grund: ${tags.map(clean).join(', ')}`;
  if (comment && clean(comment)) line += ` · Kommentar: ${clean(comment)}`;
  return line;
}

/** Stable string form of a rating, used to detect changes in the markdown file. */
export function ratingKey(rating) {
  return rating ? formatRating(rating) : '';
}
