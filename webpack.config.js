const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ReplaceInFileWebpackPlugin = require('replace-in-file-webpack-plugin');
const { DefinePlugin } = require('webpack');


module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const isEdge = env.BROWSER === 'edge';
  const outputDir = isProduction ? (isEdge ? 'dist-edge' : 'dist-chrome') : (isEdge ? 'dev-edge' : 'dev-chrome');

  return {
    mode: isProduction ? 'production' : 'development',
    entry: {
      background: './src/background.js',
      popup: './src/popup.js',
      script: './src/script.js',
      onboarding: './src/onboarding.js',
      config: './src/config.js',
      shared: './src/shared.js'
    },
    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, outputDir),
      clean: true,
    },
    devtool: isProduction ? false : 'inline-source-map',
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            format: {
              comments: false,
            },
          },
          extractComments: false,
        }),
        new CssMinimizerPlugin(),
      ],
      splitChunks: isProduction ? {
        chunks: 'all',
        name: 'vendor',
      } : false,
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: 'src/manifest.json', to: 'manifest.json' },
          { from: 'src/images', to: 'images' },
          { from: 'src/icons', to: 'icons' },
        ],
      }),
      new DefinePlugin({
        'process.env.BROWSER': JSON.stringify(isEdge ? 'edge' : 'chrome'),
      }),
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),
      new HtmlWebpackPlugin({
        template: './src/popup.html',
        filename: 'popup.html',
        chunks: ['popup', 'shared'],
      }),
      new HtmlWebpackPlugin({
        template: './src/index.html',
        filename: 'index.html',
        chunks: ['script', 'shared'],
      }),
      new HtmlWebpackPlugin({
        template: './src/onboarding.html',
        filename: 'onboarding.html',
        chunks: ['onboarding', 'shared'],
      }),
      new ReplaceManifestPlugin(),
    ],
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env'],
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

class ReplaceManifestPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tapAsync('ReplaceManifestPlugin', (compilation, callback) => {
      const outputDir = compilation.options.output.path;
      const isEdge = compilation.options.mode === 'production' 
        ? outputDir.endsWith('dist-edge')
        : outputDir.endsWith('dev-edge');
      console.log(`Replacing manifest for ${isEdge ? 'Edge' : 'Chrome'}`);
      const replacePlugin = new ReplaceInFileWebpackPlugin([{
        dir: outputDir,
        files: ['manifest.json'],
        rules: [{
          search: /Chrome/g,
          replace: isEdge ? 'Microsoft Edge' : 'Chrome'
        }]
      }]);

      replacePlugin.apply(compiler);
      callback();
    });
  }
}