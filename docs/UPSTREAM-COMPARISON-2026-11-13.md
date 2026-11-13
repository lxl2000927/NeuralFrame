# 两个上游全量对比与鸣潮渠道兼容修复

日期：2026-11-13。对象：NeuralFrame 当前调试工作区，软件版本保持 0.1.1；本轮未打包、未上传、未向真实游戏安装补丁。

## 结论

1. **Enhanced 2.3.1 的主要新增兼容修复已经同步。** 重点是老游戏预加载、转接配置、扫描和安装事务，不是新的神经模型引擎。NeuralFrame 保留每游戏启用、已有参数和鸣潮独立路线，不能用上游文件整套覆盖当前实现。
2. **RTXManager 4.3.31 的主要增量是 RTX Encore 2.3.0 适配及 Linux/Wine 支持。** 它管理的 Encore 引擎来自另一个上游；本次更新没有升级鸣潮正在使用的 MFG Unlocker 1.7.0 包。Encore 是可评估的新路线，不能只换 DLL 就视为与鸣潮参数适配等价。
3. **本轮修复三个已经复现的 NeuralFrame 问题：** 缺少官服资源清单时独立安装被一律拒绝；仅有 FG/NR/Reflex 等文件被应用逻辑误判为原生 DLSS SR；静态诊断把硬件/文件/配置推断成已经执行的效果。
4. 用户提供的 WeGame 报错定位到资源清单读取阶段，但安装在另一台机器，无法核实究竟是缺文件、权限不足还是格式不同。缺清单路径已用隔离目录复现并修复；**不等于完成该 WeGame 客户端进游戏验证**。

## 1. 原版源码与比较范围

| 项目 | 新源码目录 | 固定版本 / 提交 | 比较基线 | 文件规模 |
| --- | --- | --- | --- | --- |
| DLSS5-Swapper-Enhanced | [2.3.1 源码](D:/NeuralFrame-research/DLSS5-Swapper-Enhanced-2.3.1-source) | v2.3.1 / `f615e5719da887709e17d86564a4f0edd42a7bdc` | v2.3.0 / `652fb41d59814a91d0731f735d77ae55f83930b8` | 249 个受版本控制文件；14 个变更文件 |
| RTX-FG-Manager | [20261113 源码](D:/NeuralFrame-research/RTX-FG-Manager-20261113) | 应用 4.3.31；源码 HEAD `8771a990a5647561c860adaaf2ff2cc5ccfb9d0f` | 原研究副本 4.3.29 / `3d276c7d30d5e4faa22e3bdba91303ba4f6d56bd` | 508 个受版本控制文件；94 个变更文件 |

两份新 checkout 均未修改；旧研究目录保留。RTXManager HEAD 比 4.3.31 发布代码多出的最新提交是下载计数文档更新。版本结论固定于上述提交，不自动代表未来的 `main`。

“全量”指全部受版本控制文件生成路径、大小和 SHA-256 清单，保存基线到当前的完整差异；另将 Enhanced 全部文件与 NeuralFrame 实际工作区逐路径比较，包括本地新增源码。RTXManager 为 Rust/GPUI，NeuralFrame 为 Electron/React，二者按功能与安装协议映射，不能用同路径行数比较覆盖率。本轮没有逐行证明第三方代码正确性，也没有运行两个上游自己的全部测试。

证据保存在 [comparison-20261113](D:/NeuralFrame-research/comparison-20261113)：

- `enhanced-source-files.csv`、`rtxmanager-source-files.csv`：完整源码清单与指纹。
- `enhanced-all.patch`、`rtxmanager-all.patch`：完整变更，包括二进制差异；对应 `*-semantic.patch` 忽略空白，便于区分换行噪声。
- `*-changed-files.tsv`、`*-commits.txt`：全部变更文件与提交。
- `enhanced-vs-neuralframe-all-files.csv`：上游与 NeuralFrame 当前文件逐项结果；`summary.json` 记录计数和 checkout 状态。

RTXManager 原始差异为 26,990 行新增、18,257 行删除；忽略空白后为 9,941 行新增、1,208 行删除。`controller.rs`、`runtime_files.rs`、`ui.rs` 的大段变化包含大量换行差异，不能按原始数字理解为整个安装器重写。

## 2. Enhanced 2.3.0 → 2.3.1

| 领域 | 上游实际变化 | NeuralFrame 对应状态与取舍 |
| --- | --- | --- |
| 32 位老游戏 | 新 WinMM 预加载桥，处理 DirectDraw/D3D8/D3D9/OpenGL、旧内存报告与 CPU 兼容 | 已同步可复现构建和启动资源校验；兼容功能按游戏启用，CPU 限制不设为所有游戏默认 |
| Feeder 子进程 | 32 位宿主与 64 位 Feeder 启动协作 | 已处理 64 位子进程的原始 CPU 亲和性，避免继承为旧游戏设置的限制 |
| 代理与 API | dgVoodoo 代理识别、DXGI/D3D11 目标区分、DirectDraw/D3DImm、OpenGL ReShade 备用文件 | 已接入安装预览和归属记录；恢复与失败回滚覆盖备用加载器 |
| 配置 | 32 位显存上限默认、低分辨率与全屏兼容、不同引擎目录的配置文件 | 已同步；保留用户显式参数，各引擎目录独立处理，不用同一模板覆盖所有配置 |
| 旧安装脚本 | 读取安装脚本中的兼容注册表值 | 已改成每游戏 `HKCU\Software\NeuralFrame\Legacy\<路径摘要>`；不直接写原厂键，接入预览/还原/失败恢复 |
| 游戏扫描 | 地图编辑器优先级、排除辅助 EXE、WinMM 不再充当渲染 API 证据、ReShade 侧载识别 | 已同步；NeuralFrame 继续使用现有后台检查和扫描缓存 |
| 游戏库 | Steam 共用目录及残留安装信息判断 | 已同步；不恢复被用户要求删除的独立档位页或重复刷新入口 |
| 发布脚本 | 版本号、载荷收集、上游发布脚本与本地构建路径 | 不照搬发布身份和开发机绝对路径；保留 NeuralFrame 的固定来源、校验和发布流程 |

NeuralFrame 的工作区与上游同路径文件有大量合理差异：React 界面、组件归属、下载与预览、鸣潮保护等均已独立演进。20 个仅上游存在的文件主要是社区聊天/管理端、相关测试和截图/发布工具；不是缺少 20 个渲染功能。

依据：[固定提交差异](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced/compare/652fb41d59814a91d0731f735d77ae55f83930b8...f615e5719da887709e17d86564a4f0edd42a7bdc)、[本地完整 patch](D:/NeuralFrame-research/comparison-20261113/enhanced-all.patch)。

## 3. RTXManager 4.3.29 → 4.3.31

### 3.1 引擎相关增量

| 增量 | 管理器接入的行为 | 对 NeuralFrame 的意义 |
| --- | --- | --- |
| Encore 2.3.0 NR Final image | 新 NR 放置阶段，位于最终画面/后处理之后、FG 之前；相关 API 切换有重启要求 | 值得单独评估后处理与 UI 的作用顺序；不能仅向现有 MFG JSON 塞同名字段 |
| 运动矢量 | `presentOpticalFlow=game`，提供游戏运动矢量与估计路径的选择/回退 | 可减少依赖估计输入的场景，但真实输入可用性仍需游戏验证 |
| 曝光 | 新装使用新默认；旧配置缺少字段时保留其既有语义 | 可借鉴“新默认不覆盖旧行为”的迁移规则 |
| FSR 1 / NIS | 增加空间超分选择和锐化设置；有分辨率、API 与 SDR 等适用约束 | 这是空间超分，不是新的神经渲染模型；组件页应明确区分 |
| XeFG 帧节奏 | 四项控制、自动/手动策略与预算约束 | 属于 Encore 的 FG 调度接口，现有 MFG Unlocker/RenoDX 未必具有对应能力 |
| 版本能力 | `supports_230` 等版本判断；旧组件不开放新字段 | 可以扩展为 NeuralFrame 的组件版本能力表，避免可下载就意味着可应用 |
| 配置升级 | 保留 JSONC 注释、未知字段、菜单状态与已明确选择的值 | 新引擎应实现独立解析器和迁移测试，不能直接重建整个配置对象 |
| 预设分享 | 扩展 Encore 2.3.0 参数协议，兼容旧协议 | 是管理功能；不应把远端预设自动写入已有游戏 |
| 原生 FG 判定 | 单独的 Streamline SR/Reflex 文件不再视为原生 FG；仍拒绝覆盖无归属冲突文件 | 支持 SR、支持 FG、可加载 NR 必须分开判断。本轮修复了 NF 的 SR 路线误判，完整能力矩阵仍可完善 |

这里的“Encore 支持”是上游管理器的代码/配置能力，不是本轮完成了这些功能的游戏画质和帧率实测。引擎来源为 [RTX Encore](https://github.com/SilyNoMeta/rtx-encore)，不在 RTXManager 管理器源码中重新实现。

### 3.2 平台和界面

- 新增实验性 Linux/AppImage、显式 Wine/Proton 前缀、路径大小写与注册表桥接；不支持的清理操作保留恢复记录，Linux 不套用 Windows EXE 自动升级。
- GPUI Kit 0.9.1 / Fast 0.1.14 改进输入、文本、滑块、无障碍和绘制。NeuralFrame 使用 React，不能直接移植这些 Rust UI 补丁。
- 语言切换保留页面和搜索等交互细节值得参考；现有 NeuralFrame 已有对应草稿和导航保留测试。
- WeGame/Rail 注册表安装读取在该项目已有实现。它可以作为以后自动发现的参考，但不能证明本次发布包含鸣潮 WeGame 资源清单修复。

依据：[4.3.31 源码版本说明](https://github.com/pandaligx/RTX-FG-Manager/blob/8771a990a5647561c860adaaf2ff2cc5ccfb9d0f/CHANGELOG.md)、[Encore 参数适配](https://github.com/pandaligx/RTX-FG-Manager/blob/8771a990a5647561c860adaaf2ff2cc5ccfb9d0f/rust/src/encore.rs)、[运行库保护](https://github.com/pandaligx/RTX-FG-Manager/blob/8771a990a5647561c860adaaf2ff2cc5ccfb9d0f/rust/src/runtime_files.rs)、[WeGame/Rail 读取](https://github.com/pandaligx/RTX-FG-Manager/blob/8771a990a5647561c860adaaf2ff2cc5ccfb9d0f/rust/src/game_name_windows.rs)。

### 3.3 鸣潮组件没有跟着变成 Encore

比较前后目录中的 MFG 包身份不变：`mfg-unlocker-1.7.0-version-dll-e476ce87b215`。

- RTXManager 签名分发 DLL SHA-256：`e476ce87b215bc987c5ca0dddcd5b4e3ca4fd05c764a6c446863e04fceba8e83`。
- 配套 JSON SHA-256：`978882875fe0715e81cec40060de367e25637cb81bff0f25b14d63fc7a6a990d`。
- NeuralFrame 使用自己固定校验的上游 1.7.0 文件，并识别 RTXManager 的签名版本以实现共存；两种分发不能简单声称字节相同。

因此本轮没有重新下载一份“新版鸣潮 MFG”，也没有混入 Encore DLL 或修改现有模型选择。

### 3.4 安装路线与组件职责

| 职责 | Enhanced / NeuralFrame 当前路线 | RTXManager 对应路线 | 判断原则 |
| --- | --- | --- | --- |
| 原生 DLSS SR | 游戏 NGX/Streamline 集成与 SR DLL | 原生运行库更新 | 换 DLL 不会给任意游戏补出原生调用 |
| 非原生游戏的 NR 输入 | Feeder / 对应 RenoDX Present 路线，取决于 API 和位数 | Encore 的非原生集成路线 | 引擎/输入接入不同，不代表效果、时序或性能等价 |
| NR 模型 | 独立模型库、指纹与显卡架构检查 | 独立 NR 运行库/模型管理 | 模型文件不是加载器，也不是 FG 解锁补丁 |
| FG 解锁 | MFG Unlocker / RenoDX MFG；鸣潮用独立 `version.dll` | MFG Unlocker 等方案 | 解锁既有路径与新增 FG 引擎是两种能力 |
| 新增 FG | 取决于具体已适配路线，不能由“有 SR DLL”推出 | Encore 的 Added FG，成套依赖及归属记录 | 要分别检查引擎能力、原生 FG 和文件冲突 |
| 界面与状态 | Electron/React，运行诊断区分配置和执行证据 | Rust/GPUI，按方案读取配置 | 管理器界面不是游戏里的渲染引擎面板 |

## 4. 本轮确认并修复的问题

### A. 缺少官服资源清单时无法应用独立补丁

原代码将 `LocalGameResources.json` 的所有读取/解析异常合成一句“请先用启动器校验游戏”，并且一律阻止安装。一个不提供这份 Kuro 清单的渠道布局也会触发该错误，校验游戏未必能产生这份文件。

现在分三类处理：

| 读取结果 | 处理 |
| --- | --- |
| 清单存在且有效 | 沿用资源列表与指纹保护，禁止替换启动器受保护资源 |
| 文件不存在（仅 `ENOENT`） | 允许受限独立加载：只处理主程序旁的已知补丁路径；保留游戏原版 DLSS/Streamline |
| 权限错误、清单存在但格式无效 | 给出不同错误并停止；不降级为无清单安装 |

无清单模式只允许 `Client/Binaries/Win64` 内的 `version.dll`、`RTXMFG-Universal.json`、`nvngx_dlssnr.dll`、许可文件及配套模型归属记录。未知 `version.dll`、无归属的模型或配置仍受保护；已有 RTXManager 的模型/配置按原有指纹和记录验证。重复应用保留无关参数，还原检查归属；无法验证的旧运行库备份停止还原，不向游戏写入猜测的原版 DLL。

其他安装、组件升级和回滚入口也有同一限制，不能换一个入口覆盖原版运行库。预览后如果清单出现并将目标列为官方资源，会重新检查并拒绝确认。

页面区分“清单缺失，保留原文件”与“读取失败”；没有证据时不伪造原版版本号，实际加载版本由运行诊断提供。

修改：[wuthering-waves.js](D:/NeuralFrame/src/core/wuthering-waves.js)、[combined-manager.js](D:/NeuralFrame/src/core/combined-manager.js)、[GraphicsPanels.tsx](D:/NeuralFrame/ui/src/features/GraphicsPanels.tsx)。测试：[wuthering-waves.test.js](D:/NeuralFrame/test/wuthering-waves.test.js)，包括有/无清单 IPC、安装、重复应用、还原、权限、无归属文件、RTXManager 共存、预览时资源变化及旧备份保护。

**远端限制：** 报错说明游戏已经走到鸣潮保护分支，不足以断言远端清单确实缺失。当前根目录识别仍使用已知鸣潮布局，尚未验证所有 WeGame 目录变体、启动参数和游戏内加载。没有宣称“所有 WeGame 版本已经支持”或“实机一定不报修复”。

### B. 原生 DLSS SR 路线误判

应用逻辑原先宽泛匹配 `nvngx_*`、`sl.*`，只有 FG/NR 或 Reflex 文件时也可能认为游戏有原生 DLSS SR，从而跳过 Feeder。页面的推荐逻辑却使用更严格规则，造成预览/应用不一致。

应用逻辑现在复用 [install-routes.js](D:/NeuralFrame/src/shared/install-routes.js) 的判断：使用扫描确定的 SR 主文件，排除 DLSS 1.x 和 NeuralFrame 自己添加的文件。测试覆盖仅 Reflex、仅 common、仅 FG+NR、DLSS 1.x+FG，以及真正的原生 DLSS SR。扫描结果仍是安装路线的证据，不代表已证明游戏执行了 NGX 调用。

修改：[combined-manager.js](D:/NeuralFrame/src/core/combined-manager.js)；测试：[native-input-route.test.js](D:/NeuralFrame/test/native-input-route.test.js)。

### C. 静态诊断冒充运行状态

- RTX 40/50 档位不再直接推出 Reflex 已生效。
- 使用 ASI 后端不再自动视为 RenoDX 边界伪影缓解已启用；需要对应插件与配置。
- 鸣潮独立路线不支持的 RenoDX QualityGuard/HUD 参数显示未知及原因，不伪装成通过。
- 没有 DLSS / DLSS 1.x 不再显示“已自动启用 Feeder 1.19”；区分待评估和已有部署记录。
- 没有 NeuralFrame 备份记录显示“无 NeuralFrame 部署记录”，不声称游戏是原版纯净状态。
- DLL 绑定和可选备用代理描述为配置/预览结果；效果仍依赖运行证据。

修改：[combined-manager.js](D:/NeuralFrame/src/core/combined-manager.js)、[diagnostics.ts](D:/NeuralFrame/ui/src/diagnostics.ts) 与英文翻译。新增 [diagnostic-evidence.test.js](D:/NeuralFrame/test/diagnostic-evidence.test.js)，更新界面状态和还原测试。

## 5. 下一步优先级

| 优先级 | 事项 | 性质及完成标准 |
| --- | --- | --- |
| 已修复 | 清单缺失、SR 路线误判、静态诊断误报 | 本轮调试代码与回归已覆盖；远端 WeGame 仍需实机确认 |
| P1 | WeGame 自动发现与渠道信息 | 功能补齐。可读取 Tencent WeGame/Rail 注册表并保留渠道；需要真实目录样本。不是当前已定位报错的直接原因 |
| P1 | 统一 SR / FG / NR / Reflex 能力描述 | 组件页、安装路线和应用后端共享证据与限制；区分文件存在、引擎集成和运行结果，禁止无归属覆盖 |
| P1（可选新功能） | Encore 2.3.0 独立路线 | 先固定来源/许可/指纹，增加 JSONC 与版本适配、下载依赖、预览/还原和运行证据，再进行游戏测试；不替换鸣潮当前路线 |
| P2 | 组件版本能力与升级策略 | 新版本新增字段仅对已适配版本开放；新装默认与旧配置迁移分开，保留未知字段 |
| P2 | 扩展实机性能与质量验证 | 对选定游戏/API/显卡记录输入输出帧率、延迟、显存和画面问题；不能用管理器单测推导画质等价 |

没有列为待修缺陷的项目：

- 组件可以下载但标为“待适配”是当前保护策略；不能为了使按钮可用而跳过后端参数适配。
- `310.9.16-oct2026 → 310.8.SF-v2` 是旧错误目录条目的身份迁移。真正的 RankFTW 310.9.16 已有独立下载与指纹；不能仅按旧名称把用户现存的 SF-v2 文件改认成另一个模型。现有身份测试继续保留。
- 独立档位页、重复刷新按钮和上游社区 UI 是已确定的产品取舍，不恢复。

## 6. 验证记录

- 完整资源测试 **516/516 通过，0 失败、0 跳过**，约 130 秒；使用仓库外固定载荷和 Zig，包含真实 32/64 位原生探针。结果记录于 `full-tests.log`。
- TypeScript / Vite 和 Electron 工作流通过：导航、草稿、操作预览、运行诊断、模型下载流程和叠加层预览。
- 真实游戏库只读 UI 检查通过：鸣潮/星铁详情、草稿保留和撤销、诊断/文件列表、960px 布局与深浅主题；无脚本错误。使用隔离应用配置目录，没有对真实游戏执行应用或还原。
- 所有日志在 [比较目录](D:/NeuralFrame-research/comparison-20261113)，截图和只读 UI 结果在 `real-library-ui/`。
- 未打包、未发布；现有安装包不包含本轮修复。
