import { useEffect, useMemo, useState } from "react";
import { createTravelClient, getDefaultClientSettings, type ClientMode } from "./api";
import { MapView } from "./MapView";
import { type TravelPoint, type TravelResponse } from "./types";

const PLAYBACK_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];
const POINT_BASE_INTERVAL_MS = 160;
const SETTINGS_STORAGE_KEY = "immich-travel-map.settings.v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const SEGMENT_TRIGGER_DAYS = 45;
const SEGMENT_DAYS = 7;
const HISTORY_TODAY_YEARS = 15;
const HISTORY_TODAY_CONCURRENCY = 3;

type PlaybackMode = "time" | "point";
type ConnectionStatus = "checking" | "connected" | "disconnected" | "direct";
type QueryMode = "time_range" | "history_today";

type RuntimeSettings = {
  mode: ClientMode;
  queryMode: QueryMode;
  proxyApiBase: string;
  directImmichBaseUrl: string;
  directImmichApiKey: string;
  directAssetUrlTemplate: string;
};

function isMobileShellRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.location.protocol === "capacitor:";
}

function isCompactViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(max-width: 900px)").matches;
}

function resolveDefaultMode(proxyApiBase: string): ClientMode {
  if (!isMobileShellRuntime()) {
    return "proxy";
  }
  // On mobile, empty proxy base usually means there is no local BFF.
  // Defaulting to direct mode avoids "/api" falling back to index.html.
  return proxyApiBase.trim().length > 0 ? "proxy" : "direct";
}

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

function splitRangeIntoSegments(startMs: number, endMs: number, segmentDays: number): Array<{ startIso: string; endIso: string }> {
  if (endMs <= startMs) {
    return [];
  }

  const segmentMs = Math.max(1, Math.floor(segmentDays * DAY_MS));
  const segments: Array<{ startIso: string; endIso: string }> = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const segmentEnd = Math.min(cursor + segmentMs, endMs);
    segments.push({
      startIso: new Date(cursor).toISOString(),
      endIso: new Date(segmentEnd).toISOString()
    });
    cursor = segmentEnd;
  }

  return segments;
}

function mergeSegmentResponses(startIso: string, endIso: string, responses: TravelResponse[]): TravelResponse {
  if (responses.length === 0) {
    return {
      summary: {
        start: startIso,
        end: endIso,
        rawAssetCount: 0,
        geoPointCount: 0,
        simplifiedPointCount: 0
      },
      points: []
    };
  }

  const mergedMap = new Map<string, TravelPoint>();
  let rawAssetCount = 0;
  let geoPointCount = 0;

  for (const response of responses) {
    rawAssetCount += response.summary.rawAssetCount;
    geoPointCount += response.summary.geoPointCount;
    for (const point of response.points) {
      const key = point.assetId + "|" + point.timestamp;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, point);
      }
    }
  }

  const points = Array.from(mergedMap.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return {
    summary: {
      start: startIso,
      end: endIso,
      rawAssetCount,
      geoPointCount,
      simplifiedPointCount: points.length
    },
    points
  };
}


type HistoryTodayRange = {
  year: number;
  startIso: string;
  endIso: string;
};

function buildHistoryTodayRanges(referenceDate: Date, yearsBack: number): HistoryTodayRange[] {
  const month = referenceDate.getMonth();
  const day = referenceDate.getDate();
  const currentYear = referenceDate.getFullYear();
  const startYear = currentYear - Math.max(1, yearsBack) + 1;
  const ranges: HistoryTodayRange[] = [];

  for (let year = startYear; year <= currentYear; year += 1) {
    const startLocal = new Date(year, month, day, 0, 0, 0, 0);
    const isSameDay = startLocal.getFullYear() === year && startLocal.getMonth() === month && startLocal.getDate() === day;
    if (!isSameDay) {
      continue;
    }

    const endLocal = new Date(year, month, day + 1, 0, 0, 0, 0);
    ranges.push({
      year,
      startIso: startLocal.toISOString(),
      endIso: endLocal.toISOString()
    });
  }

  return ranges;
}

function formatHistoryTodayFailureMessage(failedYears: number[]): string {
  if (failedYears.length === 0) {
    return "";
  }
  return "历史上今天：以下年份加载失败，已展示其余年份结果：" + failedYears.join(", ");
}
function loadRuntimeSettings(defaults: ReturnType<typeof getDefaultClientSettings>): RuntimeSettings {
  const defaultMode = resolveDefaultMode(defaults.proxyApiBase);
  const defaultQueryMode: QueryMode = "time_range";

  if (typeof window === "undefined") {
    return {
      mode: defaultMode,
      queryMode: defaultQueryMode,
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
        mode: defaultMode,
        queryMode: defaultQueryMode,
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

    const parsedMode = parsed.mode === "direct" ? "direct" : "proxy";
    const resolvedMode =
      parsedMode === "proxy" && isMobileShellRuntime() && parsedProxyApiBase.trim().length === 0 ? "direct" : parsedMode;
    const parsedQueryMode = parsed.queryMode === "history_today" ? "history_today" : "time_range";

    return {
      mode: resolvedMode,
      queryMode: parsedQueryMode,
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
      mode: defaultMode,
      queryMode: defaultQueryMode,
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
  const [queryMode, setQueryMode] = useState<QueryMode>(initialSettings.queryMode);
  const [proxyApiBaseInput, setProxyApiBaseInput] = useState(initialSettings.proxyApiBase);
  const [directImmichBaseUrlInput, setDirectImmichBaseUrlInput] = useState(initialSettings.directImmichBaseUrl);
  const [directImmichApiKeyInput, setDirectImmichApiKeyInput] = useState(initialSettings.directImmichApiKey);
  const [directAssetUrlTemplateInput, setDirectAssetUrlTemplateInput] = useState(initialSettings.directAssetUrlTemplate);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{ current: number; total: number } | null>(null);
  const [showProxyRetry, setShowProxyRetry] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
  const [compactLayout, setCompactLayout] = useState<boolean>(() => isCompactViewport());
  const [configExpanded, setConfigExpanded] = useState<boolean>(() => !isMobileShellRuntime() && !isCompactViewport());

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
      queryMode,
      proxyApiBase: proxyApiBaseInput,
      directImmichBaseUrl: directImmichBaseUrlInput,
      directImmichApiKey: directImmichApiKeyInput,
      directAssetUrlTemplate: directAssetUrlTemplateInput
    };
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  }, [mode, queryMode, proxyApiBaseInput, directAssetUrlTemplateInput, directImmichApiKeyInput, directImmichBaseUrlInput]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const apply = () => setCompactLayout(mediaQuery.matches);
    apply();

    const listener = () => apply();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }

    mediaQuery.addListener(listener);
    return () => mediaQuery.removeListener(listener);
  }, []);

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
        if (!payload || payload.ok !== true) {
          throw new Error("健康检查返回非预期内容");
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

  async function loadPoints(
    targetMode: ClientMode = mode,
    autoFallback = true,
    targetQueryMode: QueryMode = queryMode
  ): Promise<void> {
    const buildClientForMode = (nextMode: ClientMode) =>
      createTravelClient({
        mode: nextMode,
        proxyApiBase: proxyApiBaseInput,
        directImmichBaseUrl: directImmichBaseUrlInput,
        directImmichApiKey: directImmichApiKeyInput,
        directAssetUrlTemplate: directAssetUrlTemplateInput
      });

    const fetchTravelPointsWithStrategy = async (
      nextMode: ClientMode,
      nextQueryMode: QueryMode,
      startIso?: string,
      endIso?: string
    ): Promise<{ data: TravelResponse; failedYears: number[] }> => {
      const activeClient = buildClientForMode(nextMode);
      if (activeClient.configError) {
        throw new Error(activeClient.configError);
      }

      if (nextQueryMode === "history_today") {
        const ranges = buildHistoryTodayRanges(new Date(), HISTORY_TODAY_YEARS);
        if (ranges.length === 0) {
          const empty = mergeSegmentResponses(new Date().toISOString(), new Date().toISOString(), []);
          return { data: empty, failedYears: [] };
        }

        setLoadingProgress({ current: 0, total: ranges.length });
        let nextIndex = 0;
        let completed = 0;
        let lastError = "";
        const responses: TravelResponse[] = [];
        const failedYears: number[] = [];

        const worker = async () => {
          while (nextIndex < ranges.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            const range = ranges[currentIndex];
            try {
              const response = await activeClient.fetchTravelPoints(range.startIso, range.endIso);
              responses.push(response);
            } catch (error) {
              failedYears.push(range.year);
              lastError = error instanceof Error ? error.message : String(error);
            } finally {
              completed += 1;
              setLoadingProgress({ current: completed, total: ranges.length });
            }
          }
        };

        const workerCount = Math.min(HISTORY_TODAY_CONCURRENCY, ranges.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        failedYears.sort((a, b) => a - b);

        if (responses.length === 0) {
          throw new Error(lastError || "历史上今天加载失败");
        }

        return {
          data: mergeSegmentResponses(ranges[0].startIso, ranges[ranges.length - 1].endIso, responses),
          failedYears
        };
      }

      if (!startIso || !endIso) {
        throw new Error("缺少时间范围参数");
      }

      const startMs = new Date(startIso).getTime();
      const endMs = new Date(endIso).getTime();
      const spanDays = Math.max(0, (endMs - startMs) / DAY_MS);
      if (spanDays <= SEGMENT_TRIGGER_DAYS) {
        setLoadingProgress(null);
        return { data: await activeClient.fetchTravelPoints(startIso, endIso), failedYears: [] };
      }

      const segments = splitRangeIntoSegments(startMs, endMs, SEGMENT_DAYS);
      if (segments.length === 0) {
        setLoadingProgress(null);
        return { data: await activeClient.fetchTravelPoints(startIso, endIso), failedYears: [] };
      }

      const responses: TravelResponse[] = [];
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        setLoadingProgress({ current: index + 1, total: segments.length });
        const response = await activeClient.fetchTravelPoints(segment.startIso, segment.endIso);
        responses.push(response);
      }

      return { data: mergeSegmentResponses(startIso, endIso, responses), failedYears: [] };
    };

    const applyLoadedData = (data: TravelResponse) => {
      setPoints(data.points);
      setSummary(data.summary);
      if (data.points.length > 0) {
        setActiveTime(new Date(data.points[0].timestamp).getTime());
        setPlayheadIndex(0);
      }
    };

    setLoading(true);
    setMessage(null);
    setError(null);
    setShowProxyRetry(false);
    setIsPlaying(false);
    setLoadingProgress(null);

    let startIso: string | undefined;
    let endIso: string | undefined;
    if (targetQueryMode === "time_range") {
      const startDate = new Date(startInput);
      const endDate = new Date(endInput);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        setLoading(false);
        setError("请输入有效的开始和结束时间");
        return;
      }

      if (startDate.getTime() >= endDate.getTime()) {
        setLoading(false);
        setError("结束时间必须晚于开始时间");
        return;
      }

      startIso = startDate.toISOString();
      endIso = endDate.toISOString();
    }

    try {
      const result = await fetchTravelPointsWithStrategy(targetMode, targetQueryMode, startIso, endIso);
      applyLoadedData(result.data);
      if (targetMode !== mode) {
        setMode(targetMode);
      }
      if (targetQueryMode !== queryMode) {
        setQueryMode(targetQueryMode);
      }
      if (targetQueryMode === "history_today" && result.failedYears.length > 0) {
        setMessage(formatHistoryTodayFailureMessage(result.failedYears));
      }
    } catch (primaryErr) {
      const primaryMessage = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      if (targetMode !== "direct" || !autoFallback) {
        setError(primaryMessage);
        if (targetMode === "direct") {
          setShowProxyRetry(true);
        }
        return;
      }

      try {
        const proxyResult = await fetchTravelPointsWithStrategy("proxy", targetQueryMode, startIso, endIso);
        applyLoadedData(proxyResult.data);
        setMode("proxy");
        if (targetQueryMode !== queryMode) {
          setQueryMode(targetQueryMode);
        }
        const fallbackMessages: string[] = ["直连失败，已自动切换到代理模式：" + primaryMessage];
        if (targetQueryMode === "history_today" && proxyResult.failedYears.length > 0) {
          fallbackMessages.push(formatHistoryTodayFailureMessage(proxyResult.failedYears));
        }
        setMessage(fallbackMessages.join("；"));
      } catch (proxyErr) {
        const proxyMessage = proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
        setShowProxyRetry(true);
        setError("直连失败，代理回退也失败。直连：" + primaryMessage + "；代理：" + proxyMessage);
      }
    } finally {
      setLoading(false);
      setLoadingProgress(null);
    }
  }

  function handleQueryModeChange(nextQueryMode: QueryMode): void {
    setQueryMode(nextQueryMode);
    if (nextQueryMode === "history_today") {
      void loadPoints(mode, true, nextQueryMode);
    }
  }
  function applyQuickPreset(preset: "7d" | "30d" | "month" | "year"): void {
    const end = new Date();
    const start = new Date(end);

    if (preset === "7d") {
      start.setDate(end.getDate() - 7);
    } else if (preset === "30d") {
      start.setDate(end.getDate() - 30);
    } else if (preset === "month") {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    } else {
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
    }

    setStartInput(toDateTimeLocalValue(start));
    setEndInput(toDateTimeLocalValue(end));
  }

  function resetView(): void {
    setIsPlaying(false);
    setError(null);
    setMessage(null);
    setSummary(null);
    setPoints([]);
    setActiveTime(0);
    setPlayheadIndex(0);
    setSpeed(1);
    setPlaybackMode("time");
    setFollowCurrent(true);
    setFollowIntensity(72);
    setUltraAggressiveFollow(false);
    setShowProxyRetry(false);
    setLoadingProgress(null);
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

  const useCompactHeader = compactLayout || isMobileShellRuntime();

  useEffect(() => {
    if (isPlaying && useCompactHeader) {
      setConfigExpanded(false);
    }
  }, [isPlaying, useCompactHeader]);

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
  const showConfigPanel = !useCompactHeader || configExpanded;
  const loadButtonLabel = loadingProgress ? ("加载中 " + loadingProgress.current + "/" + loadingProgress.total) : "加载轨迹";

  return (
    <div className={`app ${useCompactHeader ? "compact-layout" : ""} ${showConfigPanel ? "config-open" : "config-closed"}`}>
      <header className="topbar">
        <div className="topbar-head">
          <div className="title">
            <h1>Immich Travel Map</h1>
            <div className={`connection-status ${connectionClass}`} title={connectionTitle}>
              连接状态：{connectionText}
            </div>
            {showConfigPanel ? <p>支持代理模式与直连模式，按时间重现你的旅行轨迹。</p> : null}
          </div>

          {useCompactHeader ? (
            <button
              className="secondary settings-toggle"
              onClick={() => setConfigExpanded((prev) => !prev)}
              title="展开或收起设置"
            >
              {showConfigPanel ? "收起" : "设置"}
            </button>
          ) : (
            <div className="quick-controls">
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

              <button
                className="primary"
                onClick={() => void loadPoints()}
                disabled={loading || client.configError !== null}
                title="按当前配置和起止时间重新加载轨迹"
              >
                {loading ? loadButtonLabel : "加载轨迹"}
              </button>

              <button
                className="secondary reset"
                onClick={resetView}
                disabled={loading}
                title="清空当前轨迹和播放状态，不修改连接设置"
              >
                重置界面
              </button>
            </div>
          )}
        </div>

        {showConfigPanel ? (
          <div className="filters">
            {useCompactHeader ? (
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
            ) : null}

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

            <label title="查询模式：时间范围或历史上今天">
              查询模式
              <select
                value={queryMode}
                onChange={(event) => handleQueryModeChange(event.target.value as QueryMode)}
                disabled={loading}
                title="查询模式：时间范围或历史上今天"
              >
                <option value="time_range">时间范围</option>
                <option value="history_today">历史上今天</option>
              </select>
            </label>

            <label title="设置轨迹查询的开始时间">
              起始时间
              <input
                type="datetime-local"
                value={startInput}
                onChange={(event) => setStartInput(event.target.value)}
                disabled={loading || queryMode === "history_today"}
              />
            </label>
            <label title="设置轨迹查询的结束时间">
              结束时间
              <input
                type="datetime-local"
                value={endInput}
                onChange={(event) => setEndInput(event.target.value)}
                disabled={loading || queryMode === "history_today"}
              />
            </label>

            <div className="quick-date-presets" title="快速选择时间范围">
              <span>快捷时间</span>
              <button className="secondary" type="button" onClick={() => applyQuickPreset("7d")} disabled={loading || queryMode === "history_today"}>
                近7天
              </button>
              <button className="secondary" type="button" onClick={() => applyQuickPreset("30d")} disabled={loading || queryMode === "history_today"}>
                近30天
              </button>
              <button className="secondary" type="button" onClick={() => applyQuickPreset("month")} disabled={loading || queryMode === "history_today"}>
                本月
              </button>
              <button className="secondary" type="button" onClick={() => applyQuickPreset("year")} disabled={loading || queryMode === "history_today"}>
                今年
              </button>
            </div>

            {queryMode === "history_today" ? (
              <span className="history-today-hint">历史上今天模式：按本地时区同月同日回溯近15年，2月29日在非闰年会自动跳过。</span>
            ) : null}
            {useCompactHeader ? (
              <>
                <button
                  className="primary"
                  onClick={() => void loadPoints()}
                  disabled={loading || client.configError !== null}
                  title="按当前配置和起止时间重新加载轨迹"
                >
                  {loading ? loadButtonLabel : "加载轨迹"}
                </button>

                <button
                  className="secondary reset"
                  onClick={resetView}
                  disabled={loading}
                  title="清空当前轨迹和播放状态，不修改连接设置"
                >
                  重置界面
                </button>
              </>
            ) : null}
          </div>
        ) : null}
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
          {loadingProgress ? <span>{(queryMode === "history_today" ? "年份加载：" : "分段加载：") + loadingProgress.current + "/" + loadingProgress.total}</span> : null}
          {message ? <span>{message}</span> : null}
          {error ? <span className="error">{error}</span> : null}
          {client.configError ? <span className="error">{client.configError}</span> : null}
          {showProxyRetry ? (
            <button className="secondary retry" onClick={() => void loadPoints("proxy", false)} disabled={loading} type="button">
              使用代理重试
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
