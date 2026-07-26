const path = require('node:path');

/** @type {import('webpack').Configuration} */
module.exports = {
  entry: {
    'background/service-worker': './src/background/service-worker.ts',
    'content/arena-bridge': './src/content/arena-bridge.ts',
    'popup/popup': './src/popup/popup.ts',
    'sidepanel/sidepanel': './src/sidepanel/sidepanel.ts',
    'options/options': './src/options/options.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: false,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/u,
        exclude: /node_modules/u,
        use: 'ts-loader',
      },
    ],
  },
  optimization: {
    runtimeChunk: false,
    splitChunks: false,
  },
  devtool: false,
  performance: {
    hints: false,
  },
};
