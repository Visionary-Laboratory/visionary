// scripts/fix_onnx.mjs
import { mkdir, copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// 通过“导出的入口”来定位真实的 dist 目录（规避 package.json 限制）
const entryPath = require.resolve("onnxruntime-web/webgpu"); // e.g. .../onnxruntime-web/dist/ort-webgpu.mjs
const distDir = path.dirname(entryPath);

// 允许命令行传目标目录；默认 src/ort（Vite 直接可用）
const destArg = process.argv[2];
const destDir = path.resolve(destArg ?? "src/ort");

// 期望拷贝的一组文件（存在就拷，不存在就跳过，兼容不同版本）
const wanted = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

const filesInDist = new Set(await readdir(distDir));
const toCopy = wanted.filter(f => filesInDist.has(f));

if (toCopy.length === 0) {
  throw new Error(`Didn't find expected ORT files in ${distDir}. Found: ${[...filesInDist].join(", ")}`);
}

await mkdir(destDir, { recursive: true });

for (const name of toCopy) {
  const src = path.join(distDir, name);
  const dst = path.join(destDir, name);
  await copyFile(src, dst);
  console.log(`✔ Copied ${name} -> ${path.relative(process.cwd(), dst)}`);
}

console.log("Done.");
