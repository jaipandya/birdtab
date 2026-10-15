# Building BirdTab for Firefox

These steps rebuild the Firefox add-on from this source package. The output
matches the uploaded package file for file.

## Requirements

- macOS, Linux or Windows
- Node.js 25.2.1 (the version released builds use)
- pnpm 10.26.1 (`npm install -g pnpm@10.26.1`)

## Build

```sh
pnpm install --frozen-lockfile
pnpm run build:firefox
```

The add-on is written to `dist-firefox/`.

## About the build

- Webpack (`webpack.config.js`) bundles the sources in `src/` with Babel and
  Terser. Nothing is downloaded or generated at runtime: every script the
  add-on runs is in the package.
- The Sentry webpack plugin adds a debug ID, a hash of the file's code, to
  each script so error reports can be matched with source maps. Without a
  Sentry auth token it uploads nothing.
- `.env.production` holds the two values the build embeds: the PostHog
  project key for analytics and the key that signs the uninstall survey link.
  Both are visible in the packaged code.
- Analytics (PostHog) and error reports (Sentry) are only sent when the user
  allows "technical and interaction data" in Firefox's data collection
  consent. See `hasDataCollectionConsent()` in `src/browserInfo.js`.
- Bird photos, sounds and lists come from `https://media.birdtab.app`. No host
  permissions are requested.
