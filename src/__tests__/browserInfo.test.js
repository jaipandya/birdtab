/**
 * browserInfo tests: Firefox-specific install detection, data collection
 * consent and new tab URL handling, plus the Chrome defaults.
 */

function loadBrowserInfo(browser) {
  const previous = process.env.BROWSER;
  process.env.BROWSER = browser;
  let browserInfo;
  jest.isolateModules(() => {
    browserInfo = require('../browserInfo.js');
  });
  process.env.BROWSER = previous;
  return browserInfo;
}

describe('browserInfo', () => {
  let permissionListeners;

  beforeEach(() => {
    permissionListeners = { added: [], removed: [] };
    global.chrome = {
      runtime: {
        getManifest: jest.fn(() => ({})),
        getURL: jest.fn((path) => `moz-extension://uuid/${path}`),
      },
      management: {
        getSelf: jest.fn(() => Promise.resolve({ installType: 'normal' })),
      },
      permissions: {
        getAll: jest.fn(() => Promise.resolve({ permissions: [], origins: [], data_collection: [] })),
        onAdded: { addListener: jest.fn((fn) => permissionListeners.added.push(fn)) },
        onRemoved: { addListener: jest.fn((fn) => permissionListeners.removed.push(fn)) },
      },
    };
  });

  describe('in Firefox', () => {
    const browserInfo = loadBrowserInfo('firefox');

    test('cannot open the browser new tab page', () => {
      expect(browserInfo.IS_FIREFOX).toBe(true);
      expect(browserInfo.canOpenBrowserNewTab()).toBe(false);
    });

    test('recognizes the overriding page as the new tab', () => {
      expect(browserInfo.isBrowserNewTabUrl('moz-extension://uuid/index.html')).toBe(true);
      expect(browserInfo.isBrowserNewTabUrl('about:newtab')).toBe(true);
      expect(browserInfo.isBrowserNewTabUrl('https://example.com/')).toBe(false);
    });

    test('treats AMO installs as store installs', async () => {
      await expect(browserInfo.isStoreInstall()).resolves.toBe(true);
    });

    test.each(['development', 'temporary'])('treats %s installs as development', async (installType) => {
      chrome.management.getSelf.mockResolvedValue({ installType });
      await expect(browserInfo.isStoreInstall()).resolves.toBe(false);
    });

    test('has no consent until technicalAndInteraction is granted', async () => {
      await expect(browserInfo.hasDataCollectionConsent()).resolves.toBe(false);

      chrome.permissions.getAll.mockResolvedValue({ data_collection: ['technicalAndInteraction'] });
      await expect(browserInfo.hasDataCollectionConsent()).resolves.toBe(true);
    });

    test('has no consent when permissions cannot be read', async () => {
      chrome.permissions.getAll.mockRejectedValue(new Error('unavailable'));
      await expect(browserInfo.hasDataCollectionConsent()).resolves.toBe(false);
    });

    test('reports consent changes for technicalAndInteraction only', () => {
      const listener = jest.fn();
      browserInfo.onDataCollectionConsentChanged(listener);

      permissionListeners.added.forEach((fn) => fn({ permissions: ['topSites'] }));
      expect(listener).not.toHaveBeenCalled();

      permissionListeners.added.forEach((fn) => fn({ data_collection: ['technicalAndInteraction'] }));
      permissionListeners.removed.forEach((fn) => fn({ data_collection: ['technicalAndInteraction'] }));
      expect(listener.mock.calls).toEqual([[true], [false]]);
    });
  });

  describe('in Chrome', () => {
    const browserInfo = loadBrowserInfo('chrome');

    test('opens the Chrome new tab page', () => {
      expect(browserInfo.canOpenBrowserNewTab()).toBe(true);
      expect(browserInfo.getNewTabUrl()).toBe('chrome://new-tab-page');
    });

    test('uses update_url to tell store installs apart', async () => {
      await expect(browserInfo.isStoreInstall()).resolves.toBe(false);
      chrome.runtime.getManifest.mockReturnValue({ update_url: 'https://clients2.google.com/service/update2/crx' });
      await expect(browserInfo.isStoreInstall()).resolves.toBe(true);
    });

    test('always has data collection consent', async () => {
      await expect(browserInfo.hasDataCollectionConsent()).resolves.toBe(true);
      expect(chrome.permissions.getAll).not.toHaveBeenCalled();
    });

    test('does not watch consent changes', () => {
      browserInfo.onDataCollectionConsentChanged(jest.fn());
      expect(chrome.permissions.onAdded.addListener).not.toHaveBeenCalled();
    });
  });
});
