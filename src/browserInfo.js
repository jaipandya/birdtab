export const IS_EDGE = process.env.BROWSER === 'edge';
export const IS_FIREFOX = process.env.BROWSER === 'firefox';

// Firefox users choose at install (and later in about:addons) whether the
// extension may send technical and interaction data: analytics and error reports
const DATA_COLLECTION_CONSENT = 'technicalAndInteraction';

export function getNewTabUrl() {
  if (IS_EDGE) {
    return 'https://ntp.msn.com/edge/ntp';
  }
  return 'chrome://new-tab-page';
}

/**
 * Whether the browser's own new tab page can be opened from BirdTab.
 * Firefox doesn't let extensions open its built-in home or new tab page.
 */
export function canOpenBrowserNewTab() {
  return !IS_FIREFOX;
}

export function isBrowserNewTabUrl(url) {
  if (!url) return false;

  if (IS_EDGE) {
    return (
      url === 'https://ntp.msn.com/edge/ntp' ||
      url === 'https://ntp.msn.com/edge/ntp/' ||
      url === 'edge://newtab/' ||
      url === 'edge://new-tab-page/' ||
      url === 'chrome://newtab/'
    );
  }

  if (IS_FIREFOX) {
    // Firefox shows the overriding page's own URL in the tab
    return url === 'about:newtab' || url.startsWith(chrome.runtime.getURL('index.html'));
  }

  return url === 'chrome://newtab/';
}

/**
 * Whether this is a store install rather than a development load
 * (unpacked in Chrome/Edge, temporary or web-ext in Firefox).
 * Chrome and Edge store installs carry update_url in the manifest;
 * AMO-signed Firefox installs don't, so Firefox asks the management API.
 */
export async function isStoreInstall() {
  if (!IS_FIREFOX) {
    return Boolean(chrome.runtime.getManifest().update_url);
  }
  try {
    const self = await chrome.management.getSelf();
    return self.installType !== 'development' && self.installType !== 'temporary';
  } catch {
    return false;
  }
}

/**
 * Whether the user allows analytics and error reports to be sent.
 * Always true outside Firefox; in Firefox it follows the built-in data
 * collection consent for technicalAndInteraction.
 */
export async function hasDataCollectionConsent() {
  if (!IS_FIREFOX) {
    return true;
  }
  try {
    const granted = await chrome.permissions.getAll();
    return Array.isArray(granted.data_collection) &&
      granted.data_collection.includes(DATA_COLLECTION_CONSENT);
  } catch {
    return false;
  }
}

/**
 * Call listener(granted) when the user changes data collection consent
 * in about:addons. No-op outside Firefox.
 */
export function onDataCollectionConsentChanged(listener) {
  if (!IS_FIREFOX || !chrome.permissions?.onAdded) {
    return;
  }
  const affectsConsent = (permissions) =>
    Array.isArray(permissions?.data_collection) &&
    permissions.data_collection.includes(DATA_COLLECTION_CONSENT);

  chrome.permissions.onAdded.addListener((permissions) => {
    if (affectsConsent(permissions)) listener(true);
  });
  chrome.permissions.onRemoved.addListener((permissions) => {
    if (affectsConsent(permissions)) listener(false);
  });
}
