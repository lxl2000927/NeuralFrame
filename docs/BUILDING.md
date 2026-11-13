# NeuralFrame 0.1.2 开发与构建

验证平台为 Windows x64，Node.js 26.13.0、Electron 33.4.11、electron-builder 26.15.3。依赖以 package-lock.json 为准。

~~~powershell
git clone https://github.com/lxl2000927/NeuralFrame.git
cd NeuralFrame
npm ci
npm run build:ui
npm start
~~~

如果 npm 禁用了依赖安装脚本、导致 Electron 可执行文件缺失，可显式执行 node node_modules/electron/install.js 下载锁定的 Electron 运行环境，再启动。

前端位于 ui/，构建输出为 src/ui-dist/。npm start 会先构建前端。main.js、preload.js 与 src/core/ 保留原有本机安装服务。

## 原生小组件与按需组件

发布页的 `NeuralFrame-0.1.2-Source.zip` 另带 `dist/runtime-bootstrap/` 和 `dist/overlay/`，用于中文适配、预加载器、F8 桥接及许可证。GitHub 自动生成的 Source code 归档只含仓库文件。使用 Git 克隆时，也可以从本版已安装程序的 `resources/payload/` 和 `resources/overlay/` 复制到上述两个目录。

打包前运行 node scripts/verify-runtime-bootstrap.js 校验文件。不要把完整开发用 payload/ 放进发行程序。大型运行库和插件按 src/core/runtime-catalog.json 在使用时下载，并校验 SHA-256。

原生构建步骤保留在 [Enhanced 构建记录](BUILDING-ENHANCED-ARCHIVE.md)，其中旧版本名称、旧下载地址和离线打包方式仅供历史参考，不能直接用来制作当前轻量发行包。

## 检查与打包

32 位兼容桥已同步 Enhanced 2.3.1 并作 NeuralFrame 适配。修改原生源码后，使用 Zig 0.14.1 编译并更新本机启动资源及固定指纹：

~~~powershell
$env:NEURALFRAME_ZIG='D:/tools/zig-x86_64-windows-0.14.1/zig.exe'
node scripts/build-winmm-preload32.js --stage
node scripts/verify-runtime-bootstrap.js
node --test test/preloader-native.test.js
~~~

这只编译 `winmm.dll`，不打包或发布桌面程序。脚本直接编译仓库里的 C/DEF 文件，不再用旧的内嵌模板覆盖源码。默认输出在 `build-output/preloader32/`；`--stage` 将 DLL 放入 `dist/runtime-bootstrap/` 并更新 `runtime-catalog.json`，此前组件缓存及游戏内 DLL 不会被覆盖。更新指纹后重新运行下方测试资源准备脚本，使用其输出的新视图路径。设置 `NEURALFRAME_ZIG` 后，核心测试还会编译临时 32/64 位探针，验证真实 API 回读与子进程亲和性；没有编译器的环境会明确跳过此项。

老游戏的 `NeuralFrame-Legacy.ini` 在用户确认安装后生成并纳入备份：`CpuLimit=8` 默认仅匹配 Prototype，`LegacyMemory=1` 仅匹配已识别的 Delta Force 老引擎，`GoldSrc=1` 对应 `hl.exe`；显式设置保留。Steam 安装脚本只解析游戏目录内的注册表数据，不执行安装命令。兼容数据写入 `HKCU\Software\NeuralFrame\Legacy\<游戏指纹>` 独立命名空间，应用前预览，安装记录负责清理；不会改写原来的游戏厂商注册表键。清理失败保留记录供恢复重试。

~~~powershell
npm run check:ui
npm test
npm run test:ui
npm run build -- --publish never
~~~

完整核心回归以 Node 运行，安装集成检查还需要开发用完整 payload/。仅有 bootstrap 时可以构建桌面发行版；复现全部安装回归需要准备对应的开发载荷。

也可将 `NEURALFRAME_TEST_PAYLOAD_DIR` 指向已准备完整的开发载荷或按需缓存的 `runtime/views/<指纹>/`，再运行 `npm test`。该变量仅供测试读取源文件，测试写入临时游戏目录，不改变软件的实际安装来源。缓存缺包时仍会报缺少文件，不会跳过校验或自动下载。

可先准备隔离的完整测试资源：

~~~powershell
node --use-env-proxy scripts/prepare-test-payload.js D:/NeuralFrame-test-cache
# 将下方路径替换为上一步输出的 Test payload ready 路径
$env:NEURALFRAME_TEST_PAYLOAD_DIR='D:/NeuralFrame-test-cache/component-library-v1/runtime/views/<指纹>'
npm test
~~~

准备脚本优先复用并校验现有组件，缺少的配套包按固定清单下载。dgVoodoo2 与 LumeniteFX 从原作者地址获取并校验 SHA-256，仅作为本机测试缓存；测试会复制已验证的压缩包到临时配置目录，再运行实际解压、安装及恢复流程。脚本要求 `dist/runtime-bootstrap/` 中的原生小组件完整，不会生成发行包或写入游戏目录。Node 26 的 `--use-env-proxy` 用于遵循 `HTTP_PROXY` / `HTTPS_PROXY`；此参数不更改软件的网络设置。

`npm run test:ui` 依次验证旧界面的筛选与菜单、当前 React 界面的下载与预览流程。单独运行 `npm run test:workflow` 会先构建当前前端，再用模拟后端检查取消、确认和诊断轮询。

大游戏库封面回归：先运行 `npm run build:ui`，再运行 `node scripts/qa-artwork.cjs`。它使用独立的 160 游戏夹具和可控图片请求，检查可见项优先、4 路并发、嵌套滚动预读、搜索、缓存/自定义封面、坏图修复、恢复联网与手动重试，以及隐藏页面不下载；不读取真实图库或连接图片服务器。其等待时间用于验证调度，不是实际网络性能测量。

scripts/qa-neuralframe.cjs 是本机真实游戏库检查，会复制现有列表和封面到隔离配置；列表中存在鸣潮、星穹铁道时也会检查其诊断与组件标签。它只读取实际游戏目录，不执行应用操作。截图默认写入系统临时目录，也可通过 `NEURALFRAME_QA_OUT` 指定仓库外的输出目录。

可设置 NEURALFRAME_USER_DATA 为独立测试目录。开发模式默认使用与发行版相同的按需组件路径，仅 `DLSS5_LIGHTWEIGHT=0` 显式切回完整本地载荷。普通应用继续沿用原配置目录，保留已有缓存和锁定记录。

生成文件位于 dist/：便携单文件与 NSIS 安装版。发布由明确的 GitHub 发布操作完成，上述命令不发布安装包。

Encore 的调试入口、配套依赖、选版与配置保护见 [ENCORE.md](ENCORE.md)。完整测试资源现在使用推荐 Encore 2.4.1、鸣潮 MFG 1.7.1，以及单独位于 `enhanced/mfg-optiscaler-170/` 的 OptiScaler MFG 1.7.0；旧缓存视图不能直接充当新完整测试载荷，应重新运行准备脚本，复用旧文件并补齐新目录。

`node scripts/prepare-engine-licenses.js` 从仓库的 `assets/licenses/` 按固定 SHA 恢复 MFG 的 MIT 许可证到 bootstrap；`prestart` 与打包前检查会调用它。测试载荷准备前也应运行它。官方 1.7.1 压缩包未携带许可证，因此许可作为独立内置小组件准备，不假设它位于上游压缩包中。运行时清单构建脚本保留官方引擎来源，不重新打包这些引擎。

`npm run test:workflow` 包括 `qa-engine-versions.cjs`，覆盖推荐/旧版选择、参数能力限制、切游戏保留草稿、单独补帧的范围隔离和预览请求。运行它只构建调试前端资源，不生成安装包。
