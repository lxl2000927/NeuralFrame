# NeuralFrame

**Neural rendering & frame generation — Windows desktop manager**

NeuralFrame 集中管理游戏的 DLSS 神经渲染、帧生成运行库和配套插件。0.1.0 是桌面重构的初始版本：使用统一的游戏列表与设置界面，保留组件按需下载、变更预览、版本锁定和回滚能力。

当前版本 **0.1.1** 改进切页性能、完整封面显示、导航对齐和下拉菜单，采用更简洁的 DLSS 5 主题图标。详见 [更新说明](docs/NEURALFRAME-0.1.1.md)。

## 主要功能

- 游戏库：识别游戏平台与手动目录，使用本地封面缓存。
- 游戏配置：神经渲染、模型、帧生成倍率、硬件档位与高级选项。
- 待应用修改：修改参数先进入当前游戏的草稿；预览文件变更后才写入。
- 组件库：配套组件按需下载，上游版本独立检查、下载、校验和入库。
- 每游戏版本：选择配套组件版本、锁定稳定组合、回滚上次更新。
- 运行诊断：分别显示安装文件、进程加载、有效期内的运行证据。
- 游戏内面板：保留已有 F8 紧凑面板与中文适配插件，提供快捷键和配色设置。
- 历史与恢复：查看或清除操作历史，通过原始备份恢复游戏。

## 基本使用

1. 添加游戏目录，或从已发现的游戏中选择。
2. 在“画质与补帧”中选择参数。未开启的功能保持关闭。
3. 点击“预览并应用”。需要组件时先下载缓存，再检查文件变更清单。
4. 应用完成后重新启动游戏，在实际场景中打开“运行诊断”。
5. 在游戏中确认组合稳定后，可在“组件与版本”中锁定。

仅有 DLL 文件、勾选开关或倍率请求，不代表渲染已经生效。状态页保留证据来源和时间；无法读取时显示具体原因。通用硬件档位也不代表每款游戏都经过验证。

## 组件与软件分离

运行库不完整塞入便携 EXE。配套包托管在本仓库独立的 `runtime-components-2026.11.06` Release，清单固定文件大小和 SHA-256。软件浏览页面不会自动安装或更新游戏组件。

上游新版本可以下载入库；通过配置协议和中文面板适配检查后，才可替换游戏使用的版本。版本锁定不会阻止游戏自身或其他软件修改文件。

## 已有配置

从 Enhanced 0.1.8 过渡时，继续使用 `%APPDATA%\dlss5-swapper-enhanced` 保存游戏列表、组件缓存和版本锁定，避免复制大型模型。游戏原始备份仍在原目录。卸载管理器不会自动恢复游戏文件。

旧仓库已删除；本项目中的组件地址已经迁移。旧构建内写死的下载地址可能失效。

## 开发

当前本机验证环境：Windows、Node.js 26、Electron 33.4.11。

```powershell
npm ci
npm run build:ui
npm start
node scripts/run-regression.cjs
node --test test/neuralframe-draft.test.mjs
npm run build -- --publish never
```

- `ui/`：React + TypeScript 桌面前端，按页面分包。
- `main.js` / `preload.js`：桌面入口与本机接口；后续继续按功能拆分。
- `src/core/`：扫描、下载、安装、预览、锁定、回滚与检测。
- `src/overlay-*`、`overlay/`：独立的游戏内面板与原生桥接。
- `docs/design/ROUND-1.md`：本轮设计约定和范围。
- `docs/NEURALFRAME-0.1.0.md`：初始版本说明。

首次准备开发目录时，需要现有已校验的原生构建产物：`dist/runtime-bootstrap` 与 `dist/overlay`。打包前的校验脚本会拒绝缺失或被修改的文件。完整源码归档包含这两个小型构建目录；Git 仓库保留原生源码与构建脚本。安装流程集成测试另需完整的开发用 `payload`，它不会进入应用安装包。

通过 `NEURALFRAME_USER_DATA` 可指定独立的测试配置目录。UI 测试使用隔离配置，不能据此宣称游戏画质或输出帧率已验证。

## 来源与许可

本项目基于 [DLSS5-Swapper-Enhanced](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced) 的本地独立分支继续开发，保留原有作者贡献及许可声明。

第三方运行库、RenoDX、MFG 解锁器、Feeder、ReShade 等各自遵循对应许可证；详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和组件包内的许可文件。NVIDIA App 的布局分析用于界面结构参考；NeuralFrame 使用自己的名称、Logo 和实现。
