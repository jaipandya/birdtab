/**
 * Commons fills a missing author field with "No machine-readable author
 * provided. <User> assumed (based on copyright claims)." Schema 1 manifests
 * (and any release built before the crawlers unwrapped it) still carry it.
 */
const ASSUMED_AUTHOR =
  /^No machine-readable author provided\.\s*(.+?)\s+assumed\s+\(based on copyright claims\)\.?$/i;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Some creator names arrive HTML-encoded from their source ("U.S. Fish &amp;
 * Wildlife Service", "O&#039;Donnell"). Credits are inserted as text, so
 * decode them back. Regex only: this runs in the background script too.
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text) {
  return text.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-f]+));/gi, (entity, named, dec, hex) => {
    if (named) return NAMED_ENTITIES[named.toLowerCase()];
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/**
 * Reduce a credit name to the person, as plain text: decodes HTML entities
 * and unwraps the Commons placeholder.
 * @param {string|null|undefined} name
 * @returns {string|null|undefined}
 */
export function cleanCreditName(name) {
  if (typeof name !== 'string') return name;
  name = decodeHtmlEntities(name);
  const match = name.trim().match(ASSUMED_AUTHOR);
  if (!match) return name;
  return match[1].replace(/~commonswiki$/i, '').trim() || null;
}

/**
 * Format a credit date for display: "May 23, 2007" for YYYY-MM-DD
 * (optionally followed by a time), "Mar 2022" for YYYY-MM and "2021" for
 * YYYY, the last two from the release's *Approx fields. Returns '' for
 * anything that isn't a real date, so the caller can leave the date out
 * instead of showing "Invalid Date".
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function formatCreditDate(value) {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?=$|[T\s])/.exec(String(value ?? '').trim());
  if (!match) return '';
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  if (year < 1800) return '';
  if (month === null) return String(year);
  const date = new Date(year, month - 1, day ?? 1);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || (day !== null && date.getDate() !== day)) {
    return '';
  }
  return day === null
    ? date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
