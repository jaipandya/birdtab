/**
 * Commons fills a missing author field with "No machine-readable author
 * provided. <User> assumed (based on copyright claims)." Schema 1 manifests
 * (and any release built before the crawlers unwrapped it) still carry it.
 */
const ASSUMED_AUTHOR =
  /^No machine-readable author provided\.\s*(.+?)\s+assumed\s+\(based on copyright claims\)\.?$/i;

/**
 * Reduce a credit name to the person. Returns the input unchanged when it
 * isn't the Commons placeholder.
 * @param {string|null|undefined} name
 * @returns {string|null|undefined}
 */
export function cleanCreditName(name) {
  if (typeof name !== 'string') return name;
  const match = name.trim().match(ASSUMED_AUTHOR);
  if (!match) return name;
  return match[1].replace(/~commonswiki$/i, '').trim() || null;
}

/**
 * Format a credit date (YYYY-MM-DD, optionally followed by a time) as
 * "May 23, 2007". Returns '' for anything that isn't a real date, so the
 * caller can leave the date out instead of showing "Invalid Date".
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function formatCreditDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(String(value ?? '').trim());
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    year < 1800 ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return '';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
