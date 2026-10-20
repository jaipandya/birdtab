/**
 * "BirdTab is your new tab page": the guide's check-in on how BirdTab opens (Chrome and Edge).
 *
 * People who miss their browser's own page often remove BirdTab in their first hour, before any
 * habit shows it. So the card comes once on day one (the tab after the bird-name tip), sooner if
 * they open Chrome's page from the Chrome Tab icon, and once more later if they keep doing so.
 *
 * Keeping things as they are is the main button (and what closing or ignoring the card means).
 * The other ways are a step away, each with what it does, and nothing changes until confirmed:
 *   check-in → other options → (pin BirdTab, for the way back to a bird) → saved, with Undo
 * "When I ask" waits for the pin, or for "Continue without pinning", which says the other way
 * back (typing "bird" in the address bar). "Show my shortcuts here" keeps BirdTab and adds the
 * most visited sites instead.
 */

import { track } from '../analytics.js';
import { IS_EDGE } from '../browserInfo.js';
import { setNewTabMode, isPinnedToToolbar, CHROME_TAB_NUDGE_AFTER } from '../newTabMode.js';
import { PUZZLE_PATH, PIN_PATH, EYE_PATH } from '../pinCoach.js';

const OFFERS_KEY = 'stepAsideOffer';
// The check-in is for a new install's first week
const FIRST_WEEK_DAYS = 7;
// At most: the check-in, and one second chance
const MAX_OFFERS = 2;
const PIN_POLL_MS = 1000;

const msg = (key, fallback, subs) => (subs ? chrome.i18n.getMessage(key, subs) : chrome.i18n.getMessage(key)) || fallback;

/** Whether it's time: see the header. */
export function newTabTipDue(ctx) {
  const { offers = 0, usesAtOffer = 0 } = ctx.local[OFFERS_KEY] || {};
  const uses = ctx.local.chromeTabUses || 0;
  if (offers >= MAX_OFFERS) return false;
  if (offers === 1) return uses - usesAtOffer >= CHROME_TAB_NUDGE_AFTER;
  const firstWeek = ctx.days < FIRST_WEEK_DAYS;
  return (firstWeek && (ctx.tabs >= 3 || uses >= 1)) || uses >= CHROME_TAB_NUDGE_AFTER;
}

/**
 * The card, view by view.
 * @param {Object} ctx - the guide's context (ctx.card is the open card once shown)
 * @param {(action: string) => void} done - records what the user chose
 */
export function newTabTipCard(ctx, done) {
  const MODES = {
    hourly: {
      name: msg('newTabModeHourly', 'Now and then'),
      help: msg('newTabModeHourlyHelp', 'A bird after an hour away. Chrome’s page the rest of the time.'),
      confirm: msg('tipConfirmHourly', 'Show Chrome’s page between birds'),
    },
    button: {
      name: msg('newTabModeButton', 'When I ask'),
      help: msg('newTabModeButtonHelp', 'Chrome’s page in new tabs. Click BirdTab’s button for a bird.'),
      confirm: msg('tipConfirmButton', 'Open Chrome’s page in new tabs'),
    },
  };
  let poll = 0;
  const stopPolling = () => clearInterval(poll);
  const show = (view) => {
    stopPolling();
    ctx.card.update(view);
  };

  const checkIn = () => ({
    title: msg('tipNewTabTitle', 'BirdTab is your new tab page'),
    text: msg('tipNewTabText', 'Every new tab brings a bird. You can change that anytime.'),
    actionsLayout: 'stacked',
    actions: [
      { label: msg('tipKeepEveryTab', 'Keep a bird on every tab'), kind: 'primary', onClick: () => done('kept') },
      { label: msg('tipOtherOptions', 'Other options'), kind: 'quiet', onClick: () => show(options()) },
    ],
  });

  const options = () => {
    const choices = [];
    if (ctx.actions.showShortcuts && !ctx.topSitesShown) {
      choices.push({
        label: msg('tipShortcuts', 'Show my shortcuts here'),
        help: msg('tipShortcutsHelp', 'Your most visited sites under the search box, with a bird.'),
        onClick: () => {
          done('shortcuts');
          ctx.actions.showShortcuts();
        },
      });
    }
    for (const mode of ['hourly', 'button']) {
      choices.push({ label: MODES[mode].name, help: MODES[mode].help, onClick: () => show(pin(mode)) });
    }
    return {
      title: msg('tipOptionsTitle', 'Other ways to use BirdTab'),
      text: msg('tipOptionsText', 'Nothing changes until you confirm.'),
      choices,
      actions: [{ label: msg('welcomeBack', 'Back'), kind: 'quiet', onClick: () => show(checkIn()) }],
    };
  };

  // Pin first: the toolbar button is the way back to a bird. Required for "When I ask" (or skipped
  // knowingly), suggested for "Now and then", where birds come back on their own.
  const pin = (mode, { pinned = ctx.pinned, skipped = false } = {}) => {
    const required = mode === 'button';
    const canConfirm = pinned !== false || !required || skipped;
    const actions = [];
    if (required && !pinned && !skipped) {
      actions.push({ label: msg('tipSkipPin', 'Continue without pinning'), kind: 'quiet', onClick: () => show(pin(mode, { pinned, skipped: true })) });
    } else {
      actions.push({ label: msg('welcomeBack', 'Back'), kind: 'quiet', onClick: () => show(options()) });
    }
    actions.push({ label: MODES[mode].confirm, kind: 'primary', disabled: !canConfirm, onClick: () => show(saved(mode)) });

    const view = {
      // Once pinned, the heading names the choice and the status line says it's pinned
      title: pinned ? MODES[mode].name : msg('tipPinTitle', 'First, pin BirdTab'),
      text: msg('tipPinText', 'Its button in the toolbar brings a bird whenever you want one.'),
      actions,
    };
    if (pinned === null) {
      // The browser can't say whether it's pinned: the steps, without waiting
      view.steps = pinSteps();
    } else if (!pinned) {
      view.steps = pinSteps();
      view.status = { text: msg('pinCoachWaiting', 'Waiting for the pin…') };
      if (skipped) view.note = msg('newTabModeKeyword', 'Or type bird, a space and a bird’s name in the address bar', ['bird']);
    } else {
      view.status = { text: msg('newTabModePinned', 'Pinned to your toolbar'), done: true };
    }
    // Turns into "Pinned" by itself the moment the button is on the toolbar
    if (pinned === false) {
      setTimeout(() => {
        poll = setInterval(async () => {
          if (await isPinnedToToolbar()) {
            ctx.pinned = true;
            track('tip_action', { tip: 'stepAside', action: 'pinned' });
            show(pin(mode, { pinned: true }));
          }
        }, PIN_POLL_MS);
      }, 0);
    }
    return view;
  };

  const pinSteps = () => [
    { text: msg('pinCoachStep1', 'Click the puzzle piece next to the address bar'), icon: PUZZLE_PATH },
    IS_EDGE
      ? { text: msg('pinCoachStep2Edge', 'Click the eye next to BirdTab to show it in the toolbar'), icon: EYE_PATH }
      : { text: msg('pinCoachStep2', 'Click the pin next to BirdTab'), icon: PIN_PATH },
  ];

  // Applied now; said in the card, with Undo
  const saved = (mode) => {
    setNewTabMode(mode);
    done(mode);
    return {
      title: msg('tipSaved', 'Saved'),
      text: `${MODES[mode].help} ${msg('tipChangeInSettings', 'You can change this anytime in Settings.')}`,
      actions: [
        { label: msg('tipUndo', 'Undo'), kind: 'quiet', onClick: () => {
          setNewTabMode('every');
          track('tip_action', { tip: 'stepAside', action: 'undo' });
        } },
        { label: msg('tipGotIt', 'Got it'), kind: 'primary' },
      ],
    };
  };

  return {
    ...checkIn(),
    onShown: () => {
      const { offers = 0 } = ctx.local[OFFERS_KEY] || {};
      chrome.storage.local.set({ [OFFERS_KEY]: { offers: offers + 1, usesAtOffer: ctx.local.chromeTabUses || 0 } });
    },
    cleanup: stopPolling,
  };
}

/**
 * After stepping aside, the first time BirdTab shows: which way it opens now, and where to change it.
 */
export function newTabReminderCard(ctx, done) {
  const mode = ctx.local.newTabMode;
  const name = mode === 'hourly' ? msg('newTabModeHourly', 'Now and then') : msg('newTabModeButton', 'When I ask');
  return {
    title: msg('tipReminderTitle', 'Here’s your bird'),
    text: msg('tipReminderText', `BirdTab opens: ${name}. You can change this anytime in Settings.`, [name]),
    actions: [
      { label: msg('openSettings', 'Open settings'), kind: 'quiet', onClick: () => { done('settings'); ctx.actions.openSettings?.(); } },
      { label: msg('tipGotIt', 'Got it'), kind: 'primary', onClick: () => done('got_it') },
    ],
  };
}
