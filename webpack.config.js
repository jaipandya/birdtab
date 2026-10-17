const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { DefinePlugin } = require('webpack');
const { sentryWebpackPlugin } = require('@sentry/webpack-plugin');
const { rimraf } = require('rimraf');
const fs = require('fs');
const Dotenv = require('dotenv-webpack');
const { diffPermissions, PERMISSIONS_BASELINES } = require('./scripts/permissions_baseline');

// Never change: AMO ties the listing, updates and users' synced settings to it
const FIREFOX_ADDON_ID = 'birdtab@birdtab.app';

// Firefox Add-ons cuts names at 50 characters, so Firefox builds get their own
// (same as NAME in webstore/firefox/<lang>.txt). Chrome and Edge keep extensionName.
const FIREFOX_EXTENSION_NAMES = {
  en: "BirdTab - Bird Wallpapers & Sounds for New Tab",
  es: "BirdTab - Fondos de aves y cantos en nueva pestaña",
  "pt_BR": "BirdTab - Papéis de parede de aves na nova aba",
  de: "BirdTab - Vogelbilder & Vogelstimmen im neuen Tab",
  fr: "BirdTab - Fonds d'écran d'oiseaux en nouvel onglet",
  ja: "BirdTab - 鳥の壁紙と鳴き声で彩る新しいタブ",
  pl: "BirdTab - Tapety i śpiew ptaków na nowej karcie",
  ru: "BirdTab - Обои и голоса птиц в новой вкладке",
  "zh_CN": "BirdTab - 鸟类壁纸与鸟鸣声新标签页",
  ar: "BirdTab - خلفيات وأصوات الطيور لعلامة تبويب جديدة",
};

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const browser = ['edge', 'firefox'].includes(env.BROWSER) ? env.BROWSER : 'chrome';
  const isEdge = browser === 'edge';
  const isFirefox = browser === 'firefox';
  const isChrome = browser === 'chrome';
  // FEATURE_PREVIEW=true: the Chrome-first features (CONFIG.FEATURES) in Edge/Firefox builds too
  const featurePreview = process.env.FEATURE_PREVIEW === 'true';
  if (featurePreview && isProduction) {
    console.warn('\n⚠️  FEATURE_PREVIEW is set: this production build has features not yet released for ' + browser + '. Do not upload it.\n');
  }
  const previewing = isChrome || featurePreview;
  // "Open BirdTab" steps aside for the browser's own new tab page: Chrome, and Edge in a preview.
  // Firefox doesn't let extensions open about:newtab.
  const stepsAside = isChrome || (featurePreview && isEdge);
  const outputDir = `${isProduction ? 'dist' : 'dev'}-${browser}`;

  // Load environment-specific .env file
  // Production: .env.production, Development: .env.local, Fallback: .env
  const envFile = isProduction ? '.env.production' : '.env.local';
  const envPath = path.resolve(__dirname, envFile);
  const fallbackEnvPath = path.resolve(__dirname, '.env');
  const resolvedEnvPath = fs.existsSync(envPath) ? envPath : fallbackEnvPath;
  require('dotenv').config({ path: resolvedEnvPath });

  // Custom plugin to delete source maps after they've been used
  const DeleteSourceMapsPlugin = {
    apply: (compiler) => {
      compiler.hooks.done.tap('DeleteSourceMapsPlugin', () => {
        if (isProduction) {
          console.log('Cleaning up source maps...');
          const outputPath = path.resolve(__dirname, outputDir);
          // Find and delete all .map files
          try {
            const files = fs.readdirSync(outputPath);
            const mapFiles = files.filter(file => file.endsWith('.map'));
            mapFiles.forEach(file => {
              const filePath = path.join(outputPath, file);
              fs.unlinkSync(filePath);
              console.log(`  Deleted: ${file}`);
            });
            console.log(`Source maps deleted successfully (${mapFiles.length} files).`);
          } catch (err) {
            console.error('Failed to delete source maps:', err);
          }
        }
      });
    },
  };

  const copyPatterns = [
    {
      from: 'src/manifest.json',
      to: 'manifest.json',
      transform(content, path) {
        const manifest = JSON.parse(content.toString());

        if (Array.isArray(manifest.optional_permissions)) {
          manifest.optional_permissions = manifest.optional_permissions.filter(
            (permission) => permission !== 'favicon'
          );
        }

        if (!isProduction && manifest.externally_connectable?.matches) {
          manifest.externally_connectable.matches.push('https://birdtab.jaipandya.com/*');
        }

        // Edge keeps the hosts its 1.3.9 users already granted; media is read
        // through the bucket's CORS policy (see scripts/permissions_baseline.js)
        if (isEdge) {
          manifest.host_permissions = [...PERMISSIONS_BASELINES.edge.host_permissions];
        }

        // Typing "bird" and a bird's name in the address bar opens BirdTab on that bird
        // (Chrome; Edge and Firefox in a preview)
        if (previewing) {
          manifest.omnibox = { keyword: 'bird' };
        }

        // Firefox MV3 runs the background as an event page, has no
        // externally_connectable, and needs a fixed add-on ID (storage.sync
        // and AMO signing depend on it). Analytics and error reports are
        // technicalAndInteraction data, which Firefox makes opt-in; see
        // hasDataCollectionConsent() in browserInfo.js.
        if (isFirefox) {
          manifest.background = { scripts: ['background.js'] };
          delete manifest.externally_connectable;
          manifest.host_permissions = [...PERMISSIONS_BASELINES.firefox.host_permissions];
          manifest.browser_specific_settings = {
            gecko: {
              id: FIREFOX_ADDON_ID,
              strict_min_version: '140.0',
              data_collection_permissions: {
                required: ['none'],
                optional: ['technicalAndInteraction'],
              },
            },
          };
        }

        // Dev builds only: allow a local media server (MEDIA_BASE_URL=http://localhost:8787)
        if (!isProduction && Array.isArray(manifest.host_permissions)) {
          manifest.host_permissions.push('http://localhost/*');
        }

        // Production builds must keep the published permissions so the update
        // installs without a re-consent prompt.
        if (isProduction) {
          const differences = diffPermissions(manifest, browser);
          if (differences.length > 0) {
            throw new Error(
              `manifest.json permissions differ from ${PERMISSIONS_BASELINES[browser].version} ` +
              `(users would have to re-approve the extension):\n  ${differences.join('\n  ')}`
            );
          }
        }

        return JSON.stringify(manifest, null, 2) + '\n';
      },
    },
    { from: 'src/images', to: 'images' },
    { from: 'src/icons', to: 'icons' },
    {
      from: 'src/_locales',
      to: '_locales',
      transform(content, path) {
        if (!isEdge && !isFirefox) {
          return content;
        }
        try {
          const localeData = JSON.parse(content.toString());
          const replaceForFirefox = (value) => value.replace(/Chrome/g, 'Firefox');
          const replaceForEdge = (value) => {
            let updated = value.replace(/Chrome/g, 'Microsoft Edge');
            updated = updated
              .replace(/Microsoft Edge New Tab/g, 'Edge New Tab')
              .replace(/Microsoft Edge new tab/g, 'Edge new tab')
              .replace(/Microsoft Edge new tab page/g, 'Edge new tab page')
              .replace(/Microsoft Edge Tab Shortcut/g, 'Edge New Tab Shortcut')
              .replace(/Microsoft Edge Tab/g, 'Edge New Tab');
            return updated;
          };

          const replaceForBrowser = isEdge ? replaceForEdge : replaceForFirefox;
          const locale = path.split(/[\\/]/).slice(-2, -1)[0];
          if (isFirefox && localeData.extensionName && FIREFOX_EXTENSION_NAMES[locale]) {
            localeData.extensionName.message = FIREFOX_EXTENSION_NAMES[locale];
          }

          Object.values(localeData).forEach((entry) => {
            if (entry && typeof entry.message === 'string') {
              entry.message = replaceForBrowser(entry.message);
            }
            if (entry && typeof entry.description === 'string') {
              entry.description = replaceForBrowser(entry.description);
            }
          });
          return JSON.stringify(localeData, null, 2) + '\n';
        } catch (error) {
          return content;
        }
      },
    },
  ];

  if (isEdge) {
    copyPatterns.push({ from: 'src/edge-assets', to: 'images/edge' });
  }

  // Runs before the new tab paints to step aside for the browser's own page (CONFIG.FEATURES.newTabMode)
  if (stepsAside) {
    copyPatterns.push({
      from: 'src/boot.js',
      to: 'boot.js',
      // Edge's own new tab page, as the Chrome Tab shortcut opens it (browserInfo.js getNewTabUrl)
      transform: (content) => isEdge
        ? content.toString().replace("'chrome://new-tab-page/'", "'https://ntp.msn.com/edge/ntp'")
        : content,
    });
  }
  if (previewing) {
    copyPatterns.push({ from: 'src/fonts/Inter-LICENSE.txt', to: 'fonts/Inter-LICENSE.txt' });
  }

  if (isFirefox) {
    copyPatterns.push({ from: 'src/firefox-assets', to: 'images/firefox' });
  }

  // Firefox production builds always get Sentry's debug IDs, which are hashed
  // from the code, so AMO reviewers rebuilding without our token get the same
  // files. Release injection (the git commit) is off for Firefox for the same
  // reason; the release comes from sentry.js at runtime.
  const sentryPlugins = () => {
    const wantsUpload = isProduction && process.env.UPLOAD_SOURCEMAPS === 'true';
    const canUpload = wantsUpload && Boolean(process.env.SENTRY_AUTH_TOKEN);

    if (wantsUpload && !canUpload) {
      console.log('\n⚠️  SENTRY_AUTH_TOKEN not found - source maps will NOT be uploaded to Sentry.');
      console.log('   To enable source map uploads, set SENTRY_AUTH_TOKEN in your .env file.\n');
    }
    if (!canUpload && !(isFirefox && isProduction)) {
      return [];
    }
    if (canUpload) {
      console.log('\n📤 Sentry source map upload enabled (UPLOAD_SOURCEMAPS=true, SENTRY_AUTH_TOKEN found)');
      console.log(`   Organization: ${process.env.SENTRY_ORG || "birdtab"}`);
      console.log(`   Project: ${process.env.SENTRY_PROJECT || "birdtab-extension"}\n`);
    }
    return [
      sentryWebpackPlugin({
        authToken: canUpload ? process.env.SENTRY_AUTH_TOKEN : undefined,
        org: process.env.SENTRY_ORG || "birdtab",
        project: process.env.SENTRY_PROJECT || "birdtab-extension",
        telemetry: false,
        sourcemaps: {
          assets: outputDir + "/**",
          ...(!canUpload && { disable: 'disable-upload' }),
        },
        ...(isFirefox && { release: { inject: false, create: false } }),
        // Silent mode off so we can see upload output
        silent: !canUpload,
      }),
    ];
  };

  return {
    mode: isProduction ? 'production' : 'development',
    entry: {
      background: './src/background.js',
      popup: './src/popup.js',
      script: './src/script.js',
      onboarding: './src/onboarding.js',
      quiz: './src/quiz.css'
    },
    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, outputDir),
      clean: true,
      // Firefox 140 has globalThis: skips webpack's new Function('return this')
      // fallback, which AMO review flags as eval
      ...(isFirefox && { environment: { globalThis: true } }),
    },
    // Use source-map in production for Sentry, but we'll delete them after
    devtool: isProduction ? 'source-map' : 'inline-source-map',
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              drop_debugger: true,
              // Remove only debug logs, keep console.error and console.warn for error tracking
              pure_funcs: isProduction ? ['console.log', 'console.info', 'console.debug'] : [],
              passes: 2, // Multiple compression passes for better results
            },
            mangle: {
              safari10: true, // Work around Safari 10 bugs
            },
            format: {
              comments: false,
            },
          },
          extractComments: false,
        }),
        new CssMinimizerPlugin(),
      ],
      // Tree shaking - remove unused exports
      usedExports: true,
      splitChunks: isProduction ? {
        chunks: (chunk) => {
          // Don't split the background script - service workers can't import chunks
          return chunk.name !== 'background';
        },
        name: 'vendor',
      } : false,
    },
    plugins: [
      new CopyPlugin({
        patterns: copyPatterns,
      }),
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),
      new DefinePlugin({
        'process.env.BROWSER': JSON.stringify(browser),
        'process.env.FEATURE_PREVIEW_BUILD': JSON.stringify(featurePreview),
        'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
        'process.env.SENTRY_ENVIRONMENT': JSON.stringify(isProduction ? 'production' : 'development'),
      }),
      // Dotenv loads environment variables into bundled code
      // Uses .env.production for production builds, .env.local for development, .env as fallback
      new Dotenv({
        path: resolvedEnvPath,
        systemvars: true,
        silent: true,
      }),
      new HtmlWebpackPlugin({
        template: './src/popup.html',
        filename: 'popup.html',
        chunks: ['vendor', 'popup'],
      }),
      new HtmlWebpackPlugin({
        template: './src/index.html',
        filename: 'index.html',
        chunks: ['vendor', 'script'],
        isEdge,
        isFirefox,
        withBoot: stepsAside,
      }),
      new HtmlWebpackPlugin({
        template: './src/onboarding.html',
        filename: 'onboarding.html',
        chunks: ['vendor', 'onboarding'],
        isFirefox,
      }),
      // Sentry plugin - uploads source maps when UPLOAD_SOURCEMAPS is set (during deploy) and token is present
      ...sentryPlugins(),
      DeleteSourceMapsPlugin // Add our custom plugin to delete maps
    ],
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', {
                  // Chrome 88+ required for MV3; Firefox matches strict_min_version
                  targets: isFirefox ? { firefox: '140' } : { chrome: '88' },
                  // Only include polyfills that are actually used
                  useBuiltIns: false,
                  // Use modern module syntax
                  modules: false,
                }]
              ],
            },
          },
        },
        {
          test: /\.css$/,
          use: [
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
          ],
        },
      ],
    },
    resolve: {
      extensions: ['.js', '.css'],
      alias: {
        // Chrome ships one variable Inter (every weight, optical sizes); the others keep
        // the two static weights until the variable font is ported to them
        'birdtab-fonts.css$': path.resolve(__dirname, previewing ? 'src/fontsVariable.css' : 'src/fontsStatic.css'),
      },
    },
  };
};
