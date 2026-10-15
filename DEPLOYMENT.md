# BirdTab Deployment Guide

This guide explains how to build, package, and submit BirdTab to the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons (AMO).

## Table of Contents

- [Release Checklist](#release-checklist)
- [Prerequisites](#prerequisites)
- [Deployment Workflow](#deployment-workflow)
- [Submitting to the Chrome Web Store](#submitting-to-the-chrome-web-store)
- [Submitting to Edge Add-ons](#submitting-to-edge-add-ons)
- [Submitting to Firefox Add-ons](#submitting-to-firefox-add-ons)
- [Submitting with Claude](#submitting-with-claude)
- [Available Scripts](#available-scripts)
- [Versioning](#versioning)
- [Tracking Deployments with Git Tags](#tracking-deployments-with-git-tags)
- [Troubleshooting](#troubleshooting)

## Release Checklist

Every release, minor ones included:

1. Bump `version` in `src/manifest.json` above the version live in **every** store, and commit it (`Bump to X.Y.Z`).
2. Add an `X.Y.Z - ...` line at the top of WHAT'S NEW in all 30 listing files: `webstore/*.txt` (Chrome), `webstore/edge/*.txt` (Edge) and `webstore/firefox/*.txt` (Firefox), ten languages each.
3. Build and zip each browser from the same commit (`pnpm run deploy`, `pnpm run deploy -- --browser=edge` and `pnpm run deploy -- --browser=firefox`).
4. Upload and submit to each store whose previous submission has finished review. A store with a version still in review has to wait; submit there once it clears, from the same commit if possible, so both stores ship the same code under the same version.
5. Paste the updated WHAT'S NEW into each store's listing description when you submit (Chrome: Store listing tab; Edge: Store listings).
6. Tag the commit you submitted to the Chrome Web Store: `deployed-vX.Y.Z` (see [Step 6](#step-6-tag-the-deployment)), and push the tag.
7. If the release changed permissions on purpose, update `scripts/permissions_baseline.js` to the newly published build once it is live.

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

The new version must be higher than what is live in **both** stores. Both stores reject a package whose version isn't higher than the current one.

### Step 2: Commit Version Change

```bash
git add src/manifest.json
git commit -m "Bump to 1.2.13"
```

If you skip this, `pnpm run deploy` (Chrome only) bumps the patch version itself (when the manifest matches the last `deployed-v*` tag) and commits the bump. Edge and Firefox deploys never bump: they ship the version Chrome shipped.

### Step 3: Build and Package

Run the deployment script:

```bash
pnpm run deploy                         # Chrome
pnpm run deploy -- --browser=edge       # Edge
pnpm run deploy -- --browser=firefox    # Firefox
```

Firefox deploys also run `web-ext lint` and write the source zip AMO asks for: `releases/birdtab-firefox-vX.Y.Z-<commit>-source.zip`. It's built from the committed `HEAD`, so commit before deploying. AMO reviewers rebuild the add-on from it and compare with the upload, so Firefox builds stay reproducible: Sentry's debug IDs are always injected (they're hashed from the code, no token needed) and the git-commit release isn't.

This will:
- ✅ Build production bundle with Webpack (fails if permissions drift from `scripts/permissions_baseline.js`)
- ✅ Upload source maps to Sentry
- ✅ Delete source maps from build
- ✅ Create a zip file: `releases/birdtab-v1.2.13-abc1234.zip` (Chrome) or `releases/birdtab-edge-v1.2.13-abc1234.zip` (Edge)

The zip filename includes:
- Version number (from manifest.json)
- Git commit hash (for traceability)

Then run `pnpm run check:chrome-build` for the Chrome build.

### Step 4: Test Locally

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist-chrome` folder
6. Test all features thoroughly

### Step 5: Upload to the stores

See [Submitting to the Chrome Web Store](#submitting-to-the-chrome-web-store) and [Submitting to Edge Add-ons](#submitting-to-edge-add-ons).

### Step 6: Tag the Deployment

Once the Chrome Web Store submission is in review:

```bash
pnpm run tag-deployment
```

This will:
- Create an annotated git tag: `deployed-v1.2.13`
- Tag message: "Deployed v1.2.13 to Chrome Web Store"
- Push the tag to remote (optional)

`tag-deployment` tags `HEAD` and asks questions interactively. If you've committed since building, or are running it non-interactively, tag the built commit by hand (it's in the zip filename):

```bash
git tag -a deployed-v1.2.13 -m "Deployed v1.2.13 to Chrome Web Store" abc1234
git push origin deployed-v1.2.13
```

## Submitting to the Chrome Web Store

Dashboard: https://chrome.google.com/webstore/devconsole/e66ead01-6e04-4f0a-9735-9b33162a862b/dkdnidbnjihhilbjndnnlfipmbnoaipn/edit

1. **Package** → **Upload new package** → select `releases/birdtab-vX.Y.Z-<commit>.zip`. The dashboard jumps to Store listing once the upload is processed.
2. Back on **Package**, check that the Draft column shows the new version and the same permissions as the Published column.
3. **Store listing**: replace the description with `webstore/en.txt`, then switch language for each of the other nine (`webstore/<lang>.txt`). Save draft.
4. **Submit for review** → keep "Publish automatically after it has passed review" ticked → **Submit For Review**.
5. **Status** should read "Pending review".

## Submitting to Edge Add-ons

Dashboard: https://partner.microsoft.com/en-us/dashboard/microsoftedge/4745a19a-a76d-4f16-82c2-ff8289b478f5/packages/dashboard

1. **Extension overview** → **Update** (only offered once the previous submission has finished review).
2. **Packages**: upload `releases/birdtab-edge-vX.Y.Z-<commit>.zip` and wait for "Your current package has been verified". Check the version and permissions it lists.
3. **Store listings**: update each language's description from `webstore/edge/<lang>.txt`.
4. **Publish** (top right) opens "Submit your extension":
   - "Does a tester need credentials...?" → **No**. All features work without an account; new installs get the 14-day Pro trial.
   - With **No** selected, the "Notes for certification" box is greyed out and not required.
5. **Publish**. The overview should show "UPDATE ... Version X.Y.Z — In review" above the live version. Microsoft quotes up to 7 business days.

## Submitting to Firefox Add-ons

Developer hub: https://addons.mozilla.org/developers/

The add-on ID is `birdtab@birdtab.app` (set in `webpack.config.js`). Never change it: AMO, updates and users' synced settings are tied to it.

**First submission** (once):

1. Sign in with the Mozilla account that should own the listing, then **Submit a New Add-on** → **On this site** (listed).
2. Upload `releases/birdtab-firefox-vX.Y.Z-<commit>.zip`. Compatibility: **Firefox** only. Firefox for Android doesn't let extensions replace the new tab page.
3. "Do you need to submit source code?" → **Yes** → upload `releases/birdtab-firefox-vX.Y.Z-<commit>-source.zip`. Build steps are in `BUILD-FIREFOX.md`, inside the zip.
4. Listing: copy the fields from `webstore/firefox/en.txt` (summary, description, categories, support site, privacy policy, notes to reviewer), then for each other language the summary and description from `webstore/firefox/<lang>.txt`. The name comes from the manifest, already translated. Add the screenshots `screenshots/firefox/1.png` to `5.png` (1280×800). Request the `birdtab` slug so the review link in `src/reviewPrompt.js` works: `https://addons.mozilla.org/firefox/addon/birdtab/`.
5. Submit. Automated validation runs right away; a human review can follow.

**Updates**: **Manage My Submissions** → BirdTab → **Upload New Version**, then the same package and source zips. Paste the updated descriptions from `webstore/firefox/*.txt`.

**From the command line** (optional): with API keys from https://addons.mozilla.org/developers/addon/api/key/,

```bash
./node_modules/.bin/web-ext sign --channel listed --source-dir dist-firefox \
  --upload-source-code releases/birdtab-firefox-vX.Y.Z-<commit>-source.zip \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
```

**Data collection consent**: the manifest declares `technicalAndInteraction` as optional data collection. Firefox asks users about it at install (they can change it later in `about:addons`), and PostHog and Sentry only run when it's granted. Firefox users who decline send nothing, so expect lower analytics numbers from Firefox than from Chrome.

## Submitting with Claude

Claude can run the whole release from Claude Code. What works:

- **Edge Partner Center**: Claude in Chrome (`mcp__claude-in-chrome__*`) works, using your signed-in Chrome. Upload the zip with its file-upload tool on the page's file input.
- **Chrome Web Store dashboard**: Claude in Chrome is blocked there ("The extensions gallery cannot be scripted"); Chrome doesn't let any extension script Web Store pages. Use the browser-use plugin (CDP) instead:
  1. Open `chrome://inspect/#remote-debugging` and tick "Allow remote debugging for this browser instance".
  2. Click **Allow** when Chrome asks about the debugging connection.
  3. Claude opens the dashboard, sets the zip on the upload dialog's `input[type=file]` with `DOM.setFileInputFiles`, and clicks through Submit for review.
  4. **Untick remote debugging when done**. While it's on, any local program can drive your signed-in Chrome.

Prompt that worked: "Build <browser> prod for the latest changes and submit it on the <store>. Use claude-in-chrome (or browser-use for the Chrome Web Store). Then do the post-release steps from DEPLOYMENT.md."

## Available Scripts

### Production Build

```bash
pnpm run build:chrome    # Build for Chrome
pnpm run build:edge      # Build for Edge
pnpm run build:firefox   # Build for Firefox
pnpm run lint:firefox    # Run AMO's linter (web-ext lint) on dist-firefox
```

### Development

```bash
pnpm run dev:chrome      # Watch mode for Chrome
pnpm run dev:edge        # Watch mode for Edge
pnpm run dev:firefox     # Watch mode for Firefox
pnpm run run:firefox     # Launch Firefox with dev-firefox loaded (reloads on rebuild)
```

### Deployment

```bash
pnpm run deploy                      # Build and create the Chrome zip
pnpm run deploy -- --browser=edge    # Build and create the Edge zip
pnpm run deploy -- --browser=firefox # Build the Firefox zip and the AMO source zip
pnpm run tag-deployment              # Tag current version as deployed
```

### Utilities

```bash
pnpm run clean           # Clean all dist folders
pnpm run check:i18n      # Check translation completeness
pnpm run check:unused    # Check for unused translation strings
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

Git tags record which commit each version shipped from and when. The only release tags are `deployed-vX.Y.Z`, one per version submitted to the Chrome Web Store (there are no plain `vX.Y.Z` tags). Edge submissions aren't tagged separately; ship Edge from the same commit where you can.

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
├── script.js             # New tab page script (minified)
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

Then re-run `pnpm run tag-deployment`.

### Uncommitted Changes Warning

**Problem**: Deploy script warns about uncommitted changes.

**Solution**: Commit your changes first:

```bash
git status                    # See what's changed
git add .                     # Stage changes
git commit -m "Your message"  # Commit
pnpm run deploy                # Re-run deploy
```

## Best Practices

1. **Always bump version** before deploying
2. **Test locally** before uploading to Chrome Web Store
3. **Tag deployments** as soon as the Chrome Web Store submission is in review
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
   pnpm run deploy
   ```

4. Upload the older version to Chrome Web Store

---

**Questions?** Check the [main README](./README.md) or create an issue.
