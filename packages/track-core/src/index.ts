import type { TravelPointBase } from "@immich-travel-map/shared-types";

export const DEFAULT_DUPLICATE_DISTANCE_METERS = 30;
export const DEFAULT_DUPLICATE_TIME_WINDOW_MS = 10 * 60 * 1000;

type TimestampCandidateAsset = {
  createdAt: string;
  localDateTime?: string;
  exifInfo?: { dateTimeOriginal?: string };
};

export type SimplifyTrackOptions = {
  duplicateDistanceMeters?: number;
  duplicateTimeWindowMs?: number;
};

export function parseImmichDate(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.match(/^\d{4}:\d{2}:\d{2} /)
    ? value.replace(/^(\d{4}):(\d{2}):(\d{2}) /, "$1-$2-$3T")
    : value;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.getTime();
}

export function toTimestamp(asset: TimestampCandidateAsset): string | null {
  const candidates = [
    parseImmichDate(asset.exifInfo?.dateTimeOriginal),
    parseImmichDate(asset.localDateTime),
    parseImmichDate(asset.createdAt)
  ];
  const first = candidates.find((value) => value !== null);
  return first === undefined || first === null ? null : new Date(first).toISOString();
}

export function haversineMeters(a: TravelPointBase, b: TravelPointBase): number {
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

export function simplifyPoints(
  points: TravelPointBase[],
  options: SimplifyTrackOptions = {}
): TravelPointBase[] {
  const duplicateDistanceMeters = options.duplicateDistanceMeters ?? DEFAULT_DUPLICATE_DISTANCE_METERS;
  const duplicateTimeWindowMs = options.duplicateTimeWindowMs ?? DEFAULT_DUPLICATE_TIME_WINDOW_MS;
  const result: TravelPointBase[] = [];

  for (const point of points) {
    const prev = result[result.length - 1];
    if (!prev) {
      result.push(point);
      continue;
    }

    const distance = haversineMeters(prev, point);
    const deltaMs = Math.abs(new Date(point.timestamp).getTime() - new Date(prev.timestamp).getTime());
    const isDuplicate = distance < duplicateDistanceMeters && deltaMs < duplicateTimeWindowMs;

    if (!isDuplicate) {
      result.push(point);
    }
  }

  return result;
}
