/**
 * Close Trigger Button Component
 * Provides the X close icon used for hide/dismiss functionality
 */

import { trustedHtml } from './utils/html.js';

/**
 * SVG markup for the X close icon
 * @constant {SafeHtml}
 */
const CLOSE_TRIGGER_SVG = trustedHtml(`
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
`);

/**
 * Get the SVG markup for the X close icon
 * @returns {SafeHtml} SVG markup (see utils/html.js)
 */
export function getCloseTriggerSvg() {
  return CLOSE_TRIGGER_SVG;
}
