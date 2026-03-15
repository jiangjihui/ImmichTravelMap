import type { ImmichSearchResponse } from "@immich-travel-map/shared-types";
import { config } from "./config.js";

function buildImmichUrl(path: string): string {
  return `${config.IMMICH_BASE_URL}${path}`;
}

async function immichFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(buildImmichUrl(path), {
    ...init,
    headers: {
      "x-api-key": config.IMMICH_API_KEY,
      ...init?.headers
    }
  });
}

export async function searchMetadata(body: Record<string, unknown>): Promise<ImmichSearchResponse> {
  const response = await immichFetch("/api/search/metadata", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Immich search failed (${response.status}): ${text}`);
  }

  return (await response.json()) as ImmichSearchResponse;
}

export async function fetchThumbnail(assetId: string, size: "thumbnail" | "preview"): Promise<Response> {
  return immichFetch(`/api/assets/${assetId}/thumbnail?size=${size}`);
}
