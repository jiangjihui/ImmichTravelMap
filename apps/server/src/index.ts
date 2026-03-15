import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import travelRouter from "./routes/travel.js";

const app = express();
const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const projectRoot = resolve(currentDir, "..", "..");
const webDistDir = resolve(projectRoot, "web", "dist");
const webIndexFile = resolve(webDistDir, "index.html");

app.use(
  cors({
    origin: config.WEB_ORIGIN,
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/travel", travelRouter);

if (existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(webIndexFile);
  });
} else {
  console.log("web/dist not found, API-only mode enabled");
}

app.listen(config.PORT, () => {
  console.log(`Travel server running at http://localhost:${config.PORT}`);
});
