import { isTourActive } from '../featureTour.js';

// Focus inside these keeps its own keys (typing, select type-ahead, menu and
// dialog navigation)
const KEY_OWNING_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="menu"]',
  '[role="dialog"]',
  '[role="listbox"]',
].join(', ');

/**
 * Whether a page-wide shortcut (arrow-key volume, "q" for the quiz) should
 * leave this keydown alone: a modifier is held, focus is in a control that
 * uses the key itself, the feature tour is running, or a sidebar is open.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
export function shouldIgnoreGlobalShortcut(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  if (e.target instanceof Element && e.target.closest(KEY_OWNING_SELECTOR)) return true;
  if (isTourActive()) return true;
  if (document.querySelector('.settings-sidebar.open')) return true;
  return false;
}
