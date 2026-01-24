/**
 * Close Trigger Button Component
 * Provides the X close icon used for hide/dismiss functionality
 */

/**
 * SVG markup for the X close icon
 * @constant {string}
 */
const CLOSE_TRIGGER_SVG = `
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
`;

/**
 * Get the SVG markup for the X close icon
 * @returns {string} SVG markup
 */
export function getCloseTriggerSvg() {
  return CLOSE_TRIGGER_SVG;
}
