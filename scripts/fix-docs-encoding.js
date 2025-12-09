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

function fixFileEncoding(filePath) {
  try {
    // Read as buffer first
    const buffer = fs.readFileSync(filePath);
    
    // Remove BOM if present
    let content = buffer;
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      content = buffer.slice(3);
      console.log(`  Found BOM in ${path.relative(rootDir, filePath)}, removing...`);
    }
    
    // Try to decode as UTF-8
    let text;
    try {
      text = content.toString("utf-8");
    } catch (error) {
      // If UTF-8 fails, try other encodings
      console.log(`  UTF-8 decode failed for ${path.relative(rootDir, filePath)}, trying alternatives...`);
      
      // Try latin1 (ISO-8859-1) which can decode any byte sequence
      text = content.toString("latin1");
      
      // Clean up common encoding issues
      text = text
        .replace(/\x00/g, "") // Remove null bytes
        .replace(/[\x80-\x9F]/g, (char) => {
          // Try to fix common Windows-1252 characters
          const code = char.charCodeAt(0);
          const fixes = {
            0x80: "\u20AC", // €
            0x82: "\u201A", // ‚
            0x83: "\u0192", // ƒ
            0x84: "\u201E", // „
            0x85: "\u2026", // …
            0x86: "\u2020", // †
            0x87: "\u2021", // ‡
            0x88: "\u02C6", // ˆ
            0x89: "\u2030", // ‰
            0x8A: "\u0160", // Š
            0x8B: "\u2039", // ‹
            0x8C: "\u0152", // Œ
            0x8E: "\u017D", // Ž
            0x91: "\u2018", // '
            0x92: "\u2019", // '
            0x93: "\u201C", // "
            0x94: "\u201D", // "
            0x95: "\u2022", // •
            0x96: "\u2013", // –
            0x97: "\u2014", // —
            0x98: "\u02DC", // ˜
            0x99: "\u2122", // ™
            0x9A: "\u0161", // š
            0x9B: "\u203A", // ›
            0x9C: "\u0153", // œ
            0x9E: "\u017E", // ž
            0x9F: "\u0178", // Ÿ
          };
          return fixes[code] || "";
        });
    }
    
    // Remove any remaining invalid UTF-8 sequences
    text = text.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, "");
    
    // Write back as UTF-8 without BOM
    fs.writeFileSync(filePath, text, { encoding: "utf-8" });
    
    return true;
  } catch (error) {
    console.error(`✗ Failed to fix ${path.relative(rootDir, filePath)}: ${error.message}`);
    return false;
  }
}

console.log("Fixing Markdown files encoding issues...\n");

const mdFiles = findMarkdownFiles(docsDir);
let fixedCount = 0;

for (const file of mdFiles) {
  const before = fs.readFileSync(file);
  if (fixFileEncoding(file)) {
    const after = fs.readFileSync(file);
    if (!before.equals(after)) {
      fixedCount++;
      console.log(`✓ Fixed: ${path.relative(rootDir, file)}`);
    }
  }
}

if (fixedCount === 0) {
  console.log("✓ No encoding issues found or all files are already correct.");
} else {
  console.log(`\n✓ Fixed ${fixedCount} file(s).`);
}

