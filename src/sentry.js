import * as Sentry from '@sentry/browser';
import { CONFIG } from './config.js';
import { log, error as logError, warn as logWarn } from './logger.js';

// Track if Sentry is initialized
let sentryInitialized = false;

// Error patterns to ignore (common browser extension noise)
const IGNORED_ERROR_PATTERNS = [
  'Extension context invalidated',
  'NetworkError',
  'ResizeObserver loop',
  'Script error.',
  'Non-Error promise rejection',
  'Loading chunk',
  'ChunkLoadError',
  // Chrome extension specific
  'chrome.runtime.lastError',
  'The message port closed',
  'message channel closed',
  'Receiving end does not exist',
];

/**
 * Get or create a unique visitor ID for anonymous user tracking.
 * This ID persists per installation in chrome.storage.local.
 * Unlike chrome.runtime.id (which is the same for all users),
 * this gives each installation a unique identifier.
 */
async function getOrCreateVisitorId() {
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
    // Fallback to a session-based ID if storage fails
    return `session-${crypto.randomUUID()}`;
  }
}

// Configuration object for Sentry
const SENTRY_CONFIG = {
  // DSN from config
  dsn: CONFIG.SENTRY.DSN,
  environment: CONFIG.SENTRY.ENVIRONMENT,
  debug: CONFIG.SENTRY.DEBUG,
  release: `birdtab@${chrome.runtime.getManifest().version}`,
  
  // Performance monitoring sample rate (5% for free tier optimization)
  // With 1000+ daily users opening new tabs, this keeps us well within limits
  tracesSampleRate: CONFIG.SENTRY.TRACES_SAMPLE_RATE,
  
  // Dynamic sampling: prioritize transactions with errors
  tracesSampler: (samplingContext) => {
    // Always sample transactions that have errors
    if (samplingContext.parentSampled !== undefined) {
      return samplingContext.parentSampled;
    }
    
    // Sample critical operations more frequently
    const operationName = samplingContext.name || '';
    if (operationName.includes('error') || operationName.includes('fetch-bird-info')) {
      return CONFIG.SENTRY.TRACES_SAMPLE_RATE * 2; // Double the rate for important operations
    }
    
    // Default sample rate for other transactions
    return CONFIG.SENTRY.TRACES_SAMPLE_RATE;
  },

  // Integrations
  integrations: (defaultIntegrations) => {
    try {
      // Detect if we're in a service worker context (no window object)
      const isServiceWorker = typeof window === 'undefined' && typeof self !== 'undefined';

      // Filter out integrations that contain CDN references (Chrome Web Store rejection)
      // Also filter out browser-specific integrations when in service worker
      const filteredIntegrations = defaultIntegrations.filter(integration => {
        try {
          const name = integration.name || '';
          const constructor = integration.constructor && integration.constructor.name;

          // Remove feedback integrations
          if (name.includes('Feedback') || name.includes('feedback') ||
              (constructor && constructor.includes('Feedback')) ||
              name === 'FeedbackIntegration') {
            return false;
          }

          // In service workers, filter out browser-specific integrations that require DOM/window
          if (isServiceWorker) {
            const browserOnlyIntegrations = ['BrowserTracing', 'TryCatch', 'Breadcrumbs', 'LinkedErrors', 'HttpContext', 'GlobalHandlers'];
            if (browserOnlyIntegrations.some(browserInt => name.includes(browserInt))) {
              return false;
            }
          }

          return true;
        } catch (e) {
          return false; // Skip any integration that causes an error
        }
      });

      // Add browser tracing integration only in production AND only in browser context (not service worker)
      if (!isServiceWorker && CONFIG.SENTRY.ENVIRONMENT === 'production' && typeof Sentry.browserTracingIntegration === 'function') {
        filteredIntegrations.push(Sentry.browserTracingIntegration({
          // Disable automatic page load spans for extension (not relevant)
          enableLongTask: false,
          // Enable Web Vitals capture
          enableInp: true,
        }));
      }

      // Add console capture integration to capture console.error as breadcrumbs
      // Only in browser context, not service worker
      if (!isServiceWorker && typeof Sentry.captureConsoleIntegration === 'function') {
        filteredIntegrations.push(Sentry.captureConsoleIntegration({
          levels: ['error', 'warn'], // Only capture errors and warnings, not info/log
        }));
      }

      return filteredIntegrations;
    } catch (e) {
      // If anything fails, return default integrations without modifications
      console.error('[Sentry] Error configuring integrations:', e);
      return defaultIntegrations;
    }
  },

  // Client-side rate limiting and error filtering
  beforeSend(event, hint) {
    // Don't send events when offline - prevents console noise and failed requests
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return null;
    }

    // Rate limiting: max 10 errors per session
    if (typeof window !== 'undefined' && window.sentryErrorCount >= 10) {
      return null;
    }

    if (event.exception) {
      const error = hint.originalException;
      const errorMessage = error?.message || event.exception?.values?.[0]?.value || '';

      // Filter out ignored error patterns
      const shouldIgnore = IGNORED_ERROR_PATTERNS.some(pattern => 
        errorMessage.includes(pattern)
      );

      if (shouldIgnore) {
        return null;
      }

      if (typeof window !== 'undefined') {
        window.sentryErrorCount = (window.sentryErrorCount || 0) + 1;
      }
    }

    // Security: Remove sensitive keys from extra data
    if (event.extra) {
      const sensitiveKeys = ['token', 'key', 'password', 'secret', 'auth', 'credential', 'cookie', 'session'];
      Object.keys(event.extra).forEach(key => {
        if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
          delete event.extra[key];
        }
      });
    }

    // Security: Sanitize URLs (remove query params which may contain sensitive data)
    if (event.request && event.request.url) {
      try {
        const url = new URL(event.request.url);
        url.search = '';
        url.hash = '';
        event.request.url = url.toString();
      } catch (e) {
        delete event.request.url;
      }
    }

    // Security: Sanitize breadcrumb URLs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map(breadcrumb => {
        if (breadcrumb.data?.url) {
          try {
            const url = new URL(breadcrumb.data.url);
            url.search = '';
            url.hash = '';
            breadcrumb.data.url = url.toString();
          } catch (e) {
            delete breadcrumb.data.url;
          }
        }
        return breadcrumb;
      });
    }

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

// Initialize error count
if (typeof window !== 'undefined') {
  window.sentryErrorCount = 0;
}

/**
 * Initialize Sentry
 * Uses isolated client approach for Chrome extensions to avoid conflicts
 * with other Sentry instances that might be on web pages
 */
export function initSentry(component, additionalConfig = {}) {
  try {
    // Prevent double initialization
    if (sentryInitialized) {
      log('Sentry already initialized, skipping');
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
    // This runs async but doesn't block initialization
    (async () => {
      try {
        const visitorId = await getOrCreateVisitorId();
        const result = await chrome.storage.sync.get(['region', 'onboardingComplete', 'autoPlay', 'quietHours', 'quickAccessEnabled']);
        Sentry.setUser({
          id: visitorId,
          data: {
            region: result.region || 'US',
            onboarded: result.onboardingComplete || false,
            autoPlay: result.autoPlay || false,
            quietHours: result.quietHours || false,
            quickAccess: result.quickAccessEnabled || false,
          }
        });
      } catch (error) {
        logError('Failed to set user context:', error);
      }
    })();

    const manifest = chrome.runtime.getManifest();
    Sentry.setContext('extension', {
      version: manifest.version,
      name: manifest.name,
      component: component,
      manifestVersion: manifest.manifest_version,
    });

    log(`Sentry initialized for ${component}`);

  } catch (error) {
    logError('Failed to initialize Sentry:', error);
  }
}


/**
 * Check if Sentry is initialized
 */
export function isSentryInitialized() {
  return sentryInitialized;
}

/**
 * Capture an exception
 * Logs to console (dev) via logger, and sends to Sentry (always/prod)
 */
export function captureException(error, context = {}) {
  // Log locally using our unified logger
  logError('[Sentry Error]:', error);
  if (context && Object.keys(context).length > 0) {
    logError('Context:', context);
  }

  try {
    Sentry.withScope((scope) => {
      if (context.extra) {
        Object.keys(context.extra).forEach(key => scope.setExtra(key, context.extra[key]));
      }
      if (context.tags) {
        Object.keys(context.tags).forEach(key => scope.setTag(key, context.tags[key]));
      }
      if (context.user) {
        scope.setUser(context.user);
      }
      if (context.level) {
        scope.setLevel(context.level);
      }
      const eventId = Sentry.captureException(error);
      log(`Sentry event captured with ID: ${eventId}`);
    });
  } catch (sentryError) {
    logError('Failed to send to Sentry:', sentryError);
  }
}

/**
 * Capture a message
 */
export function captureMessage(message, level = 'info', context = {}) {
  if (level === 'error' || level === 'fatal') {
    logError(`[Sentry Message]: ${message}`, context);
  } else if (level === 'warning') {
    logWarn(`[Sentry Message]: ${message}`, context);
  } else {
    log(`[Sentry Message]: ${message}`, context);
  }

  try {
    Sentry.withScope((scope) => {
      if (context.extra) {
        Object.keys(context.extra).forEach(key => scope.setExtra(key, context.extra[key]));
      }
      if (context.tags) {
        Object.keys(context.tags).forEach(key => scope.setTag(key, context.tags[key]));
      }
      scope.setLevel(level);
      Sentry.captureMessage(message);
    });
  } catch (error) {
    logError('Failed to capture message with Sentry:', error);
  }
}

/**
 * Start a transaction (Span) for performance monitoring
 * Wraps Sentry.startInactiveSpan
 */
export function startTransaction(name, op = 'navigation', context = {}) {
  try {
    const span = Sentry.startInactiveSpan({
      name,
      op,
      attributes: context
    });

    if (!span) return null;

    return {
      finish: () => span.end(),
      setStatus: (status) => {
        let statusCode = 2; // ERROR
        if (status === 'ok') statusCode = 1; // OK
        if (status === 'cancelled') statusCode = 2;
        span.setStatus({ code: statusCode });
      },
      setData: (key, value) => {
        span.setAttribute(key, value);
      }
    };
  } catch (error) {
    logError('Failed to start transaction:', error);
    return null;
  }
}

export function addBreadcrumb(message, category = 'default', level = 'info', data = {}) {
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

export async function updateUserContext(newSettings = {}) {
  try {
    const visitorId = await getOrCreateVisitorId();
    const result = await chrome.storage.sync.get(['region', 'onboardingComplete', 'autoPlay', 'quietHours', 'quickAccessEnabled']);
    Sentry.setUser({
      id: visitorId,
      data: {
        region: newSettings.region || result.region || 'US',
        onboarded: newSettings.onboardingComplete !== undefined ? newSettings.onboardingComplete : (result.onboardingComplete || false),
        autoPlay: newSettings.autoPlay !== undefined ? newSettings.autoPlay : (result.autoPlay || false),
        quietHours: newSettings.quietHours !== undefined ? newSettings.quietHours : (result.quietHours || false),
        quickAccess: newSettings.quickAccessEnabled !== undefined ? newSettings.quickAccessEnabled : (result.quickAccessEnabled || false),
      }
    });
  } catch (error) {
    logError('Failed to update user context:', error);
  }
}

export function setPerformanceContext(operation, data = {}) {
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

export { Sentry };
