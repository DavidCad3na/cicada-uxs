// Copies RNNoise AudioWorklet and WASM files from node_modules into public/rnnoise/
// so they can be served as static assets (AudioWorklets cannot be webpack-bundled).
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "../node_modules/@sapphi-red/web-noise-suppressor/dist");
const dest = path.join(__dirname, "../public/rnnoise");

fs.mkdirSync(dest, { recursive: true });

const files = [
  ["rnnoise/workletProcessor.js", "workletProcessor.js"],
  ["rnnoise.wasm",                "rnnoise.wasm"],
  ["rnnoise_simd.wasm",           "rnnoise_simd.wasm"],
];

for (const [from, to] of files) {
  fs.copyFileSync(path.join(src, from), path.join(dest, to));
}

console.log("Copied RNNoise assets to public/rnnoise/");
