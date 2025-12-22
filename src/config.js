export const CONFIG = {
  CACHE_DURATION: {
    BIRD_INFO: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    BIRDS_BY_REGION: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    RECENT_OBSERVATIONS: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
  },
  DEV_TAB_COUNT: 5,  // Number of new tabs to open before showing the prompt in dev mode
  PROD_TAB_COUNT: 50,  // Number of new tabs to open before showing the prompt in production
  DEV_TIME_DELAY: 1 * 60 * 1000,  // 1 minute in milliseconds
  PROD_TIME_DELAY: 4 * 24 * 60 * 60 * 1000,  // 4 days in milliseconds
  API_SERVER_URL: 'https://api.birdtab.app/api',
  DEFAULT_VOLUME: 0.3, // Default volume level (0.0 to 1.0)
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
  }
};

export default CONFIG;