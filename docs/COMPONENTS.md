# 组件来源与用途

在「组件」点某个版本，可查看作者项目、发布记录、本地文件和 NeuralFrame 的部署条件。下面列的是 **0.1.4** 的组件和配套依赖。作者、发布包提供者和下载镜像有时是三方，例如 sm86 的作者发布代码，RTX-FG-Manager 提供本版使用的完整包。

[超分与模型](#超分与模型) · [插件与帧生成](#插件与帧生成) · [加载器与配套工具](#加载器与配套工具) · [版本与入库](#版本与入库) · [参数手册](PARAMETERS.md)

## 超分与模型

| 组件 / 文件 | 解决什么问题、在什么条件下使用 | 作者项目与发布来源 |
| --- | --- | --- |
| DLSS 超分辨率（SR） · `nvngx_dlss.dll` | 将较低分辨率的渲染画面重建为输出画面。游戏已有 DLSS 时，可通过适配路线管理运行库。基准组合 310.9.1，更新组合 310.9.16。 | NVIDIA 提供 DLSS。组件库同时扫描 RankFTW 的发布包。[NVIDIA DLSS](https://github.com/NVIDIA/DLSS) · [RankFTW 发布库](https://github.com/RankFTW/rhi-repo/releases) |
| DLSS 帧生成（FG） · `nvngx_dlssg.dll` | 在受支持的路线中生成中间帧。原生路线需要游戏的 DLSS-G 接口提供运动矢量、深度等输入。与 SR 分开记录，可在游戏页分别核对磁盘版本。 | NVIDIA 提供运行库，RankFTW 发布库提供部分可发现版本。[NVIDIA DLSS](https://github.com/NVIDIA/DLSS) · [组件发布源](https://github.com/RankFTW/rhi-repo/releases) |
| DLSS 光线重建（RR） · `nvngx_dlssd.dll` | 在游戏接入 RR 时重建有噪声的光追画面。0.1.4 配套版本为 310.9.1。组件页可查看 RankFTW 发布的历史版本，按 SHA-256 校验后下载入库。游戏页按安装路线部署配套版本。某些 XeMFG 路线也能从游戏已启用的 RR 接口获取输入。 | [NVIDIA DLSS](https://github.com/NVIDIA/DLSS) · [RankFTW 历史包](https://github.com/RankFTW/rhi-repo/releases?q=dlssd) · [本版配套清单](../src/core/runtime-catalog.json) |
| NVIDIA Streamline · `sl.interposer.dll`、`sl.common.dll` 等 | 在游戏与各功能运行库间传递输入。DLSS-G 模块负责接入补帧，Reflex 和 PCL 模块按路线配套。管理器按组合处理 2.13 与 2.14.16。 | [NVIDIA Streamline](https://github.com/NVIDIA-RTX/Streamline) · [DLSS-G 集成说明](https://github.com/NVIDIA-RTX/Streamline/blob/v2.14.16/docs/ProgrammingGuideDLSS_G.md) |
| DLSS 神经渲染（NR） · `nvngx_dlssnr.dll` | 由兼容插件调用模型处理画面。选择时同时核对发布者、DLL 指纹和 GPU 架构；同名模型可能包含不同内核。 | [SmarterGamers 发布包](https://github.com/SmarterGamers/SmarterGamers-DLSS5-Swapper/releases) · [RankFTW 发布包](https://github.com/RankFTW/rhi-repo/releases) · [模型目录](../src/core/neural-models.js) |

### 模型列表怎么看

| 界面中的模型 | 版本身份与适用范围 |
| --- | --- |
| 310.8.SF-v2 · SmarterGamers / RankFTW | 两个独立文件，目录中的 DLL 版本分别为 310.8.0.0、310.8.2.0。均记录 sm_75、86、89、120，归档和 DLL 各有自己的指纹。 |
| 310.9.16 · RankFTW | 独立的 NR 模型，目录记录以上四种架构。选择同版本号的 SR 或 FG 运行库需要到运行库设置中操作。 |
| 310.8.0-RTX40 / 310.8.SF | 早期 Ada 移植版的目录记录为 sm_89、120；ShortFuse v1 另有 sm_75、86。可通过本地导入识别对应文件。 |
| 310.8.Lecram / 310.8.0 Stock | 目录标为 Blackwell sm_120。Stock 条目没有固定 DLL 指纹，遇到只有目录记录的模型，以实际文件检查和游戏页的适配结果为准。 |

## 插件与帧生成

| 组件 | 带来的功能与适用条件 | 作者项目与本版来源 |
| --- | --- | --- |
| RenoDX 神经渲染插件 | `renodx-dlss5.addon64` 在 ReShade 路线中调用 NR 模型，提供结构、色调、遮罩等画面控制。配套 8.5.0-rc10，模型单独选。 | ShortFuse 维护实现，RankFTW 提供构建。[RenoDX](https://github.com/clshortfuse/renodx) · [8.5.0-rc10](https://github.com/RankFTW/rhi-repo/releases/tag/renodx-dlss5-8.5.0-rc10) |
| RenoDX 多通道插件 / DLSS Tool | `renodx-dlss.addon64` 为多通道处理或适配的呈现路线提供另一种入口。配套 SF 26.1003.2350，游戏页依 EXE 位数和 API 列出路线。 | [ShortFuse / RenoDX](https://github.com/clshortfuse/renodx) · [RankFTW 多通道构建](https://github.com/RankFTW/rhi-repo/releases/tag/renodx-dlss-SF-26.1003.2350) |
| MFG 多帧生成插件 · RenoDX | `renodx-mfgunlock.addon64` 通过 ReShade 插件管理社区补帧。配套 1.5.5。RTX 20–40 的支持依后端和游戏而异，RTX 50 使用原生 MFG 控制。详情中的测试机型与驱动对应具体版本。 | [mavismmg / MFGAdaUnlock-RenoDx](https://github.com/mavismmg/MFGAdaUnlock-RenoDx) · [1.5.5 版本说明](https://github.com/mavismmg/MFGAdaUnlock-RenoDx/blob/1.5.5/docs/releases/1.5.5.md) |
| MFG 多帧生成插件 · Universal | `MFGUnlocker.dll` 提供独立加载、游戏内补帧控制和部分路线的 NR。《鸣潮》推荐 1.7.2，保留原游戏运行库。OptiScaler 的 DLSS MFG 插件有单独的 1.7.0 配套包；XeMFG 使用 1.7.2。 | [dashdogy / MFG-Unlocker 1.7.2](https://github.com/dashdogy/MFG-Unlocker/releases/tag/v1.7.2) · [1.7.0](https://github.com/dashdogy/MFG-Unlocker/releases/tag/v1.7.0) |
| Intel XeSS 帧生成与 XeLL | SDK 3.0.2 的 `libxess_fg.dll` 提供 XeFG 帧生成，`libxell.dll` 提供低延迟运行库。独立 XeMFG 搭配 MFG Unlocker 工作；插件模式还须识别可用的 OptiScaler 10 宿主与配套 Intel 文件。Radeon 能否使用取决于游戏开放的输入。 | [Intel XeSS SDK 3.0.2](https://github.com/intel/xess/releases/tag/v3.0.2) · [XeMFG 接入说明](https://github.com/dashdogy/MFG-Unlocker/blob/v1.7.2/docs/xemfg.md) |
| ANR FG · 完整包 | 带宿主、ANR 提供程序、模型与配置。0.1.4 配套 B20，目标是有原生 DLSS-G 输入的 64 位 DX12 / Vulkan 游戏。支持的 Radeon 等 FP16 显卡可使用 ANR 补帧；联用 DLSS 神经渲染还须原生 DLSS 超分和兼容 NVIDIA GPU。 | [apex-compute / ANR](https://github.com/apex-compute/ANR) · [B20 完整包与插件包](https://github.com/apex-compute/ANR/releases/tag/FG-V.B20) |
| ANR FG · OptiScaler Add-on | 同作者的轻量插件包，只补齐 ANR 提供程序与模型。管理器先检查目标 EXE 能加载的现有宿主是否支持自定义提供程序。完整包和 Add-on 分别记录 B01–B20 历史。 | [apex-compute / ANR 发布历史](https://github.com/apex-compute/ANR/releases) |
| Dlssg_for_sm86 · 标准版 | 在有 DLSS-G 输入的 64 位 DX12 游戏中，为 GeForce RTX 提供 DLSS / XeSS 补帧引擎选择。0.1.4 配套 0.4.2，按完整目录部署后端、内核和配置。 | sdli1995 发布原项目，pandaligx 提供本版使用的完整包。[原作者 0.4.2](https://github.com/sdli1995/dlssg_for_sm86/releases/tag/0.4.2) · [RTX-FG-Manager 配套包](https://github.com/pandaligx/RTX-FG-Manager/releases/tag/payloads) |
| Dlssg_for_sm86 R3 · 三角洲 / 迈尔斯 | 配套 `0.4.2+rtxfg.3`。三角洲渲染程序可走 DX12 或 Vulkan，使用私有运行库。Steam 版《迈尔斯》走 DX12，并可同步该游戏的 NVIDIA 倍率。Pipo sm86-10 另有独立的版本资料。 | [pandaligx / RTX-FG-Manager](https://github.com/pandaligx/RTX-FG-Manager/releases/tag/payloads) · [Pipo 独立发布](https://github.com/pipotoufikxyz-lgtm/dlssg_for_sm86-MFG-version/releases/tag/sm86-10) |
| XeMFG 配套 OptiScaler 10 宿主 | RTXManager 的 MFG 1.7.2 配套包包含作者的宿主 DLL 与许可说明。仅在游戏页勾选「同步更新已识别的 OptiScaler 宿主」时替换。 | [dashdogy / OptiScaler](https://github.com/dashdogy/OptiScaler) · [RTXManager 配套包](https://github.com/pandaligx/RTX-FG-Manager/releases/tag/payloads) |
| RTX Encore | 为缺少原生帧生成的离线 RTX 游戏提供可选后端。可分别配置帧生成、NR 和附加超分。2.5.0 增加 MWSR、NIS、FSR 1 和空间抗锯齿；2.3.0、2.4.1、2.4.2 保留各自支持的设置。 | SilyNoMeta 发布原始引擎包。[RTX Encore 2.5.0](https://github.com/SilyNoMeta/rtx-encore/releases/tag/v2.5.0) · [本项目接入范围](ENCORE.md) |
| OptiScaler · DLSS-NR / Pre-SR Multipass | 作为超分和插件宿主，读取游戏已有输入。DLSS-NR 有 0.2.0-patch1 与历史 0.1.1.5 构建；0.8.92-presr 提供超分前多通道处理。游戏页按构建选择，XeMFG 插件另有宿主要求。 | [Dagherbou / DLSS-NR](https://github.com/Dagherbou/OptiScaler_DLSSNR) · [wilsjo2 / Pre-SR](https://github.com/wilsjo2/OptiScaler-DLSSNR-PreSR-Multipass) · [jlrouzies-fr 配套构建](https://github.com/jlrouzies-fr/OptiScaler-DLSSNR-PreSR-Multipass/releases/tag/v0.8.92) |
| OptiFG · AMD FSR 帧生成 | 使用已识别 OptiScaler 宿主随附的 AMD 运行库。64 位 DX12 游戏开启宿主能读取的时间超分后，管理器配置 Upscaler 输入和 FSR FG 输出。该路线复用已有文件。 | [OptiScaler 宿主配置](https://github.com/Dagherbou/OptiScaler_DLSSNR/blob/v0.2.0-patch1/OptiScaler.ini) · [本项目游戏条件](GAME-ROUTES.md) |
| AFMF · 驱动补帧 | AMD 驱动直接生成中间帧。符合条件时游戏页提供 AMD Software 设置指引，开关由用户在驱动里按游戏设置。 | [AMD Fluid Motion Frames](https://www.amd.com/en/products/software/adrenalin/afmf.html) |

## 加载器与配套工具

| 组件 | 在游戏或管理器中的作用 | 来源 |
| --- | --- | --- |
| ReShade 加载器 | 加载与游戏位数和 API 匹配的 add-on、着色器和 Home 菜单。Vulkan 使用对应架构的模块和图层文件。组件页按官方源码标签列出历史版本；当前可下载、随路线部署的配套包是 6.8.0。 | [crosire / ReShade](https://github.com/crosire/reshade) · [官方版本标签](https://github.com/crosire/reshade/tags) |
| Feeder 1.17 / 1.19 | `dlss5-feed.addon32/64`、`DLSS5_Feed.fx` 和需要时使用的 64 位辅助宿主协作，把游戏图像和运动数据提供给渲染插件。32 位游戏的客户端与宿主须配套。 | [jlrouzies-fr / DLSS5-Feeder](https://github.com/jlrouzies-fr/DLSS5-Feeder/releases) |
| dgVoodoo2 | 为特定老 DirectX / DirectDraw 游戏转换图形接口，让 Feeder 和 ReShade 能接入。程序按需从作者处获取 2.87.5。 | [dege-diosg / dgVoodoo2](https://github.com/dege-diosg/dgVoodoo2/releases/tag/v2.87.5) |
| vort Shaders / LumeniteFX | 在适配的 Feeder 路线上估算画面运动，供缺少原生运动数据的游戏使用。vort 随配套着色器提供，LumeniteFX 从作者固定修订下载。 | [vortigern11 / vort Shaders](https://github.com/vortigern11/vort_Shaders) · [umar-afzaal / LumeniteFX](https://github.com/umar-afzaal/LumeniteFX/tree/f8cbbb4eccfcb7adf0d74bb358ba349272e3c1e9) |
| 32 位 WinMM 预加载器 | 在适配的旧游戏中提前加载兼容组件，部分游戏有专用兼容设置。本版由 NeuralFrame 从 Enhanced 来源适配并编译。 | [Enhanced 上游](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced) · [本版 WinMM 源码](../src/native/dgv_preload32/) |
| 中文面板适配层 / F7 性能监控 | 内置 `dlss5-zh-cn.addon32/64` 提供中文控件、单遍调校和 F7 浮窗。F7 随 Enhanced 2.3.5 引入，NeuralFrame 维护适配实现。 | [Enhanced F7 来源](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced/releases/tag/v2.3.5) · [Yukikaze20170315 翻译](https://github.com/Yukikaze20170315/RenoDX-DLSS5-Generic) · [本版源码](../overlay/zh-cn-overlay.cpp) |
| F8 紧凑叠加层 | 内置 64 位 ReShade 桥接 `dlss5-lab-overlay.addon64`，把游戏当前可用的参数连接到管理器绘制的面板。需要管理器运行。 | [本项目 F8 源码](../overlay/overlay.cpp) · [ReShade](https://github.com/crosire/reshade) · [Dear ImGui](https://github.com/ocornut/imgui) |
| 模拟器与 Vulkan 部署档案 | 部分模拟器识别和 Feeder 安装逻辑源于 DLSS5-Autopilot，已整合进管理器。 | [Kizzuwatnaa / DLSS5-Autopilot](https://github.com/Kizzuwatnaa/DLSS5-Autopilot) |
| 桌面界面与配置编辑 | Electron 运行桌面应用，React 绘制主界面，Lucide 提供图标，jsonc-parser 让 Encore 配置可在保留注释的情况下更新。 | [Electron](https://github.com/electron/electron) · [React](https://github.com/facebook/react) · [Lucide](https://github.com/lucide-icons/lucide) · [Microsoft / jsonc-parser](https://github.com/microsoft/node-jsonc-parser) |

## 版本与入库

- **配套包**指本版已经选定的文件组合。清单有 21 个按需下载包，另有中文适配与预加载器、MFG 许可证两个内置条目。F8 桥接随应用单独提供。部分配套包托管在 NeuralFrame 的发行存档，其余按清单指向作者或整包发布方。[包地址、上游、大小和 SHA-256](../src/core/runtime-catalog.json)
- **历史版本**来自「检查更新」。例如 ANR 按完整包与插件包分别扫描，sm86 同时看原作者与 RTX-FG-Manager，XeSS 查 Intel SDK 发行包。只有发布记录的条目可以用来查来源；能否下载和应用请看该行状态。[版本发现规则](../src/core/component-definitions.js)
- **组合按需下载**表示所选功能用到这个组件时，游戏页会列出缺少的包，下载校验后再预览文件变更。已准备的组件会复用缓存。[组合依赖清单](../src/core/runtime-payload.js)
- 游戏页「组件与版本」默认跟随推荐组合。在「自定义组件版本」中可为当前游戏已识别的文件指定已入库、位数匹配的版本。清除指定版本后，下次应用配置时使用组合版本。恢复已写入的文件可用回滚或恢复原始文件。[版本身份与适配](../src/core/component-compatibility.js)
- **游戏已加载**需要在启动游戏后检查。项目说明里的测试记录标有版本和环境，选择同名插件、不同版本或不同 GPU 时应查看各自记录。[版本测试资料](../src/shared/component-evidence.js) · [第三方许可](../THIRD_PARTY_NOTICES.md)
