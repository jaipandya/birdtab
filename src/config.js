// ---------------------------------------------------------------------------
// Media releases (schema 2). Format: crawlers/RELEASE_FORMAT.md
// ---------------------------------------------------------------------------

const IS_PRODUCTION_BUILD = process.env.NODE_ENV === 'production';
const BUILD_BROWSER = process.env.BROWSER;
// A feature runs on the browsers it supports
const featureOn = (...supported) => supported.includes(BUILD_BROWSER);

// Production media host. Dev builds can point at a local media server by
// setting MEDIA_BASE_URL in .env.local (e.g. MEDIA_BASE_URL=http://localhost:8787).
// Production builds ignore MEDIA_BASE_URL so a stray env var can never ship.
const PRODUCTION_MEDIA_BASE_URL = 'https://media.birdtab.app';
const MEDIA_BASE_URL = ((!IS_PRODUCTION_BUILD && process.env.MEDIA_BASE_URL) || PRODUCTION_MEDIA_BASE_URL)
  .replace(/\/+$/, '');

// >>> RELEASE-TIME CONSTANT <<<
// The schema 2 release that is live on media.birdtab.app when the production
// build is made (e.g. 'm261020r01'). Used only when current.json can't be read
// and nothing schema 2 is stored yet. While null, such users get the schema 1
// World manifest below, exactly like 2.0.x.
const PRODUCTION_FALLBACK_RELEASE = 'm261014r01';

// Dev builds fall back to the local test release exported by the crawlers.
const DEV_FALLBACK_RELEASE = 'm000000r01';

const FALLBACK_RELEASE = IS_PRODUCTION_BUILD ? PRODUCTION_FALLBACK_RELEASE : DEV_FALLBACK_RELEASE;

// Region setting default and the region every release has
const DEFAULT_REGION = 'WLD';

export const CONFIG = {
  MEDIA: {
    BASE_URL: MEDIA_BASE_URL,
    // Pointer to the live release (short cache), read at most every REFRESH_INTERVAL_MS
    CURRENT_URL: `${MEDIA_BASE_URL}/current.json`,
    // Built-in index used when current.json is unreachable and nothing is stored
    FALLBACK_INDEX_URL: FALLBACK_RELEASE ? `${MEDIA_BASE_URL}/releases/${FALLBACK_RELEASE}/index.json` : null,
    // Schema 1 World manifest (what 2.0.x reads). Last resort when no schema 2 data is reachable.
    LEGACY_MANIFEST_URL: 'https://media.birdtab.app/m260416r01/manifests/manifest.json',
    SCHEMA_VERSION: 2,
    DEFAULT_REGION,
    REFRESH_INTERVAL_MS: 24 * 60 * 60 * 1000, // current.json at most once a day, browser starts included
    FAILURE_BACKOFF_MS: 15 * 60 * 1000, // after a failed check, wait before trying again
    FETCH_TIMEOUT_MS: 15000, // no response headers within this: the attempt fails
    FETCH_STALL_TIMEOUT_MS: 15000, // no body bytes for this long: the attempt fails
    FETCH_MAX_DURATION_MS: 5 * 60 * 1000, // safety cap for a download that keeps receiving bytes
    FETCH_RETRIES: 2, // retries after the first attempt
    RETRY_BASE_DELAY_MS: 1000, // 1s, 2s, ... plus jitter
    // chrome.storage.session key where the background mirrors a region switch
    REGION_SWITCH_STATE_KEY: 'regionSwitchState',
    // A 'loading' region switch not updated for this long has stopped (e.g. service worker ended)
    REGION_SWITCH_STALE_MS: 30 * 1000,
  },

  DEV_TAB_COUNT: 5,  // Number of new tabs to open before showing the prompt in dev mode
  PROD_TAB_COUNT: 50,  // Number of new tabs to open before showing the prompt in production
  DEV_TIME_DELAY: 1 * 60 * 1000,  // 1 minute in milliseconds
  PROD_TIME_DELAY: 4 * 24 * 60 * 60 * 1000,  // 4 days in milliseconds
  VOLUME_STEP: 0.1, // Volume change step for keyboard shortcuts

  // Sentry Configuration - follows same pattern as other config
  SENTRY: {
    // DSN - Safe to include in production builds (Sentry DSN is designed to be public)
    // Replace with your actual Sentry DSN from your project settings
    DSN: 'https://7feee5a5cf4a7076d925889e94dac457@o4509638513393664.ingest.us.sentry.io/4509638520012800',

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
    region: DEFAULT_REGION,
    autoPlay: false,
    quietHours: false,
    quietHoursStart: 20, // 8 PM
    quietHoursEnd: 8, // 8 AM
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
    newTabMode: 'every',
    birdRotation: 'every',
    quickGuess: false,
  },

  // Keys that should remain in sync storage (cross-device)
  SYNC_STORAGE_KEYS: ['onboardingComplete', 'featureTourVersion', 'seenFeatures', 'favoriteSpecies'],

  // Features that need a browser to support them. A new one can start on Chrome only
  // ('chrome') and be ported by adding the other browsers once their parts are checked.
  FEATURES: {
    // "Open BirdTab": every tab / now and then / only from the toolbar button (boot.js).
    // Not Firefox: extensions can't open its own new tab page to step aside to.
    newTabMode: featureOn('chrome', 'edge'),
    // "New bird": every tab / every hour / once a day
    birdRotation: featureOn('chrome', 'edge', 'firefox'),
    favorites: featureOn('chrome', 'edge', 'firefox'),
    // One list of every bird seen, with Favorites as a filter (replaces the History panel)
    yourBirds: featureOn('chrome', 'edge', 'firefox'),
    quickGuess: featureOn('chrome', 'edge', 'firefox'),
    // Accent colour and text shading taken from the photo
    photoTone: featureOn('chrome', 'edge', 'firefox'),
  },
};

export default CONFIG;
