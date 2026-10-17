/**
 * Pin coach (Chrome, with CONFIG.FEATURES.newTabMode)
 *
 * When BirdTab steps aside for Chrome's own new tab page, its toolbar button is
 * the way back, so it should be pinned. Chrome doesn't let an extension pin
 * itself; this walks the user through it. An arrow points up at the puzzle-piece
 * button beside the address bar, a small copy of Chrome's extensions menu shows
 * where the pin is, and the coach watches chrome.action.getUserSettings() so it
 * turns into "Pinned!" the moment the button is on the toolbar.
 */

import { isPinnedToToolbar } from './newTabMode.js';
import { trackFeature } from './analytics.js';
import { html, setHtml } from './utils/html.js';
import { IS_EDGE } from './browserInfo.js';

const POLL_MS = 1000;

// Chrome's own icons, drawn the way its toolbar shows them
const PUZZLE_PATH = 'M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z';
const PIN_PATH = 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z';
// Edge's extensions menu has an eye ("Show in toolbar") where Chrome has a pin
const EYE_PATH = 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z';

let openCoach = null;

const msg = (key, fallback) => chrome.i18n.getMessage(key) || fallback;

/**
 * Show the coach, unless BirdTab is already pinned (or Chrome can't say).
 * @param {Object} [options]
 * @param {'steps'|'done'} [options.preview] - debug: show that state whatever the pin says
 * @returns {Promise<boolean>} whether it opened
 */
export async function showPinCoach({ preview = null } = {}) {
  if (openCoach) return true;
  const pinned = preview ? preview === 'done' : await isPinnedToToolbar();
  if (!preview && (pinned === null || pinned)) return false;

  const coach = document.createElement('div');
  coach.className = 'pin-coach';
  coach.setAttribute('role', 'dialog');
  coach.setAttribute('aria-modal', 'true');
  coach.setAttribute('aria-labelledby', 'pin-coach-title');
  setHtml(coach, html`
    <svg class="pin-coach-arrow" viewBox="0 0 220 180" aria-hidden="true">
      <path class="pin-coach-arrow-line" d="M20 170 C 40 90, 120 70, 196 14" />
      <path class="pin-coach-arrow-head" d="M178 10 L198 12 L192 32" />
    </svg>
    <div class="pin-coach-card">
      <div class="pin-coach-steps-view">
        <p class="pin-coach-eyebrow">${msg('pinCoachEyebrow', 'One quick step')}</p>
        <h2 class="pin-coach-title" id="pin-coach-title">${msg('pinCoachTitle', 'Pin BirdTab to your toolbar')}</h2>

        <div class="pin-coach-mock" aria-hidden="true">
          <div class="pin-mock-toolbar">
            <span class="pin-mock-omnibox"></span>
            <span class="pin-mock-button pin-mock-puzzle">
              <svg viewBox="0 0 24 24"><path d="${PUZZLE_PATH}" /></svg>
            </span>
            <span class="pin-mock-avatar"></span>
            <span class="pin-mock-dots"><i></i><i></i><i></i></span>
          </div>
          <div class="pin-mock-menu">
            <p class="pin-mock-menu-title">${msg('pinCoachExtensions', 'Extensions')}</p>
            <div class="pin-mock-row">
              <img src="icons/icon32.png" alt="" width="16" height="16">
              <span class="pin-mock-name">BirdTab</span>
              <span class="pin-mock-pin">
                <svg viewBox="0 0 24 24"><path d="${IS_EDGE ? EYE_PATH : PIN_PATH}" /></svg>
              </span>
            </div>
          </div>
        </div>

        <ol class="pin-coach-steps">
          <li><span class="pin-step-number">1</span><span>${msg('pinCoachStep1', 'Click the puzzle piece next to the address bar')}</span></li>
          <li><span class="pin-step-number">2</span><span>${IS_EDGE
            ? msg('pinCoachStep2Edge', 'Click the eye next to BirdTab to show it in the toolbar')
            : msg('pinCoachStep2', 'Click the pin next to BirdTab')}</span></li>
        </ol>
        <p class="pin-coach-waiting" aria-live="polite"><span class="pin-coach-spinner"></span>${msg('pinCoachWaiting', 'Waiting for the pin…')}</p>
        <button type="button" class="pin-coach-later">${msg('pinCoachLater', 'Maybe later')}</button>
      </div>

      <div class="pin-coach-done-view" hidden>
        <span class="pin-coach-check" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        <h2 class="pin-coach-title">${msg('pinCoachDoneTitle', 'Pinned!')}</h2>
        <p class="pin-coach-text">${msg('pinCoachDoneText', 'Click the BirdTab button whenever you want a bird.')}</p>
        <button type="button" class="pin-coach-done">${msg('pinCoachDone', 'Done')}</button>
      </div>
    </div>
  `);
  document.body.appendChild(coach);
  trackFeature('pin_coach_shown');

  let poll = 0;
  const close = () => {
    clearInterval(poll);
    document.removeEventListener('keydown', onKey, true);
    coach.classList.add('closing');
    setTimeout(() => coach.remove(), 250);
    openCoach = null;
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const showDone = () => {
    clearInterval(poll);
    coach.classList.add('pinned');
    coach.querySelector('.pin-coach-steps-view').hidden = true;
    coach.querySelector('.pin-coach-done-view').hidden = false;
    coach.querySelector('.pin-coach-done').focus();
    trackFeature('pin_coach_pinned');
  };

  document.addEventListener('keydown', onKey, true);
  coach.addEventListener('click', (e) => {
    if (e.target === coach) close();
  });
  coach.querySelector('.pin-coach-later').addEventListener('click', () => {
    trackFeature('pin_coach_later');
    close();
  });
  coach.querySelector('.pin-coach-done').addEventListener('click', close);
  coach.querySelector('.pin-coach-later').focus();

  if (pinned) {
    showDone();
  } else if (!preview) {
    poll = setInterval(async () => {
      if (await isPinnedToToolbar()) showDone();
    }, POLL_MS);
  }
  openCoach = coach;
  return true;
}
