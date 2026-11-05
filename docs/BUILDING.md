# 0.1.0 源码开发与构建

本说明面向 Windows x64。普通用户直接使用 [0.1.0 发行包](https://github.com/lxl2000927/DLSS5-Swapper-Enhanced/releases/tag/v0.1.0)；运行发行包不需要安装开发环境。

## 代码与依赖

| 内容 | 位置 / 工具 |
| --- | --- |
| 桌面程序主进程与 IPC | main.js、preload.js |
| 界面与中文文本 | src/renderer/、src/shared/overlay-zh.js |
| 组件库、更新、部署与运行时检测 | src/core/ |
| 游戏库与启动器识别 | src/library.js、src/library-standalone.js |
| 游戏内桥接、汉化适配 | overlay/ 中的 C/C++ 源码 |
| 32 位旧游戏预加载器 | src/native/dgv_preload32/ |
| 自动化检查 | test/、scripts/test-*.js、scripts/test-*.ps1 |
| 编译与打包 | Node.js、npm、Electron、electron-builder；原生部分使用便携 Zig 和 ReShade SDK |

0.1.0 发布验证使用 Electron **33.4.11**、其内置 Node **20.18.3** 和 electron-builder **26.15.3**。安装依赖以仓库中的 package-lock.json 为准。

~~~powershell
git clone https://github.com/lxl2000927/DLSS5-Swapper-Enhanced.git
cd DLSS5-Swapper-Enhanced
npm ci
npm start
~~~

npm start 启动源码界面。完整安装功能还需要下文的第三方 payload；仅安装 npm 依赖不会获得所有运行库和插件。

如需查看发布时的原始代码，可检出 v0.1.0 标签；main 分支中的文档可能包含后续补充说明。

## 准备第三方 payload

payload/、vendor/、addons/、tools/、dist/ 和 node_modules/ 未纳入 Git。源代码包因此不能直接替代完整发行包。

对于已验证的 0.1.0 组合，可以从解包后的发行程序准备资源，并保持原有目录结构：

| 发行程序中的目录 | 仓库内目录 |
| --- | --- |
| resources/payload/ | payload/ |
| resources/overlay/ | dist/overlay/ |
| resources/addons/（若存在） | addons/ |

保留其中的第三方许可证。仅解包资源进行构建准备，不需要向游戏安装这些文件。缺少 addons/ 时可创建空目录供打包配置使用。

仓库还提供收集脚本：

~~~powershell
npm run payload -- 'C:\path\to\prepared-runtime-files'
~~~

该目录需要包含脚本能识别的 nvngx_dlssnr.dll / streamline/ 等源文件。脚本会检查本地资源、查找 ReShade Add-on 安装程序，并下载部分固定版本依赖；Enhanced 扩展资源还依赖 vendor/enhanced-cache/ 中已经准备好的文件。

**0.1.0 的收集脚本保留了部分上游旧版本映射。** 它不是统一组件库的在线更新入口，也不是一条命令重新取得全部 0.1.0 适配组件的保证。已有完整、验证过的 payload 时，不要仅为打包而重新运行收集脚本；应先核对其输出版本和文件哈希。

组件来源和在线更新限制见 [README](../README.md)。组件身份定义在 [component-definitions.js](../src/core/component-definitions.js)，分发说明在 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 编译游戏内面板与汉化层

只改管理器的 JavaScript / HTML / CSS 时，通常不需要重编译原生组件。改动原生面板、文字适配或 ABI 桥接时，需要对应的编译步骤。

~~~powershell
npm run overlay:prepare
npm run overlay:build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-zh-cn-addon.ps1
~~~

- overlay:prepare 下载固定版本的 Zig、ReShade SDK 与 ImGui 头文件到 tools/，并校验 Zig 归档。
- overlay:build 生成 dist/overlay/dlss5-lab-overlay.addon64 及配套许可证。
- build-zh-cn-addon.ps1 生成 payload/enhanced/zh-cn/dlss5-zh-cn.addon32 与 .addon64。
- 这套脚本使用便携工具链；无需仅为这些构建额外安装完整 Visual Studio IDE。

32 位预加载器可按需运行：

~~~powershell
node scripts/build-winmm-preload32.js
~~~

该脚本读取本机 SysWOW64/winmm.dll 的导出表，会重新生成 src/native/dgv_preload32/ 中的源码与导出定义，并输出 payload/enhanced/zh-cn/winmm.dll。执行后检查 Git 差异与目标文件，避免把环境造成的变化当成无关文件清理掉。

这些命令只构建本仓库拥有的桥接和适配代码，不会重新编译 NVIDIA 运行库或第三方 MFG / RenoDX 插件。替换第三方插件版本后，还需核对本仓库的适配限制。

## 检查改动

普通测试入口：

~~~powershell
npm test
npm run test:ui
~~~

为贴近 0.1.0 的发布验证环境，可用项目安装的 Electron 运行 Node 测试。下面显式展开测试文件名，并在结束后还原环境变量：

~~~powershell
$previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $testFiles = @(Get-ChildItem -LiteralPath '.\test' -Filter '*.test.js' | ForEach-Object { $_.FullName })
    & '.\node_modules\electron\dist\electron.exe' --test --test-concurrency=1 @testFiles
    if ($LASTEXITCODE -ne 0) { throw 'Regression tests failed' }
} finally {
    $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode
}
~~~

涉及 Feeder / OptiScaler payload 的检查入口另有 npm run test:payload、npm run test:optiscaler；这些检查需要对应资源已经准备好。

0.1.0 发布时完整回归为 **374 项：372 通过、2 跳过、0 失败**。原生适配变更还需验证实际 ABI、面板交互及游戏运行状态；仅通过 JavaScript 测试不能证明游戏兼容性。

## 打包便携单文件与安装版

先确认 payload/、dist/overlay/、addons/ 及 assets/app.ico 已准备好，然后执行：

~~~powershell
npx electron-builder --win portable nsis --x64 --publish never
~~~

输出包括：

- DLSS5-Swapper-Enhanced-0.1.0-Portable-x64.exe
- DLSS5-Swapper-Enhanced-0.1.0-Setup-x64.exe

默认输出目录以 electron-builder 的构建日志为准；可用 --config.directories.output=build-output 单独指定目录。

这里直接调用 electron-builder，是为了使用已经准备好的 payload。npm run build 会先触发 prebuild → npm run payload，可能重新收集并覆盖组件；npm run build:portable 则只打包便携版。

--publish never 用于只在本地构建。仓库中的 GitHub 发布配置不代表构建完成后可以省略人工核验。至少应检查版本和图标、资源是否齐全、程序能否启动、两个包内的核心文件、SHA-256 以及第三方许可证。

软件版本配置位于 package.json / package-lock.json，独立更新仓库配置位于 package.json 的 distribution.releaseRepository。name: dlss5-swapper-enhanced 同时影响持久用户数据目录和桥接约定，修改时需同步处理迁移与原生编译配置。

本说明描述源码开发入口和已验证资源的准备方式；未提供完整第三方 payload 的全自动重建，也不承诺不同机器构建得到与发行附件字节级相同的 EXE。
