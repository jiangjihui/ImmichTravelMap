# ImmichTravelMap App 化目录与打包方案

本文目标：在保留当前 Web 能力的基础上，规划未来桌面/移动 App 形态，做到代码复用、构建可维护、发布可持续。

## 1. 设计目标

- 一套核心业务逻辑，多端复用（Web / Desktop / Mobile）。
- 用户侧尽量“单入口启动”，减少部署复杂度。
- API Key 等敏感配置在不同端有明确安全策略。
- 发布流程标准化（构建、签名、升级）。

## 2. 推荐目录结构（目标态）

```txt
.
├─ apps/
│  ├─ web/                 # 现有前端（Vite + React）
│  ├─ server/              # 现有 BFF（Express）
│  ├─ desktop/             # 桌面壳（推荐 Tauri 2）
│  └─ mobile/              # 移动壳（Capacitor）
├─ packages/
│  ├─ shared-types/        # 前后端共享类型（API DTO、领域类型）
│  ├─ track-core/          # 轨迹处理核心（时间解析/去重/抽稀）
│  ├─ immich-client/       # Immich 调用封装（browser/node 双适配）
│  └─ ui/                  # 可复用 UI 组件（可选）
├─ docs/
│  ├─ APP_PACKAGING_PLAN.md
│  └─ DEPLOYMENT.md        # 后续补充部署方案
├─ package.json
└─ tsconfig.base.json
```

说明：
- 当前 `web/`、`server/` 后续建议迁到 `apps/`，先不强制一步到位。
- 优先抽 `shared-types` 和 `track-core`，这是多端复用关键。

## 3. 打包路线建议

## 3.1 Web（当前主线）

- 保持现有 `apps/web + apps/server` 模式。
- 对用户提供“单服务启动”：`server` 静态托管 `web` 构建产物（同源访问 `/api`）。

## 3.2 Desktop（推荐：Tauri 2）

推荐原因：
- 包体比 Electron 小，启动更快，系统集成能力强。
- 前端可直接复用 React 页面。

建议架构：
- `apps/desktop` 作为壳，加载 `apps/web` 构建产物。
- 初期可使用“sidecar”启动 `apps/server`（复用现有后端逻辑，迁移成本低）。
- 后期逐步将简单接口迁到 Tauri command，减少 sidecar 依赖。

发布产物：
- Windows: `msi`
- macOS: `dmg`
- Linux: `AppImage` / `deb`

## 3.3 Mobile（推荐：Capacitor）

推荐原因：
- 前端页面可最大复用。
- 可快速产出 iOS/Android 安装包。

建议架构：
- `apps/mobile` 内嵌 `apps/web` 打包产物。
- 移动端不运行 Node 后端，采用：
  1. 直连 Immich（用户输入 URL/API Key）或
  2. 远程 BFF（如果后续提供云端代理）

配置存储：
- API Key 采用系统安全存储插件（Keychain/Keystore），不放 localStorage。

## 4. 构建与发布矩阵

## 4.1 Monorepo 脚本（示例）

```json
{
  "scripts": {
    "build:web": "npm --prefix apps/web run build",
    "build:server": "npm --prefix apps/server run build",
    "build:desktop": "npm --prefix apps/desktop run build",
    "build:mobile": "npm --prefix apps/mobile run build",
    "build:all": "npm run build:web && npm run build:server && npm run build:desktop"
  }
}
```

## 4.2 CI 建议

- `pull_request`：
  - lint
  - typecheck
  - unit/integration test
  - web/server build
- `tag release`：
  - 构建桌面安装包
  - 签名（证书）
  - 上传 release artifact
  - 生成更新清单（桌面自动更新）

## 5. 关键技术拆分建议

优先抽离为 `packages/*`：
- `track-core`：
  - `parseImmichDate`
  - `toTimestamp`
  - `haversine`
  - `simplifyPoints`
- `shared-types`：
  - `TravelPoint`
  - `TravelResponse`
  - Immich 相关 DTO

收益：
- 直连模式与代理模式使用同一套轨迹算法，行为一致。
- 后续移动端直连 Immich 也能复用处理逻辑。

## 6. 配置策略（多端统一）

分层配置：
- `system defaults`（构建默认值）
- `user settings`（用户输入，持久化）
- `runtime override`（启动参数）

建议配置项：
- `immich.baseUrl`
- `immich.apiKey`
- `mode`（proxy/direct）
- `apiBase`（仅 proxy 模式）

安全建议：
- Web: 不默认内置 API Key
- Desktop: 使用系统凭据存储
- Mobile: Secure Storage 插件

## 7. 分阶段迁移计划

## Phase 1（低风险，1-2 周）
- 增加“单服务运行”能力（server 托管 web）。
- 抽 `shared-types` + `track-core`。
- 补基础测试与 CI。

## Phase 2（2-4 周）
- 引入 `apps/desktop`（Tauri），打出首个桌面安装包。
- 配置持久化与自动更新链路。

## Phase 3（4-8 周）
- 引入 `apps/mobile`（Capacitor）。
- 完成移动端配置与关键交互适配。

## 8. 取舍建议

- 如果目标是“最快可交付给用户”：
  - 先做 Phase 1 + Desktop。
- 如果目标是“跨平台覆盖”：
  - 按三阶段推进，不建议一次性并行全做。

---

如果确认这版结构，我下一步可以直接给出“当前仓库到目标结构”的具体迁移 PR 列表（按文件级别拆任务）。
