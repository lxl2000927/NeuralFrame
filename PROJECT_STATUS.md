# NeuralFrame 项目进度

更新于 2026-11-08，对应 Windows x64 版本 0.1.0。[版本说明](RELEASE-NOTES.md) · [构建说明](docs/BUILDING.md)

## 已完成

| 范围 | 交付内容 | 验证入口 |
| --- | --- | --- |
| 桌面界面 | 游戏库与详情、硬件档位、组件库、附加组件、叠加层、历史、设置与关于。简中和英文切换，窗口位置与大小可记忆。 | `npm run test:ui` |
| 硬件与模型 | 读取物理显卡、显存、窗口所在显示器和刷新率。RTX 40 低显存桌面卡可借用省显存参数。区分模型目录记录、本地文件与 CUDA 架构匹配。 | `test/panel-settings.test.js`、`test/neural-model-identity.test.js` |
| 安装与恢复 | 每游戏预览、版本锁定、组件回滚、整套恢复。普通和增强安装共用文件事务，末步失败可恢复原 DLL 与 F8 登记。 | `test/ordinary-install-transaction.test.js`、`test/combined-transaction.test.js` |
| 组件更新 | 14 个运行包按需下载；9 个上游来源共用 5 个仓库。支持重复检查合并、5 分钟缓存、ETag、限流等待和旧结果标记。 | `test/component-library.test.js`、`test/runtime-payload-ipc.test.js` |
| 运行诊断与性能 | 区分安装、加载、实际倍率与会话证据。较重的文件检查交给后台工作线程，快速切换游戏时跳过过期请求。 | `test/game-inspection.test.js`、`test/runtime-status.test.js` |
| 发布 | Windows x64 便携单文件、NSIS 安装程序、带原生启动资源的源码包及 SHA-256 清单。 | [0.1.0 发布页](https://github.com/lxl2000927/NeuralFrame/releases/tag/v0.1.0) |

## 当前验证边界

发布前回归基线为 435 项自动化测试、TypeScript 检查与 Electron 界面回归。显示器接口在 RTX 4070 Laptop 机器上读到 2560 × 1600、165 Hz。测试中的临时游戏目录用于复现安装、失败与恢复；模拟遥测用于验证状态判读。游戏内真实画质、延迟与输出倍率需要单独采样。

## 待完成

| 工作 | 完成标准 |
| --- | --- |
| 建立本版游戏实测表 | 记录游戏版本、API、显卡和驱动；分别测试 NR / MFG 开关、F8 热键、场景切换与恢复。保存当前会话证据，对缺少倍率报告的组合写明限制。 |
| 核对显存预算 | 在 1080p、1440p 和 1600p 记录启停 NR / MFG 前后的真实显存与 1% low。数据充分后再调整当前参考值。 |
| 扩展可用组合 | 新模型和插件逐项确认来源、摘要、架构、配置协议及回滚，再决定能否进入配套清单。历史目录里缺少本地文件的模型继续标注需导入。 |
| 补充发行环境验证 | 在另一台干净的 Windows x64 机器上验证首次按需下载、断网重试、安装升级与卸载，并登记具体环境和结果。 |

维护时，桌面软件版本由 `package.json` 管理，配套组件由 `src/core/runtime-catalog.json` 固定。更新软件和替换运行包分别发布。已被游戏版本锁定或回滚记录引用的组件需保留可获取的原文件。
