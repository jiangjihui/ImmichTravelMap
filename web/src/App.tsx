import { useEffect, useMemo, useState } from "react";
import { fetchTravelPoints, getApiBase } from "./api";
import { MapView, type FollowPreset } from "./MapView";
import { TravelPoint, TravelResponse } from "./types";

const PLAYBACK_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];

function toDateTimeLocalValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function App() {
  const now = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), [now]);

  const [startInput, setStartInput] = useState<string>(toDateTimeLocalValue(defaultStart));
  const [endInput, setEndInput] = useState<string>(toDateTimeLocalValue(now));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<TravelResponse["summary"] | null>(null);
  const [points, setPoints] = useState<TravelPoint[]>([]);
  const [activeTime, setActiveTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [followCurrent, setFollowCurrent] = useState(true);
  const [followPreset, setFollowPreset] = useState<FollowPreset>("cinematic");

  const minTime = points.length > 0 ? new Date(points[0].timestamp).getTime() : 0;
  const maxTime = points.length > 0 ? new Date(points[points.length - 1].timestamp).getTime() : 0;

  async function loadPoints(): Promise<void> {
    setLoading(true);
    setError(null);
    setIsPlaying(false);
    try {
      const startIso = new Date(startInput).toISOString();
      const endIso = new Date(endInput).toISOString();
      const data = await fetchTravelPoints(startIso, endIso);
      setPoints(data.points);
      setSummary(data.summary);
      if (data.points.length > 0) {
        setActiveTime(new Date(data.points[0].timestamp).getTime());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPoints();
  }, []);

  useEffect(() => {
    if (!isPlaying || points.length < 2) {
      return;
    }

    const span = Math.max(1000, maxTime - minTime);
    const step = (span / 400) * speed;
    const timer = window.setInterval(() => {
      setActiveTime((prev) => clamp(prev + step, minTime, maxTime));
    }, 50);

    return () => window.clearInterval(timer);
  }, [isPlaying, maxTime, minTime, points.length, speed]);

  useEffect(() => {
    if (isPlaying && activeTime >= maxTime) {
      setIsPlaying(false);
    }
  }, [activeTime, isPlaying, maxTime]);

  const progressPercent =
    minTime < maxTime ? Math.round(((activeTime - minTime) / (maxTime - minTime)) * 1000) / 10 : 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">
          <h1>Immich Travel Map</h1>
          <p>拖动时间轴，按时间重现你的旅行轨迹。</p>
        </div>
        <div className="filters">
          <label>
            起始时间
            <input
              type="datetime-local"
              value={startInput}
              onChange={(event) => setStartInput(event.target.value)}
            />
          </label>
          <label>
            结束时间
            <input type="datetime-local" value={endInput} onChange={(event) => setEndInput(event.target.value)} />
          </label>
          <button className="primary" onClick={() => void loadPoints()} disabled={loading}>
            {loading ? "加载中..." : "加载轨迹"}
          </button>
        </div>
      </header>

      <main className="map-shell">
        <MapView
          points={points}
          activeTime={activeTime}
          followCurrent={followCurrent}
          followPreset={followPreset}
          apiBase={getApiBase()}
        />
      </main>

      <section className="timeline-panel">
        <div className="timeline-row">
          <button
            className="secondary"
            onClick={() => setIsPlaying((prev) => !prev)}
            disabled={points.length < 2 || loading}
          >
            {isPlaying ? "暂停" : "播放"}
          </button>

          <label className="inline">
            速度
            <select value={String(speed)} onChange={(event) => setSpeed(Number(event.target.value))}>
              {PLAYBACK_SPEEDS.map((item) => (
                <option value={item} key={item}>
                  {item}x
                </option>
              ))}
            </select>
          </label>

          <label className="inline">
            跟随模式
            <select value={followPreset} onChange={(event) => setFollowPreset(event.target.value as FollowPreset)}>
              <option value="cinematic">电影感</option>
              <option value="extreme">极限紧跟</option>
            </select>
          </label>

          <label className="inline checkbox">
            <input
              type="checkbox"
              checked={followCurrent}
              onChange={(event) => setFollowCurrent(event.target.checked)}
            />
            跟随当前点
          </label>

          <span className="time-label">
            {points.length > 0 ? new Date(activeTime).toLocaleString() : "暂无轨迹数据"}
          </span>
          <span className="progress">{progressPercent}%</span>
        </div>

        <input
          type="range"
          className="slider"
          min={minTime}
          max={Math.max(minTime, maxTime)}
          value={points.length > 0 ? activeTime : 0}
          onChange={(event) => setActiveTime(Number(event.target.value))}
          disabled={points.length === 0}
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
        </div>
      </section>
    </div>
  );
}
