import { log, error as logError } from './logger.js';

/**
 * Get or create a unique visitor ID for anonymous user tracking.
 * Used by both Sentry and PostHog for consistent user identification.
 * 
 * @returns {Promise<string>} The visitor ID (UUID format)
 */
export async function getOrCreateVisitorId() {
  try {
    const result = await chrome.storage.local.get('visitorId');
    if (result.visitorId) {
      return result.visitorId;
    }

    const newId = crypto.randomUUID();
    await chrome.storage.local.set({ visitorId: newId });
    return newId;
  } catch (error) {
    logError('Failed to get/create visitor ID:', error);
    return `session-${crypto.randomUUID()}`;
  }
}
