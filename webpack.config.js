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

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const isEdge = env.BROWSER === 'edge';
  const outputDir = isProduction ? (isEdge ? 'dist-edge' : 'dist-chrome') : (isEdge ? 'dev-edge' : 'dev-chrome');

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
        const isEdge = outputDir.includes('edge');
        const manifest = JSON.parse(content.toString());

        if (Array.isArray(manifest.optional_permissions)) {
          manifest.optional_permissions = manifest.optional_permissions.filter(
            (permission) => permission !== 'favicon'
          );
        }

        if (!isProduction && manifest.externally_connectable?.matches) {
          manifest.externally_connectable.matches.push('https://birdtab.jaipandya.com/*');
        }

        return JSON.stringify(manifest, null, 2) + '\n';
      },
    },
    { from: 'src/images', to: 'images' },
    { from: 'src/icons', to: 'icons' },
    { from: 'src/fonts', to: 'fonts' },
    {
      from: 'src/_locales',
      to: '_locales',
      transform(content, path) {
        const isEdge = outputDir.includes('edge');
        if (!isEdge) {
          return content;
        }
        try {
          const localeData = JSON.parse(content.toString());
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

          Object.values(localeData).forEach((entry) => {
            if (entry && typeof entry.message === 'string') {
              entry.message = replaceForEdge(entry.message);
            }
            if (entry && typeof entry.description === 'string') {
              entry.description = replaceForEdge(entry.description);
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
        'process.env.BROWSER': JSON.stringify(isEdge ? 'edge' : 'chrome'),
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
      }),
      new HtmlWebpackPlugin({
        template: './src/onboarding.html',
        filename: 'onboarding.html',
        chunks: ['vendor', 'onboarding'],
      }),
      // Sentry plugin - only when UPLOAD_SOURCEMAPS is set (during deploy) and token is present
      ...(isProduction && process.env.UPLOAD_SOURCEMAPS === 'true' && process.env.SENTRY_AUTH_TOKEN ? (() => {
        console.log('\n📤 Sentry source map upload enabled (UPLOAD_SOURCEMAPS=true, SENTRY_AUTH_TOKEN found)');
        console.log(`   Organization: ${process.env.SENTRY_ORG || "birdtab"}`);
        console.log(`   Project: ${process.env.SENTRY_PROJECT || "birdtab-extension"}\n`);
        return [
          sentryWebpackPlugin({
            authToken: process.env.SENTRY_AUTH_TOKEN,
            org: process.env.SENTRY_ORG || "birdtab",
            project: process.env.SENTRY_PROJECT || "birdtab-extension",
            telemetry: false,
            sourcemaps: {
              assets: outputDir + "/**",
            },
            // Silent mode off so we can see upload output
            silent: false,
          }),
        ];
      })() : (isProduction && process.env.UPLOAD_SOURCEMAPS === 'true' && !process.env.SENTRY_AUTH_TOKEN ? (() => {
        console.log('\n⚠️  SENTRY_AUTH_TOKEN not found - source maps will NOT be uploaded to Sentry.');
        console.log('   To enable source map uploads, set SENTRY_AUTH_TOKEN in your .env file.\n');
        return [];
      })() : [])),
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
                  // Chrome 88+ required for MV3, target modern browsers only
                  targets: { chrome: '88' },
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
    },
  };
};
