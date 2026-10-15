#!/usr/bin/env node

/**
 * BirdTab Extension Deployment Script
 * Cross-platform Node.js version
 *
 * This script:
 * 1. Builds the production extension (--browser=chrome|edge|firefox)
 * 2. Creates a deployment-ready zip file
 * 3. For Firefox, lints the build and creates the source zip AMO review needs
 * 4. Provides deployment instructions including git tagging
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
  if (value === 'chrome' || value === 'edge' || value === 'firefox') {
    return value;
  }

  log(`\n⚠️  Unknown browser "${value}", defaulting to Chrome.`, colors.yellow);
  return 'chrome';
}

async function main() {
  log('\n🚀 BirdTab Deployment Script\n', colors.blue);

  const browserTarget = getBrowserTarget(process.argv.slice(2));
  const isEdge = browserTarget === 'edge';
  const isFirefox = browserTarget === 'firefox';
  const browserSlug = browserTarget;
  const browserLabel = {
    chrome: 'Chrome Web Store',
    edge: 'Microsoft Edge Add-ons',
    firefox: 'Firefox Add-ons (AMO)',
  }[browserTarget];

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

  // Auto-bump version if it matches last deployed version. deployed-v* tags
  // mark Chrome Web Store submissions; Edge and Firefox ship the same version
  // from the same commit, so they never bump.
  if (browserSlug === 'chrome' && lastDeployedVersion && version === lastDeployedVersion) {
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
    exec(`pnpm run build:${browserSlug}`, {
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
  const filename = browserSlug === 'chrome'
    ? `birdtab-v${version}-${commit}.zip`
    : `birdtab-${browserSlug}-v${version}-${commit}.zip`;
  const filepath = path.join(releasesDir, filename);

  log(`\n📦 Creating zip file: ${filename}\n`, colors.blue);

  // Remove old zip if exists
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }

  // Create zip using built-in zip command or 7z on Windows
  const distDir = path.join(__dirname, `../dist-${browserSlug}`);

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

  // Firefox: run AMO's linter, then package the source code reviewers build from
  let sourceFilename = null;
  if (isFirefox) {
    log('\n🔍 Linting with web-ext (same checks as AMO)...\n', colors.blue);
    try {
      exec('pnpm run lint:firefox');
    } catch (error) {
      log('\n❌ web-ext lint found errors. Fix them before uploading.', colors.red);
      process.exit(1);
    }
    sourceFilename = `birdtab-firefox-v${version}-${commit}-source.zip`;
    createAmoSourceZip(path.join(releasesDir, sourceFilename));
  }

  // Get file size
  const stats = fs.statSync(filepath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  log(`\n✅ Build complete!\n`, colors.green);
  log(`📁 Package: releases/${filename}`, colors.green);
  log(`📊 Size: ${sizeMB} MB`, colors.green);
  if (sourceFilename) {
    log(`📁 Source for AMO review: releases/${sourceFilename}`, colors.green);
  }
  log(`\n📋 Next steps:`, colors.yellow);
  log(`   1. Test the extension locally from dist-${browserSlug}/`);
  log(`   2. Upload ${filename} to ${browserLabel}`);
  if (sourceFilename) {
    log(`      When AMO asks for source code, upload ${sourceFilename}`);
  }
  log(`   3. After deployment, tag this commit:`, colors.yellow);
  log(`      git tag -a deployed-v${version} -m "Deployed v${version} to ${browserLabel}"`, colors.blue);
  log(`      git push origin deployed-v${version}`, colors.blue);
  log('');
}

/**
 * Zip the committed source (HEAD) for AMO review, without store assets.
 * The build reads POSTHOG_API_KEY and UNINSTALL_SECRET from .env.production;
 * both end up in the shipped bundle anyway, so the zip carries just those two
 * (never SENTRY_AUTH_TOKEN) so reviewers' builds match the upload.
 */
function createAmoSourceZip(sourceZipPath, treeish = 'HEAD') {
  const extensionDir = path.join(__dirname, '..');
  const BUNDLED_ENV_KEYS = ['POSTHOG_API_KEY', 'UNINSTALL_SECRET'];
  const env = require('dotenv').parse(fs.readFileSync(path.join(extensionDir, '.env.production')));
  const stagingDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'birdtab-amo-'));
  const envPath = path.join(stagingDir, '.env.production');
  fs.writeFileSync(envPath, BUNDLED_ENV_KEYS.map((key) => `${key}=${env[key] || ''}`).join('\n') + '\n');

  if (fs.existsSync(sourceZipPath)) {
    fs.unlinkSync(sourceZipPath);
  }
  // Top-level PNGs are store and marketing images; the extension's are in src/
  const excluded = ['screenshots', 'webstore', '*.png', '.claude*', '.claude*/**', '.vscode']
    .map((pattern) => `':(top,exclude,glob)${pattern}'`)
    .join(' ');
  exec(`git archive --format=zip --add-file="${envPath}" -o "${sourceZipPath}" ${treeish} -- . ${excluded}`, {
    cwd: extensionDir,
  });
  fs.rmSync(stagingDir, { recursive: true, force: true });
}

if (require.main === module) {
  main().catch((error) => {
    log(`\n❌ Error: ${error.message}`, colors.red);
    process.exit(1);
  });
}

module.exports = { createAmoSourceZip };
