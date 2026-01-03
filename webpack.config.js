const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ReplaceInFileWebpackPlugin = require('replace-in-file-webpack-plugin');
const { DefinePlugin } = require('webpack');
const { sentryWebpackPlugin } = require('@sentry/webpack-plugin');
const { rimraf } = require('rimraf');
const fs = require('fs');
const Dotenv = require('dotenv-webpack');

// Load .env file for webpack config (dotenv-webpack only injects into bundled code)
require('dotenv').config();


module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const isEdge = env.BROWSER === 'edge';
  const outputDir = isProduction ? (isEdge ? 'dist-edge' : 'dist-chrome') : (isEdge ? 'dev-edge' : 'dev-chrome');

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
        patterns: [
          {
            from: 'src/manifest.json',
            to: 'manifest.json',
            transform(content, path) {
              const isEdge = outputDir.includes('edge');
              return content.toString().replace(/Chrome/g, isEdge ? 'Microsoft Edge' : 'Chrome');
            },
          },
          { from: 'src/images', to: 'images' },
          { from: 'src/icons', to: 'icons' },
          { from: 'src/_locales', to: '_locales' },
        ],
      }),
      new DefinePlugin({
        'process.env.BROWSER': JSON.stringify(isEdge ? 'edge' : 'chrome'),
        'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
        'process.env.SENTRY_ENVIRONMENT': JSON.stringify(isProduction ? 'production' : 'development'),
      }),
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),
      new Dotenv({
        systemvars: true, // Load system environment variables as well
        silent: true, // Hide errors if .env is missing (e.g. in CI)
      }),
      new HtmlWebpackPlugin({
        template: './src/popup.html',
        filename: 'popup.html',
        chunks: ['vendor', 'popup'],
      }),
      // Remove debug section from production popup.html
      ...(isProduction ? [
        new ReplaceInFileWebpackPlugin([{
          dir: outputDir,
          files: ['popup.html'],
          rules: [{
            // Remove the entire debug section div
            search: /<div id="debug-section"[^>]*>[\s\S]*?<\/div>/g,
            replace: '<!-- Debug section removed in production -->'
          }]
        }])
      ] : []),
      new HtmlWebpackPlugin({
        template: './src/index.html',
        filename: 'index.html',
        chunks: ['vendor', 'script'],
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