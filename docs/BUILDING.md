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

完整源码归档另带 dist/runtime-bootstrap/ 和 dist/overlay/，用于中文适配、预加载器、F8 桥接及许可证。Git 不追踪这些二进制构建目录。也可以从本版发行包中复制 resources/payload/ 到 dist/runtime-bootstrap/、resources/overlay/ 到 dist/overlay/。

打包前运行 node scripts/verify-runtime-bootstrap.js 校验文件。不要把完整开发用 payload/ 放进发行程序。大型运行库和插件按 src/core/runtime-catalog.json 在使用时下载，并校验 SHA-256。

原生构建步骤保留在 [Enhanced 构建记录](BUILDING-ENHANCED-ARCHIVE.md)，其中旧版本名称、旧下载地址和离线打包方式仅供历史参考，不能直接用来制作当前轻量发行包。

## 检查与打包

~~~powershell
npm run check:ui
node --test test/neuralframe-draft.test.mjs
node scripts/run-regression.cjs
npm run build -- --publish never
~~~

核心回归使用 Electron 内置 Node 执行，安装集成检查还需要开发用完整 payload/。仅有 bootstrap 时不能把缺少测试资源解释为安装功能通过。

scripts/qa-neuralframe.cjs 是本机真实游戏库检查，会复制现有列表和封面到隔离配置；当前脚本要求列表中包含鸣潮和星穹铁道。它只读取实际游戏目录，不执行应用操作。scripts/qa-workflow.cjs 使用模拟后端检查下载/预览的取消和确认流程。

可设置 NEURALFRAME_USER_DATA 为独立测试目录；设置 DLSS5_LIGHTWEIGHT=1 使用发行版的按需组件路径。普通应用继续沿用原配置目录，保留已有缓存和锁定记录。

生成文件位于 dist/：便携单文件与 NSIS 安装版。发布由明确的 GitHub 发布操作完成，上述命令不发布安装包。
