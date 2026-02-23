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
