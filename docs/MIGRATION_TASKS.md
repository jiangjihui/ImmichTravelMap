# ImmichTravelMap 迁移任务清单（按文件级）

本清单基于 [APP_PACKAGING_PLAN.md](./APP_PACKAGING_PLAN.md)，目标是把当前项目平滑演进到“可 App 化、多端复用、用户单服务启动”形态。

## Phase 0：基线整理（0.5 天）

目标：先稳定当前工程状态，避免后续迁移时“边动边坏”。

任务：
- [ ] 统一 README 编码为 UTF-8（避免中文乱码）
  - 文件：`README.md`
- [ ] 增加基础检查脚本
  - 文件：`package.json`
  - 新增：`typecheck:web`、`typecheck:server`、`lint`（后续可补 ESLint）
- [ ] 固化本地构建通过基线
  - 命令：`npm run build:web`、`npm run build:server`

验收标准：
- 主分支可稳定构建
- 文档中文可正常显示

---

## Phase 1：用户单服务启动（1-2 天）

目标：用户只启动一个服务即可使用（后端托管前端静态资源）。

任务：
- [ ] 后端支持静态托管 `web/dist`
  - 文件：`server/src/index.ts`
  - 改动：
    - 生产模式挂载 `express.static`
    - SPA fallback（非 `/api` 路由回退 `index.html`）
- [ ] 增加一键构建脚本
  - 文件：`package.json`
  - 新增：
    - `build`（先 web 后 server）
    - `start`（启动 server 生产包）
- [ ] 校准前端 API 基址策略
  - 文件：`web/src/api.ts`
  - 原则：默认走同源 `/api`，仅在 `VITE_API_BASE` 配置时覆盖
- [ ] 文档更新为“开发模式 / 单服务模式”双说明
  - 文件：`README.md`

验收标准：
- 执行 `npm run build && npm run start` 后，访问一个地址即可使用
- 页面接口请求同源，不需要另起前端 dev server

---

## Phase 2：抽共享类型与轨迹核心（2-4 天）

目标：消除前后端逻辑重复，为 Desktop/Mobile 复用做准备。

任务：
- [ ] 新建共享类型包
  - 新文件：
    - `packages/shared-types/package.json`
    - `packages/shared-types/src/index.ts`
  - 内容：`TravelPoint`、`TravelResponse`、Immich DTO
- [ ] 前后端改用共享类型
  - 文件：
    - `server/src/types.ts`（删除或仅保留服务端专属类型）
    - `web/src/types.ts`（迁移为 re-export 或删除）
    - 相关 import 全量替换
- [ ] 新建轨迹核心包
  - 新文件：
    - `packages/track-core/package.json`
    - `packages/track-core/src/index.ts`
  - 迁移逻辑：
    - `parseImmichDate`
    - `toTimestamp`
    - `haversineMeters`
    - `simplifyPoints`
- [ ] 后端改用 `track-core`
  - 文件：`server/src/travelService.ts`
- [ ] 增加最小单元测试（优先 `track-core`）
  - 新文件：`packages/track-core/src/*.test.ts`

验收标准：
- 轨迹处理逻辑只有一份实现
- 修改阈值不再需要前后端同步改两次

---

## Phase 3：直连模式与代理模式双栈规范化（2-3 天）

目标：保留后端代理模式，同时可切换前端直连（适用于同源/已放行 CORS 环境）。

任务：
- [ ] 定义统一运行模式配置
  - 文件：`web/src/config/*`（新增）
  - 配置：`mode = proxy | direct`
- [ ] 抽象数据访问层
  - 文件：`web/src/api.ts`（重构）
  - 结构：
    - `proxyClient`（调 `/api/travel/*`）
    - `directClient`（直调 Immich API）
- [ ] 直连模式复用 `track-core` 去重/抽稀
  - 文件：`web/src/*`
- [ ] 增加模式切换 UI 与配置持久化
  - 文件：`web/src/App.tsx`
  - 存储：`localStorage`（后续桌面/移动端替换为安全存储）

验收标准：
- 同一套 UI 可切换 proxy/direct
- 两种模式轨迹结果一致性可接受

---

## Phase 4：目录迁移到 apps/packages（2-4 天）

目标：达到 App 化友好的 monorepo 结构。

任务：
- [ ] 迁移目录
  - `server/ -> apps/server/`
  - `web/ -> apps/web/`
- [ ] 根 `package.json` 更新 workspace
  - 文件：`package.json`
- [ ] 统一 TS 基础配置
  - 新文件：`tsconfig.base.json`
  - 子项目继承
- [ ] 修复脚本与路径引用
  - 各 package `scripts`、导入路径、构建输出路径

验收标准：
- 迁移后脚本与 CI 均可用
- 无相对路径“魔法常量”残留

---

## Phase 5：Desktop 首版（Tauri）(3-5 天)

目标：产出可安装桌面包（Windows 优先）。

任务：
- [ ] 新建 `apps/desktop`（Tauri 2）
- [ ] 集成 `apps/web` 构建产物
- [ ] 初期采用 sidecar 启动 `apps/server`
- [ ] 配置用户设置读写（baseUrl、apiKey、mode）
- [ ] 打包 Windows 安装包（MSI）

验收标准：
- 双击安装后可本地运行
- 无需手动启动多个进程

---

## Phase 6：Mobile 可行性分支（Capacitor）(5-10 天)

目标：验证移动端可用性，优先 Android。

任务：
- [ ] 新建 `apps/mobile`
- [ ] 接入 `apps/web` 打包产物
- [ ] 评估直连 Immich 的网络与证书场景
- [ ] 配置安全存储 API Key（Keystore/Keychain）

验收标准：
- 真机可跑通基础加载与播放
- 配置可持久化

---

## CI / 发布任务（并行推进）

任务：
- [ ] PR 流水线：build + test
- [ ] tag 发布流水线：desktop 打包与 artifact 上传
- [ ] 版本号策略：语义化版本（SemVer）

建议文件：
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

---

## 建议执行顺序（最稳）

1. Phase 1（单服务启动）
2. Phase 2（共享类型 + 轨迹核心）
3. Phase 3（双模式规范化）
4. Phase 4（目录迁移）
5. Phase 5（Desktop）
6. Phase 6（Mobile）

---

## 风险提示

- CORS/同源问题在“直连模式”下依然是核心风险。
- API Key 在 Web 直连模式不具备强安全性，只适合个人或受控环境。
- 目录迁移建议独立 PR，避免与业务改动混在一起。
