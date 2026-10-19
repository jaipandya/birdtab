/**
 * The bird's info popover: the English name under a name in another language.
 */

import { setupInfoPopover } from '../birdInfoPopover.js';

function showBird({ shown, english = 'Pied Avocet', guessHidden = false } = {}) {
  document.body.innerHTML = `
    <button class="info-popover-trigger" id="bird-name"
      data-scientific-name="Recurvirostra avosetta"
      data-english-name="${english}"
      data-description="Striking and essentially unmistakable."
      data-conservation="LC"
      data-species-code="pieavo1"
      data-ebird-url="https://ebird.org/species/pieavo1">${shown}</button>`;
  const trigger = document.getElementById('bird-name');
  if (guessHidden) trigger.classList.add('guess-hidden');
  setupInfoPopover();
  trigger.click();
  return document.querySelector('.info-popover');
}

describe('info popover: English name', () => {
  beforeEach(() => {
    chrome.i18n.getMessage = jest.fn(() => '');
  });

  afterEach(() => {
    // Close it so the next test opens a fresh one
    document.querySelector('.info-popover-backdrop')?.click();
    document.body.innerHTML = '';
  });

  test('a translated name gets the English one above the scientific name', () => {
    const popover = showBird({ shown: '反嘴鴴' });
    const english = popover.querySelector('.info-popover__english-name');
    expect(english.textContent).toBe('Pied Avocet');
    expect(english.getAttribute('lang')).toBe('en');
    expect(english.nextElementSibling.className).toBe('info-popover__scientific-name');
  });

  test('no second line when the shown name is the English one, whatever its case', () => {
    expect(showBird({ shown: 'Pied Avocet' }).querySelector('.info-popover__english-name')).toBeNull();
    document.querySelector('.info-popover-backdrop')?.click();
    expect(showBird({ shown: ' pied avocet ' }).querySelector('.info-popover__english-name')).toBeNull();
  });

  test('never while Guess the bird hides the name', () => {
    const popover = showBird({ shown: 'Who’s this bird?', guessHidden: true });
    expect(popover?.querySelector('.info-popover__english-name') ?? null).toBeNull();
  });

  test('nothing when the bird has no English name stored', () => {
    expect(showBird({ shown: '反嘴鴴', english: '' }).querySelector('.info-popover__english-name')).toBeNull();
  });
});
