import { useEffect, useMemo, useState } from "react";
import { createTravelClient, getDefaultClientSettings, type ClientMode } from "./api";
import { MapView } from "./MapView";
import { type TravelPoint, type TravelResponse } from "./types";

const PLAYBACK_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];
const POINT_BASE_INTERVAL_MS = 160;
const SETTINGS_STORAGE_KEY = "immich-travel-map.settings.v1";

type PlaybackMode = "time" | "point";
type ConnectionStatus = "checking" | "connected" | "disconnected" | "direct";

type RuntimeSettings = {
  mode: ClientMode;
  proxyApiBase: string;
  directImmichBaseUrl: string;
  directImmichApiKey: string;
  directAssetUrlTemplate: string;
};

function toDateTimeLocalValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function findPointIndexAtOrBeforeTime(points: TravelPoint[], targetTime: number): number {
  if (points.length === 0) {
    return 0;
  }

  let left = 0;
  let right = points.length - 1;
  let answer = 0;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = new Date(points[mid].timestamp).getTime();
    if (midTime <= targetTime) {
      answer = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return answer;
}

function buildHealthCheckUrl(apiBase: string): string {
  const trimmed = apiBase.trim();
  if (!trimmed) {
    return "/api/health";
  }
  return `${trimmed.replace(/\/+$/, "")}/api/health`;
}

function loadRuntimeSettings(defaults: ReturnType<typeof getDefaultClientSettings>): RuntimeSettings {
  if (typeof window === "undefined") {
    return {
      mode: "proxy",
      proxyApiBase: defaults.proxyApiBase,
      directImmichBaseUrl: defaults.directImmichBaseUrl,
      directImmichApiKey: defaults.directImmichApiKey,
      directAssetUrlTemplate: defaults.directAssetUrlTemplate
    };
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        mode: "proxy",
        proxyApiBase: defaults.proxyApiBase,
        directImmichBaseUrl: defaults.directImmichBaseUrl,
        directImmichApiKey: defaults.directImmichApiKey,
        directAssetUrlTemplate: defaults.directAssetUrlTemplate
      };
    }

    const parsed = JSON.parse(raw) as Partial<RuntimeSettings>;
    const parsedProxyApiBase =
      typeof parsed.proxyApiBase === "string" && parsed.proxyApiBase.trim().length > 0
        ? parsed.proxyApiBase
        : defaults.proxyApiBase;

    return {
      mode: parsed.mode === "direct" ? "direct" : "proxy",
      proxyApiBase: parsedProxyApiBase,
      directImmichBaseUrl:
        typeof parsed.directImmichBaseUrl === "string" ? parsed.directImmichBaseUrl : defaults.directImmichBaseUrl,
      directImmichApiKey:
        typeof parsed.directImmichApiKey === "string" ? parsed.directImmichApiKey : defaults.directImmichApiKey,
      directAssetUrlTemplate:
        typeof parsed.directAssetUrlTemplate === "string"
          ? parsed.directAssetUrlTemplate
          : defaults.directAssetUrlTemplate
    };
  } catch {
    return {
      mode: "proxy",
      proxyApiBase: defaults.proxyApiBase,
      directImmichBaseUrl: defaults.directImmichBaseUrl,
      directImmichApiKey: defaults.directImmichApiKey,
      directAssetUrlTemplate: defaults.directAssetUrlTemplate
    };
  }
}

export default function App() {
  const now = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), [now]);
  const defaultClientSettings = useMemo(() => getDefaultClientSettings(), []);
  const initialSettings = useMemo(() => loadRuntimeSettings(defaultClientSettings), [defaultClientSettings]);

  const [startInput, setStartInput] = useState<string>(toDateTimeLocalValue(defaultStart));
  const [endInput, setEndInput] = useState<string>(toDateTimeLocalValue(now));
  const [mode, setMode] = useState<ClientMode>(initialSettings.mode);
  const [proxyApiBaseInput, setProxyApiBaseInput] = useState(initialSettings.proxyApiBase);
  const [directImmichBaseUrlInput, setDirectImmichBaseUrlInput] = useState(initialSettings.directImmichBaseUrl);
  const [directImmichApiKeyInput, setDirectImmichApiKeyInput] = useState(initialSettings.directImmichApiKey);
  const [directAssetUrlTemplateInput, setDirectAssetUrlTemplateInput] = useState(initialSettings.directAssetUrlTemplate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<TravelResponse["summary"] | null>(null);
  const [points, setPoints] = useState<TravelPoint[]>([]);
  const [activeTime, setActiveTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [followCurrent, setFollowCurrent] = useState(true);
  const [followIntensity, setFollowIntensity] = useState(72);
  const [ultraAggressiveFollow, setUltraAggressiveFollow] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("time");
  const [playheadIndex, setPlayheadIndex] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("checking");
  const [connectionHint, setConnectionHint] = useState("");

  const client = useMemo(
    () =>
      createTravelClient({
        mode,
        proxyApiBase: proxyApiBaseInput,
        directImmichBaseUrl: directImmichBaseUrlInput,
        directImmichApiKey: directImmichApiKeyInput,
        directAssetUrlTemplate: directAssetUrlTemplateInput
      }),
    [mode, proxyApiBaseInput, directAssetUrlTemplateInput, directImmichApiKeyInput, directImmichBaseUrlInput]
  );

  const minTime = points.length > 0 ? new Date(points[0].timestamp).getTime() : 0;
  const maxTime = points.length > 0 ? new Date(points[points.length - 1].timestamp).getTime() : 0;

  useEffect(() => {
    const payload: RuntimeSettings = {
      mode,
      proxyApiBase: proxyApiBaseInput,
      directImmichBaseUrl: directImmichBaseUrlInput,
      directImmichApiKey: directImmichApiKeyInput,
      directAssetUrlTemplate: directAssetUrlTemplateInput
    };
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  }, [mode, proxyApiBaseInput, directAssetUrlTemplateInput, directImmichApiKeyInput, directImmichBaseUrlInput]);

  useEffect(() => {
    if (mode !== "proxy") {
      setConnectionStatus("direct");
      setConnectionHint("直连模式不依赖本地代理服务");
      return;
    }

    let active = true;
    const healthPath = buildHealthCheckUrl(client.mapApiBase);

    const checkConnection = async () => {
      setConnectionStatus((prev) => (prev === "connected" ? "connected" : "checking"));
      try {
        const healthUrl = new URL(healthPath, window.location.origin);
        const response = await fetch(healthUrl.toString(), { method: "GET" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
        if (payload?.ok === false) {
          throw new Error("health.ok=false");
        }
        if (!active) {
          return;
        }
        setConnectionStatus("connected");
        setConnectionHint(healthUrl.toString());
      } catch (err) {
        if (!active) {
          return;
        }
        setConnectionStatus("disconnected");
        setConnectionHint(err instanceof Error ? err.message : String(err));
      }
    };

    void checkConnection();
    const timer = window.setInterval(() => {
      void checkConnection();
    }, 4000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client.mapApiBase, mode]);

  async function loadPoints(): Promise<void> {
    if (client.configError) {
      setError(client.configError);
      return;
    }

    setLoading(true);
    setError(null);
    setIsPlaying(false);
    try {
      const startIso = new Date(startInput).toISOString();
      const endIso = new Date(endInput).toISOString();
      const data = await client.fetchTravelPoints(startIso, endIso);
      setPoints(data.points);
      setSummary(data.summary);
      if (data.points.length > 0) {
        setActiveTime(new Date(data.points[0].timestamp).getTime());
        setPlayheadIndex(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (client.mode === "direct" && client.configError) {
      return;
    }
    void loadPoints();
  }, []);

  useEffect(() => {
    if (!isPlaying || points.length < 2) {
      return;
    }

    if (playbackMode === "time") {
      const span = Math.max(1000, maxTime - minTime);
      const step = (span / 400) * speed;
      const timer = window.setInterval(() => {
        setActiveTime((prev) => clamp(prev + step, minTime, maxTime));
      }, 50);
      return () => window.clearInterval(timer);
    }

    const intervalMs = Math.max(24, Math.round(POINT_BASE_INTERVAL_MS / speed));
    const timer = window.setInterval(() => {
      setPlayheadIndex((prev) => {
        const next = Math.min(prev + 1, points.length - 1);
        setActiveTime(new Date(points[next].timestamp).getTime());
        return next;
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, maxTime, minTime, playbackMode, points, speed]);

  useEffect(() => {
    if (points.length === 0) {
      return;
    }

    if (playbackMode === "point") {
      setPlayheadIndex(findPointIndexAtOrBeforeTime(points, activeTime));
      return;
    }

    const safeIndex = clamp(playheadIndex, 0, points.length - 1);
    setActiveTime(new Date(points[safeIndex].timestamp).getTime());
  }, [playbackMode, points]);

  useEffect(() => {
    if (isPlaying && activeTime >= maxTime) {
      setIsPlaying(false);
    }
  }, [activeTime, isPlaying, maxTime]);

  const progressPercent =
    minTime < maxTime ? Math.round(((activeTime - minTime) / (maxTime - minTime)) * 1000) / 10 : 0;
  const proxyHealthPath = buildHealthCheckUrl(client.mapApiBase);
  const connectionText =
    connectionStatus === "connected"
      ? "已连接"
      : connectionStatus === "checking"
        ? "检测中..."
        : connectionStatus === "direct"
          ? "直连模式"
          : "未连接";
  const connectionClass =
    connectionStatus === "connected"
      ? "connected"
      : connectionStatus === "checking"
        ? "checking"
        : connectionStatus === "direct"
          ? "direct"
          : "disconnected";
  const connectionTitle =
    mode === "proxy"
      ? `健康检查: ${proxyHealthPath}${connectionHint ? ` | ${connectionHint}` : ""}`
      : connectionHint;

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">
          <h1>Immich Travel Map</h1>
          <div className={`connection-status ${connectionClass}`} title={connectionTitle}>
            连接状态：{connectionText}
          </div>
          <p>支持代理模式与直连模式，按时间重现你的旅行轨迹。</p>
        </div>
        <div className="filters">
          <label title="数据来源模式。代理：走本地后端；直连：浏览器直连 Immich">
            数据模式
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as ClientMode)}
              title="数据来源模式。代理：走本地后端；直连：浏览器直连 Immich"
            >
              <option value="proxy">代理模式（推荐）</option>
              <option value="direct">直连模式</option>
            </select>
          </label>

          {mode === "proxy" ? (
            <label title="后端 API 地址。留空使用同源 /api">
              代理 API
              <input
                type="text"
                value={proxyApiBaseInput}
                onChange={(event) => setProxyApiBaseInput(event.target.value)}
                placeholder="留空表示同源 /api"
                title="后端 API 地址。留空使用同源 /api"
              />
            </label>
          ) : (
            <>
              <label title="Immich 服务地址，例如 http://localhost:2283">
                Immich 地址
                <input
                  type="text"
                  value={directImmichBaseUrlInput}
                  onChange={(event) => setDirectImmichBaseUrlInput(event.target.value)}
                  placeholder="http://localhost:2283"
                  title="Immich 服务地址，例如 http://localhost:2283"
                />
              </label>
              <label title="Immich API Key（仅保存在当前浏览器）">
                API Key
                <input
                  type="password"
                  value={directImmichApiKeyInput}
                  onChange={(event) => setDirectImmichApiKeyInput(event.target.value)}
                  placeholder="输入 Immich API Key"
                  title="Immich API Key（仅保存在当前浏览器）"
                />
              </label>
              <label title="可选：Immich 页面跳转模板，支持 {assetId}">
                跳转模板
                <input
                  type="text"
                  value={directAssetUrlTemplateInput}
                  onChange={(event) => setDirectAssetUrlTemplateInput(event.target.value)}
                  placeholder="可选，如 https://immich/photos/{assetId}"
                  title="可选：Immich 页面跳转模板，支持 {assetId}"
                />
              </label>
            </>
          )}

          <label title="设置轨迹查询的开始时间">
            起始时间
            <input type="datetime-local" value={startInput} onChange={(event) => setStartInput(event.target.value)} />
          </label>
          <label title="设置轨迹查询的结束时间">
            结束时间
            <input type="datetime-local" value={endInput} onChange={(event) => setEndInput(event.target.value)} />
          </label>
          <button
            className="primary"
            onClick={() => void loadPoints()}
            disabled={loading || client.configError !== null}
            title="按当前配置和起止时间重新加载轨迹"
          >
            {loading ? "加载中..." : "加载轨迹"}
          </button>
        </div>
      </header>

      <main className="map-shell">
        <MapView
          points={points}
          activeTime={activeTime}
          followCurrent={followCurrent}
          followIntensity={followIntensity}
          ultraAggressiveFollow={ultraAggressiveFollow}
          apiBase={client.mapApiBase}
          thumbnailAuth={client.thumbnailAuth}
        />
      </main>

      <section className="timeline-panel">
        <div className="timeline-row">
          <button
            className="secondary"
            onClick={() => setIsPlaying((prev) => !prev)}
            disabled={points.length < 2 || loading}
            title="播放或暂停轨迹动画"
          >
            {isPlaying ? "暂停" : "播放"}
          </button>

          <label className="inline" title="控制播放速度，值越大播放越快">
            速度
            <select
              value={String(speed)}
              onChange={(event) => setSpeed(Number(event.target.value))}
              title="控制播放速度，值越大播放越快"
            >
              {PLAYBACK_SPEEDS.map((item) => (
                <option value={item} key={item}>
                  {item}x
                </option>
              ))}
            </select>
          </label>

          <label className="inline" title="控制镜头跟随紧密程度。0 最平稳，100 最紧跟">
            跟随强度
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={followIntensity}
              onChange={(event) => setFollowIntensity(Number(event.target.value))}
              className="inline-range"
              title="控制镜头跟随紧密程度。0 最平稳，100 最紧跟"
            />
            <span title="当前跟随强度值">{followIntensity}</span>
          </label>

          <label className="inline checkbox" title="开启后使用更激进镜头参数（更高缩放、更少留白、更快过渡）">
            <input
              type="checkbox"
              checked={ultraAggressiveFollow}
              onChange={(event) => setUltraAggressiveFollow(event.target.checked)}
              title="开启后使用更激进镜头参数（更高缩放、更少留白、更快过渡）"
            />
            超激进跟随
          </label>

          <label className="inline" title="按时间：真实间隔；按点位：均匀推进，减少停顿">
            播放模式
            <select
              value={playbackMode}
              onChange={(event) => setPlaybackMode(event.target.value as PlaybackMode)}
              title="按时间：真实间隔；按点位：均匀推进，减少停顿"
            >
              <option value="time">按时间（真实节奏）</option>
              <option value="point">按点位（均匀节奏）</option>
            </select>
          </label>

          <label className="inline checkbox" title="开启后镜头会自动跟随当前点位">
            <input
              type="checkbox"
              checked={followCurrent}
              onChange={(event) => setFollowCurrent(event.target.checked)}
              title="开启后镜头会自动跟随当前点位"
            />
            跟随当前点
          </label>

          <span className="time-label">{points.length > 0 ? new Date(activeTime).toLocaleString() : "暂无轨迹数据"}</span>
          <span className="progress">{progressPercent}%</span>
        </div>

        <input
          type="range"
          className="slider"
          min={minTime}
          max={Math.max(minTime, maxTime)}
          value={points.length > 0 ? activeTime : 0}
          onChange={(event) => {
            const nextTime = Number(event.target.value);
            setActiveTime(nextTime);
            if (playbackMode === "point") {
              setPlayheadIndex(findPointIndexAtOrBeforeTime(points, nextTime));
            }
          }}
          disabled={points.length === 0}
          title="拖动时间轴浏览轨迹"
        />

        <div className="meta">
          {summary ? (
            <>
              <span>原始资产: {summary.rawAssetCount}</span>
              <span>地理点: {summary.geoPointCount}</span>
              <span>轨迹点: {summary.simplifiedPointCount}</span>
            </>
          ) : (
            <span>尚未加载数据</span>
          )}
          {error ? <span className="error">{error}</span> : null}
          {client.configError ? <span className="error">{client.configError}</span> : null}
        </div>
      </section>
    </div>
  );
}
