const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: "./src/index.jsx",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.[contenthash].js",
    clean: true,
  },
  resolve: { extensions: [".js", ".jsx"] },
  module: {
    rules: [
      { test: /\.jsx?$/, exclude: /node_modules/, use: "babel-loader" },
      { test: /\.css$/, use: ["style-loader", "css-loader"] },
    ],
  },
  // React + D3 is ~330 KiB; fine for this app, so skip the size warnings.
  performance: { hints: false },
  plugins: [new HtmlWebpackPlugin({ template: "./src/index.html" })],
  devServer: {
    port: 8080,
    historyApiFallback: true,
    proxy: [{ context: ["/api"], target: "http://127.0.0.1:5050" }],
  },
};
