import { simplifyPoints, toTimestamp } from "@immich-travel-map/track-core";
import type { ImmichSearchResponse, TravelPointBase, TravelResponse } from "@immich-travel-map/shared-types";

const DEFAULT_PAGE_SIZE = 300;
const MAX_PAGES = 200;

export type ClientMode = "proxy" | "direct";

export type TravelClientConfig = {
  mode: ClientMode;
  proxyApiBase?: string;
  directImmichBaseUrl?: string;
  directImmichApiKey?: string;
  directAssetUrlTemplate?: string;
};

export type TravelClient = {
  mode: ClientMode;
  mapApiBase: string;
  thumbnailAuth: { baseUrl: string; apiKey: string } | null;
  configError: string | null;
  fetchTravelPoints: (startIso: string, endIso: string) => Promise<TravelResponse>;
};

function detectDesktopDefaultProxyApiBase(): string {
  if (typeof window === "undefined") {
    return "";
  }

  if (window.location.protocol === "tauri:") {
    return "http://127.0.0.1:8787";
  }

  if (window.location.hostname === "tauri.localhost") {
    return "http://127.0.0.1:8787";
  }

  return "";
}

function resolveProxyApiBase(candidate?: string): string {
  const trimmed = (candidate ?? "").trim();
  if (trimmed) {
    return trimmed;
  }
  return detectDesktopDefaultProxyApiBase();
}

const defaultProxyApiBase = resolveProxyApiBase(import.meta.env.VITE_API_BASE);
const defaultDirectImmichBaseUrl = (import.meta.env.VITE_DIRECT_IMMICH_BASE_URL ?? "").trim();
const defaultDirectImmichApiKey = (import.meta.env.VITE_DIRECT_IMMICH_API_KEY ?? "").trim();
const defaultAssetUrlTemplate = (import.meta.env.VITE_IMMICH_WEB_ASSET_URL_TEMPLATE ?? "").trim();

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildProxyUrl(base: string, path: string): string {
  const trimmed = base.trim();
  return trimmed ? `${trimTrailingSlash(trimmed)}${path}` : path;
}

function buildImmichAssetUrl(assetId: string, baseUrl: string, template?: string): string {
  const fallback = `${trimTrailingSlash(baseUrl)}/photos/{assetId}`;
  const resolvedTemplate = template?.trim() ? template.trim() : fallback;
  return resolvedTemplate.split("{assetId}").join(assetId);
}

async function fetchProxyTravelPoints(apiBase: string, startIso: string, endIso: string): Promise<TravelResponse> {
  const url = new URL(buildProxyUrl(apiBase, "/api/travel/points"), window.location.origin);
  url.searchParams.set("start", startIso);
  url.searchParams.set("end", endIso);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`加载轨迹失败 (${response.status}): ${text}`);
  }

  return (await response.json()) as TravelResponse;
}

async function fetchImmichSearchPage(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<ImmichSearchResponse> {
  let response: Response;
  try {
    response = await fetch(`${trimTrailingSlash(baseUrl)}/api/search/metadata`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new Error(
      `无法连接 Immich（可能是地址不可达或 CORS 未放行）：${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Immich metadata 查询失败 (${response.status}): ${text}`);
  }

  return (await response.json()) as ImmichSearchResponse;
}

async function fetchDirectTravelPoints(
  immichBaseUrl: string,
  immichApiKey: string,
  startIso: string,
  endIso: string,
  assetUrlTemplate?: string
): Promise<TravelResponse> {
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

    const response = await fetchImmichSearchPage(immichBaseUrl, immichApiKey, {
      withExif: true,
      takenAfter: startIso,
      takenBefore: endIso,
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
      start: new Date(startIso).toISOString(),
      end: new Date(endIso).toISOString(),
      rawAssetCount,
      geoPointCount: points.length,
      simplifiedPointCount: simplified.length
    },
    points: simplified.map((point) => ({
      ...point,
      thumbnailPath: "",
      assetViewUrl: buildImmichAssetUrl(point.assetId, immichBaseUrl, assetUrlTemplate)
    }))
  };
}

export function getDefaultClientSettings() {
  return {
    proxyApiBase: defaultProxyApiBase,
    directImmichBaseUrl: defaultDirectImmichBaseUrl,
    directImmichApiKey: defaultDirectImmichApiKey,
    directAssetUrlTemplate: defaultAssetUrlTemplate
  };
}

export function createTravelClient(config: TravelClientConfig): TravelClient {
  if (config.mode === "proxy") {
    const proxyApiBase = resolveProxyApiBase(config.proxyApiBase ?? defaultProxyApiBase);
    return {
      mode: "proxy",
      mapApiBase: proxyApiBase,
      thumbnailAuth: null,
      configError: null,
      fetchTravelPoints: (startIso, endIso) => fetchProxyTravelPoints(proxyApiBase, startIso, endIso)
    };
  }

  const directImmichBaseUrl = (config.directImmichBaseUrl ?? defaultDirectImmichBaseUrl).trim();
  const directImmichApiKey = (config.directImmichApiKey ?? defaultDirectImmichApiKey).trim();
  const directAssetUrlTemplate = (config.directAssetUrlTemplate ?? defaultAssetUrlTemplate).trim();
  const missingDirectConfig =
    !directImmichBaseUrl || !directImmichApiKey
      ? "直连模式需要填写 Immich 地址和 API Key。"
      : null;

  return {
    mode: "direct",
    mapApiBase: "",
    thumbnailAuth:
      missingDirectConfig === null
        ? {
            baseUrl: directImmichBaseUrl,
            apiKey: directImmichApiKey
          }
        : null,
    configError: missingDirectConfig,
    fetchTravelPoints: async (startIso, endIso) => {
      if (missingDirectConfig !== null) {
        throw new Error(missingDirectConfig);
      }
      return fetchDirectTravelPoints(
        directImmichBaseUrl,
        directImmichApiKey,
        startIso,
        endIso,
        directAssetUrlTemplate
      );
    }
  };
}
