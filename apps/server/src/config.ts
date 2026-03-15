import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const envPath = resolve(currentDir, "../.env");

dotenv.config({ path: envPath });

const schema = z.object({
  IMMICH_BASE_URL: z.string().url(),
  IMMICH_API_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8787),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  IMMICH_WEB_ASSET_URL_TEMPLATE: z.string().optional()
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
