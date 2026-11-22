# 开发版游戏路线与 F7 监控

## 游戏内面板与可选帧生成

F7 由 Enhanced v2.3.5 的中文 ReShade 插件引入。该版本的便携包和安装包都包含双架构插件。NeuralFrame 自行构建适配版，可以在「叠加层 → F7 性能监控 → 导出插件文件」保存 32 位或 64 位文件。[上游 F7 实现](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced/blob/ea23fd10f1c66aa8224fbeefbba89ae7026e6db1/overlay/zh-cn-overlay.cpp#L1111) · [原始发布](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced/releases/tag/v2.3.5)

在「叠加层 → F7 性能监控」可为所选程序预设四角位置和显示模式，再预览安装。游戏中按 F7 切换模式，按 Home 调整位置。NVIDIA 整卡显存按渲染设备 LUID 匹配，无法取得时显示 DXGI 进程用量和预算。延迟读数标明 Reflex 输入至 GPU 或 DXGI 排队估计。

游戏页的补帧卡片按当前程序提供 NVIDIA DLSS 帧生成和 ANR 引擎选择，安装与运行环境中也可选择 Dlssg_for_sm86。RenoDX 单遍路线提供四个预设。

ANR FG B20 提供完整包和供已有 OptiScaler 宿主使用的附加包，增加 scRGB HDR 与 Blackwell 模型。游戏必须提供可用的 DLSS-G 输入，附加包还会检查当前游戏程序能加载的宿主及其自定义提供程序能力。可从 B18 预览升级并保留已有配置。在游戏中启用 NVIDIA 帧生成，按 Insert 打开 OptiScaler。已有原生 DLSS 超分的游戏可在完整包中另外启用 DLSS 神经渲染。sm86 0.4.2 标准包用于 DX12，三角洲专版提供 DX12 和 Vulkan。实际倍率由游戏和驱动决定。

组件资料页另列 Pipo sm86-10 的 DX12 发布记录。Pipo 默认使用预设 C、内核模式 2，作者的实机记录来自 RTX 3070。两份发行包的帧数配置均优先于驱动限制，NeuralFrame 将该分支保留为参考资料。[文件核对与适配结论](UPSTREAM-COMPARISON-2026-11-17.md#pipo-dx12-实包核对)

## Radeon 与没有原生补帧的游戏

游戏页的「画质与补帧」会按所选的 64 位游戏程序显示可用组件。XeMFG 使用 MFG Unlocker 1.7.1 和 Intel XeFG，OptiFG 则使用 OptiScaler 宿主自带的 AMD FSR 帧生成。遇到带反作弊保护的游戏会停止部署。[XeMFG 上游安装说明](https://github.com/dashdogy/MFG-Unlocker/blob/v1.7.1/docs/install.md) · [OptiFG 输入和输出设置](https://github.com/Dagherbou/OptiScaler_DLSSNR/blob/v0.2.0-patch1/OptiScaler.ini#L16-L38)

| 游戏和已有组件 | 可选路线 | 游戏内操作 |
| --- | --- | --- |
| DX12，有可启用的 DLSS、XeSS 或 FSR 3.1 及更新版超分，或可用的原生 DLSS-G、DLSS 光线重建接口 | 独立 XeMFG，按需准备 Intel XeSS SDK 3.0.2 的 FG 与 XeLL 运行库 | 启用游戏实际提供的输入。使用超分输入时，关闭游戏自带的 FSR 或 XeSS 补帧。管理器默认 2×，可设至 6×。 |
| Vulkan，游戏实际开放 DLSS 超分或光线重建输入 | 独立 XeMFG | 启用游戏提供的对应模式。只有 XeSS、FSR 或 DLSS-G 文件时，独立路线缺少可读的 Vulkan 输入。 |
| DX12，已有已识别的 OptiScaler 10 宿主、配套 Intel 运行库和可用的超分输入 | XeMFG 插件 | 配置使用 Upscaler 输入、XeFG 输出，在 OptiScaler 游戏内菜单设置倍率。Vulkan 的插件路线另需作者适配版宿主。 |
| DX12，已有 0.2.0-patch1 或 0.8.92-presr 宿主及配套 AMD 运行库，游戏提供可读取的超分输入，包括部分以 DLL 提供 FSR 2 或 FSR 3.0 的游戏 | OptiFG · AMD FSR 帧生成 | 在游戏中启用超分，在 OptiScaler 菜单查看补帧状态。该路线复用宿主的 AMD 运行库。 |
| 游戏缺少上述输入，Windows 使用受支持的 Radeon RX 显卡或 Radeon 700M / 800M 系列核显 | 驱动补帧 AFMF | 在 AMD Software 中按游戏开启。RX 6000 系列需要独占全屏。 |

独立路线会在游戏程序旁放置 `version.dll` 和 `RTXMFG-XeSS` 目录。重启游戏后按 Backspace，可在 XeMFG 菜单中查看输入和运行状态。部分游戏只加载上游列出的其他文件名，管理器的独立部署目前只覆盖能加载 `version.dll` 的游戏。插件路线复用已安装的宿主，保留玩家的其他 INI 设置。[上游逐游戏加载兼容表](https://github.com/dashdogy/MFG-Unlocker/blob/v1.7.1/docs/compatibility.md#games)

独立 XeMFG 无法读取内置的 FSR 2 或 FSR 3.0。OptiFG 对旧 FSR 的自动识别要求匹配的超分库和 DX12 后端。静态集成、DX11 版 XeSS 或单独的 FG 库都不足以确认该路线。DX12 的 XeMFG 还需要显卡和驱动支持 Shader Model 6.4。缺少深度或合适的运动矢量时，实际补帧可能无法启动。缺少无 HUD 画面时，界面会随场景一起插值。[OptiFG 如何读取超分输入](https://github.com/Dagherbou/OptiScaler_DLSSNR/blob/v0.2.0-patch1/OptiScaler/inputs/FG/Upscaler_Inputs_Dx12.cpp) · [XeMFG 输入与限制](https://github.com/dashdogy/MFG-Unlocker/blob/v1.7.1/docs/xemfg.md) · [OptiScaler 宿主要求](https://github.com/dashdogy/MFG-Unlocker/blob/v1.7.1/docs/optiscaler.md) · [AMD AFMF 条件](https://www.amd.com/en/products/software/adrenalin/afmf.html)

引擎及组件随原始发布包附带许可。版本资料见 [ANR FG B20](https://github.com/apex-compute/ANR/releases/tag/FG-V.B20)、[Dlssg_for_sm86 0.4.2](https://github.com/sdli1995/dlssg_for_sm86/releases/tag/0.4.2)、[RTX-FG-Manager 4.3.39](https://github.com/pandaligx/RTX-FG-Manager/releases/tag/v4.3.39) 和 [Enhanced 2.3.5](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced/releases/tag/v2.3.5)。
