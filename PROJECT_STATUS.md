# NeuralFrame 项目进度

更新于 2026-11-24。当前构建版本为 **0.1.4**，GitHub 下载仍指向 0.1.3。[版本记录](RELEASE-NOTES.md)

| 模块 | 本版进度 | 实现与说明 |
| --- | --- | --- |
| 组件库 | 补充 DLSS 光线重建历史版本。版本扫描保留限流或分页失败前已取得的记录。 | [上游来源](src/core/component-definitions.js) · [配套版本与哈希](src/core/runtime-catalog.json) |
| 游戏识别与部署 | 独立 MFG 和 XeMFG 更新至 1.7.2。sm86 R3 适配三角洲和 Steam 版《迈尔斯》。 | [游戏路线](docs/GAME-ROUTES.md) · [Encore 选版](docs/ENCORE.md) |
| 桌面与设置 | Windows x64 支持在应用内下载更新并校验文件。清理缓存并恢复初始状态时，可选择还原已部署游戏。 | [功能与操作指南](docs/FEATURES.md) |
| 构建与回归 | Windows 安装包、便携包与 Linux 构建共用打包前检查。核心测试、桌面工作流和原生插件各有独立入口。 | [开发与构建](docs/BUILDING.md) |

## 待实机验证

- 按游戏版本、显卡、驱动与 API 记录 NR / MFG 的实际倍率、画质、延迟、场景切换和恢复结果。
- 在 1080p、1440p 和 1600p 记录显存用量和 1% low，再决定是否调整参考值。
- 在干净的 Windows x64 环境检查首次下载、断网恢复、升级与卸载。Linux / Proton 的实机兼容性仍需单独验证。

历次检查、已发布版本与原始测试记录可从[文档索引](docs/README.md)进入。2026-11-14 及以前的逐轮进度保存在[开发日志](docs/history/PROJECT-STATUS-2026-11-14.md)。
