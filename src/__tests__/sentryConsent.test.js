/**
 * Firefox Sentry consent tests: error reports start only with data
 * collection consent, stop when it's withdrawn, and the consent listener is
 * registered once however often the user toggles it.
 */

jest.mock('@sentry/browser', () => ({
  init: jest.fn(),
  close: jest.fn(),
  setTag: jest.fn(),
  setUser: jest.fn(),
  setContext: jest.fn(),
  browserTracingIntegration: jest.fn(() => ({})),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock('../browserInfo.js', () => {
  const consentListeners = [];
  return {
    IS_FIREFOX: true,
    isStoreInstall: jest.fn(() => Promise.resolve(true)),
    hasDataCollectionConsent: jest.fn(() => Promise.resolve(false)),
    onDataCollectionConsentChanged: jest.fn((listener) => consentListeners.push(listener)),
    __consentListeners: consentListeners,
  };
});

const Sentry = require('@sentry/browser');
const browserInfo = require('../browserInfo.js');
const { initSentry } = require('../sentry.js');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setConsent(granted) {
  browserInfo.hasDataCollectionConsent.mockResolvedValue(granted);
  browserInfo.__consentListeners.forEach((listener) => listener(granted));
}

describe('Sentry in Firefox', () => {
  beforeAll(() => {
    global.chrome = {
      runtime: {
        getManifest: jest.fn(() => ({ version: '2.1.1', name: 'BirdTab', manifest_version: 3 })),
      },
      storage: {
        local: { get: jest.fn(() => Promise.resolve({})), set: jest.fn(() => Promise.resolve()) },
        sync: { get: jest.fn(() => Promise.resolve({})) },
      },
    };
  });

  test('starts only with consent, stops when withdrawn, and listens once', async () => {
    initSentry('background', { dsn: 'https://key@o0.ingest.us.sentry.io/0' });
    await flush();
    expect(Sentry.init).not.toHaveBeenCalled();

    setConsent(true);
    await flush();
    expect(Sentry.init).toHaveBeenCalledTimes(1);

    setConsent(false);
    expect(Sentry.close).toHaveBeenCalledTimes(1);

    setConsent(true);
    await flush();
    setConsent(false);
    setConsent(true);
    await flush();

    expect(browserInfo.onDataCollectionConsentChanged).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledTimes(3);
    expect(Sentry.close).toHaveBeenCalledTimes(2);
  });
});
