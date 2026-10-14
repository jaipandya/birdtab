#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { diffPermissions, PERMISSIONS_BASELINE } = require('./permissions_baseline');

const distDir = path.join(__dirname, '../dist-chrome');
const edgeImagesDir = path.join(distDir, 'images', 'edge');
const manifestPath = path.join(distDir, 'manifest.json');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

if (!fs.existsSync(distDir)) {
  fail('dist-chrome/ not found. Run `pnpm run build:chrome` first.');
}

if (fs.existsSync(edgeImagesDir)) {
  fail('Edge assets found in dist-chrome/images/edge. Chrome build must not include Edge assets.');
}

if (!fs.existsSync(manifestPath)) {
  fail('dist-chrome/manifest.json not found.');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const permissionDifferences = diffPermissions(manifest);
if (permissionDifferences.length > 0) {
  fail(
    `Permissions differ from ${PERMISSIONS_BASELINE.version}; Chrome would ask users to re-approve the update:\n   ` +
    permissionDifferences.join('\n   ')
  );
}

if (JSON.stringify(manifest).includes('localhost')) {
  fail('dist-chrome/manifest.json mentions localhost. Use a production build (pnpm run build:chrome).');
}

console.log('✅ Chrome build verification passed.');
