/**
 * Review Prompt Module
 * Handles the review prompt logic, HTML, and event listeners
 */

import CONFIG from './config.js';
import { trackReviewPromptAction, trackReviewPromptShown } from './analytics.js';

// Module state
let shouldShowReviewPrompt = false;
let reviewPromptData = null;

/**
 * Get whether review prompt should be shown
 * @returns {boolean}
 */
export function getShouldShowReviewPrompt() {
  return shouldShowReviewPrompt;
}

/**
 * Get review prompt data for analytics
 * @returns {Object|null}
 */
export function getReviewPromptData() {
  return reviewPromptData;
}

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
 * Check and prepare review prompt based on user activity
 * @returns {Promise<boolean>} Whether review prompt should be shown
 */
export function checkAndPrepareReviewPrompt() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['installTime', 'newTabCount', 'lastReviewPrompt', 'reviewDismissed', 'reviewLeft'], function (result) {
      const now = Date.now();
      const installTime = result.installTime || now;
      const newTabCount = result.newTabCount || 0;
      const lastReviewPrompt = result.lastReviewPrompt || 0;
      const reviewDismissed = result.reviewDismissed || false;
      const reviewLeft = result.reviewLeft || false;

      if (reviewLeft || reviewDismissed) {
        resolve(false);
        return;
      }

      const isDev = process.env.NODE_ENV !== 'production';
      const timeDelay = isDev ? CONFIG.DEV_TIME_DELAY : CONFIG.PROD_TIME_DELAY;
      const tabCountThreshold = isDev ? CONFIG.DEV_TAB_COUNT : CONFIG.PROD_TAB_COUNT;

      const timeCondition = now - installTime > timeDelay;
      const activityCondition = newTabCount >= tabCountThreshold;
      const frequencyCondition = now - lastReviewPrompt > timeDelay;

      shouldShowReviewPrompt = timeCondition && activityCondition && frequencyCondition;

      // Store data for analytics tracking
      if (shouldShowReviewPrompt) {
        const daysSinceInstall = Math.floor((now - installTime) / (1000 * 60 * 60 * 24));
        reviewPromptData = {
          daysSinceInstall,
          newTabCount
        };
      }

      resolve(shouldShowReviewPrompt);
    });
  });
}

/**
 * Get review prompt HTML
 * @returns {string} HTML string for review prompt
 */
export function getReviewPromptHTML() {
  return `
    <div id="review-prompt" class="review-prompt">
      <div class="review-content">
        <h2>${chrome.i18n.getMessage('reviewPromptTitle')}</h2>
        <p>${chrome.i18n.getMessage('reviewPromptMessage')}</p>
        <div class="review-buttons">
          <button id="leave-review" class="review-btn primary">${chrome.i18n.getMessage('leaveReview')}</button>
          <button id="maybe-later" class="review-btn secondary">${chrome.i18n.getMessage('maybeLater')}</button>
          <button id="no-thanks" class="review-btn tertiary">${chrome.i18n.getMessage('noThanks')}</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Add event listeners to review prompt buttons
 */
export function addReviewPromptListeners() {
  const daysSinceInstall = reviewPromptData?.daysSinceInstall || -1;

  document.getElementById('leave-review').addEventListener('click', () => {
    if (process.env.BROWSER === 'edge') {
      chrome.tabs.create({ url: 'https://microsoftedge.microsoft.com/addons/detail/ciggnaneplggkgmjnmcjpmaggbbbcakg' });
    } else {
      chrome.tabs.create({ url: 'https://chromewebstore.google.com/detail/birdtab/dkdnidbnjihhilbjndnnlfipmbnoaipn' });
    }
    chrome.storage.local.set({ reviewLeft: true });
    trackReviewPromptAction('left_review', daysSinceInstall);
    dismissPrompt();
  });

  document.getElementById('maybe-later').addEventListener('click', () => {
    chrome.storage.local.set({ lastReviewPrompt: Date.now() });
    trackReviewPromptAction('maybe_later', daysSinceInstall);
    dismissPrompt();
  });

  document.getElementById('no-thanks').addEventListener('click', () => {
    chrome.storage.local.set({ reviewDismissed: true });
    trackReviewPromptAction('dismissed', daysSinceInstall);
    dismissPrompt();
  });
}

/**
 * Dismiss the review prompt with animation
 */
export function dismissPrompt() {
  const prompt = document.getElementById('review-prompt');
  if (prompt) {
    prompt.style.opacity = '0';
    setTimeout(() => prompt.remove(), 300);
  }
}

/**
 * Show the review prompt if conditions are met
 * @param {HTMLElement} container - Container to insert prompt into
 */
export function showReviewPromptIfNeeded(container) {
  if (shouldShowReviewPrompt && container) {
    container.insertAdjacentHTML('beforeend', getReviewPromptHTML());
    addReviewPromptListeners();
    
    // Track that prompt was shown
    if (reviewPromptData) {
      trackReviewPromptShown(reviewPromptData.daysSinceInstall);
    }
  }
}
