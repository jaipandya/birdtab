#!/usr/bin/env node

/**
 * Tag Deployment Script
 *
 * Creates an annotated git tag to mark when a version was deployed to Chrome Web Store
 * Usage: npm run tag-deployment
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function exec(command) {
  return execSync(command, { encoding: 'utf8' }).trim();
}

async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  log('\n🏷️  Tag Deployment\n', colors.blue);

  // Read version from manifest.json
  const manifestPath = path.join(__dirname, '../src/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = manifest.version;

  log(`📦 Current version: ${version}`, colors.blue);

  // Check if tag already exists
  const tagName = `deployed-v${version}`;
  try {
    exec(`git rev-parse ${tagName}`);
    log(`\n⚠️  Tag ${tagName} already exists!`, colors.yellow);
    const overwrite = await promptUser('Overwrite? (y/N): ');
    if (overwrite.toLowerCase() !== 'y') {
      log('❌ Cancelled', colors.red);
      process.exit(0);
    }
    // Delete existing tag
    exec(`git tag -d ${tagName}`);
    log(`🗑️  Deleted existing tag`, colors.yellow);
  } catch (error) {
    // Tag doesn't exist, which is fine
  }

  // Get current commit
  const commit = exec('git rev-parse --short HEAD');
  log(`📝 Commit: ${commit}`, colors.blue);

  // Check for uncommitted changes
  const status = exec('git status --short');
  if (status) {
    log('\n⚠️  Warning: You have uncommitted changes!', colors.yellow);
    log('It\'s recommended to commit all changes before tagging deployments.', colors.yellow);
    const proceed = await promptUser('Continue anyway? (y/N): ');
    if (proceed.toLowerCase() !== 'y') {
      log('❌ Cancelled', colors.red);
      process.exit(0);
    }
  }

  // Confirm deployment
  log(`\n📋 This will create tag: ${tagName}`, colors.yellow);
  const confirm = await promptUser('Have you deployed this version to Chrome Web Store? (y/N): ');
  if (confirm.toLowerCase() !== 'y') {
    log('❌ Cancelled - Deploy to Chrome Web Store first!', colors.red);
    process.exit(0);
  }

  // Create annotated tag
  const message = `Deployed v${version} to Chrome Web Store`;
  try {
    exec(`git tag -a ${tagName} -m "${message}"`);
    log(`\n✅ Created tag: ${tagName}`, colors.green);
  } catch (error) {
    log(`\n❌ Failed to create tag: ${error.message}`, colors.red);
    process.exit(1);
  }

  // Ask to push
  const push = await promptUser('\nPush tag to remote? (Y/n): ');
  if (push.toLowerCase() !== 'n') {
    try {
      exec(`git push origin ${tagName}`);
      log(`✅ Pushed tag to remote`, colors.green);
    } catch (error) {
      log(`❌ Failed to push tag: ${error.message}`, colors.red);
      log(`You can push manually with: git push origin ${tagName}`, colors.yellow);
      process.exit(1);
    }
  }

  log('\n✅ Deployment tagged successfully!\n', colors.green);
  log('📋 To view deployment history:', colors.blue);
  log('   git tag -l "deployed-*"', colors.blue);
  log('\n📋 To see when a version was deployed:', colors.blue);
  log(`   git show ${tagName}`, colors.blue);
  log('');
}

main().catch((error) => {
  log(`\n❌ Error: ${error.message}`, colors.red);
  process.exit(1);
});
