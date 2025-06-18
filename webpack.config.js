const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
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
      shared: './src/shared.js',
      quiz: './src/quiz.css'
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