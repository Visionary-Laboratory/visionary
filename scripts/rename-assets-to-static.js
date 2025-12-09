import {
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";

const siteDirectory = "site";
const oldAssets = join(siteDirectory, "assets");
const newAssets = join(siteDirectory, "static");

// Check if assets directory exists
try {
  statSync(oldAssets);
} catch {
  console.log("Assets directory not found, skipping rename.");
  process.exit(0);
}

// Rename assets directory
console.log(`Renaming ${oldAssets} → ${newAssets}...`);
renameSync(oldAssets, newAssets);
replaceInHtmlFiles(siteDirectory);

function replaceInHtmlFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      replaceInHtmlFiles(fullPath);
    } else if (stat.isFile() && extname(fullPath) === ".html") {
      const html = readFileSync(fullPath, "utf-8");

      // Replace relative/local asset references ONLY (exclude external URLs)
      const updated = html.replace(
        /(["'(=])((?:\.\.\/)*|\.\/|\/)assets\//g,
        (_, prefix, rel) => `${prefix}${rel}static/`,
      );
      if (updated !== html) {
        writeFileSync(fullPath, updated);
      }
    }
  }
}

console.log("Assets renamed to static successfully.");

