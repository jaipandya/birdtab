/**
 * Centralized logger for BirdTab
 * Only logs to console in development mode or if explicitly enabled
 */

const isDev = process.env.NODE_ENV !== 'production';

export function log(message, ...args) {
  if (isDev) {
    if (args.length > 0) {
      console.log(`[BirdTab]: ${message}`, ...args);
    } else {
      console.log(`[BirdTab]: ${message}`);
    }
  }
}

export function warn(message, ...args) {
  if (isDev) {
    console.warn(`[BirdTab]: ${message}`, ...args);
  }
}

export function error(message, ...args) {
  // Always log errors locally for debugging, even in prod if needed, 
  // but usually we rely on Sentry in prod.
  // User requested "dev only" for log, but errors might be useful?
  // User said: "Refactor console.error to log + captureException".
  // So 'log' handles the console part (dev only).
  if (isDev) {
    console.error(`[BirdTab]: ${message}`, ...args);
  }
}
