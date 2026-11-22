# NeuralFrame 项目进度

更新于 2026-11-22。已发行版本为 **0.1.3**。该版交付的功能与安装包见[发行说明](RELEASE-NOTES.md)。下表列出本版各模块的主要变更。

| 模块 | 本版进度 | 实现与说明 |
| --- | --- | --- |
| 组件库 | 扫描 ANR 完整包与插件包、sm86 发布记录与三角洲修订、Intel XeSS 帧生成 SDK。按来源、版本与指纹区分，可用的配套包按游戏路线部署。 | [上游来源](src/core/component-definitions.js) · [配套版本与哈希](src/core/runtime-catalog.json) |
| 游戏识别与部署 | 按可执行文件、图形 API、输入和已安装宿主筛选路线。Radeon 可用的 XeMFG、OptiFG 与驱动补帧条件各有说明。Encore 默认引擎为 2.5.0。 | [游戏路线](docs/GAME-ROUTES.md) · [Encore 选版](docs/ENCORE.md) |
| 桌面与叠加层 | 游戏库支持批量扫描与报告导出。叠加层页可预览 F7 模式和浮窗位置，并向选中的程序应用配置。 | [桌面功能源码](ui/src/features/) · [原生叠加层](overlay/) |
| 构建与回归 | Windows 安装包、便携包与 Linux 构建共用打包前检查。核心测试、桌面工作流和原生插件各有独立入口。 | [开发与构建](docs/BUILDING.md) |

## 待实机验证

- 按游戏版本、显卡、驱动与 API 记录 NR / MFG 的实际倍率、画质、延迟、场景切换和恢复结果。
- 在 1080p、1440p 和 1600p 记录显存用量和 1% low，再决定是否调整参考值。
- 在干净的 Windows x64 环境检查首次下载、断网恢复、升级与卸载。Linux / Proton 的实机兼容性仍需单独验证。

历次检查、已发布版本与原始测试记录可从[文档索引](docs/README.md)进入。2026-11-14 及以前的逐轮进度保存在[开发日志](docs/history/PROJECT-STATUS-2026-11-14.md)。
