import fs from "node:fs";
import { rm } from "node:fs/promises";

const distDirectory = "docs-docs/dist";
if (fs.existsSync(distDirectory)) {
  await rm(distDirectory, { recursive: true, force: true });
  console.log(`Directory ${distDirectory} deleted`);
}

const siteDirectory = "site";
if (fs.existsSync(siteDirectory)) {
  await rm(siteDirectory, { recursive: true, force: true });
  console.log(`Directory ${siteDirectory} deleted`);
}

const siteZhDirectory = "site-zh";
if (fs.existsSync(siteZhDirectory)) {
  await rm(siteZhDirectory, { recursive: true, force: true });
  console.log(`Directory ${siteZhDirectory} deleted`);
}

console.log("Cleanup completed.");

