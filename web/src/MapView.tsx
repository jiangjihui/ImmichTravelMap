import maplibregl from "maplibre-gl";
import maplibreglWorkerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker.js?url";
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useEffect, useRef } from "react";
import { TravelPoint } from "./types";

type MapViewProps = {
  points: TravelPoint[];
  activeTime: number;
  followCurrent: boolean;
  apiBase: string;
  thumbnailAuth: { baseUrl: string; apiKey: string } | null;
  followIntensity: number;
  ultraAggressiveFollow: boolean;
};

type FollowConfig = {
  windowSize: number;
  padding: { top: number; right: number; bottom: number; left: number };
  maxZoom: number;
  minZoom: number;
  duration: number;
  easing: (t: number) => number;
};

let workerConfigured = false;

function ensureMaplibreWorkerConfigured() {
  if (workerConfigured) {
    return;
  }
  maplibregl.setWorkerUrl(maplibreglWorkerUrl);
  workerConfigured = true;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function resolveFollowConfig(intensity: number, ultraAggressiveFollow: boolean): FollowConfig {
  const t = Math.max(0, Math.min(100, intensity)) / 100;
  const eased = t * t * (3 - 2 * t);

  const bounds = ultraAggressiveFollow
    ? {
        windowMin: 1.5,
        zoomMax: 14,
        zoomMinMax: 7.2,
        durationMin: 240,
        padTopMin: 12,
        padBottomMin: 18
      }
    : {
        windowMin: 2,
        zoomMax: 12,
        zoomMinMax: 5.4,
        durationMin: 360,
        padTopMin: 20,
        padBottomMin: 28
      };

  return {
    windowSize: Math.max(1, Math.round(lerp(12, bounds.windowMin, eased))),
    padding: {
      top: Math.round(lerp(168, bounds.padTopMin, eased)),
      right: Math.round(lerp(168, bounds.padTopMin, eased)),
      bottom: Math.round(lerp(208, bounds.padBottomMin, eased)),
      left: Math.round(lerp(168, bounds.padTopMin, eased))
    },
    maxZoom: lerp(5.2, bounds.zoomMax, eased),
    minZoom: lerp(2.1, bounds.zoomMinMax, eased),
    duration: Math.round(lerp(1180, bounds.durationMin, eased)),
    easing: (x) => x * x * (3 - 2 * x)
  };
}

function buildLocationLabel(point: TravelPoint): string {
  return [point.city, point.state, point.country].filter(Boolean).join(", ");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function toThumbnailUrl(apiBase: string, point: TravelPoint): string | null {
  if (!point.thumbnailPath) {
    return null;
  }
  return apiBase ? `${apiBase}${point.thumbnailPath}` : point.thumbnailPath;
}

async function fetchDirectThumbnail(
  assetId: string,
  auth: { baseUrl: string; apiKey: string }
): Promise<string | null> {
  const response = await fetch(`${trimTrailingSlash(auth.baseUrl)}/api/assets/${assetId}/thumbnail?size=preview`, {
    headers: {
      "x-api-key": auth.apiKey
    }
  });
  if (!response.ok) {
    return null;
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export function MapView({
  points,
  activeTime,
  followCurrent,
  apiBase,
  thumbnailAuth,
  followIntensity,
  ultraAggressiveFollow
}: MapViewProps) {
  const followConfig = useMemo(
    () => resolveFollowConfig(followIntensity, ultraAggressiveFollow),
    [followIntensity, ultraAggressiveFollow]
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const popupObjectUrlRef = useRef<string | null>(null);
  const thumbnailAuthRef = useRef<{ baseUrl: string; apiKey: string } | null>(thumbnailAuth);
  const lastCenteredAssetRef = useRef<string | null>(null);

  useEffect(() => {
    thumbnailAuthRef.current = thumbnailAuth;
  }, [thumbnailAuth]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    ensureMaplibreWorkerConfigured();

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap contributors"
          }
        },
        layers: [
          {
            id: "osm-base",
            type: "raster",
            source: "osm"
          }
        ]
      },
      center: [15, 20],
      zoom: 1.6
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      map.addSource("track", {
        type: "geojson",
        lineMetrics: true,
        data: {
          type: "FeatureCollection",
          features: []
        }
      });
      map.addSource("visited-points", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: []
        }
      });
      map.addSource("current-point", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: []
        }
      });

      map.addLayer({
        id: "track-glow",
        type: "line",
        source: "track",
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.25,
          "line-width": 9
        }
      });

      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        paint: {
          "line-width": 4,
          "line-gradient": [
            "interpolate",
            ["linear"],
            ["line-progress"],
            0,
            "#2a7fff",
            0.5,
            "#00c4b3",
            1,
            "#f54f7f"
          ]
        }
      });

      map.addLayer({
        id: "visited-circle",
        type: "circle",
        source: "visited-points",
        paint: {
          "circle-radius": 4,
          "circle-color": "#f9fbff",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#1b4bc4"
        }
      });

      map.addLayer({
        id: "current-circle",
        type: "circle",
        source: "current-point",
        paint: {
          "circle-radius": 8,
          "circle-color": "#ff6f5b",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff7f2"
        }
      });

      map.on("mouseenter", "visited-circle", () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", "visited-circle", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("click", "visited-circle", (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") {
          return;
        }

        const [lng, lat] = feature.geometry.coordinates;
        const props = feature.properties as {
          assetId?: string;
          time?: string;
          location?: string;
          image?: string;
          viewUrl?: string;
        };
        const previewUrl = props.image?.trim() ? props.image : "";

        if (popupObjectUrlRef.current) {
          URL.revokeObjectURL(popupObjectUrlRef.current);
          popupObjectUrlRef.current = null;
        }

        popupRef.current?.remove();

        const popupContent = document.createElement("div");
        popupContent.style.fontFamily = "ui-sans-serif, system-ui";
        popupContent.style.width = "260px";

        const imageHost = document.createElement("div");
        imageHost.style.width = "100%";
        imageHost.style.height = "148px";
        imageHost.style.borderRadius = "10px";
        imageHost.style.overflow = "hidden";
        imageHost.style.background = "#eef3fd";
        popupContent.appendChild(imageHost);

        const renderImage = (src: string) => {
          const image = document.createElement("img");
          image.src = src;
          image.alt = "preview";
          image.style.width = "100%";
          image.style.height = "148px";
          image.style.objectFit = "cover";

          if (props.viewUrl) {
            const link = document.createElement("a");
            link.href = props.viewUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.style.display = "block";
            link.style.cursor = "pointer";
            link.appendChild(image);
            imageHost.replaceChildren(link);
            return;
          }

          imageHost.replaceChildren(image);
        };

        const renderHint = (text: string) => {
          const hint = document.createElement("div");
          hint.textContent = text;
          hint.style.height = "148px";
          hint.style.display = "flex";
          hint.style.alignItems = "center";
          hint.style.justifyContent = "center";
          hint.style.color = "#516585";
          hint.style.fontSize = "12px";
          imageHost.replaceChildren(hint);
        };

        if (previewUrl) {
          renderImage(previewUrl);
        } else {
          renderHint("预览加载中...");
        }

        const timeLine = document.createElement("div");
        timeLine.textContent = props.time ?? "";
        timeLine.style.marginTop = "8px";
        timeLine.style.fontSize = "13px";
        timeLine.style.color = "#101821";
        popupContent.appendChild(timeLine);

        const locationLine = document.createElement("div");
        locationLine.textContent = props.location ?? "";
        locationLine.style.marginTop = "2px";
        locationLine.style.fontSize = "12px";
        locationLine.style.color = "#4d5b72";
        popupContent.appendChild(locationLine);

        if (props.viewUrl) {
          const linkHint = document.createElement("div");
          linkHint.textContent = "点击图片在 Immich 中查看";
          linkHint.style.marginTop = "4px";
          linkHint.style.fontSize = "12px";
          linkHint.style.color = "#1b4bc4";
          popupContent.appendChild(linkHint);
        }

        const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "290px" })
          .setLngLat([lng, lat])
          .setDOMContent(popupContent)
          .addTo(map);

        popupRef.current = popup;

        if (!previewUrl && props.assetId && thumbnailAuthRef.current) {
          void fetchDirectThumbnail(props.assetId, thumbnailAuthRef.current)
            .then((objectUrl) => {
              if (!objectUrl) {
                renderHint("无法加载预览图");
                return;
              }
              if (popupRef.current !== popup) {
                URL.revokeObjectURL(objectUrl);
                return;
              }
              popupObjectUrlRef.current = objectUrl;
              renderImage(objectUrl);
            })
            .catch(() => {
              renderHint("无法加载预览图");
            });
        } else if (!previewUrl) {
          renderHint("无预览图");
        }
      });
    });

    return () => {
      popupRef.current?.remove();
      if (popupObjectUrlRef.current) {
        URL.revokeObjectURL(popupObjectUrlRef.current);
        popupObjectUrlRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || points.length < 2) {
      return;
    }

    const bounds = new maplibregl.LngLatBounds([points[0].longitude, points[0].latitude], [
      points[0].longitude,
      points[0].latitude
    ]);
    for (const point of points) {
      bounds.extend([point.longitude, point.latitude]);
    }
    map.fitBounds(bounds, { padding: 48, duration: 1000 });
    lastCenteredAssetRef.current = null;
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const visible = points.filter((point) => new Date(point.timestamp).getTime() <= activeTime);
    const lineCoordinates = visible.map((point) => [point.longitude, point.latitude]);
    const current = visible[visible.length - 1];

    const trackSource = map.getSource("track") as GeoJSONSource | undefined;
    const visitedSource = map.getSource("visited-points") as GeoJSONSource | undefined;
    const currentSource = map.getSource("current-point") as GeoJSONSource | undefined;

    trackSource?.setData({
      type: "FeatureCollection",
      features:
        lineCoordinates.length >= 2
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: lineCoordinates
                }
              }
            ]
          : []
    });

    visitedSource?.setData({
      type: "FeatureCollection",
      features: visible.map((point) => ({
        type: "Feature",
        properties: {
          assetId: point.assetId,
          time: new Date(point.timestamp).toLocaleString(),
          location: buildLocationLabel(point),
          image: toThumbnailUrl(apiBase, point),
          viewUrl: point.assetViewUrl ?? ""
        },
        geometry: {
          type: "Point",
          coordinates: [point.longitude, point.latitude]
        }
      }))
    });

    currentSource?.setData({
      type: "FeatureCollection",
      features: current
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "Point",
                coordinates: [current.longitude, current.latitude]
              }
            }
          ]
        : []
    });

    if (followCurrent && current && lastCenteredAssetRef.current !== current.assetId) {
      const recentPoints = visible.slice(Math.max(0, visible.length - followConfig.windowSize));
      const recentBounds = new maplibregl.LngLatBounds(
        [current.longitude, current.latitude],
        [current.longitude, current.latitude]
      );
      for (const point of recentPoints) {
        recentBounds.extend([point.longitude, point.latitude]);
      }

      const targetCamera = map.cameraForBounds(recentBounds, {
        padding: followConfig.padding,
        maxZoom: followConfig.maxZoom
      });
      const targetZoom =
        targetCamera?.zoom ?? Math.max(followConfig.minZoom, Math.min(followConfig.maxZoom, map.getZoom()));

      map.easeTo({
        center: [current.longitude, current.latitude],
        zoom: Math.max(followConfig.minZoom, Math.min(followConfig.maxZoom, targetZoom)),
        duration: followConfig.duration,
        easing: followConfig.easing
      });
      lastCenteredAssetRef.current = current.assetId;
    }
  }, [activeTime, apiBase, followConfig, followCurrent, points]);

  return <div ref={containerRef} className="map-container" />;
}
