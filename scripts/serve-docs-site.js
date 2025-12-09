import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get directory to serve
const root = path.resolve(process.argv[2] || ".");

const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  try {
    const requestedPath = decodeURIComponent(req.url.split("?")[0]);
    const fullPath = path.join(root, requestedPath);
    const safePath = path.normalize(fullPath);

    if (!safePath.startsWith(root)) {
      res.writeHead(403);
      return res.end("Access denied");
    }

    const stats = await fs.stat(safePath);

    if (stats.isDirectory()) {
      const indexPath = path.join(safePath, "index.html");
      try {
        const content = await fs.readFile(indexPath);
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(content);
      } catch {
        res.writeHead(403);
        return res.end("Directory listing is disabled");
      }
    } else {
      const ext = path.extname(safePath).toLowerCase();
      const contentType = mimeTypes[ext] || "application/octet-stream";
      const content = await fs.readFile(safePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    }
  } catch (err) {
    res.writeHead(err.code === "ENOENT" ? 404 : 500);
    res.end(
      err.code === "ENOENT" ? "Not Found" : `Server Error: ${err.message}`,
    );
  }
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Serving ${root} at http://localhost:${PORT}`);
});

