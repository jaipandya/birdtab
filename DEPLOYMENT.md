# BirdTab Deployment Guide

This guide explains how to build, package, and deploy BirdTab to the Chrome Web Store.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Deployment Workflow](#deployment-workflow)
- [Available Scripts](#available-scripts)
- [Versioning](#versioning)
- [Tracking Deployments with Git Tags](#tracking-deployments-with-git-tags)
- [Troubleshooting](#troubleshooting)

## Prerequisites

1. **Environment Variables**: Ensure `.env` file exists with required variables:
   ```bash
   SENTRY_AUTH_TOKEN=your_token_here
   SENTRY_ORG=mutables
   SENTRY_PROJECT=birdtab-extension
   API_SERVER_URL=https://your-api-url
   ```

2. **Clean Git State**: It's recommended to have all changes committed before deployment.

3. **Version Bump**: Update version in `src/manifest.json` before deployment.

## Deployment Workflow

### Step 1: Update Version

Edit `src/manifest.json` and bump the version:

```json
{
  "version": "1.2.13"  // Increment from 1.2.12
}
```

### Step 2: Commit Version Change

```bash
git add src/manifest.json
git commit -m "Bump version to 1.2.13"
```

### Step 3: Build and Package

Run the deployment script:

```bash
npm run deploy
```

This will:
- ✅ Clean the dist-chrome folder
- ✅ Build production bundle with Webpack
- ✅ Upload source maps to Sentry
- ✅ Delete source maps from build
- ✅ Create a zip file: `releases/birdtab-v1.2.13-abc1234.zip`

The zip filename includes:
- Version number (from manifest.json)
- Git commit hash (for traceability)

### Step 4: Test Locally

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist-chrome` folder
6. Test all features thoroughly

### Step 5: Upload to Chrome Web Store

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
2. Select your extension
3. Click "Upload new package"
4. Upload the zip file from `releases/` folder
5. Fill in changelog/description
6. Submit for review

### Step 6: Tag the Deployment

After the extension is live on Chrome Web Store:

```bash
npm run tag-deployment
```

This will:
- Create an annotated git tag: `deployed-v1.2.13`
- Tag message: "Deployed v1.2.13 to Chrome Web Store"
- Push the tag to remote (optional)

**Or manually:**

```bash
git tag -a deployed-v1.2.13 -m "Deployed v1.2.13 to Chrome Web Store"
git push origin deployed-v1.2.13
```

## Available Scripts

### Production Build

```bash
npm run build:chrome    # Build for Chrome
npm run build:edge      # Build for Edge
```

### Development

```bash
npm run dev:chrome      # Watch mode for Chrome
npm run dev:edge        # Watch mode for Edge
```

### Deployment

```bash
npm run deploy          # Build and create deployment zip
npm run tag-deployment  # Tag current version as deployed
```

### Utilities

```bash
npm run clean           # Clean all dist folders
npm run check:i18n      # Check translation completeness
npm run check:unused    # Check for unused translation strings
```

## Versioning

We use semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR** (1.x.x): Breaking changes, major new features
- **MINOR** (x.2.x): New features, backwards compatible
- **PATCH** (x.x.13): Bug fixes, minor improvements

### When to bump each version:

- **Bug fixes**: `1.2.12` → `1.2.13`
- **New features**: `1.2.13` → `1.3.0`
- **Breaking changes**: `1.3.0` → `2.0.0`

## Tracking Deployments with Git Tags

### Why Use Deployment Tags?

Git tags let you track **when** a version was deployed, separate from when it was built:

- `v1.2.13` (release tag) = Code is ready
- `deployed-v1.2.13` (deployment tag) = Live on Chrome Web Store

### View Deployment History

List all deployed versions:

```bash
git tag -l "deployed-*"
```

See when a version was deployed:

```bash
git show deployed-v1.2.13
```

View deployment timeline:

```bash
git log --tags="deployed-*" --simplify-by-decoration --pretty="format:%ai %d"
```

### Compare Deployed vs Current

See what changed since last deployment:

```bash
# Find last deployed tag
LAST_DEPLOYED=$(git tag -l "deployed-*" | sort -V | tail -1)

# See commits since then
git log $LAST_DEPLOYED..HEAD --oneline

# See file changes
git diff $LAST_DEPLOYED..HEAD
```

## Build Output

### Production Build (`dist-chrome/`)

```
dist-chrome/
├── manifest.json          # Extension manifest
├── background.js          # Service worker (minified)
├── script.js             # Content script (minified)
├── popup.js              # Popup script (minified)
├── *.css                 # Stylesheets (minified)
├── images/               # Static images
├── icons/                # Extension icons
└── _locales/             # Translations
```

### Deployment Package (`releases/`)

```
releases/
└── birdtab-v1.2.13-abc1234.zip
```

## Troubleshooting

### Source Maps Not Uploaded to Sentry

**Problem**: Build succeeds but source maps aren't uploaded.

**Solution**: Check your `.env` file has `SENTRY_AUTH_TOKEN` set.

```bash
# Verify Sentry token
echo $SENTRY_AUTH_TOKEN

# If empty, add to .env:
SENTRY_AUTH_TOKEN=your_token_here
```

### Zip Creation Failed

**Problem**: Script fails to create zip file.

**Solution**:
- **Mac/Linux**: Install `zip` command
  ```bash
  # Mac (via Homebrew)
  brew install zip

  # Linux
  sudo apt-get install zip
  ```

- **Windows**: Use PowerShell (included by default) or install 7-Zip

### Version Already Tagged

**Problem**: Tag `deployed-v1.2.13` already exists.

**Solution**: Delete the old tag if you're re-deploying:

```bash
git tag -d deployed-v1.2.13
git push origin :refs/tags/deployed-v1.2.13  # Delete from remote
```

Then re-run `npm run tag-deployment`.

### Uncommitted Changes Warning

**Problem**: Deploy script warns about uncommitted changes.

**Solution**: Commit your changes first:

```bash
git status                    # See what's changed
git add .                     # Stage changes
git commit -m "Your message"  # Commit
npm run deploy                # Re-run deploy
```

## Best Practices

1. **Always bump version** before deploying
2. **Test locally** before uploading to Chrome Web Store
3. **Tag deployments** immediately after they go live
4. **Keep deployment zips** for rollback capability
5. **Document changes** in git commit messages
6. **Monitor Sentry** after deployment for new errors

## Rollback Procedure

If you need to rollback to a previous version:

1. Find the deployed tag:
   ```bash
   git tag -l "deployed-*"
   ```

2. Checkout that tag:
   ```bash
   git checkout deployed-v1.2.12
   ```

3. Rebuild and deploy:
   ```bash
   npm run deploy
   ```

4. Upload the older version to Chrome Web Store

---

**Questions?** Check the [main README](./README.md) or create an issue.
