# Mobile (Capacitor)

当前目录是移动端可行性分支（Phase 6）骨架，目标是复用 `apps/web` 页面并同步到 Android/iOS 容器。

## 前置要求

- Node.js 18+
- Android Studio（Android）
- Xcode（iOS，仅 macOS）
- JDK 17（建议）
- Android SDK（建议设置 `ANDROID_HOME` / `ANDROID_SDK_ROOT`）

示例（PowerShell）：

```powershell
$env:JAVA_HOME="D:\Program\jdk-17.0.12+7"
$env:ANDROID_HOME="H:\ProgramData\Android\SDK"
$env:ANDROID_SDK_ROOT="H:\ProgramData\Android\SDK"
$env:Path="$env:JAVA_HOME\bin;$env:Path"
```

## 初始化

在仓库根目录执行：

```bash
npm install
npm run mobile:add:android
```

iOS（仅 macOS）：

```bash
npm run mobile:add:ios
```

## 同步 Web 代码到移动端

```bash
npm run build:mobile
```

该命令会先构建 `apps/web`，再执行 `cap sync`。

## 打开原生工程

Android：

```bash
npm run mobile:open:android
```

iOS（仅 macOS）：

```bash
npm run mobile:open:ios
```

## 模式建议

- 移动端不内置 Node sidecar，推荐使用“直连模式”访问 Immich。
- 如果使用“代理模式”，请把 `VITE_API_BASE` 指向可从手机访问的远程 BFF 地址。
- 直连模式仍依赖 Immich 的网络可达性与 CORS 策略。
