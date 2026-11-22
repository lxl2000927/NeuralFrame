# NeuralFrame 开发版组件与游戏路线核对

2026-11-17 核对的两个发行版本为 [Enhanced v2.3.5](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced/releases/tag/v2.3.5)（`ea23fd1`）和 [RTX-FG-Manager v4.3.36](https://github.com/pandaligx/RTX-FG-Manager/releases/tag/v4.3.36)（`26e327a`）。范围是 NeuralFrame 已有的组件获取、安装、调参、检查和还原。

## 组件从哪里来

| 组件 | 固定版本或组合 | 文件来源与使用方式 |
| --- | --- | --- |
| 神经模型 | 310.8.SF-v2，另有本地模型和在线版本 | 固定包记录 [SmarterGamers](https://github.com/SmarterGamers/SmarterGamers-DLSS5-Swapper) 为来源。在线目录另收录 [RankFTW](https://github.com/RankFTW/rhi-repo) 的发布。应用前检查实际 DLL 指纹和模型架构。 |
| DLSS SR、FG、RR 和 Streamline | SR/FG 310.9.1、310.9.16，RR 310.9.1，SL 2.13、2.14.16 | 按路线下载配套组合，来源为 [NVIDIA/DLSS](https://github.com/NVIDIA/DLSS) 和 [NVIDIA-RTX/Streamline](https://github.com/NVIDIA-RTX/Streamline)。历史 FG 与固定包文件完全相同时可复用同一适配记录。 |
| RenoDX NR 和多遍插件 | 8.5.0-rc10、SF 26.1003.2350 | 项目和插件分发分别为 [clshortfuse/renodx](https://github.com/clshortfuse/renodx) 与 [RankFTW/rhi-repo](https://github.com/RankFTW/rhi-repo)。安装时区分游戏端和 Feeder 的 host64。 |
| Feeder、ReShade | Feeder 1.17 与 1.19 配套，ReShade 6.8.0 | 组合包含双架构插件、宿主与着色器。Feeder 的其他发布可入库，部署仍使用路线已适配的组合。[Feeder](https://github.com/jlrouzies-fr/DLSS5-Feeder) · [ReShade](https://github.com/crosire/reshade) |
| ReShade MFG、Universal MFG | RenoDX 1.5.5，鸣潮独立路线 1.7.1，OptiScaler 配套 1.7.0 | 分开核对游戏侧加载方式、配置协议、许可和指纹。旧 Universal 包可按原文件名入库。[RenoDX MFG](https://github.com/mavismmg/MFGAdaUnlock-RenoDx) · [MFG-Unlocker](https://github.com/dashdogy/MFG-Unlocker) |
| Encore | 2.4.2 | 从原作者取得固定引擎和配套运行库。适配记录决定可选的引擎版本。[RTX Encore](https://github.com/SilyNoMeta/rtx-encore) |
| ANR | B18 完整包与 OptiScaler 附加包 | 两条路线来自同一发布，文件布局不同。附加包使用宿主的 provider 目录。[apex-compute/ANR](https://github.com/apex-compute/ANR) |
| Dlssg_for_sm86 | 通用 0.4.2，三角洲 DX12/Vulkan 0.4.2+rtxfg.1 | 通用引擎来自 [sdli1995/dlssg_for_sm86](https://github.com/sdli1995/dlssg_for_sm86)。两个完整配套包由 [RTX-FG-Manager](https://github.com/pandaligx/RTX-FG-Manager/releases/tag/payloads) 提供。 |
| F7、中文面板与 32 位兼容桥 | 本项目构建双架构插件，桥接 DLL 随程序提供 | F7 实现可追溯到 [Enhanced 的 ReShade 插件源码](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced/blob/ea23fd10f1c66aa8224fbeefbba89ae7026e6db1/overlay/zh-cn-overlay.cpp#L1111)。本机按所选程序的架构安装。CPU 限制由按游戏配置的兼容桥处理。 |
| OptiScaler 与旧图形 API 的辅助组件 | OptiScaler 0.2.0-patch1、0.1.1.5-dlssnr、0.8.92-presr，dgVoodoo 2.87.5，LumeniteFX 固定提交 | 这些依赖另走原作者的按需下载。三个 OptiScaler 包和 dgVoodoo 的 GitHub 资产摘要与程序内固定值一致。[OptiScaler DLSSNR](https://github.com/Dagherbou/OptiScaler_DLSSNR) · [PreSR](https://github.com/jlrouzies-fr/OptiScaler-DLSSNR-PreSR-Multipass) · [dgVoodoo2](https://github.com/dege-diosg/dgVoodoo2) · [LumeniteFX](https://github.com/umar-afzaal/LumeniteFX/tree/f8cbbb4eccfcb7adf0d74bb358ba349272e3c1e9) |

固定目录有 22 包，其中 13 包由 NeuralFrame 组合分发，7 包取自上游发布，2 包随程序提供。20 个在线包的发布文件名、长度和 SHA-256 与清单一致。隔离缓存中的 226 个文件均按大小和 SHA-256 复核。[固定目录](../src/core/runtime-catalog.json)

在线历史目录本次返回 96 个候选。实际下载并入库的样本包括 Feeder 1.19.0 和 2.0.0、OptiScaler 0.2.0-patch1、MFG Universal 1.4.2、DLSS FG 310.9.16、RenoDX MFG 1.10.0 和 RenoDX NR 10.8.0。FG 样本还在隔离游戏目录完成选择、预览、应用和回滚，恢复后的文件与原件一致。

GitHub Releases API 限流时，手动检查可以读取上游公开发布页。SmarterGamers 的模型指针和 OptiScaler 配套许可证在原始文件域名不可达时可从 GitHub Contents 读取同一版本，并继续校验指纹。历史包遇到未知文件身份时，组件页显示对应的应用条件。

## 游戏页参数如何落地

| 游戏或已装路线 | 核对的参数与行为 |
| --- | --- |
| 原生 DLSS | 以所选 EXE 的架构、有效 API、原生 SR 文件决定推荐。检查模型身份、运行时组合、显卡档位和配置回读。仅见 FG、NR、Reflex、管理器自行放入的 DLL 或其他程序的 DLL 时，不据此推荐原生 SR。 |
| 无原生 DLSS、仅有 DLSS 1.x 或旧 API | 依据 API 和位数进入 Feeder、32 位转 64 位宿主或现有 RenoDX DLSS Tool 路线。验证桥接、着色器、代理名和原文件恢复。已有 RenoDX 或 OptiScaler 后端再次改参数时沿用其加载方式。 |
| FSR、XeSS 与 Encore | 区分超分和帧生成文件。仅有 FSR3 超分时可按其他条件选择 Encore，仅有 XeSS-FG 时不能作为 OptiScaler 的超分输入。Encore 的模型、引擎、固定倍率及高级参数由其适配器读取。 |
| OptiScaler 与 MFG ASI | 已有可用输入和输出时，倍率写入宿主 `OptiScaler.ini` 的 `[DLSSG]`。例如界面选择 3× 对应 2 个插入帧。关闭时恢复原宿主参数，保留游戏自己的 JSON 设置。[MFG-Unlocker 的宿主说明](https://github.com/dashdogy/MFG-Unlocker/blob/v1.7.0/README.md#optiscaler-support) · [OptiScaler 配置](https://github.com/Dagherbou/OptiScaler_DLSSNR/blob/v0.2.0-patch1/OptiScaler.ini#L246-L267) |
| NVIDIA 补帧与鸣潮 | 核对位数、API、GPU 能力、保存的倍率及 HDR 配置。鸣潮只走独立加载器，独立版本使用相应参数，切回旧版本会移除待提交的新版专用参数。 |
| ANR 与 sm86 | 参数归属跟随 EXE 和后端。ANR 写入生成帧数和切镜保护，sm86 写入引擎和生成帧数。1 个真实帧加上生成帧数才是界面倍率。XeSS 最高 4×，DLSS 最高 6×。 |
| 叠加层与 F7 | 核对插件导出、架构、渲染宿主、四角位置、显示模式以及修改后再读取。双架构 D3D11 程序验证了修复后的 F7 实际绘制，同时保留调用方的 CPU 亲和性。 |
| 共用设置与恢复 | 界面、预览和写入按同一个 EXE 和 API 处理。核对切换程序、单项应用、还原后草稿、历史版本锁定、已变更文件和重复应用。Proton 的配置读取覆盖多库目录和多行 `config_info`。[Valve 的写入实现](https://github.com/ValveSoftware/Proton/blob/proton_10.0/proton#L913-L940) |

## 实际验证

- 最终代码的 743 项核心回归全部通过，零跳过。Electron 工作流验证了组件下载、右侧详情面板、游戏参数、叠加层草稿与插件操作。
- Feeder 用真实文件验证了五种位数和 API 组合。每种都完成了首次安装、重复安装和恢复原件。
- 七项 OptiScaler 场景覆盖原生 DLSS 和 Feeder 双向切换、失败回滚、Vulkan 恢复顺序、PreSR 替换和安装确认。
- 在同一份外部 `OptiScaler.ini` 上先后安装 F7、MFG ASI 和神经模型。两种安装顺序下，关闭 ASI 或整套还原都保留了玩家后来改写的参数，并区分原先缺省和显式设置的字段。
- 在 32 位、64 位 D3D11 测试程序中实际绘制 F7，修复后的两个插件都维持了调用方的 CPU 亲和性掩码。另在本机《鸣潮》和《崩坏：星穹铁道》的库记录上完成游戏页只读检查。

## 保留的项目差异

- Enhanced 的 F7 还有管线徽标和软件估算延迟。当前开发版展示有对应数据来源的 Reflex 或 DXGI 指标，两者均取不到时显示缺测。[Enhanced 发行说明](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced/releases/tag/v2.3.5)
- RTX-FG-Manager 可在多个部署目录之间共同管理运行库。NeuralFrame 在每个游戏根目录维护一份活动安装清单，通过切换目标和还原管理多个 EXE。《影之刃零》已核对实际渲染程序 `platform/steam/PBZ.exe` 和旧启动器目录的还原路径。[RTX-FG-Manager 发行说明](https://github.com/pandaligx/RTX-FG-Manager/releases/tag/v4.3.36)

文件部署和配置测试使用隔离目录。真实游戏库检查只读取配置。画面质量、实际输出倍率、游戏内帧率与延迟仍需逐游戏运行验证，Linux/Proton 本轮覆盖配置解析与分流测试。

## 2026-11-20 上游复核

- Enhanced 的最新发布仍为 v2.3.5，主分支也停在该版本的提交 `ea23fd1`。[发布说明](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced/releases/tag/v2.3.5)
- RTX-FG-Manager 连续发布了 4.3.37、4.3.38 和 4.3.39。4.3.37 引入 DX12 版 Pipo sm86-10、带 MWSR 空间超分的 Encore 2.5.0，以及支持 scRGB HDR 的 ANR B20。4.3.38 修复 ANR 卸载后遗留 Vulkan 加载器导致重装误报。NeuralFrame 当前固定组件清单仍使用 Encore 2.4.2 和 ANR B18。[4.3.37](https://github.com/pandaligx/RTX-FG-Manager/releases/tag/v4.3.37) · [4.3.38](https://github.com/pandaligx/RTX-FG-Manager/releases/tag/v4.3.38)
- 4.3.39 增加网易官服安装识别，合并同游戏在不同平台的已核实推荐，并在 DLSS / XeSS 运行库界面并排展示当前和目标版本，修正 Streamline 文件夹跳转。[4.3.39](https://github.com/pandaligx/RTX-FG-Manager/releases/tag/v4.3.39)

### 源码同步时发现的差异

本地参考库从 4.3.29 时的 `3d276c7` 快进到 `b247ddf`，共 103 个提交。正式版 4.3.39 的标签指向 `bdc0909`，此后的两个提交分别启用已验证的发布通道和刷新下载统计。下列差异以上次核对的 4.3.36 为起点。[源码差异](https://github.com/pandaligx/RTX-FG-Manager/compare/v4.3.36...v4.3.39)

| 项目 | NeuralFrame 的现状与接入点 |
| --- | --- |
| ANR 卸载和重装 | 用 NeuralFrame 的 B18 完整包安装到隔离 DX12 游戏目录，再按上游首次运行后的布局，将本机系统 Vulkan 加载器复制到 ANR 的私有目录。还原返回成功，安装清单已移除，但 `anr-vkloader.dll` 留在原处，重装被当成已有 OptiScaler。优先修复这个可复现问题。应识别生成文件的归属，让玩家预览清理，同时保留游戏自带的 Vulkan 文件、独立宿主和其他插件。此验证模拟了生成文件，没有启动游戏。[上游修复](https://github.com/pandaligx/RTX-FG-Manager/commit/72949cf) · [本项目的宿主判断](../src/core/optional-graphics.js) |
| Encore 2.5.0 | 当前固定版为 2.4.2，桌面、配置写入和预设只接受关闭或 DLSS 附加超分。对没有原生 DLSS 的 RTX 游戏，可按引擎版本加入 MWSR、锐化强度和空间抗锯齿，并在预设中保留选择。MWSR 本身无需额外 DLSS / Intel 运行库。Encore 的无原生 DLSS 说明仍要求 RTX 20–50，此项属于空间超分能力。[Encore 使用条件](https://github.com/SilyNoMeta/rtx-encore/blob/v2.5.0/docs/GAMES-WITHOUT-DLSS.zh-CN.md) · [本项目的配置读写](../src/core/encore-config.js) |
| ANR FG B20 | 当前完整包和 OptiScaler 附加包均固定为 B18。B20 增加 scRGB HDR 和 Blackwell 模型。两种包要分别核对文件清单、已有 B18 的配置迁移与还原。对 Radeon 仍需检查游戏是否提供 ANR 可替换的 DLSS-G 入口。无原生补帧游戏继续依据现有 XeMFG、OptiFG 或 AFMF 条件判断。[上游模型清单](https://github.com/pandaligx/RTX-FG-Manager/blob/v4.3.39/rust/src/anr.rs) · [本项目的路线](../src/shared/install-routes.js) |
| Pipo sm86-10 | 组件资料页收录该独立 DX12 分支。两份发行包的 INI 均采用预设 C、内核模式 2，标准版采用 A、1。Pipo 作者公布了 RTX 3070 的测试，RTX 20 在该版本发布说明中列为待确认。[作者发布说明](https://github.com/pipotoufikxyz-lgtm/dlssg_for_sm86-MFG-version/releases/tag/sm86-10) · [参考项目的版本对照用例](https://github.com/pandaligx/RTX-FG-Manager/blob/v4.3.39/tests/v4337_upstream.rs) |
| 游戏发现和运行库界面 | 当前独立客户端的注册表扫描主要针对 HoYoPlay、Starward 和库洛。可以用发行商加游戏官网或已核实名称识别网易官服，同时保留同一游戏的 Steam 副本身份。现有游戏组件表已显示磁盘版本、路径与指纹，应用前预览也有修改前后值。可把所选目标版本放到同一行，并按文件位置展开多份副本，直接打开对应插件目录。[上游游戏平台识别](https://github.com/pandaligx/RTX-FG-Manager/blob/v4.3.39/rust/src/game_name_windows.rs) · [上游运行库界面](https://github.com/pandaligx/RTX-FG-Manager/blob/v4.3.39/rust/src/ui_runtime_files.rs) · [本项目的组件表](../ui/src/features/Games.tsx) |

### 已接入开发版

- ANR 完整包和附加包已切换到 B20。还原预览能识别 ANR 私有目录生成的 Vulkan 加载器，实际还原后可重新安装。B18 原包、B20 原包以及外置 OptiScaler 宿主分别参与升级与还原测试。
- Encore 2.5.0 在兼容的 RTX 游戏上提供 MWSR 空间超分、锐化和空间抗锯齿。首次仅选空间超分时按需部署引擎和声明文件。老版引擎按实际版本提供参数。[Encore 配置](ENCORE.md)
- 游戏库结合发行商、已核实的游戏名称或官网，以及本地可执行文件识别网易官服，保留不同商店的副本。失效图标、共享启动器和其他商店的卸载项有独立回归用例。
- 组件表按文件位置展示磁盘版本和目标版本。展开同名文件可分别核对位数、指纹与实际插件目录。ANR、Encore 和 F7 管理的文件显示安装记录。原生 NVIDIA 运行库与 ANR 私有库同名时，单独选版只更新可替换的原生副本。两份二进制版本号相同但内容不同时，目标栏显示指纹差异。

### Pipo DX12 实包核对

作者原包 SHA-256 为 `33033037ceda1c705a33e1ce718aa04921f92441cb463ba55554d40566419ec3`，RTX-FG-Manager 4.3.39 配套包为 `0a4a32462a6f694323a7bc5a5a4a28f38f8bb161551de08bb2433c05e8f03fe9`。按参考项目索引校验默认入口的 10 个文件，均符合索引。两份发行包的配置、两份 NVIDIA 运行库及两份许可共 5 项相同，加载器、后端和三份计算内核的指纹各异。[作者发行包](https://github.com/pipotoufikxyz-lgtm/dlssg_for_sm86-MFG-version/releases/tag/sm86-10) · [4.3.39 配套文件索引](https://github.com/pandaligx/RTX-FG-Manager/blob/v4.3.39/cloud/bundles/indexes/bundles-ca24fdfb2fac3099f61e.json)

原包的 `docs/INSTALL.en.md` 说明 RTX 20/30 路径会更改游戏读取的显卡架构。RTX 40/50 可保留真实架构，但帧数参数还会优先于驱动限制，两个发行包的后端均含相同的诊断说明。手册第 149 行将 0 列为跟随运行时，随包配置器却只接受 1–5。现有证据不足以验证保留驱动限制的安装方式，因此本项目将 Pipo 标为资料项。RTX 50 在支持的游戏和驱动上原生支持 DLSS 4.5 最高 6× 多帧生成。[Pipo 版本说明与原包](https://github.com/pipotoufikxyz-lgtm/dlssg_for_sm86-MFG-version/releases/tag/sm86-10) · [NVIDIA 对 RTX 50 原生 6× 的说明](https://www.nvidia.com/en-us/geforce/news/dlss-4-5-dynamic-multi-frame-generation-6x-mode-released/)
