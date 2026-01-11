/**
 * PostHog Analytics Module
 * Uses posthog-js-lite - the official lightweight PostHog SDK for browser environments.
 * 
 * This implementation uses the official posthog-js-lite package (~38KB) instead of the
 * full posthog-js SDK (~168KB), which is more appropriate for a new tab extension
 * where bundle size impacts every tab load.
 * 
 * Features:
 * - No host permissions required (PostHog capture API supports CORS)
 * - localStorage persistence for event batching across tabs
 * - Reuses existing visitorId from chrome.storage.local
 * - Skips tracking in development mode (unpacked extension)
 * - Automatic browser/OS/screen context from posthog-js-lite
 * 
 * Privacy & Performance:
 * - Non-blocking: All analytics calls are asynchronous and batched
 * - Respects Do Not Track (DNT): Analytics disabled when user has DNT enabled
 * - Events batched and sent every 2 minutes or after 15 events accumulate
 * - EU data residency: Data sent to eu.i.posthog.com for GDPR compliance
 * 
 * Events tracked:
 * - session_start: New tab opened (with user settings)
 * - feature_used: User interacts with a feature
 * - quiz_completed: Quiz finished
 * - onboarding_completed: Onboarding flow done
 * - tour_completed: Feature tour done
 */

import PostHog from 'posthog-js-lite';
import { CONFIG } from './config.js';
import { log, error as logError } from './logger.js';
import { getOrCreateVisitorId } from './shared.js';

// PostHog instance
let posthog = null;

// Track initialization state
let analyticsInitialized = false;
let analyticsInitializing = false;

/**
 * Check if user has enabled Do Not Track in their browser
 * Respects user privacy preferences by disabling analytics when DNT is set
 * @returns {boolean} true if DNT is enabled
 */
function isDoNotTrackEnabled() {
  if (typeof navigator === 'undefined') {
    return false;
  }
  
  // Check standard DNT header (most browsers)
  // navigator.doNotTrack returns "1" if enabled, "0" if disabled, null if not set
  const dnt = navigator.doNotTrack || 
              // @ts-ignore - window.doNotTrack for older IE
              window.doNotTrack || 
              // @ts-ignore - navigator.msDoNotTrack for older IE
              navigator.msDoNotTrack;
  
  return dnt === '1' || dnt === 'yes' || dnt === true;
}

/**
 * Check if analytics should be enabled
 * Currently enabled for both development and production for testing.
 * TODO: Re-enable the development mode check before production release:
 *       Uncomment the update_url check below to disable analytics in dev.
 */
function shouldEnableAnalytics() {
  // Respect user's Do Not Track preference
  if (isDoNotTrackEnabled()) {
    log('Analytics disabled - user has enabled Do Not Track');
    return false;
  }

  // Check if API key is configured
  if (!CONFIG.POSTHOG?.API_KEY || 
      CONFIG.POSTHOG.API_KEY === 'phc_YOUR_PROJECT_API_KEY_HERE' ||
      CONFIG.POSTHOG.API_KEY === '') {
    log('Analytics disabled - PostHog API key not configured');
    return false;
  }

  // TODO: Uncomment this block before production release to disable analytics in dev
  // // Check if running in development mode (unpacked extension)
  // try {
  //   const manifest = chrome.runtime.getManifest();
  //   if (!manifest.update_url) {
  //     log('Analytics disabled - extension loaded unpacked (development mode)');
  //     return false;
  //   }
  // } catch (error) {
  //   logError('Failed to check manifest:', error);
  //   return false;
  // }

  return true;
}

/**
 * Initialize PostHog analytics
 * Should be called once when the extension loads
 * 
 * @param {string} component - Component identifier (e.g., 'newtab', 'popup', 'onboarding')
 */
export async function initAnalytics(component = 'unknown') {
  // Prevent double initialization or concurrent initialization
  if (analyticsInitialized || analyticsInitializing) {
    log('Analytics already initialized or initializing, skipping');
    return;
  }

  if (!shouldEnableAnalytics()) {
    return;
  }

  analyticsInitializing = true;

  try {
    // Get visitor ID for consistent user tracking
    const visitorId = await getOrCreateVisitorId();
    
    // Get extension version
    let extensionVersion = 'unknown';
    try {
      extensionVersion = chrome.runtime.getManifest().version;
    } catch (e) {
      // Ignore
    }

    // Initialize PostHog with posthog-js-lite
    // Official configuration options: https://posthog.com/docs/libraries/js
    posthog = new PostHog(CONFIG.POSTHOG.API_KEY, {
      // API host - EU region for GDPR compliance
      host: CONFIG.POSTHOG.API_HOST || 'https://eu.i.posthog.com',
      
      // Use localStorage for persistence - events accumulate across tabs
      // and are sent in batches for better performance
      persistence: 'localStorage',
      
      // Disable autocapture - we track specific events only
      autocapture: false,
      
      // Disable history tracking - not relevant for extension
      captureHistoryEvents: false,
      
      // Disable feature flags - we don't use them, saves a network request
      preloadFeatureFlags: false,
      
      // Bootstrap the distinctId to avoid calling identify() which triggers a flags reload
      // Using isIdentifiedId: true to set it as the main distinctId (not anonymous)
      bootstrap: {
        distinctId: visitorId,
        isIdentifiedId: true,
      },
      
      // Flush interval: 120 seconds (2 minutes)
      // Events accumulate in localStorage and are sent in batches
      flushInterval: 120000,
      
      // Flush when 15 events have accumulated
      // Whichever comes first: 2 minutes or 15 events
      flushAt: 15,
    });

    // Note: We don't call posthog.identify() here because:
    // 1. The distinctId is already set via bootstrap option above
    // 2. Calling identify() would trigger a feature flags reload (even with preloadFeatureFlags: false)
    //    because identify() reloads flags when the distinctId changes

    // Register super properties (included in all events)
    // These persist for the session and are sent with every event
    posthog.register({
      component: component,
      extension_version: extensionVersion,
    });

    analyticsInitialized = true;
    analyticsInitializing = false;
    log(`PostHog analytics initialized for ${component} (posthog-js-lite, localStorage persistence)`);

    // Note: We intentionally don't flush on beforeunload or visibilitychange
    // Events are persisted in localStorage and will be sent:
    // - When 15 events accumulate (across all tabs)
    // - Or after 2 minutes (whichever comes first)
    // This reduces network requests and lets events batch naturally

  } catch (error) {
    analyticsInitializing = false;
    logError('Failed to initialize PostHog:', error);
  }
}

/**
 * Check if analytics has been initialized
 * @returns {boolean}
 */
export function isAnalyticsInitialized() {
  return analyticsInitialized;
}

/**
 * Track a custom event
 * 
 * Best practices for event naming (from PostHog docs):
 * - Use snake_case for event names
 * - Be specific but not too granular
 * - Include relevant properties for filtering/breakdown
 * 
 * @param {string} eventName - Name of the event
 * @param {Object} properties - Event properties
 */
export function track(eventName, properties = {}) {
  if (!analyticsInitialized || !posthog) {
    log(`Analytics not initialized, skipping event: ${eventName}`);
    return;
  }

  try {
    // posthog-js-lite automatically adds context properties:
    // $browser, $os, $device, $screen_width, $screen_height, etc.
    posthog.capture(eventName, properties);
    log(`Analytics event: ${eventName}`, properties);
  } catch (error) {
    logError(`Failed to track event ${eventName}:`, error);
  }
}

/**
 * Track feature usage (convenience wrapper for feature_used events)
 * 
 * Best practice: Use a single "feature_used" event with a "feature" property
 * rather than many separate events. This makes analysis easier in PostHog.
 * 
 * @param {string} featureName - Name of the feature (e.g., 'share', 'audio_play', 'refresh')
 * @param {Object} properties - Additional properties
 */
export function trackFeature(featureName, properties = {}) {
  track('feature_used', {
    feature: featureName,
    ...properties,
  });
}

/**
 * Calculate days since install from installTime
 * 
 * @param {number|null} installTime - Install timestamp from chrome.storage.local
 * @returns {number} Days since install, or -1 if unknown
 */
function getDaysSinceInstall(installTime) {
  if (!installTime) return -1;
  const now = Date.now();
  return Math.floor((now - installTime) / (1000 * 60 * 60 * 24));
}

/**
 * Track session start with user settings
 * Called when a new tab is opened
 * 
 * Best practice: Include user state/settings as properties to enable
 * cohort analysis (e.g., "users with video mode enabled")
 * 
 * @param {Object} settings - User settings and bird info
 * @param {number|null} installTime - Install timestamp from chrome.storage.local
 */
export function trackSessionStart(settings = {}, installTime = null) {
  // Get Chrome UI locale for i18n planning
  let locale = 'unknown';
  try {
    locale = chrome.i18n.getUILanguage() || 'unknown';
  } catch (e) {
    // Ignore - locale will remain 'unknown'
  }

  // Calculate user tenure
  const daysSinceInstall = getDaysSinceInstall(installTime);

  track('session_start', {
    // User settings
    region: settings.region || 'unknown',
    video_mode: settings.videoMode || false,
    auto_play: settings.autoPlay || false,
    quiet_hours: settings.quietHours || false,
    high_res: settings.highResImages || false,
    quick_access: settings.quickAccessEnabled || false,
    clock_enabled: settings.clockEnabled || false,
    
    // Browser locale for i18n planning
    locale: locale,
    
    // Content info
    species_code: settings.speciesCode || null,
    has_audio: settings.hasAudio || false,
    has_video: settings.hasVideo || false,
    
    // User tenure (for cohort analysis)
    // PostHog can bucket this value using breakdown bins
    days_since_install: daysSinceInstall,
  });
  
  // Note: We don't flush immediately anymore
  // Events accumulate in localStorage and batch send every 2 min or 15 events
}

/**
 * Track quiz started
 * 
 * Call this when the user opens/starts the quiz
 * 
 * @param {number} totalQuestions - Total questions in the quiz
 */
export function trackQuizStarted(totalQuestions) {
  track('quiz_started', {
    total_questions: totalQuestions,
  });
}

/**
 * Track quiz completion
 * 
 * Best practice: Include computed properties (like score_percent) to make
 * analysis easier without needing formulas in PostHog
 * 
 * @param {number} score - Quiz score
 * @param {number} total - Total questions
 * @param {number} durationSec - Duration in seconds
 */
export function trackQuizCompleted(score, total, durationSec) {
  track('quiz_completed', {
    score,
    total,
    duration_sec: durationSec,
    score_percent: total > 0 ? Math.round((score / total) * 100) : 0,
  });
}

/**
 * Track quiz abandoned
 * 
 * Call this when user closes quiz without completing
 * 
 * @param {number} questionsAnswered - Number of questions answered before abandoning
 * @param {number} totalQuestions - Total questions in the quiz
 */
export function trackQuizAbandoned(questionsAnswered, totalQuestions) {
  track('quiz_abandoned', {
    questions_answered: questionsAnswered,
    total_questions: totalQuestions,
    completion_percent: totalQuestions > 0 ? Math.round((questionsAnswered / totalQuestions) * 100) : 0,
  });
}

/**
 * Track onboarding completion
 * 
 * @param {string} region - Selected region
 * @param {boolean} autoPlay - Auto-play setting
 */
export function trackOnboardingCompleted(region, autoPlay) {
  track('onboarding_completed', {
    region,
    auto_play: autoPlay,
  });
}

/**
 * Track feature tour completion
 * 
 * @param {number} stepsViewed - Number of steps viewed
 */
export function trackTourCompleted(stepsViewed) {
  track('tour_completed', {
    steps_viewed: stepsViewed,
  });
}

/**
 * Track review prompt shown
 * 
 * @param {number} daysSinceInstall - Days since extension install
 * @param {number} newTabCount - Number of new tabs opened
 */
export function trackReviewPromptShown(daysSinceInstall, newTabCount) {
  track('review_prompt_shown', {
    days_since_install: daysSinceInstall,
    new_tab_count: newTabCount,
  });
}

/**
 * Track review prompt action
 * 
 * @param {string} action - Action taken: 'left_review', 'maybe_later', or 'dismissed'
 * @param {number} daysSinceInstall - Days since extension install
 */
export function trackReviewPromptAction(action, daysSinceInstall) {
  track('review_prompt_action', {
    action: action,
    days_since_install: daysSinceInstall,
  });
}

/**
 * Force flush all pending events
 * Useful before page unload or when immediate delivery is needed
 */
export function flush() {
  if (posthog) {
    posthog.flush();
  }
}

/**
 * Get the PostHog instance (for advanced usage)
 * @returns {PostHog|null}
 */
export function getPostHogInstance() {
  return posthog;
}

export default {
  initAnalytics,
  isAnalyticsInitialized,
  track,
  trackFeature,
  trackSessionStart,
  trackQuizCompleted,
  trackOnboardingCompleted,
  trackTourCompleted,
  flush,
  getPostHogInstance,
};
