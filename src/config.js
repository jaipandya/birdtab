export const CONFIG = {
  MANIFEST_URL: 'https://media.birdtab.app/m260416r01/manifests/manifest.json',
  DEV_TAB_COUNT: 5,  // Number of new tabs to open before showing the prompt in dev mode
  PROD_TAB_COUNT: 50,  // Number of new tabs to open before showing the prompt in production
  DEV_TIME_DELAY: 1 * 60 * 1000,  // 1 minute in milliseconds
  PROD_TIME_DELAY: 4 * 24 * 60 * 60 * 1000,  // 4 days in milliseconds
  VOLUME_STEP: 0.1, // Volume change step for keyboard shortcuts

  // Sentry Configuration - follows same pattern as other config
  SENTRY: {
    // DSN - Safe to include in production builds (Sentry DSN is designed to be public)
    // Replace with your actual Sentry DSN from your project settings
    DSN: 'https://98781d8af4acd4e491de6bb3ae00bd39@o4509638513393664.ingest.us.sentry.io/4509638520012800',

    // Environment detection - set by webpack based on build mode
    ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || 'production',

    // Performance monitoring sample rate (5% for free tier optimization)
    // With 1000+ daily users and new tab loads, 5% keeps us well within:
    // - 5 million spans/month limit
    // - Estimated: 1000 users × 30 days × 5 tabs/day × 5% = ~7,500 spans/month
    TRACES_SAMPLE_RATE: 0.05,

    // Enable debug mode (set to true only when debugging Sentry issues)
    DEBUG: false
  },

  // PostHog Analytics Configuration
  // No host permissions required - PostHog's capture API supports CORS natively
  POSTHOG: {
    // Injected from .env.local (dev) or .env.production (prod) via dotenv-webpack
    API_KEY: process.env.POSTHOG_API_KEY || 'phc_YOUR_PROJECT_API_KEY_HERE',

    // API Host - EU region for GDPR compliance (Frankfurt, Germany)
    API_HOST: 'https://eu.i.posthog.com'
  },

  // Uninstall URL - base endpoint for uninstall feedback redirect
  UNINSTALL_URL: 'https://api.birdtab.app/uninstall',

  // Uninstall URL Signing - HMAC secret for validating visitor IDs
  // This prevents URL tampering on the uninstall feedback page
  UNINSTALL_SECRET: process.env.UNINSTALL_SECRET || 'birdtab-uninstall-secret-change-in-prod',

  // Default values for local storage settings
  // These are used for fresh installs and as fallbacks during migration
  STORAGE_DEFAULTS: {
    region: 'WLD',
    autoPlay: false,
    quietHours: false,
    clockDisplayMode: 'clock',
    clockShowSeconds: false,
    clockFormat24Hour: false,
    quickAccessEnabled: true,
    hideTopSites: true,
    customShortcuts: [],
    googleAppsEnabled: false,
    chromeTabEnabled: true,
    searchEngine: 'default',
    isMuted: false,
    volumeLevel: 0.3,
    lowDistractionMode: false,
    chromeFooterNotificationDismissed: false,
    timerSetupHours: 0,
    timerSetupMinutes: 5,
    timerSetupSeconds: 0,
    timerAlarmEnabled: false,
  },

  // Keys that should remain in sync storage (cross-device)
  SYNC_STORAGE_KEYS: ['onboardingComplete', 'featureTourVersion', 'seenFeatures']
};

export default CONFIG;
