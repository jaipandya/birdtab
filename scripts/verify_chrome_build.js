#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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

console.log('✅ Chrome build verification passed.');
