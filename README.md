# ImmichTravelMap

基于 Immich API 的旅行轨迹回放应用。  
支持按时间范围拉取照片地理信息，在地图上播放轨迹，并可点击轨迹点查看缩略图和跳转 Immich 照片页。

## 项目结构

```txt
.
├─ packages/
│  ├─ shared-types/  # 前后端共享类型
│  └─ track-core/    # 轨迹核心算法（时间解析/去重/抽稀）
├─ apps/
│  ├─ server/   # BFF + 生产环境静态托管
│  └─ web/      # React + Vite 前端
```

## 环境要求

- Node.js 18+（建议 20+）
- 可访问的 Immich 服务
- Immich API Key

## 安装依赖

```bash
npm install
```

## 环境变量

### 后端（必填）

复制 `apps/server/.env.example` 到 `apps/server/.env`：

```env
IMMICH_BASE_URL=http://localhost:2283
IMMICH_API_KEY=replace_with_your_api_key
PORT=8787
WEB_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,tauri://localhost,http://tauri.localhost
```

可选（Immich 页面跳转模板）：

```env
IMMICH_WEB_ASSET_URL_TEMPLATE=https://your-immich-domain/photos/{assetId}
```

说明：
- 不配置时默认使用 `${IMMICH_BASE_URL}/photos/{assetId}`。
- `{assetId}` 会自动替换为实际资产 ID。

### 前端（可选）

复制 `apps/web/.env.example` 到 `apps/web/.env`：

```env
VITE_API_BASE=http://localhost:8787
VITE_DIRECT_IMMICH_BASE_URL=
VITE_DIRECT_IMMICH_API_KEY=
VITE_IMMICH_WEB_ASSET_URL_TEMPLATE=
```

说明：
- `VITE_API_BASE`：代理模式 API 地址，留空则同源 `/api`
- `VITE_DIRECT_IMMICH_BASE_URL`：直连模式默认 Immich 地址
- `VITE_DIRECT_IMMICH_API_KEY`：直连模式默认 API Key（仅建议本地受控环境）
- `VITE_IMMICH_WEB_ASSET_URL_TEMPLATE`：直连模式照片跳转模板，支持 `{assetId}`

## 启动方式

## 1) 开发模式（前后端分开）

终端 A：

```bash
npm run dev:server
```

终端 B：

```bash
npm run dev:web
```

打开：`http://localhost:5173`

## 2) 单服务模式（推荐给用户）

只启动一个服务：

```bash
npm run build
npm run start
```

打开：`http://localhost:8787`

说明：
- `apps/server` 会自动托管 `apps/web/dist`。
- 若 `apps/web/dist` 不存在，`apps/server` 会退回 API-only 模式。

## 快速发布（单服务）

用于“给别人直接运行”的最短流程：

```bash
npm run release:build
npm run start
```

说明：
- `release:build` 会先构建前后端，再执行产物检查。
- 检查内容包括：`apps/server/dist/index.js`、`apps/web/dist/index.html`、`apps/web/dist/assets` 以及基础静态资源完整性。

## 3) Desktop 模式（Tauri）

首次使用前需要：
- 安装 Rust 工具链（`rustup` + MSVC build tools）
- 安装 Tauri CLI 依赖（已在 `apps/desktop` 的 `devDependencies` 中声明）

开发运行：

```bash
npm install
npm run dev:desktop
```

打包桌面应用：

```bash
npm run build:desktop
```

说明：
- Desktop 会在启动时拉起本地 sidecar：`node apps/server/dist/index.js`。
- 前端在 Tauri 环境下默认访问 `http://127.0.0.1:8787`，不需要额外设置 `VITE_API_BASE`。

## 页面功能

- 数据模式：
  - 代理模式（推荐）：前端调用本项目后端 `/api/travel/*`
  - 直连模式：前端直接调用 Immich API（需浏览器可访问且 CORS 允许）
- 加载轨迹：选择起止时间，点击“加载轨迹”
- 播放控制：播放/暂停、速度（0.1x~4x）
- 播放模式：
  - 按时间（真实节奏）
  - 按点位（均匀节奏）
- 镜头跟随：
  - 跟随当前点
  - 跟随强度滑条（0~100）
  - 超激进跟随开关
- 轨迹点弹窗：缩略图、时间、地点，支持跳转 Immich 原图页

## API

- `GET /api/health`
- `GET /api/travel/points?start=<ISO>&end=<ISO>`
- `GET /api/travel/thumbnail/:assetId?size=preview|thumbnail`

## 脚本

- `npm run dev:server`：后端开发
- `npm run dev:web`：前端开发
- `npm run dev:desktop`：桌面端开发运行（Tauri）
- `npm run build:packages`：构建共享包（shared-types + track-core）
- `npm run build:web`：构建前端
- `npm run build:server`：构建后端
- `npm run build:desktop`：构建桌面应用（Tauri）
- `npm run build`：一键构建（packages + web + server）
- `npm run start`：单服务启动（生产模式）
- `npm run release:check`：检查发布产物完整性
- `npm run release:build`：构建并检查发布产物
- `npm run release:start`：构建检查后启动单服务
