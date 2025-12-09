// 轻量 postinstall：在包安装时修复 ONNX 资源；若脚本缺失则跳过
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const fixScript = path.join(rootDir, "scripts", "fix_onnx.mjs");

if (!existsSync(fixScript)) {
  console.log("postinstall: skip fix_onnx (scripts/fix_onnx.mjs not found)");
  process.exit(0);
}

try {
  // 直接 import 执行 fix_onnx 脚本
  const { default: run } = await import(fixScript).catch(() => ({ default: null }));
  if (typeof run === "function") {
    await run();
  }
} catch (err) {
  console.warn("postinstall: fix_onnx failed (ignored):", err?.message || err);
}

