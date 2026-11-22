# NeuralFrame 开发与构建

验证平台为 Windows x64，Node.js 26.13.0、Electron 33.4.11、electron-builder 26.15.3。依赖以 package-lock.json 为准。

[运行桌面应用](#运行桌面应用) · [原生资源](#原生小组件与按需组件) · [测试](#桌面与组件测试) · [制作发行包](#制作发行包) · [工作区清理](#工作区清理)

## 运行桌面应用

~~~powershell
git clone https://github.com/lxl2000927/NeuralFrame.git
cd NeuralFrame
npm ci
npm start
~~~

如果 npm 禁用了依赖安装脚本、导致 Electron 可执行文件缺失，可显式执行 node node_modules/electron/install.js 下载锁定的 Electron 运行环境，再启动。

在仓库根目录运行命令，以 [package.json](../package.json) 的脚本为准。`npm start` 先通过 `prestart` 准备许可、检查类型并构建 [React 主界面](../ui/src/)，再启动 Electron 加载 `src/ui-dist/index.html`。`npm run dev:ui` 只启动 Vite，不启动 Electron 或提供本机接口。[src/renderer/](../src/renderer/) 是旧界面及仍在使用的叠加层、筛选等资源，不是当前主窗口入口，也不能整目录删除。

## 原生小组件与按需组件

发布页的 `NeuralFrame-0.1.3-Source.zip` 另带 `dist/runtime-bootstrap/` 和 `dist/overlay/`，用于中文适配、预加载器、F8 桥接及许可证。GitHub 自动生成的 Source code 归档只含仓库文件。使用 Git 克隆时，也可以从本版已安装程序的 `resources/payload/` 和 `resources/overlay/` 复制到上述两个目录。

从源码重建 Home 单遍面板和 F7 监控时，先运行 `npm run overlay:prepare`，再运行 `powershell -ExecutionPolicy Bypass -File scripts/build-zh-cn-addon.ps1 -Stage` 编译 32 / 64 位插件并放入 bootstrap。打包前运行 `node scripts/verify-runtime-bootstrap.js` 校验文件。发行程序内置启动资源，大型运行库和插件按清单在使用时下载并校验 SHA-256。[组件来源与分发方式](COMPONENTS.md)

原生构建步骤保留在 [Enhanced 构建记录](BUILDING-ENHANCED-ARCHIVE.md)，其中旧版本名称、旧下载地址和离线打包方式仅供历史参考，不能直接用来制作当前轻量发行包。

## 检查与打包

### 32 位兼容桥

32 位兼容桥已同步 Enhanced 2.3.1 并作 NeuralFrame 适配。修改原生源码后，使用 Zig 0.14.1 编译并更新本机启动资源及固定指纹：

~~~powershell
$env:NEURALFRAME_ZIG='D:/tools/zig-x86_64-windows-0.14.1/zig.exe'
node scripts/build-winmm-preload32.js --stage
node scripts/verify-runtime-bootstrap.js
node --test test/preloader-native.test.js
~~~

这只编译 `winmm.dll`，不打包或发布桌面程序。脚本直接编译仓库里的 C/DEF 文件，不再用旧的内嵌模板覆盖源码。默认输出在 `build-output/preloader32/`；`--stage` 将 DLL 放入 `dist/runtime-bootstrap/` 并更新 `runtime-catalog.json`，此前组件缓存及游戏内 DLL 不会被覆盖。更新指纹后重新运行下方测试资源准备脚本，使用其输出的新视图路径。设置 `NEURALFRAME_ZIG` 后，核心测试还会编译临时 32/64 位探针，验证真实 API 回读与子进程亲和性；没有编译器的环境会明确跳过此项。

老游戏的 `NeuralFrame-Legacy.ini` 在用户确认安装后生成并纳入备份：`CpuLimit=8` 默认仅匹配 Prototype，`LegacyMemory=1` 仅匹配已识别的 Delta Force 老引擎，`GoldSrc=1` 对应 `hl.exe`；显式设置保留。Steam 安装脚本只解析游戏目录内的注册表数据，不执行安装命令。兼容数据写入 `HKCU\Software\NeuralFrame\Legacy\<游戏指纹>` 独立命名空间，应用前预览，安装记录负责清理；不会改写原来的游戏厂商注册表键。清理失败保留记录供恢复重试。

### 桌面与组件测试

~~~powershell
npm run check:ui
npm test
npm run test:ui
~~~

`npm run check:ui` 只做 TypeScript 检查；`npm test` 用 Node 串行运行 `test/*.test.js` 和 `test/*.test.mjs`。要跑全安装集成用例，还需完整开发载荷；这与启动桌面界面是不同的前置条件。

也可将 `NEURALFRAME_TEST_PAYLOAD_DIR` 指向已准备完整的开发载荷或按需缓存的 `runtime/views/<指纹>/`，再运行 `npm test`。该变量仅供测试读取源文件，测试写入临时游戏目录，不改变软件的实际安装来源。缓存缺包时仍会报缺少文件，不会跳过校验或自动下载。

可先准备隔离的完整测试资源：

~~~powershell
node --use-env-proxy scripts/prepare-test-payload.js D:/NeuralFrame-test-cache
# 将下方路径替换为上一步输出的 Test payload ready 路径
$env:NEURALFRAME_TEST_PAYLOAD_DIR='D:/NeuralFrame-test-cache/component-library-v1/runtime/views/<指纹>'
npm test
~~~

准备脚本也会把两版 OptiFG 测试宿主放入 `vendor/runtime-tests/components`。同一个 `NEURALFRAME_TEST_PAYLOAD_DIR` 也适用于 `npm run test:payload` 和 `npm run test:optiscaler`。前者用真实组件验证五种 Feeder 位数/API 组合的重复安装和恢复，后者验证原生、Feeder、OptiScaler 之间的切换及失败回滚。

准备脚本优先复用并校验现有组件，缺少的配套包按固定清单下载。dgVoodoo2 与 LumeniteFX 从原作者地址获取并校验 SHA-256，仅作为本机测试缓存；测试会复制已验证的压缩包到临时配置目录，再运行实际解压、安装及恢复流程。脚本要求 `dist/runtime-bootstrap/` 中的原生小组件完整，不会生成发行包或写入游戏目录。Node 26 的 `--use-env-proxy` 用于遵循 `HTTP_PROXY` / `HTTPS_PROXY`；此参数不更改软件的网络设置。

`npm run test:ui` 依次验证旧界面的筛选与菜单、当前 React 界面的下载与预览流程。单独运行 `npm run test:workflow` 会先构建当前前端，再用模拟后端检查取消、确认和诊断轮询。

大游戏库封面回归：先运行 `npm run build:ui`，再运行 `node scripts/qa-artwork.cjs`。它使用独立的 160 游戏夹具和可控图片请求，检查可见项优先、4 路并发、嵌套滚动预读、搜索、缓存/自定义封面、坏图修复、恢复联网与手动重试，以及隐藏页面不下载；不读取真实图库或连接图片服务器。其等待时间用于验证调度，不是实际网络性能测量。

`node scripts/qa-neuralframe.cjs` 将本机游戏列表、已有封面和组件发布索引复制到隔离配置，通过真实游戏目录检查桌面界面。脚本在支持调整倍率的游戏上检查草稿与撤销，列表中存在鸣潮、星穹铁道时还会检查其诊断与组件标签。截图默认写入系统临时目录，也可通过 `NEURALFRAME_QA_OUT` 指定输出目录。

可设置 NEURALFRAME_USER_DATA 为独立测试目录。开发模式默认使用与发行版相同的按需组件路径，仅 `DLSS5_LIGHTWEIGHT=0` 显式切回完整本地载荷。普通应用继续沿用原配置目录，保留已有缓存和锁定记录。

### 制作发行包

| 目标 | 在仓库根目录运行 |
| --- | --- |
| Windows x64 安装版和便携版 | `npm run build -- --publish never` |
| Windows x64 便携版 | `npm run build:portable -- --publish never` |
| Linux AppImage 和 deb | `npm run build:linux -- --publish never` |

产物写入 `dist/`。三个入口都先运行 `npm run build:prepare`，准备许可、构建桌面界面、核对原生启动文件的 SHA-256，并检查 F8 插件使用的应用配置目录。

完整测试资源使用 Encore 2.5.0、ANR FG B20、鸣潮 MFG 1.7.1，以及位于 `enhanced/mfg-optiscaler-170/` 的 OptiScaler MFG 1.7.0。更新清单后，重新运行测试载荷准备脚本，可传入之前的缓存目录复用已校验的文件。Encore 的依赖、选版及配置保护见 [ENCORE.md](ENCORE.md)。

`node scripts/prepare-engine-licenses.js` 从仓库的 `assets/licenses/` 按固定 SHA 恢复 MFG 的 MIT 许可证到 bootstrap；`prestart` 与打包前检查会调用它。测试载荷准备前也应运行它。官方 1.7.1 压缩包未携带许可证，因此许可作为独立内置小组件准备，不假设它位于上游压缩包中。运行时清单构建脚本保留官方引擎来源，不重新打包这些引擎。

每个 Electron 工作流用例使用独立的临时配置目录，结束后清理。设置 `NEURALFRAME_QA_OUT` 可另存截图。`qa-engine-versions.cjs` 覆盖推荐与历史引擎、切换游戏保留草稿、补帧范围和预览请求。

需要复核原生插件时，可运行 `node scripts/test-overlay-profile.js` 检查 F8 配置目录，运行 `powershell -ExecutionPolicy Bypass -File scripts/test-zh-native.ps1` 编译并执行 32/64 位接口测试。`scripts/verify-modes-a-to-f.js` 是使用本机测试资源重建模式验证记录的专用工具，输出位置为 `test-results/`。

游戏、显卡与组件的适用条件见[游戏路线与 F7 监控](GAME-ROUTES.md)。

## 工作区清理

| 类别 | 处理方式 |
| --- | --- |
| 可重建 | 停止开发进程后，`node_modules/` 可用 `npm ci` 恢复；`src/ui-dist/` 可用 `npm run build:ui` 重建。`ui/.vite/` 是开发缓存。 |
| 原生编译缓存 | 编译结束后可清理 `tools/zig-cache/`、`tools/zig-local-cache/` 和 `tools/zh-tests/`。下次编译会重新生成。Zig 工具链及 ReShade SDK 位于同级目录。 |
| 按需保留 | `qa-output/`、`build-output/` 是检查或编译输出，先确认日志、截图和原生构建结果不再需要。`test-results/` 含已纳入版本控制的实机证据，不要整目录清理。 |
| 构建与测试输入 | `dist/` 混有发行产物和 `runtime-bootstrap/`、`overlay/` 两个原生输入；`payload/`、`vendor/` 可含完整回归所需文件。确认有可恢复副本后再按项处理，不按忽略规则整批删除。 |
| 不作为缓存清理 | `build/installer.nsh` 是安装脚本；用户配置、游戏目录的 `_DLSS5_Backup` 和回滚记录不是构建产物。撤销部署请使用游戏页的恢复功能。 |
