import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const docsDir = path.join(rootDir, "docs");

function findMarkdownFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function checkFileEncoding(filePath) {
  try {
    // Try to read as UTF-8
    const content = fs.readFileSync(filePath, "utf-8");
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

function fixFileEncoding(filePath) {
  try {
    // Try different encodings
    const encodings = ["utf-8", "utf-8-sig", "latin1", "gbk", "gb2312", "cp1252"];
    
    for (const encoding of encodings) {
      try {
        const content = fs.readFileSync(filePath, encoding);
        // Write back as UTF-8
        fs.writeFileSync(filePath, content, "utf-8");
        console.log(`✓ Fixed ${path.relative(rootDir, filePath)} (was ${encoding})`);
        return true;
      } catch (e) {
        // Try next encoding
      }
    }
    
    // If all encodings fail, try to read as binary and clean
    const buffer = fs.readFileSync(filePath);
    // Remove invalid UTF-8 sequences
    const cleaned = buffer.toString("utf-8").replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, "");
    fs.writeFileSync(filePath, cleaned, "utf-8");
    console.log(`✓ Fixed ${path.relative(rootDir, filePath)} (cleaned invalid bytes)`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to fix ${path.relative(rootDir, filePath)}: ${error.message}`);
    return false;
  }
}

console.log("Checking Markdown files for encoding issues...\n");

const mdFiles = findMarkdownFiles(docsDir);
const problematicFiles = [];

for (const file of mdFiles) {
  const result = checkFileEncoding(file);
  if (!result.valid) {
    problematicFiles.push(file);
    console.log(`✗ Encoding issue found: ${path.relative(rootDir, file)}`);
    console.log(`  Error: ${result.error}\n`);
  }
}

if (problematicFiles.length === 0) {
  console.log("✓ All files have valid UTF-8 encoding!");
} else {
  console.log(`\nFound ${problematicFiles.length} file(s) with encoding issues. Attempting to fix...\n`);
  
  for (const file of problematicFiles) {
    fixFileEncoding(file);
  }
  
  console.log("\n✓ Fix attempt completed. Please run the build again.");
}

