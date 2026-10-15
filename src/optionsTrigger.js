/**
 * Options Trigger Button Component
 * Provides the 3-dot options trigger icon used for various UI elements
 */

import { trustedHtml } from './utils/html.js';

/**
 * SVG markup for the 3-dot options icon (horizontal ellipsis)
 * @constant {SafeHtml}
 */
const OPTIONS_TRIGGER_SVG = trustedHtml(`
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
    <circle cx="4" cy="10" r="2"/>
    <circle cx="10" cy="10" r="2"/>
    <circle cx="16" cy="10" r="2"/>
  </svg>
`);

/**
 * Get the SVG markup for the 3-dot options icon
 * @returns {SafeHtml} SVG markup (see utils/html.js)
 */
export function getOptionsTriggerSvg() {
  return OPTIONS_TRIGGER_SVG;
}
