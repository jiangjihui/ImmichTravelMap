import { TravelResponse } from "./types";

const apiBase = import.meta.env.VITE_API_BASE ?? "";

function buildUrl(path: string): string {
  return apiBase ? `${apiBase}${path}` : path;
}

export function getApiBase(): string {
  return apiBase;
}

export async function fetchTravelPoints(startIso: string, endIso: string): Promise<TravelResponse> {
  const url = new URL(buildUrl("/api/travel/points"), window.location.origin);
  url.searchParams.set("start", startIso);
  url.searchParams.set("end", endIso);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`加载轨迹失败 (${response.status}): ${text}`);
  }

  return (await response.json()) as TravelResponse;
}
