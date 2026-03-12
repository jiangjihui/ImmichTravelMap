import "maplibre-gl/dist/maplibre-gl.js";
import type * as MapLibreGL from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useEffect, useRef } from "react";
import { TravelPoint } from "./types";

const maplibregl = globalThis.maplibregl;

type MapViewProps = {
  points: TravelPoint[];
  activeTime: number;
  followCurrent: boolean;
  apiBase: string;
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

function toThumbnailUrl(apiBase: string, point: TravelPoint): string {
  return apiBase ? `${apiBase}${point.thumbnailPath}` : point.thumbnailPath;
}

export function MapView({
  points,
  activeTime,
  followCurrent,
  apiBase,
  followIntensity,
  ultraAggressiveFollow
}: MapViewProps) {
  const followConfig = useMemo(
    () => resolveFollowConfig(followIntensity, ultraAggressiveFollow),
    [followIntensity, ultraAggressiveFollow]
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreGL.Map | null>(null);
  const popupRef = useRef<MapLibreGL.Popup | null>(null);
  const lastCenteredAssetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

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
          time?: string;
          location?: string;
          image?: string;
          viewUrl?: string;
        };
        const imageHtml = props.viewUrl
          ? `<a href="${props.viewUrl}" target="_blank" rel="noopener noreferrer"><img src="${props.image ?? ""}" alt="preview" style="width:100%;height:148px;object-fit:cover;border-radius:10px;cursor:pointer;" /></a>`
          : `<img src="${props.image ?? ""}" alt="preview" style="width:100%;height:148px;object-fit:cover;border-radius:10px;" />`;
        const linkHintHtml = props.viewUrl
          ? `<div style="margin-top:4px;font-size:12px;color:#1b4bc4;">点击图片在 Immich 中查看</div>`
          : "";

        popupRef.current?.remove();
        const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "290px" })
          .setLngLat([lng, lat])
          .setHTML(`
            <div style="font-family: ui-sans-serif, system-ui; width: 260px;">
              ${imageHtml}
              <div style="margin-top:8px;font-size:13px;color:#101821;">${props.time ?? ""}</div>
              <div style="margin-top:2px;font-size:12px;color:#4d5b72;">${props.location ?? ""}</div>
              ${linkHintHtml}
            </div>
          `)
          .addTo(map);

        popupRef.current = popup;
      });
    });

    return () => {
      popupRef.current?.remove();
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
