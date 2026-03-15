import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(scriptDir, "..");

const requiredPaths = [
  { name: "server build entry", path: resolve(rootDir, "server", "dist", "index.js") },
  { name: "web app entry", path: resolve(rootDir, "web", "dist", "index.html") },
  { name: "web assets dir", path: resolve(rootDir, "web", "dist", "assets"), dir: true }
];

const errors = [];

for (const item of requiredPaths) {
  if (!existsSync(item.path)) {
    errors.push(`${item.name} missing: ${item.path}`);
    continue;
  }
  if (item.dir && !statSync(item.path).isDirectory()) {
    errors.push(`${item.name} is not a directory: ${item.path}`);
  }
}

const assetsDir = resolve(rootDir, "web", "dist", "assets");
let jsAssets = [];
let cssAssets = [];
if (existsSync(assetsDir) && statSync(assetsDir).isDirectory()) {
  const files = readdirSync(assetsDir);
  jsAssets = files.filter((file) => file.endsWith(".js"));
  cssAssets = files.filter((file) => file.endsWith(".css"));
  if (jsAssets.length === 0) {
    errors.push(`no JS asset found in: ${assetsDir}`);
  }
  if (cssAssets.length === 0) {
    errors.push(`no CSS asset found in: ${assetsDir}`);
  }
}

const indexHtmlPath = resolve(rootDir, "web", "dist", "index.html");
if (existsSync(indexHtmlPath)) {
  const html = readFileSync(indexHtmlPath, "utf8");
  if (!html.includes("/assets/")) {
    errors.push(`web/dist/index.html has no /assets/ reference: ${indexHtmlPath}`);
  }
}

const serverEntryPath = resolve(rootDir, "server", "dist", "index.js");
if (existsSync(serverEntryPath)) {
  const serverEntry = readFileSync(serverEntryPath, "utf8");
  if (!serverEntry.includes("web") || !serverEntry.includes("dist")) {
    errors.push(`server/dist/index.js does not appear to include static web/dist hosting logic`);
  }
}

if (errors.length > 0) {
  console.error("Release artifact check failed:");
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log("Release artifact check passed.");
console.log(`- server: ${resolve(rootDir, "server", "dist", "index.js")}`);
console.log(`- web: ${resolve(rootDir, "web", "dist", "index.html")}`);
console.log(`- assets: ${jsAssets.length} js, ${cssAssets.length} css`);
