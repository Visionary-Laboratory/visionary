// scripts/make-release-tarball.mjs
// 生成包含 dist 的 tarball，便于发布到 GitHub Release 供用户直接 npm 安装
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const run = (cmd, opts = {}) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: rootDir, stdio: "inherit", ...opts });
};

const ensureFile = (p, errMsg) => {
  if (!existsSync(p)) {
    throw new Error(errMsg);
  }
};

// 1) 确保 ONNX 相关文件就绪
run("npm run fix_onnx");

// 2) 构建 dist（同时生成 d.ts）
run("npm run build");

// 3) 基本校验 dist 是否存在
ensureFile(
  path.join(rootDir, "dist", "visionary-core.es.js"),
  "构建产物缺失：dist/visionary-core.es.js 未找到，请检查构建日志"
);

// 4) 打包 tarball
const packed = execSync("npm pack", { cwd: rootDir, stdio: "pipe" })
  .toString()
  .trim()
  .split("\n")
  .pop();

const tarballPath = path.join(rootDir, packed);
console.log(`✅ 生成完成: ${tarballPath}`);

