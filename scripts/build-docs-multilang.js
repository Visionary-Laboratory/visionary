import { execSync } from "child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

console.log("Building multilingual documentation...\n");

// Step 1: Build English version
console.log("Step 1: Building English version...");
try {
  execSync("mkdocs build -f mkdocs.yml", {
    cwd: rootDir,
    stdio: "inherit",
  });
  console.log("✓ English version built successfully\n");
} catch (error) {
  console.error("✗ Failed to build English version");
  process.exit(1);
}

// Step 2: Copy modules to zh directory for Chinese build
console.log("Step 2: Preparing Chinese documentation...");
const docsDir = path.join(rootDir, "docs");
const modulesDir = path.join(docsDir, "modules");
const zhModulesDir = path.join(docsDir, "zh", "modules");

if (fs.existsSync(modulesDir) && !fs.existsSync(zhModulesDir)) {
  function copyDir(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  copyDir(modulesDir, zhModulesDir);
  console.log("✓ Modules copied to Chinese docs directory\n");
}

// Step 3: Build Chinese version
console.log("Step 3: Building Chinese version...");
try {
  execSync("mkdocs build -f mkdocs.zh.yml -d site-zh", {
    cwd: rootDir,
    stdio: "inherit",
  });
  console.log("✓ Chinese version built successfully\n");
} catch (error) {
  console.error("✗ Failed to build Chinese version");
  process.exit(1);
}

// Step 4: Merge Chinese version into site/zh/
console.log("Step 4: Merging Chinese version into site/zh/...");
const siteDir = path.join(rootDir, "site");
const siteZhDir = path.join(rootDir, "site-zh");
const targetZhDir = path.join(siteDir, "zh");

if (fs.existsSync(siteZhDir)) {
  // Copy all files from site-zh to site/zh
  function copyDir(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDir(siteZhDir, targetZhDir);
  console.log("✓ Chinese version merged successfully\n");

  // Clean up site-zh directory
  function removeDir(dir) {
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          removeDir(entryPath);
        } else {
          fs.unlinkSync(entryPath);
        }
      }
      fs.rmdirSync(dir);
    }
  }

  removeDir(siteZhDir);
  console.log("✓ Cleaned up temporary directory\n");
}

console.log("✓ Multilingual documentation build completed!");
console.log(`\nSite directory: ${siteDir}`);
console.log("English version: /");
console.log("Chinese version: /zh/");
