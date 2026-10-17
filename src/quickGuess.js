/**
 * "Guess the bird" (Chrome, CONFIG.FEATURES.quickGuess, off by default)
 *
 * Every new tab becomes a one-second quiz: the name is hidden until it's clicked.
 * The first click reveals it; after that the name opens the info popover as usual.
 */

import CONFIG from './config.js';
import { trackFeature } from './analytics.js';

export async function isQuickGuessOn() {
  if (!CONFIG.FEATURES.quickGuess) return false;
  const { quickGuess = false } = await chrome.storage.local.get(['quickGuess']);
  return quickGuess === true;
}

/**
 * Hide the bird's name behind a prompt until it's clicked.
 * @param {HTMLButtonElement} nameButton - #bird-name, already holding the name
 */
export function applyQuickGuess(nameButton) {
  if (!nameButton) return;
  const name = nameButton.textContent;
  const prompt = chrome.i18n.getMessage('quickGuessPrompt') || 'Who’s this bird?';
  const panel = nameButton.closest('.info-panel');

  nameButton.textContent = prompt;
  nameButton.classList.add('guess-hidden');
  nameButton.setAttribute('aria-label', chrome.i18n.getMessage('quickGuessReveal') || 'Reveal the bird’s name');
  panel?.classList.add('guess-mode');

  // Capture on the header, so the first click never reaches the popover's handler
  const header = nameButton.closest('.info-panel-header') || nameButton.parentElement;
  const reveal = (e) => {
    if (!e.target.closest('#bird-name')) return;
    e.preventDefault();
    e.stopPropagation();
    nameButton.textContent = name;
    nameButton.classList.remove('guess-hidden');
    nameButton.classList.add('guess-revealed');
    nameButton.removeAttribute('aria-label');
    panel?.classList.remove('guess-mode');
    header.removeEventListener('click', reveal, true);
    trackFeature('quick_guess_reveal');
  };
  header.addEventListener('click', reveal, true);
}
