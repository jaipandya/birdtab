/**
 * Permissions of the published 2.0.3 build (dist-chrome/manifest.json).
 *
 * Any change here makes Chrome disable the extension on update until the
 * user re-approves it, so production builds must match this exactly.
 * Only change it on purpose, together with a release plan for re-consent.
 */
const PERMISSIONS_BASELINE = {
  version: '2.0.3',
  permissions: ['storage', 'unlimitedStorage', 'search'],
  optional_permissions: ['topSites'],
  host_permissions: ['https://*.birdtab.app/*', 'https://*.ingest.us.sentry.io/*'],
};

const PERMISSION_FIELDS = ['permissions', 'optional_permissions', 'host_permissions'];

/**
 * Compare a built manifest's permissions with the baseline.
 * @returns {string[]} one message per field that differs (empty when equal)
 */
function diffPermissions(manifest) {
  return PERMISSION_FIELDS
    .filter(field => JSON.stringify(manifest[field] || []) !== JSON.stringify(PERMISSIONS_BASELINE[field]))
    .map(field => `${field}: expected ${JSON.stringify(PERMISSIONS_BASELINE[field])}, got ${JSON.stringify(manifest[field] || [])}`);
}

module.exports = { PERMISSIONS_BASELINE, PERMISSION_FIELDS, diffPermissions };
