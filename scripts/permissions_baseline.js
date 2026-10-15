/**
 * Permissions each production build must have, per browser.
 *
 * A permission (or host) users haven't granted before makes the browser
 * disable the extension on update until they re-approve it, so production
 * builds must match these exactly. Only change them on purpose, together
 * with a release plan for re-consent.
 */
const PERMISSIONS_BASELINES = {
  // The published Chrome 2.0.3 build (dist-chrome/manifest.json)
  chrome: {
    version: '2.0.3',
    permissions: ['storage', 'unlimitedStorage', 'search'],
    optional_permissions: ['topSites'],
    host_permissions: ['https://*.birdtab.app/*', 'https://*.ingest.us.sentry.io/*'],
  },
  // Edge Add-ons is on 1.3.9, which granted storage, search, optional
  // topSites and the hosts api.birdtab.app, search.macaulaylibrary.org and
  // *.ingest.us.sentry.io. The Edge build stays within those: it reads
  // media.birdtab.app through the bucket's CORS policy (any origin,
  // crawlers/r2-cors.json) instead of a host permission. unlimitedStorage is
  // new but has no permission warning, so it doesn't ask for re-approval.
  edge: {
    version: '1.3.9 (Edge Add-ons)',
    permissions: ['storage', 'unlimitedStorage', 'search'],
    optional_permissions: ['topSites'],
    host_permissions: ['https://*.ingest.us.sentry.io/*'],
  },
  // Firefox Add-ons (AMO) first release. No host permissions: Firefox MV3
  // leaves them ungranted until the user opts in, and nothing needs them
  // (media.birdtab.app, PostHog and Sentry ingest all answer CORS requests).
  firefox: {
    version: '2.1.1 (Firefox Add-ons)',
    permissions: ['storage', 'unlimitedStorage', 'search'],
    optional_permissions: ['topSites'],
    host_permissions: [],
  },
};

const PERMISSIONS_BASELINE = PERMISSIONS_BASELINES.chrome;

const PERMISSION_FIELDS = ['permissions', 'optional_permissions', 'host_permissions'];

/**
 * Compare a built manifest's permissions with its browser's baseline.
 * @returns {string[]} one message per field that differs (empty when equal)
 */
function diffPermissions(manifest, browser = 'chrome') {
  const baseline = PERMISSIONS_BASELINES[browser];
  return PERMISSION_FIELDS
    .filter(field => JSON.stringify(manifest[field] || []) !== JSON.stringify(baseline[field]))
    .map(field => `${field}: expected ${JSON.stringify(baseline[field])}, got ${JSON.stringify(manifest[field] || [])}`);
}

module.exports = { PERMISSIONS_BASELINE, PERMISSIONS_BASELINES, PERMISSION_FIELDS, diffPermissions };
