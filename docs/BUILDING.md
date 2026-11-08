# NeuralFrame 0.1.0 开发与构建

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

发布页的 `NeuralFrame-0.1.0-Source.zip` 另带 `dist/runtime-bootstrap/` 和 `dist/overlay/`，用于中文适配、预加载器、F8 桥接及许可证。GitHub 自动生成的 Source code 归档只含仓库文件。使用 Git 克隆时，也可以从本版已安装程序的 `resources/payload/` 和 `resources/overlay/` 复制到上述两个目录。

打包前运行 node scripts/verify-runtime-bootstrap.js 校验文件。不要把完整开发用 payload/ 放进发行程序。大型运行库和插件按 src/core/runtime-catalog.json 在使用时下载，并校验 SHA-256。

原生构建步骤保留在 [Enhanced 构建记录](BUILDING-ENHANCED-ARCHIVE.md)，其中旧版本名称、旧下载地址和离线打包方式仅供历史参考，不能直接用来制作当前轻量发行包。

## 检查与打包

~~~powershell
npm run check:ui
npm test
npm run test:ui
npm run build -- --publish never
~~~

完整核心回归以 Node 运行，安装集成检查还需要开发用完整 payload/。仅有 bootstrap 时可以构建桌面发行版；复现全部安装回归需要准备对应的开发载荷。

`npm run test:ui` 依次验证旧界面的筛选与菜单、当前 React 界面的下载与预览流程。单独运行 `npm run test:workflow` 会先构建当前前端，再用模拟后端检查取消、确认和诊断轮询。

scripts/qa-neuralframe.cjs 是本机真实游戏库检查，会复制现有列表和封面到隔离配置；当前脚本要求列表中包含鸣潮和星穹铁道。它只读取实际游戏目录，不执行应用操作。

可设置 NEURALFRAME_USER_DATA 为独立测试目录；设置 DLSS5_LIGHTWEIGHT=1 使用发行版的按需组件路径。普通应用继续沿用原配置目录，保留已有缓存和锁定记录。

生成文件位于 dist/：便携单文件与 NSIS 安装版。发布由明确的 GitHub 发布操作完成，上述命令不发布安装包。
