/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} unsafe - Untrusted string
 * @returns {string} Escaped string safe for insertion into HTML
 */
export function escapeHtml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitise a contributor name for display. Strips embedded URLs and
 * truncates to the first {@link maxWords} words when the raw value is
 * excessively long (e.g. Freesound attribution strings).
 *
 * @param {string} name - Raw contributor name
 * @param {number} [maxWords=4]
 * @returns {string} Cleaned, possibly truncated name (NOT HTML-escaped)
 */
export function truncateName(name, maxWords = 4) {
  if (name == null) return '';
  const cleaned = String(name)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length <= maxWords) return cleaned;
  return words.slice(0, maxWords).join(' ') + '\u2026';
}
