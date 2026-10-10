// Central configuration. Change tags and settings here, nowhere else.

// Reason tags offered after a verdict. Order = display order.
export const REASON_TAGS = {
  'passt': ['Thema', 'Ort', 'Tätigkeit', 'Organisation', 'Geld', 'Timing'],
  'passt nicht': ['zu früh', 'zu spät', 'unbezahlt', 'zu lang', 'zu kurz', 'Ort', 'Thema', 'Tätigkeit', 'Anforderungen'],
};

// Deadlines within this many days get highlighted.
export const DEADLINE_WARNING_DAYS = 14;

// Horizontal swipe distance (px) that counts as a verdict.
export const SWIPE_THRESHOLD = 90;

// Where the content lives, relative to index.html.
export const CONTENT_BASE = 'content/';
export const DIGEST_DIR = 'content/digests/';
export const MANIFEST = 'content/digests.json';

// Read-only pages shown in the navigation. Missing files are hidden automatically
// (e.g. profil.md is not committed, so it only shows up locally).
export const PAGES = [
  { slug: 'fristen', file: 'fristen.md', label: 'Fristen' },
  { slug: 'programme', file: 'programme.md', label: 'Programme' },
  { slug: 'profil', file: 'profil.md', label: 'Profil' },
];
