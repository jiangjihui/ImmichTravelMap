import { simplifyPoints, toTimestamp } from "@immich-travel-map/track-core";
import type { TravelPointBase, TravelPointsResult } from "@immich-travel-map/shared-types";
import { searchMetadata } from "./immichClient.js";

const DEFAULT_PAGE_SIZE = 300;
const MAX_PAGES = 200;

export async function getTravelPoints(start: Date, end: Date): Promise<TravelPointsResult<TravelPointBase>> {
  let page = "1";
  let pageCount = 0;
  let rawAssetCount = 0;
  const points: TravelPointBase[] = [];
  const seenPages = new Set<string>();

  while (page && pageCount < MAX_PAGES) {
    if (seenPages.has(page)) {
      break;
    }
    seenPages.add(page);

    const response = await searchMetadata({
      withExif: true,
      takenAfter: start.toISOString(),
      takenBefore: end.toISOString(),
      page,
      size: DEFAULT_PAGE_SIZE
    });

    pageCount += 1;
    rawAssetCount += response.assets.items.length;

    for (const asset of response.assets.items) {
      const lat = asset.exifInfo?.latitude;
      const lon = asset.exifInfo?.longitude;
      if (typeof lat !== "number" || typeof lon !== "number") {
        continue;
      }
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        continue;
      }

      const timestamp = toTimestamp(asset);
      if (!timestamp) {
        continue;
      }

      points.push({
        assetId: asset.id,
        timestamp,
        latitude: lat,
        longitude: lon,
        city: asset.exifInfo?.city ?? null,
        state: asset.exifInfo?.state ?? null,
        country: asset.exifInfo?.country ?? null
      });
    }

    page = response.assets.nextPage ?? "";
  }

  points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const simplified = simplifyPoints(points);

  return {
    summary: {
      start: start.toISOString(),
      end: end.toISOString(),
      rawAssetCount,
      geoPointCount: points.length,
      simplifiedPointCount: simplified.length
    },
    points: simplified
  };
}
