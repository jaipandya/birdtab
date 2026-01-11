import * as Sentry from '@sentry/browser';
import { CONFIG } from './config.js';
import { log, error as logError, warn as logWarn } from './logger.js';
import { getOrCreateVisitorId } from './shared.js';

// Track if Sentry is initialized
let sentryInitialized = false;

// Constants
const MAX_ERRORS_PER_SESSION = 10;
const ERROR_COUNT_RESET_INTERVAL = 21600000; // 6 hours in milliseconds

// Error rate limiting (module-level, not global window)
let errorCount = 0;
let errorCountResetTime = Date.now() + ERROR_COUNT_RESET_INTERVAL;

const IGNORED_ERROR_PATTERNS = [
  'Extension context invalidated',
  'NetworkError',
  'ResizeObserver loop',
  'Script error.',
  'Non-Error promise rejection',
  'Loading chunk',
  'ChunkLoadError',
  'chrome.runtime.lastError',
  'The message port closed',
  'message channel closed',
  'Receiving end does not exist',
];

const SENSITIVE_KEYS = ['token', 'key', 'password', 'secret', 'auth', 'credential', 'cookie', 'session'];

const USER_SETTINGS_KEYS = ['region', 'onboardingComplete', 'autoPlay', 'quietHours', 'quickAccessEnabled'];

const BROWSER_ONLY_INTEGRATIONS = ['BrowserTracing', 'TryCatch', 'Breadcrumbs', 'LinkedErrors', 'HttpContext', 'GlobalHandlers'];

// Span status codes
const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;

/**
 * Sanitize URL by removing query params and hash
 */
function sanitizeUrl(url) {
  try {
    const urlObj = new URL(url);
    urlObj.search = '';
    urlObj.hash = '';
    return urlObj.toString();
  } catch {
    return null;
  }
}

/**
 * Remove sensitive data from object
 */
function removeSensitiveData(data) {
  if (!data) return;

  Object.keys(data).forEach(key => {
    if (SENSITIVE_KEYS.some(sensitive => key.toLowerCase().includes(sensitive))) {
      delete data[key];
    }
  });
}

/**
 * Sanitize event URLs and breadcrumbs
 */
function sanitizeEvent(event) {
  // Sanitize request URL
  if (event.request?.url) {
    const sanitized = sanitizeUrl(event.request.url);
    if (sanitized) {
      event.request.url = sanitized;
    } else {
      delete event.request.url;
    }
  }

  // Sanitize breadcrumb URLs
  if (event.breadcrumbs) {
    event.breadcrumbs.forEach(breadcrumb => {
      if (breadcrumb.data?.url) {
        const sanitized = sanitizeUrl(breadcrumb.data.url);
        if (sanitized) {
          breadcrumb.data.url = sanitized;
        } else {
          delete breadcrumb.data.url;
        }
      }
    });
  }
}

/**
 * Check if error should be ignored
 */
function shouldIgnoreError(errorMessage) {
  return IGNORED_ERROR_PATTERNS.some(pattern => errorMessage.includes(pattern));
}

/**
 * Build user data object from settings
 */
function buildUserData(settings = {}) {
  return {
    region: settings.region ?? 'US',
    onboarded: settings.onboardingComplete ?? false,
    autoPlay: settings.autoPlay ?? false,
    quietHours: settings.quietHours ?? false,
    quickAccess: settings.quickAccessEnabled ?? false,
  };
}

/**
 * Get user settings from storage
 */
async function getUserSettings() {
  try {
    return await chrome.storage.sync.get(USER_SETTINGS_KEYS);
  } catch (error) {
    logError('Failed to get user settings:', error);
    return {};
  }
}

/**
 * Apply context (extra, tags, user, level) to Sentry scope
 */
function applyContextToScope(scope, context) {
  if (context.extra) {
    Object.entries(context.extra).forEach(([key, value]) => scope.setExtra(key, value));
  }
  if (context.tags) {
    Object.entries(context.tags).forEach(([key, value]) => scope.setTag(key, value));
  }
  if (context.user) {
    scope.setUser(context.user);
  }
  if (context.level) {
    scope.setLevel(context.level);
  }
}

/**
 * Check if we're in a service worker context
 */
function isServiceWorker() {
  return typeof ServiceWorkerGlobalScope !== 'undefined' &&
         self instanceof ServiceWorkerGlobalScope;
}

/**
 * Parse user agent to extract OS and browser information
 * Used in service worker context where HttpContext integration is not available
 */
function parseUserAgent() {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return { os: null, browser: null };
  }

  const ua = navigator.userAgent;
  let os = null;
  let browser = null;

  // Parse OS
  if (ua.includes('Windows NT 10')) {
    os = { name: 'Windows', version: '10' };
  } else if (ua.includes('Windows NT 11') || (ua.includes('Windows NT 10') && ua.includes('Win64'))) {
    // Windows 11 reports as Windows NT 10 but we can't reliably detect it
    os = { name: 'Windows', version: '10' };
  } else if (ua.includes('Windows')) {
    os = { name: 'Windows' };
  } else if (ua.includes('Mac OS X')) {
    const match = ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
    os = { name: 'macOS', version: match ? match[1].replace(/_/g, '.') : undefined };
  } else if (ua.includes('Linux')) {
    os = { name: 'Linux' };
  } else if (ua.includes('CrOS')) {
    os = { name: 'Chrome OS' };
  }

  // Parse Browser (Chrome extension will always be Chrome-based)
  const chromeMatch = ua.match(/Chrome\/(\d+(\.\d+)*)/);
  if (chromeMatch) {
    browser = { name: 'Chrome', version: chromeMatch[1] };
  } else if (ua.includes('Edg/')) {
    const edgeMatch = ua.match(/Edg\/(\d+(\.\d+)*)/);
    browser = { name: 'Edge', version: edgeMatch ? edgeMatch[1] : undefined };
  }

  return { os, browser };
}

/**
 * Filter integrations based on context and requirements
 */
function filterIntegrations(defaultIntegrations) {
  const isWorker = isServiceWorker();

  return defaultIntegrations.filter(integration => {
    try {
      const name = integration.name || '';
      const constructor = integration.constructor?.name || '';

      // Remove feedback integrations (Chrome Web Store requirement)
      if (name.includes('Feedback') || constructor.includes('Feedback')) {
        return false;
      }

      // Remove browser-only integrations in service worker context
      if (isWorker && BROWSER_ONLY_INTEGRATIONS.some(browserInt => name.includes(browserInt))) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Add custom integrations (returns new array to avoid mutation)
 */
function addCustomIntegrations(integrations) {
  const isWorker = isServiceWorker();
  const result = [...integrations];

  // Browser tracing (production + browser context only)
  if (!isWorker && CONFIG.SENTRY.ENVIRONMENT === 'production' && Sentry.browserTracingIntegration) {
    result.push(Sentry.browserTracingIntegration({
      enableLongTask: false,
      enableInp: true,
    }));
  }

  // Console capture (browser context only)
  if (!isWorker && Sentry.captureConsoleIntegration) {
    result.push(Sentry.captureConsoleIntegration({
      levels: ['error', 'warn'],
    }));
  }

  return result;
}

// Configuration object for Sentry
const SENTRY_CONFIG = {
  // DSN from config
  dsn: CONFIG.SENTRY.DSN,
  environment: CONFIG.SENTRY.ENVIRONMENT,
  debug: CONFIG.SENTRY.DEBUG,

  // Lazy getter to avoid calling chrome API at module load time
  get release() {
    return `birdtab@${chrome.runtime.getManifest().version}`;
  },

  // Performance monitoring sample rate (5% for free tier optimization)
  // With 1000+ daily users opening new tabs, this keeps us well within limits
  tracesSampleRate: CONFIG.SENTRY.TRACES_SAMPLE_RATE,
  
  // Dynamic sampling: prioritize transactions with errors
  tracesSampler: (samplingContext) => {
    // Always sample transactions that have errors
    if (samplingContext.parentSampled !== undefined) {
      return samplingContext.parentSampled;
    }

    // Sample critical operations more frequently (cap at 1.0)
    const operationName = samplingContext.name || '';
    if (operationName.includes('error') || operationName.includes('fetch-bird-info')) {
      return Math.min(CONFIG.SENTRY.TRACES_SAMPLE_RATE * 2, 1.0);
    }

    // Default sample rate for other transactions
    return CONFIG.SENTRY.TRACES_SAMPLE_RATE;
  },

  integrations: (defaultIntegrations) => {
    try {
      const filtered = filterIntegrations(defaultIntegrations);
      return addCustomIntegrations(filtered);
    } catch (error) {
      console.error('[Sentry] Error configuring integrations:', error);
      return defaultIntegrations;
    }
  },

  beforeSend(event, hint) {
    // Don't send events when offline (works in both browser and service worker contexts)
    // navigator.onLine is available in service workers via WorkerNavigator
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return null;
    }

    // Reset error count after time window
    if (Date.now() > errorCountResetTime) {
      errorCount = 0;
      errorCountResetTime = Date.now() + ERROR_COUNT_RESET_INTERVAL;
    }

    // Rate limiting
    if (errorCount >= MAX_ERRORS_PER_SESSION) {
      return null;
    }

    // Check if error should be ignored
    if (event.exception) {
      const errorMessage = hint.originalException?.message || event.exception?.values?.[0]?.value || '';

      if (shouldIgnoreError(errorMessage)) {
        return null;
      }

      errorCount++;
    }

    // Remove sensitive data
    removeSensitiveData(event.extra);

    // Sanitize URLs
    sanitizeEvent(event);

    return event;
  },

  // Transport error handling (detects ad-blockers)
  transport: Sentry.makeFetchTransport,
  transportOptions: {
    // Custom fetch implementation with error handling
  },

  initialScope: {
    tags: {
      component: 'chrome-extension',
      extension: 'birdtab',
    },
  },
};

/**
 * Initialize Sentry for error tracking and performance monitoring
 * Automatically skips initialization in development mode (unpacked extension)
 * @param {string} component - Component identifier (e.g., 'background', 'popup', 'content')
 * @param {Object} additionalConfig - Additional Sentry configuration to merge
 * @returns {void}
 */
export function initSentry(component, additionalConfig = {}) {
  try {
    // Prevent double initialization
    if (sentryInitialized) {
      log('Sentry already initialized, skipping');
      return;
    }

    // Get manifest once and reuse
    const manifest = chrome.runtime.getManifest();

    // Skip Sentry in development mode (loaded unpacked)
    // Extensions from Chrome Web Store have update_url, unpacked extensions don't
    if (!manifest.update_url) {
      log('Sentry initialization skipped - extension loaded unpacked (development mode)');
      return;
    }

    if (!SENTRY_CONFIG.dsn || SENTRY_CONFIG.dsn === '' || SENTRY_CONFIG.dsn.includes('YOUR_SENTRY_DSN')) {
      log('Sentry initialization skipped - DSN not configured');
      return;
    }

    // Validate DSN format (supports both sentry.io and self-hosted)
    if (!SENTRY_CONFIG.dsn.startsWith('https://') || !SENTRY_CONFIG.dsn.includes('@')) {
      logError('Invalid Sentry DSN format detected');
      return;
    }

    const config = {
      ...SENTRY_CONFIG,
      ...additionalConfig,
    };

    Sentry.init(config);
    sentryInitialized = true;

    Sentry.setTag('component', component);

    // Set user context with unique anonymous visitor ID
    (async () => {
      try {
        const visitorId = await getOrCreateVisitorId();
        const settings = await getUserSettings();
        Sentry.setUser({
          id: visitorId,
          data: buildUserData(settings),
        });
      } catch (error) {
        logError('Failed to set user context:', error);
      }
    })();
    Sentry.setContext('extension', {
      version: manifest.version,
      name: manifest.name,
      component: component,
      manifestVersion: manifest.manifest_version,
    });

    // In service worker context, HttpContext integration is not available
    // so we manually set OS and browser context from user agent
    if (isServiceWorker()) {
      const { os, browser } = parseUserAgent();
      if (os) {
        Sentry.setContext('os', os);
      }
      if (browser) {
        Sentry.setContext('browser', browser);
      }
    }

    log(`Sentry initialized for ${component}`);

  } catch (error) {
    logError('Failed to initialize Sentry:', error);
  }
}


/**
 * Check if Sentry has been initialized
 * @returns {boolean} True if Sentry is initialized, false otherwise
 */
export function isSentryInitialized() {
  return sentryInitialized;
}

/**
 * Capture an exception and send to Sentry
 * Always logs locally; only sends to Sentry if initialized (production)
 * @param {Error} error - The error object to capture
 * @param {Object} context - Additional context
 * @param {Object} [context.extra] - Extra key-value data
 * @param {Object} [context.tags] - Tags for categorization
 * @param {Object} [context.user] - User information
 * @param {string} [context.level] - Error severity level
 * @returns {void}
 */
export function captureException(error, context = {}) {
  logError('[Sentry Error]:', error);
  if (Object.keys(context).length > 0) {
    logError('Context:', context);
  }

  if (!sentryInitialized) return;

  try {
    Sentry.withScope((scope) => {
      applyContextToScope(scope, context);
      const eventId = Sentry.captureException(error);
      log(`Sentry event captured with ID: ${eventId}`);
    });
  } catch (sentryError) {
    logError('Failed to send to Sentry:', sentryError);
  }
}

/**
 * Capture a message and send to Sentry
 * Always logs locally; only sends to Sentry if initialized (production)
 * @param {string} message - The message to capture
 * @param {string} level - Severity level ('info', 'warning', 'error', 'fatal')
 * @param {Object} context - Additional context
 * @param {Object} [context.extra] - Extra key-value data
 * @param {Object} [context.tags] - Tags for categorization
 * @returns {void}
 */
export function captureMessage(message, level = 'info', context = {}) {
  const logMessage = `[Sentry Message]: ${message}`;

  if (level === 'error' || level === 'fatal') {
    logError(logMessage, context);
  } else if (level === 'warning') {
    logWarn(logMessage, context);
  } else {
    log(logMessage, context);
  }

  if (!sentryInitialized) return;

  try {
    Sentry.withScope((scope) => {
      scope.setLevel(level);
      applyContextToScope(scope, context);
      Sentry.captureMessage(message);
    });
  } catch (error) {
    logError('Failed to capture message with Sentry:', error);
  }
}

/**
 * Start a transaction for performance monitoring
 * @param {string} name - Transaction name
 * @param {string} op - Operation type
 * @param {Object} context - Additional context attributes
 * @returns {Object|null} Transaction object with finish, setStatus, and setData methods
 */
export function startTransaction(name, op = 'navigation', context = {}) {
  if (!sentryInitialized) return null;

  try {
    const span = Sentry.startInactiveSpan({ name, op, attributes: context });
    if (!span) return null;

    return {
      finish: () => span.end(),
      setStatus: (status) => {
        const statusCode = status === 'ok' ? SPAN_STATUS_OK : SPAN_STATUS_ERROR;
        span.setStatus({ code: statusCode });
      },
      setData: (key, value) => span.setAttribute(key, value),
    };
  } catch (error) {
    logError('Failed to start transaction:', error);
    return null;
  }
}

/**
 * Add a breadcrumb for debugging (trail of events leading to an error)
 * @param {string} message - Breadcrumb message
 * @param {string} category - Category (e.g., 'navigation', 'http', 'user-action')
 * @param {string} level - Severity level
 * @param {Object} data - Additional structured data
 * @returns {void}
 */
export function addBreadcrumb(message, category = 'default', level = 'info', data = {}) {
  if (!sentryInitialized) return;

  try {
    Sentry.addBreadcrumb({
      message,
      category,
      level,
      data,
      timestamp: Date.now() / 1000,
    });
  } catch (error) {
    logError('Failed to add breadcrumb:', error);
  }
}

/**
 * Update user context with new settings
 * Merges new settings with current settings from storage
 * @param {Object} newSettings - New settings to merge
 * @param {string} [newSettings.region] - User region
 * @param {boolean} [newSettings.onboardingComplete] - Onboarding status
 * @param {boolean} [newSettings.autoPlay] - Auto-play setting
 * @param {boolean} [newSettings.quietHours] - Quiet hours setting
 * @param {boolean} [newSettings.quickAccessEnabled] - Quick access setting
 * @returns {Promise<void>}
 */
export async function updateUserContext(newSettings = {}) {
  if (!sentryInitialized) return;

  try {
    const visitorId = await getOrCreateVisitorId();
    const currentSettings = await getUserSettings();
    const mergedSettings = { ...currentSettings, ...newSettings };

    Sentry.setUser({
      id: visitorId,
      data: buildUserData(mergedSettings),
    });
  } catch (error) {
    logError('Failed to update user context:', error);
  }
}

/**
 * Set performance context for tracking operation metrics
 * @param {string} operation - Operation identifier
 * @param {Object} data - Additional performance data
 * @returns {void}
 */
export function setPerformanceContext(operation, data = {}) {
  if (!sentryInitialized) return;

  try {
    Sentry.setContext('performance', {
      operation,
      timestamp: Date.now(),
      ...data,
    });
  } catch (error) {
    logError('Failed to set performance context:', error);
  }
}

/**
 * Classify an error as transient (infrastructure/network) or data (bugs/missing content).
 * 
 * Transient errors (not our bug - report as warning/info):
 * - Network errors: user offline, DNS failure, "Failed to fetch"
 * - 5xx server errors: server-side issues on external APIs
 * - 407: Proxy authentication required (user's proxy/firewall issue)
 * - 408: Request timeout (network/server performance issue)
 * - 429: Rate limiting (temporary restriction)
 * 
 * Data errors (potentially our bug - report as exception):
 * - 404: Not found (missing bird data)
 * - Other 4xx: Bad request, authentication issues
 * - Parsing/validation errors
 * 
 * @param {Error} error - The error to classify
 * @returns {{ isTransient: boolean, type: string, label: string }}
 */
export function classifyError(error) {
  // HTTP status codes that indicate transient/infrastructure issues (not our bug)
  const TRANSIENT_HTTP_CODES = {
    407: 'Proxy',      // Proxy authentication required - user's proxy/firewall
    408: 'Timeout',    // Request timeout - network/server slowness
    429: 'RateLimit'   // Rate limiting - temporary throttling
  };

  // Determine if this is a network error (no HTTP response at all)
  const isNetworkError = error.isNetworkError || error.message?.includes('Failed to fetch');
  
  // Determine if this is a server-side error (5xx)
  const isServerError = error.isServerError;
  
  // Determine if this is a transient HTTP error (specific 4xx codes)
  const isTransientHttpCode = TRANSIENT_HTTP_CODES.hasOwnProperty(error.statusCode);

  // Overall: is this error transient (not our bug)?
  const isTransient = isNetworkError || isServerError || isTransientHttpCode;

  // Determine error type and human-readable label
  let type, label;
  
  if (isNetworkError) {
    type = 'network';
    label = error.isTimeout ? 'Timeout' : 'Network';
  } else if (isServerError) {
    type = 'serverError';
    label = 'Server';
  } else if (isTransientHttpCode) {
    type = 'transientHttp';
    label = TRANSIENT_HTTP_CODES[error.statusCode];
  } else if (error.statusCode) {
    type = 'httpError';
    label = `HTTP ${error.statusCode}`;
  } else {
    type = 'unknown';
    label = 'Unknown';
  }

  return { isTransient, type, label };
}

/**
 * Report an API/network error to Sentry with consistent formatting.
 * Transient errors are reported as messages (warning/info level).
 * Data errors are reported as exceptions.
 * 
 * Use this for API calls and network operations where you need to 
 * distinguish between infrastructure issues and actual bugs.
 * 
 * @param {Error} error - The error to report
 * @param {Object} options - Reporting options
 * @param {string} options.operation - The operation that failed (e.g., 'getBirdsByRegion')
 * @param {string} [options.component] - Optional component name
 * @param {string} [options.transientLevel='warning'] - Sentry level for transient errors
 * @param {Object} [options.extra={}] - Additional context to include
 * @param {number} [options.cachedBirdCount] - Pre-fetched cached bird count (to avoid async)
 * @returns {{ isTransient: boolean, type: string, label: string }}
 */
export function reportApiError(error, { operation, component, transientLevel = 'warning', extra = {}, cachedBirdCount }) {
  const { isTransient, type, label } = classifyError(error);

  // Build common tags
  const tags = {
    operation,
    errorType: type,
    statusCode: error.statusCode || 'unknown',
    isTransient: isTransient ? 'true' : 'false'  // Tag for filtering in Sentry
  };
  if (component) {
    tags.component = component;
  }

  // Build common extra data
  const fullErrorMessage = error.message || 'No error message';
  const extraData = {
    ...extra,
    errorMessage: fullErrorMessage,
    cachedBirdCount,
    hasCache: cachedBirdCount > 0,  // Context for impact assessment
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : undefined
  };

  // Build fingerprint for consistent grouping
  // Groups by: operation + error type + status code
  // Examples:
  //   ['getMacaulayImage', 'network', 'unknown']
  //   ['getBirdsByRegion', 'serverError', '503']
  //   ['preloadNextBird', 'httpError', '404']
  const fingerprint = [operation, type, tags.statusCode];

  if (isTransient) {
    // Report transient errors as messages with warning/info level
    // Include full error message in title for visibility (Sentry will handle display)
    captureMessage(`${label} error during ${operation}: ${fullErrorMessage}`, transientLevel, {
      tags,
      extra: extraData,
      fingerprint
    });
  } else {
    // Report data errors as exceptions for investigation
    captureException(error, {
      tags,
      extra: {
        ...extraData,
        responseData: error.responseData  // Include API response for debugging
      },
      fingerprint
    });
  }

  return { isTransient, type, label };
}

export { Sentry };
