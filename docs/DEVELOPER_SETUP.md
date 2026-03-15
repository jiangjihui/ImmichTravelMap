# 开发者环境与打包说明

本文面向下一位开发者，目标是让你在新机器上能快速完成：
- Web/Server 本地开发
- Desktop（Tauri）打包
- Android（Capacitor）打包

## 1. 通用环境

- Node.js：`18+`（建议 `20+`）
- npm：随 Node 安装
- Git

建议先执行：

```bash
npm install
npm run build
```

## 2. Desktop（Tauri）环境

Windows 下需要：
- Rust 工具链（`rustup`）
- Visual Studio Build Tools（包含 C++ 构建工具）

验证命令：

```bash
rustc -V
cargo -V
```

如果 `cargo` 未找到，请把 `%USERPROFILE%\.cargo\bin` 加到 `PATH`。

打包命令：

```bash
npm run build:desktop
```

产物目录：

`apps/desktop/src-tauri/target/release/bundle/`

## 3. Android（Capacitor）环境

Windows 下需要：
- Android Studio
- Android SDK（示例：`H:\ProgramData\Android\SDK`）
- JDK 17（AGP 8.x 不支持 JDK 8）

推荐环境变量：

```powershell
$env:JAVA_HOME="D:\Program\jdk-17.0.12+7"
$env:ANDROID_HOME="H:\ProgramData\Android\SDK"
$env:ANDROID_SDK_ROOT="H:\ProgramData\Android\SDK"
$env:Path="$env:JAVA_HOME\bin;$env:Path"
```

初始化（仅首次）：

```bash
npm run mobile:add:android
```

同步 Web 到 Android：

```bash
npm run build:mobile
```

生成调试包 APK：

```powershell
cd apps/mobile/android
.\gradlew.bat assembleDebug
```

APK 路径：

`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

## 4. 常见问题排查

`SDK location not found`
- 原因：没找到 Android SDK。
- 处理：设置 `ANDROID_HOME` / `ANDROID_SDK_ROOT` 或在 `apps/mobile/android/local.properties` 写 `sdk.dir`。

`No matching variant ... compatible with Java 8`
- 原因：使用了 JDK 8。
- 处理：切换到 JDK 17 并设置 `JAVA_HOME`。

`Failed to fetch`（移动端直连 Immich）
- 先确认使用最新版 APK（包含 Capacitor 原生 HTTP 分支）。
- 在 App 中使用“直连模式”，填写可访问的 Immich 地址和 API Key。
- 如果是 `http://` 地址，Android 端已开启 `usesCleartextTraffic`，但建议生产改为 `https://`。

## 5. 打包前检查清单

- `npm install` 已完成
- `npm run build` 通过
- Desktop：`cargo -V` 可用
- Android：`JAVA_HOME` 指向 JDK 17，`ANDROID_HOME` 指向 SDK
- 使用最新构建产物测试（不要复用旧 APK）
