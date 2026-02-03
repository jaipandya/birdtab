#!/usr/bin/env node

/**
 * BirdTab Chrome Extension Deployment Script
 * Cross-platform Node.js version
 *
 * This script:
 * 1. Builds the production extension
 * 2. Creates a deployment-ready zip file
 * 3. Provides deployment instructions including git tagging
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { rimraf } = require('rimraf');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function exec(command, options = {}) {
  return execSync(command, { stdio: 'inherit', ...options });
}

function getBrowserTarget(args) {
  const browserArg = args.find((arg) => arg.startsWith('--browser='));
  if (!browserArg) {
    return 'chrome';
  }

  const value = browserArg.split('=')[1];
  if (value === 'edge' || value === 'chrome') {
    return value;
  }

  log(`\n⚠️  Unknown browser "${value}", defaulting to Chrome.`, colors.yellow);
  return 'chrome';
}

async function main() {
  log('\n🚀 BirdTab Deployment Script\n', colors.blue);

  const browserTarget = getBrowserTarget(process.argv.slice(2));
  const isEdge = browserTarget === 'edge';

  // Read version from manifest.json
  const manifestPath = path.join(__dirname, '../src/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let version = manifest.version;

  log(`📦 Current version: ${version}`, colors.blue);

  // Check last deployed version from git tags
  let lastDeployedVersion = null;
  try {
    const tags = execSync('git tag -l "deployed-*"', { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(tag => tag.startsWith('deployed-v'));

    if (tags.length > 0) {
      // Sort tags and get the latest
      tags.sort((a, b) => {
        const versionA = a.replace('deployed-v', '');
        const versionB = b.replace('deployed-v', '');
        return versionA.localeCompare(versionB, undefined, { numeric: true });
      });
      const lastTag = tags[tags.length - 1];
      lastDeployedVersion = lastTag.replace('deployed-v', '');
      log(`📋 Last deployed: ${lastDeployedVersion}`, colors.blue);
    }
  } catch (error) {
    // No tags found or git error
  }

  // Auto-bump version if it matches last deployed version
  if (lastDeployedVersion && version === lastDeployedVersion) {
    log(`\n⚠️  Version ${version} was already deployed!`, colors.yellow);

    // Auto-bump patch version
    const versionParts = version.split('.').map(Number);
    versionParts[2] += 1; // Increment patch version
    const newVersion = versionParts.join('.');

    log(`🔼 Auto-bumping version: ${version} → ${newVersion}`, colors.green);

    // Update manifest
    manifest.version = newVersion;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    version = newVersion;

    // Commit the version bump
    log('📝 Committing version bump...', colors.blue);
    try {
      exec('git add src/manifest.json');
      exec(`git commit -m "Bump version to ${newVersion}"`);
      log(`✅ Committed version bump to ${newVersion}`, colors.green);
    } catch (error) {
      log(`⚠️  Failed to commit version bump: ${error.message}`, colors.yellow);
    }
  }

  log(`\n📦 Building version: ${version}`, colors.green);

  // Get current git commit (after potential version bump commit)
  const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  log(`📝 Commit: ${commit}`, colors.blue);

  // Check for uncommitted changes (excluding manifest.json which we just bumped)
  try {
    const status = execSync('git status --short', { encoding: 'utf8' });
    const filteredStatus = status.split('\n')
      .filter(line => !line.includes('manifest.json'))
      .join('\n')
      .trim();

    if (filteredStatus) {
      log('\n⚠️  Warning: You have uncommitted changes!', colors.red);
      log(filteredStatus, colors.yellow);
    }
  } catch (error) {
    // Ignore git status errors
  }

  log('\n🔨 Building production...\n', colors.blue);

  // Build using pnpm with UPLOAD_SOURCEMAPS enabled
  try {
    const buildCommand = isEdge ? 'pnpm run build:edge' : 'pnpm run build:chrome';
    exec(buildCommand, {
      env: { ...process.env, UPLOAD_SOURCEMAPS: 'true' }
    });
  } catch (error) {
    log('\n❌ Build failed!', colors.red);
    process.exit(1);
  }

  // Create releases directory
  const releasesDir = path.join(__dirname, '../releases');
  if (!fs.existsSync(releasesDir)) {
    fs.mkdirSync(releasesDir, { recursive: true });
  }

  // Create zip filename
  const filename = isEdge
    ? `birdtab-edge-v${version}-${commit}.zip`
    : `birdtab-v${version}-${commit}.zip`;
  const filepath = path.join(releasesDir, filename);

  log(`\n📦 Creating zip file: ${filename}\n`, colors.blue);

  // Remove old zip if exists
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }

  // Create zip using built-in zip command or 7z on Windows
  const distDir = path.join(__dirname, isEdge ? '../dist-edge' : '../dist-chrome');

  try {
    if (process.platform === 'win32') {
      // Windows: try PowerShell Compress-Archive
      exec(`powershell -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${filepath}' -Force"`, { stdio: 'inherit' });
    } else {
      // Unix/Mac: use zip command
      exec(`cd "${distDir}" && zip -r "${filepath}" . -x "*.map"`, { stdio: 'inherit' });
    }
  } catch (error) {
    log('\n❌ Failed to create zip file!', colors.red);
    log('Please install zip command or use 7-Zip on Windows', colors.yellow);
    process.exit(1);
  }

  // Get file size
  const stats = fs.statSync(filepath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  log(`\n✅ Build complete!\n`, colors.green);
  log(`📁 Package: releases/${filename}`, colors.green);
  log(`📊 Size: ${sizeMB} MB`, colors.green);
  log(`\n📋 Next steps:`, colors.yellow);
  log(`   1. Test the extension locally from ${isEdge ? 'dist-edge' : 'dist-chrome'}/`);
  log(`   2. Upload ${filename} to ${isEdge ? 'Microsoft Edge Add-ons' : 'Chrome Web Store'}`);
  log(`   3. After deployment, tag this commit:`, colors.yellow);
  log(`      git tag -a deployed-v${version} -m "Deployed v${version} to ${isEdge ? 'Microsoft Edge Add-ons' : 'Chrome Web Store'}"`, colors.blue);
  log(`      git push origin deployed-v${version}`, colors.blue);
  log('');
}

main().catch((error) => {
  log(`\n❌ Error: ${error.message}`, colors.red);
  process.exit(1);
});
