import { Readable } from "node:stream";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { fetchThumbnail } from "../immichClient.js";
import { getTravelPoints } from "../travelService.js";

const router = Router();

const querySchema = z.object({
  start: z.string().optional(),
  end: z.string().optional()
});

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function toAssetViewUrl(assetId: string): string {
  return `${config.IMMICH_BASE_URL.replace(/\/+$/, "")}/photos/${assetId}`;
}

router.get("/points", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid query parameters" });
  }

  const defaultEnd = new Date();
  const defaultStart = new Date(defaultEnd.getTime() - 180 * 24 * 60 * 60 * 1000);
  const start = parseDate(parsed.data.start, defaultStart);
  const end = parseDate(parsed.data.end, defaultEnd);

  if (start.getTime() >= end.getTime()) {
    return res.status(400).json({ message: "start must be earlier than end" });
  }

  try {
    const result = await getTravelPoints(start, end);
    return res.json({
      ...result,
      points: result.points.map((point) => ({
        ...point,
        thumbnailPath: `/api/travel/thumbnail/${point.assetId}?size=preview`,
        assetViewUrl: toAssetViewUrl(point.assetId)
      }))
    });
  } catch (error) {
    return res.status(502).json({
      message: "Failed to fetch data from Immich",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

router.get("/thumbnail/:assetId", async (req, res) => {
  const assetId = req.params.assetId;
  const size = req.query.size === "thumbnail" ? "thumbnail" : "preview";

  if (!assetId) {
    return res.status(400).json({ message: "assetId is required" });
  }

  try {
    const response = await fetchThumbnail(assetId, size);
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        message: "Immich thumbnail request failed",
        detail: text
      });
    }

    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    res.setHeader("Cache-Control", "public, max-age=300");

    if (!response.body) {
      return res.status(502).json({ message: "No image body from Immich" });
    }

    const nodeStream = Readable.fromWeb(response.body as never);
    nodeStream.pipe(res);
    return;
  } catch (error) {
    return res.status(502).json({
      message: "Failed to proxy thumbnail",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
