import { searchMetadata } from "./immichClient.js";
import { TravelPoint, TravelPointsResult } from "./types.js";

const DEFAULT_PAGE_SIZE = 300;
const MAX_PAGES = 200;
const DUPLICATE_DISTANCE_METERS = 30;
const DUPLICATE_TIME_WINDOW_MS = 10 * 60 * 1000;

function parseImmichDate(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  // EXIF can be "YYYY:MM:DD HH:mm:ss", convert to ISO-like first.
  const normalized = value.match(/^\d{4}:\d{2}:\d{2} /)
    ? value.replace(/^(\d{4}):(\d{2}):(\d{2}) /, "$1-$2-$3T")
    : value;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.getTime();
}

function toTimestamp(asset: {
  createdAt: string;
  localDateTime?: string;
  exifInfo?: { dateTimeOriginal?: string };
}): string | null {
  const candidates = [
    parseImmichDate(asset.exifInfo?.dateTimeOriginal),
    parseImmichDate(asset.localDateTime),
    parseImmichDate(asset.createdAt)
  ];

  const first = candidates.find((value) => value !== null);
  return first === undefined || first === null ? null : new Date(first).toISOString();
}

function haversineMeters(a: TravelPoint, b: TravelPoint): number {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const earthRadius = 6371000;

  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function simplifyPoints(points: TravelPoint[]): TravelPoint[] {
  const result: TravelPoint[] = [];
  for (const point of points) {
    const prev = result[result.length - 1];
    if (!prev) {
      result.push(point);
      continue;
    }

    const distance = haversineMeters(prev, point);
    const deltaMs = Math.abs(new Date(point.timestamp).getTime() - new Date(prev.timestamp).getTime());
    const isDuplicate = distance < DUPLICATE_DISTANCE_METERS && deltaMs < DUPLICATE_TIME_WINDOW_MS;

    if (!isDuplicate) {
      result.push(point);
    }
  }

  return result;
}

export async function getTravelPoints(start: Date, end: Date): Promise<TravelPointsResult> {
  let page = "1";
  let pageCount = 0;
  let rawAssetCount = 0;
  const points: TravelPoint[] = [];
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
