/**
 * The guide: BirdTab teaching itself, one tip at a time, after the welcome (welcome/welcome.js).
 *
 * Every tip, notice and offer the page has goes through here, so only one thing ever asks for
 * attention: at most one tip on a tab, and none until PACE_TABS tabs and PACE_MS have passed since
 * the last (an offer the user asked for by their actions, `urgent`, only waits for the next tab).
 * A tip is learned once the feature is used, with or without the tip: opening a bird's details
 * learns "birdName" as surely as the tip's own button does. One shown IMPRESSIONS times without
 * an answer isn't shown again. Nothing shows on a tab that failed to load, offline, or while
 * something else (settings, the quiz, a popover) is open.
 *
 * State: learned tips in sync storage (seenFeatures, shared with the old feature tour's
 * spotlights, so what's learned on one computer is learned on all); the pacing in local storage
 * (guideState). Older flags count as learned (see learnedBefore), so nothing needs migrating.
 */

import './guide.css';
import CONFIG from '../config.js';
import { log } from '../logger.js';
import { track, trackFeature, trackReviewPromptAction, trackReviewPromptShown } from '../analytics.js';
import { IS_EDGE, IS_FIREFOX } from '../browserInfo.js';
import { showTipCard, isTipCardOpen, closeTipCard } from './tipCard.js';
import { showSeenMilestone } from '../seenBirds.js';
import { isPinnedToToolbar } from '../newTabMode.js';
import { newTabTipDue, newTabTipCard, newTabReminderCard } from './newTabTip.js';
import { reviewPromptDue, reviewStoreUrl } from '../reviewPrompt.js';

const STATE_KEY = 'guideState';
// Between two tips: this many tabs and this long
export const PACE_TABS = 4;
export const PACE_MS = 2 * 60 * 60 * 1000;
// A tip ignored this many times isn't shown again
export const IMPRESSIONS = 2;
// After the bird appears, before a tip does
const SHOW_DELAY_MS = 1600;
const DAY = 24 * 60 * 60 * 1000;

const msg = (key, fallback) => chrome.i18n.getMessage(key) || fallback;

/** Chrome itself, not Edge, Brave or Opera (Chrome's footer note is about Chrome's own page). */
function isGoogleChrome() {
  if (IS_EDGE || IS_FIREFOX) return false;
  const ua = navigator.userAgent;
  return /Chrome/.test(ua) && /Google Inc/.test(navigator.vendor) && !/Edg|OPR/.test(ua) && navigator.brave === undefined;
}

/** On the page, shown, and not tucked away (low-distraction mode, Guess the bird's hidden name). */
function visibleTarget(selector) {
  const el = document.querySelector(selector);
  if (!el || !el.getClientRects().length) return null;
  if (el.closest('.low-distraction-hidden, .hidden') || el.classList.contains('guess-hidden')) return null;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0) return null;
  return el;
}

// ── The tips, most important first ──
// eligible(ctx): whether it's time; learnedBefore(ctx): learned by state the guide doesn't own;
// card(ctx, done): what the card says and does (`done()` marks it learned).
export const TIPS = [
  {
    // "BirdTab is your new tab page": keep it (the main answer), or another way, a step away
    // and confirmed, with the toolbar button pinned first (newTabTip.js). Chrome and Edge.
    id: 'stepAside',
    urgent: true,
    repeats: true,
    available: () => CONFIG.FEATURES.newTabMode,
    // Answered by the old offer, or already stepping aside
    eligible: (ctx) => ctx.local.stepAsideOfferDismissed !== true && (ctx.local.newTabMode || 'every') === 'every'
      && newTabTipDue(ctx),
    target: () => visibleTarget('#chrome-tab-link .chrome-tab-icon') || visibleTarget('#chrome-tab-link'),
    card: newTabTipCard,
  },
  {
    // The first BirdTab after stepping aside: how it opens now, and where to change it
    id: 'newTabReminder',
    urgent: true,
    available: () => CONFIG.FEATURES.newTabMode,
    // Only after stepping aside from the tip (a choice made in Settings needs no reminder)
    eligible: (ctx) => (ctx.local.newTabMode || 'every') !== 'every' && (ctx.local.stepAsideOffer?.offers || 0) > 0,
    card: newTabReminderCard,
  },
  {
    // The bird's name opens its story: facts, conservation status, the map
    id: 'birdName',
    learnedBefore: (ctx) => (ctx.sync.featureTourVersion || 0) >= 4,
    eligible: (ctx) => ctx.tabs >= 2,
    target: () => visibleTarget('#bird-name'),
    card: (ctx, done, target) => ({
      title: msg('tipBirdNameTitle', 'There’s more to every bird'),
      text: msg('tipBirdNameText', 'Click its name for facts, its conservation status and a map of where it lives.'),
      actions: [
        { label: msg('tipShowMe', 'Show me'), kind: 'primary', onClick: () => { done('used'); setTimeout(() => target.click(), 0); } },
      ],
    }),
  },
  {
    // Chrome's own footer under the page isn't BirdTab's, and can be hidden
    id: 'chromeFooter',
    available: () => isGoogleChrome(),
    learnedBefore: (ctx) => ctx.local.chromeFooterNotificationDismissed === true,
    eligible: (ctx) => ctx.tabs >= 3,
    placement: 'bottom-edge',
    card: (ctx, done) => ({
      title: msg('chromeFooterTitle', 'Seeing a bar at the bottom?'),
      text: msg('chromeFooterDescription', 'That’s Chrome’s new footer. To hide it, right-click it and choose “Hide footer on New Tab page”.'),
      image: 'images/chrome-footer.jpg',
      actions: [
        { label: msg('chromeFooterLearnMore', 'Learn more'), kind: 'quiet', href: 'https://support.google.com/chrome/answer/11032183#zippy=%2Cturn-new-tab-page-footer-on-or-off', onClick: () => done('learn_more') },
        { label: msg('tipGotIt', 'Got it'), kind: 'primary', onClick: () => done('got_it') },
      ],
      onDismiss: () => chrome.storage.local.set({ chromeFooterNotificationDismissed: true }),
    }),
  },
  {
    // The first milestone: every bird met is in Your Birds
    id: 'yourBirds',
    available: () => CONFIG.FEATURES.yourBirds,
    eligible: (ctx) => ctx.seen >= 10,
    target: () => visibleTarget('#settings-button'),
    card: (ctx, done) => ({
      title: msg('tipYourBirdsTitle', 'Every bird you’ve met'),
      text: msg('tipYourBirdsText', 'They’re all in Your Birds, with their photos and songs. It’s in this menu.'),
      actions: [
        { label: msg('tipOpenYourBirds', 'Open Your Birds'), kind: 'primary', onClick: () => { done('used'); ctx.actions.openYourBirds?.(); } },
      ],
    }),
  },
  {
    // The heart keeps a bird
    id: 'favorite',
    available: () => CONFIG.FEATURES.favorites,
    learnedBefore: (ctx) => (ctx.sync.favoriteSpecies || []).length > 0,
    eligible: (ctx) => ctx.tabs >= 5 && ctx.seen >= 6,
    target: () => visibleTarget('#favorite-button'),
    // The heart is under the bird's name: the card goes above the name, not over it
    avoid: '.info-panel-header',
    card: (ctx, done, target) => ({
      title: msg('tipFavoriteTitle', 'Keep the ones you love'),
      text: msg('tipFavoriteText', 'The heart adds this bird to your favorites, kept in Your Birds.'),
      actions: [
        { label: msg('favoriteAdd', 'Add to favorites'), kind: 'primary', onClick: () => { done('used'); setTimeout(() => target.click(), 0); } },
      ],
    }),
  },
  {
    // Chrome's own new tab page is a click away (Chrome and Edge)
    id: 'chromeTab',
    available: () => CONFIG.FEATURES.newTabMode,
    // The feature tour showed this icon from version 2
    learnedBefore: (ctx) => (ctx.local.chromeTabUses || 0) > 0 || ctx.local.chromeTabEnabled === false
      || (ctx.sync.featureTourVersion || 0) >= 2,
    eligible: (ctx) => ctx.tabs >= 8 && ctx.days >= 1,
    target: () => visibleTarget('#chrome-tab-link .chrome-tab-icon') || visibleTarget('#chrome-tab-link'),
    card: (ctx, done) => ({
      title: msg('tipChromeTabTitle', 'Chrome’s new tab page, one click away'),
      text: msg('tipChromeTabText', 'This opens Chrome’s own new tab page whenever you need it.'),
      actions: [{ label: msg('tipGotIt', 'Got it'), kind: 'primary', onClick: () => done('got_it') }],
    }),
  },
  {
    // Test yourself: the quiz, or every tab a guess
    id: 'quiz',
    learnedBefore: (ctx) => ctx.local.quickGuess === true,
    eligible: (ctx) => ctx.seen >= 20 && ctx.days >= 2,
    target: () => visibleTarget('#settings-button'),
    card: (ctx, done) => {
      const actions = [
        { label: msg('tipTakeQuiz', 'Take the quiz'), kind: 'primary', onClick: () => { done('quiz'); ctx.actions.startQuiz?.(); } },
      ];
      if (CONFIG.FEATURES.quickGuess) {
        actions.push({
          label: msg('tipGuessEachTab', 'Guess on each tab'),
          kind: 'secondary',
          onClick: () => {
            chrome.storage.local.set({ quickGuess: true });
            trackFeature('quick_guess_on', { source: 'tip' });
            done('quick_guess');
            ctx.card.update({
              title: msg('tipSaved', 'Saved'),
              text: msg('tipGuessOn', 'Done. From your next tab, each bird’s name stays hidden until you click it.'),
              actions: [{ label: msg('tipGotIt', 'Got it'), kind: 'primary' }],
            });
          },
        });
      }
      return {
        title: msg('tipQuizTitle', 'How many can you name?'),
        text: CONFIG.FEATURES.quickGuess
          ? msg('tipQuizText', 'Take a quiz on birds you’ve met, or hide each new bird’s name until you guess it.')
          : msg('tipQuizTextNoGuess', 'Take a quiz on the birds you’ve met.'),
        actions,
      };
    },
  },
  {
    // A while in: would they rate BirdTab?
    id: 'review',
    repeats: true,
    eligible: (ctx) => ctx.reviewDue,
    card: (ctx) => {
      const days = ctx.days;
      const answer = (action, storage) => () => {
        chrome.storage.local.set(storage);
        trackReviewPromptAction(action, days);
      };
      return {
        title: msg('reviewPromptTitle', 'Enjoying BirdTab?'),
        text: msg('reviewPromptMessage', 'A short review helps other bird lovers find it.'),
        actionsLayout: 'stacked',
        actions: [
          { label: msg('leaveReview', 'Leave a review'), kind: 'primary', onClick: () => {
            answer('left_review', { reviewLeft: true })();
            chrome.tabs.create({ url: reviewStoreUrl() });
          } },
          { label: msg('maybeLater', 'Maybe later'), kind: 'quiet', onClick: answer('maybe_later', { lastReviewPrompt: Date.now() }) },
          { label: msg('noThanks', 'No thanks'), kind: 'quiet', onClick: answer('dismissed', { reviewDismissed: true }) },
        ],
        onShown: () => {
          // Not answering counts as "maybe later"
          chrome.storage.local.set({ lastReviewPrompt: Date.now() });
          trackReviewPromptShown(days, ctx.local.newTabCount);
        },
        onDismiss: answer('maybe_later', { lastReviewPrompt: Date.now() }),
      };
    },
  },
];

export const TIP_IDS = TIPS.map(t => t.id);

// ── Learned tips (sync storage) ──

let learnedCache = null;

async function readLearned() {
  if (learnedCache) return learnedCache;
  try {
    const { seenFeatures = {} } = await chrome.storage.sync.get(['seenFeatures']);
    learnedCache = { ...seenFeatures };
  } catch {
    learnedCache = {};
  }
  return learnedCache;
}

/** Note that a feature has been used, so its tip isn't needed (one sync write the first time). */
export async function markLearned(id) {
  const learned = await readLearned();
  if (learned[id]) return;
  learned[id] = true;
  try {
    await chrome.storage.sync.set({ seenFeatures: { ...learned } });
  } catch (error) {
    log(`Couldn't save the learned tip ${id}: ${error.message}`);
  }
}

// ── Choosing ──

const freshState = () => ({ tabs: 0, lastShownAt: 0, lastShownTab: null, shown: {} });

/**
 * A new install starts the guide when the welcome ends (startGuide). No state at all means
 * BirdTab was already in use before the guide existed: its tips wait PACE_TABS tabs and PACE_MS,
 * as if one had just been shown, so an update never greets anyone with a tip.
 */
async function readState() {
  const { [STATE_KEY]: state } = await chrome.storage.local.get([STATE_KEY]);
  if (state) return { ...freshState(), ...state };
  return { ...freshState(), lastShownTab: 0, lastShownAt: Date.now() };
}

/** The welcome is done: tips start from the next tab (the bird's name on the second). */
export async function startGuide() {
  await chrome.storage.local.set({ [STATE_KEY]: freshState() });
}

async function context(state, extra = {}) {
  const local = await chrome.storage.local.get([
    'installTime', 'newTabCount', 'chromeTabUses', 'chromeTabEnabled', 'newTabMode', 'stepAsideOfferDismissed',
    'chromeFooterNotificationDismissed', 'quickGuess', 'seenBirdsCount', 'stepAsideOffer', 'quickAccessEnabled', 'hideTopSites',
  ]);
  const sync = await chrome.storage.sync.get(['featureTourVersion', 'favoriteSpecies']).catch(() => ({}));
  const installTime = local.installTime || Date.now();
  return {
    tabs: state.tabs,
    seen: local.seenBirdsCount || 0,
    days: Math.floor((Date.now() - installTime) / DAY),
    reviewDue: await reviewPromptDue(),
    // Whether BirdTab's toolbar button is pinned (null where the browser can't say)
    pinned: CONFIG.FEATURES.newTabMode ? await isPinnedToToolbar() : null,
    topSitesShown: local.quickAccessEnabled !== false && local.hideTopSites === false,
    local,
    sync,
    learned: await readLearned(),
    ...extra,
  };
}

/**
 * The tips that could show now, most important first: available on this browser, not learned,
 * not ignored too often, and due.
 */
export function pickTips(ctx, state, now = Date.now()) {
  const paced = state.lastShownTab === null
    || (ctx.tabs - state.lastShownTab >= PACE_TABS && now - state.lastShownAt >= PACE_MS);
  const sinceLast = state.lastShownTab === null || ctx.tabs > state.lastShownTab;
  return TIPS.filter(tip => {
    if (tip.available && !tip.available()) return false;
    if (!tip.repeats && (ctx.learned[tip.id] || tip.learnedBefore?.(ctx))) return false;
    if (!tip.repeats && (state.shown[tip.id] || 0) >= IMPRESSIONS) return false;
    if (!(tip.urgent ? sinceLast : paced)) return false;
    return tip.eligible(ctx);
  });
}

let actions = {};
let pageCanShow = () => true;

/**
 * @param {Object} options
 * @param {{ openYourBirds?: Function, startQuiz?: Function, showShortcuts?: Function, openSettings?: Function }} options.actions
 *   - what tips' buttons do
 * @param {() => boolean} options.canShow - false while the page is busy (quiz, settings, error)
 */
export function initGuide(options = {}) {
  actions = options.actions || {};
  pageCanShow = options.canShow || (() => true);
}

function pageIsFree() {
  if (document.visibilityState !== 'visible' || isTipCardOpen() || !pageCanShow()) return false;
  return !document.querySelector('.settings-panel.open, .info-popover, .options-menu-visible, .quiz-mode, .welcome, .pin-coach, .confirmation-dialog, .error-modal:not(.hidden)');
}

/** Once the tab is in front (a tab opened in the background waits until it's looked at). */
function whenVisible() {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise(resolve => {
    const onChange = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

async function present(tip, ctx, state, { force = false } = {}) {
  const target = tip.target ? tip.target() : null;
  if (tip.target && !target) return false;

  let finished = false;
  const done = (action) => {
    if (finished) return;
    finished = true;
    if (!tip.repeats) markLearned(tip.id);
    track('tip_action', { tip: tip.id, action });
  };
  const content = tip.card(ctx, done, target);

  if (!force) {
    state.shown[tip.id] = (state.shown[tip.id] || 0) + 1;
    state.lastShownAt = Date.now();
    state.lastShownTab = state.tabs;
    await chrome.storage.local.set({ [STATE_KEY]: state });
  }

  ctx.card = showTipCard({
    id: tip.id,
    target,
    placement: tip.placement || (target ? 'auto' : 'corner'),
    avoid: tip.avoid,
    ...content,
    onClose: (reason) => {
      content.cleanup?.();
      if (finished || reason === 'replaced') return;
      if (reason === 'action') {
        // The button did its own bookkeeping (the review's answers)
        finished = true;
        return;
      }
      if (reason === 'target') {
        // They used the thing itself: learned (the review has no target)
        done('target');
        return;
      }
      // Closed or Escape: not wanted again
      finished = true;
      if (!tip.repeats) markLearned(tip.id);
      content.onDismiss?.();
      track('tip_action', { tip: tip.id, action: 'dismissed' });
    },
  });
  content.onShown?.();
  track('tip_shown', { tip: tip.id, impression: state.shown[tip.id] || 1 });
  log(`Guide: showing ${tip.id}`);
  return true;
}

/**
 * Called once a tab's bird is on screen (not on the welcome's tab): count the tab, then show the
 * tip that's due, if any. A milestone in Your Birds ("10 different birds") is shown here too, so
 * the two never speak at once.
 * @param {{ milestone?: number|null }} [options]
 */
export async function runGuide({ milestone = null } = {}) {
  try {
    const state = await readState();
    state.tabs += 1;
    await chrome.storage.local.set({ [STATE_KEY]: state });

    const ctx = await context(state, { actions });
    // Only tips whose target is on the page now (a hidden name, no Chrome Tab icon: skipped)
    const candidates = pickTips(ctx, state).filter(tip => !tip.target || tip.target());
    const showsYourBirds = candidates[0]?.id === 'yourBirds';
    if (milestone && !showsYourBirds) showSeenMilestone(milestone);
    if (!candidates.length) return;

    await whenVisible();
    await new Promise(resolve => setTimeout(resolve, SHOW_DELAY_MS));
    for (const tip of candidates) {
      if (!pageIsFree()) return;
      if (await present(tip, ctx, state)) return;
    }
  } catch (error) {
    log(`Guide failed: ${error.message}`);
  }
}

/** Debug options and the preview harness: show one tip now, whatever the pacing says. */
export async function showTip(id) {
  const tip = TIPS.find(t => t.id === id);
  if (!tip) return false;
  closeTipCard();
  const state = await readState();
  const ctx = await context(state, { actions });
  return present(tip, ctx, state, { force: true });
}

/** Debug options: forget every learned tip and the pacing. */
export async function resetGuide() {
  learnedCache = {};
  await chrome.storage.sync.set({ seenFeatures: {} });
  await chrome.storage.local.remove([STATE_KEY, 'chromeFooterNotificationDismissed', 'stepAsideOfferDismissed']);
}
