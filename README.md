# ImmichTravelMap

基于 Immich API 的旅行轨迹回放应用。选择起止时间后，地图按时间轴动态生长轨迹，支持点击轨迹点查看照片缩略图。

## 技术栈

- 前端: React + Vite + TypeScript + MapLibre GL
- 后端: Node.js + Express + TypeScript
- 底图: OpenStreetMap raster tiles

## 功能说明（当前版本）

- 按起止时间从 Immich 拉取带地理信息的资产
- 按时间升序生成轨迹并去重简化
- 时间轴拖动时轨迹动态增长
- 播放/暂停、播放速度切换
- 跟随当前点相机
- 点击轨迹点弹出缩略图 + 时间 + 地点

## 目录结构

```txt
.
├─ server/   # Immich 代理与轨迹数据处理
└─ web/      # 地图与时间轴交互
```

## 启动方式

1. 安装依赖（根目录执行）:

```bash
npm install
```

2. 配置后端环境变量:

- 复制 `server/.env.example` 为 `server/.env`
- 填入:
  - `IMMICH_BASE_URL=http://localhost:2283`
  - `IMMICH_API_KEY=<你的 Immich API key>`

3. 可选配置前端环境变量:

- 复制 `web/.env.example` 为 `web/.env`
- 默认 `VITE_API_BASE=http://localhost:8787`

4. 分别启动后端与前端（两个终端）:

```bash
npm run dev:server
```

```bash
npm run dev:web
```

5. 打开 `http://localhost:5173`

## API（BFF）

- `GET /api/health`
- `GET /api/travel/points?start=<ISO>&end=<ISO>`
- `GET /api/travel/thumbnail/:assetId?size=preview|thumbnail`

## 说明

- Immich API key 仅在后端使用，不暴露给浏览器。
- OSM 官方瓦片服务适合开发与轻量使用；生产高流量建议改为商业瓦片或自建瓦片服务。
