import fs from "node:fs";
import path from "node:path";

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

// Copy dist build artifacts to docs-docs/dist (optional - only if dist exists)
if (fs.existsSync("dist")) {
  copyDir("dist", "docs-docs/dist");
  console.log("Build artifacts copied to docs-docs/dist");
} else {
  console.log("Note: dist directory not found. Skipping build artifacts copy (this is optional for docs build).");
}

console.log("Site files copied successfully.");

