/**
 * When to ask for a store review (shown as one of the guide's tips: guide/guide.js)
 */

import CONFIG from './config.js';

/**
 * Increment new tab count for review prompt timing
 */
export function incrementNewTabCount() {
  chrome.storage.local.get(['newTabCount', 'installTime'], function (result) {
    const now = Date.now();
    const installTime = result.installTime || now;

    if (now - installTime <= 28 * 24 * 60 * 60 * 1000) {
      chrome.storage.local.set({
        newTabCount: (result.newTabCount || 0) + 1
      });
    }
  });
}

/**
 * Whether it's time to ask: some days after install, after enough tabs, not answered, and not
 * asked recently ("Maybe later", or shown without an answer).
 * @returns {Promise<boolean>}
 */
export async function reviewPromptDue() {
  const result = await chrome.storage.local.get(['installTime', 'newTabCount', 'lastReviewPrompt', 'reviewDismissed', 'reviewLeft']);
  if (result.reviewLeft || result.reviewDismissed) return false;

  const now = Date.now();
  const isDev = process.env.NODE_ENV !== 'production';
  const timeDelay = isDev ? CONFIG.DEV_TIME_DELAY : CONFIG.PROD_TIME_DELAY;
  const tabCountThreshold = isDev ? CONFIG.DEV_TAB_COUNT : CONFIG.PROD_TAB_COUNT;

  const timeCondition = now - (result.installTime || now) > timeDelay;
  const activityCondition = (result.newTabCount || 0) >= tabCountThreshold;
  const frequencyCondition = now - (result.lastReviewPrompt || 0) > timeDelay;
  return timeCondition && activityCondition && frequencyCondition;
}

/** The store page to review BirdTab on, for this browser. */
export function reviewStoreUrl() {
  if (process.env.BROWSER === 'edge') return 'https://microsoftedge.microsoft.com/addons/detail/ciggnaneplggkgmjnmcjpmaggbbbcakg';
  if (process.env.BROWSER === 'firefox') return 'https://addons.mozilla.org/firefox/addon/birdtab/reviews/';
  return 'https://chromewebstore.google.com/detail/birdtab/dkdnidbnjihhilbjndnnlfipmbnoaipn';
}
