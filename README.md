# NeuralFrame

NeuralFrame 0.1.2 是集成社区与开源项目图形组件的 Windows x64 游戏画质工具，面向 RTX 20–50 系列显卡，按游戏管理神经渲染（NR）、多帧生成（MFG）、DLSS 超分辨率与配套运行库。应用前可以预览文件变更，并保留备份、回滚和恢复能力。

RTX 20–40 可通过相应组件解锁支持的多帧生成路线；RTX 50 已原生支持多帧生成，NeuralFrame 为其提供参数、运行库与神经渲染组件管理，不将原生功能称为解锁。具体可用功能仍取决于显卡架构、游戏输入、图形 API、驱动与所选组件。

**[下载 0.1.2](https://github.com/lxl2000927/NeuralFrame/releases/tag/v0.1.2)** · [项目进度与待办](PROJECT_STATUS.md) · [开发与构建](docs/BUILDING.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

## 下载与使用

| 文件 | 用途 |
| --- | --- |
| `NeuralFrame-0.1.2-Portable-x64.exe` | 直接运行的便携单文件 |
| `NeuralFrame-0.1.2-Setup-x64.exe` | 支持选择路径、创建快捷方式及卸载的安装程序 |
| `NeuralFrame-0.1.2-Source.zip` | 带已验证原生启动组件与 F8 桥接的源码，可用于重新打包 |
| `SHA256SUMS.txt` | 三个发布文件的 SHA-256，可用 PowerShell 的 `Get-FileHash` 对照 |

1. 打开「游戏」，选择自动识别的游戏，或手动添加游戏目录。遇到带反作弊的游戏，先查看该游戏说明并确认游戏方允许第三方插件。
2. 在「画质与补帧」选硬件档位、神经渲染模型和补帧倍率。组件缺失时按提示下载。关闭游戏后，查看变更预览并应用。
3. 重启游戏、进入实际场景，在「运行诊断」查看进程模块、插件日志和倍率证据。需要 F8 面板时，先在「叠加层」启用随游戏安装，保持管理器运行，再使用设置中的热键。
4. 配置验证稳定后可锁定组件版本。要撤回组件更新，使用「组件与版本」里的回滚。要还原整套部署，关闭游戏后选择恢复原状，并保留游戏目录中的 `_DLSS5_Backup`。

## 各页面解决什么问题

独立档位页已合并到设置和游戏页；具体画质参数按游戏保存。

| 页面 | 可以做什么 |
| --- | --- |
| 首页与游戏 | 浏览封面、搜索或按平台筛选、定位目录。各游戏独立调节档位、模型、运行库栈与补帧参数；NR 和 MFG 可分别预览、应用。可比较原生 DLSS、ReShade、Feeder 与适配的 OptiScaler 路线。 |
| 组件与附加组件 | 按种类、名称、来源、本地状态和应用条件筛选；分别查看项目说明、软件部署支持和本地文件状态。右侧详情提供支持范围、测试记录和原项目说明链接；历史版本折叠保留，具体使用版本在游戏页选择。 |
| 叠加层 | 预览主题，设置游戏内面板热键，管理内置桥接及自定义面板。面板能调哪些参数取决于游戏实际加载的插件。 |
| 运行诊断与历史 | 区分磁盘已安装、进程已加载和已观测到生效。查看操作时间、类型与文件变更，导出诊断，或清除历史记录。 |
| 设置 | 查看物理硬件和显示器。管理扫描目录、排除项、语言、外观、窗口记忆及托盘行为。档位和画质参数统一在游戏页设置，未配置游戏自动匹配硬件。界面支持简体中文与 English。 |

首页提供“扫描游戏库”，组件页提供“检查更新”，运行诊断提供“立即检测”；游戏文件重扫位于“更多操作”。切回窗口会更新当前页的本地列表或运行状态，保留筛选和未应用的修改，不会自动联网检查更新或应用配置。

运行时证据有边界。DLL 在磁盘上只能证明安装；进程加载模块可以证明加载；有效倍率需来自当前游戏会话。显存预算以 1080p 为参考，实际占用取决于游戏、分辨率和画质设置。手选倍率和档位都不能保证输出帧率或兼容所有游戏。

## 引用项目与插件组件

NeuralFrame 从 skyi7943-cmd 的 Enhanced 2.3.0 代码继续开发。其基础包含 Rakan Alkhaldi 的 DLSS 5 Swapper（截至 v2.2.9 的 MIT 代码）。桌面界面、按需组件库、运行诊断和事务式部署由本分支继续维护。NVIDIA App 用作桌面布局参考。[直接上游](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced) · [原始版权声明](LICENSE)

| 项目 / 组件 | 在 NeuralFrame 中的用途 | 来源 |
| --- | --- | --- |
| NVIDIA Streamline、DLSS / NGX | 提供 SR、FG、RR 等运行库和游戏集成接口；组件目录记录具体版本。 | [Streamline](https://github.com/NVIDIA-RTX/Streamline) · [DLSS](https://github.com/NVIDIA/DLSS) |
| RenoDX DLSS 5 / DLSS Tool | 通用和多通道神经渲染插件。NR 模型 DLL 独立选择，以文件 SHA-256 区分模型。 | [ShortFuse / RenoDX](https://github.com/clshortfuse/renodx) · [RHI 发布源](https://github.com/RankFTW/rhi-repo/releases) |
| SmarterGamers 模型发布包 | 提供独立标注来源的 NR 模型；与 RankFTW 同名版本分别记录下载包和 DLL 指纹。 | [SmarterGamers 发布源](https://github.com/SmarterGamers/SmarterGamers-DLSS5-Swapper/releases) |
| MFGAdaUnlock-RenoDx 1.5.5 / MFG-Unlocker | 独立维护的补帧插件。鸣潮独立加载推荐原版 1.7.1，可保留或选择已适配历史版本；OptiScaler ASI 单独保留 1.7.0。 | [mavismmg](https://github.com/mavismmg/MFGAdaUnlock-RenoDx) · [dashdogy](https://github.com/dashdogy/MFG-Unlocker) |
| RTX Encore | 无原生补帧游戏的可选后端，原仓库发现更新；推荐 2.4.1，保留已适配 2.3.0。 | [SilyNoMeta](https://github.com/SilyNoMeta/rtx-encore) |
| ReShade、DLSS5-Feeder 1.17 / 1.19 | 加载游戏内 add-on，通过着色器和辅助进程把相应输入送入渲染链。 | [ReShade](https://github.com/crosire/reshade) · [DLSS5-Feeder](https://github.com/jlrouzies-fr/DLSS5-Feeder) |
| OptiScaler DLSS-NR 与 Pre-SR Multipass | 提供可选的替换和多通道路线，按游戏、图形 API 与所选版本部署。 | [DLSS-NR](https://github.com/Dagherbou/OptiScaler_DLSSNR) · [Pre-SR 上游](https://github.com/wilsjo2/OptiScaler-DLSSNR-PreSR-Multipass) · [配套构建](https://github.com/jlrouzies-fr/OptiScaler-DLSSNR-PreSR-Multipass) |
| dgVoodoo2、LumeniteFX、vort Shaders | 分别用于特定旧版 DirectX 转换、可选光流和 Feeder 运动估计。 | [dgVoodoo2](https://github.com/dege-diosg/dgVoodoo2) · [LumeniteFX](https://github.com/umar-afzaal/LumeniteFX) · [vort Shaders](https://github.com/vortigern11/vort_Shaders) |
| DLSS5-Autopilot | 部分模拟器档案与 Vulkan / Feeder 安装逻辑的来源。 | [DLSS5-Autopilot](https://github.com/Kizzuwatnaa/DLSS5-Autopilot) |
| 中文适配、WinMM 预加载器、F8 桥接 | 中文词条包含上游翻译和本地补充；预加载器服务特定 32 位路线；F8 桥接连接游戏与管理器。 | [翻译来源](https://github.com/Yukikaze20170315/RenoDX-DLSS5-Generic) · [桥接源码](overlay/) · [WinMM 源码](src/native/dgv_preload32/) · [Dear ImGui](https://github.com/ocornut/imgui) |
| Electron、React、Lucide | 桌面运行环境、界面组件与图标。 | [Electron](https://github.com/electron/electron) · [React](https://github.com/facebook/react) · [Lucide](https://github.com/lucide-icons/lucide) |

本版有 **16 个按需运行包**。应用随带中文适配、WinMM 预加载器、F8 桥接及相关许可。配套运行包以清单固定大小与 SHA-256；在线发现的版本先进入组件库，只有程序已接入且满足游戏与硬件条件的版本才能应用。管理器代码使用 MIT 许可，第三方文件分别遵循其随附许可。[组件版本与哈希](src/core/runtime-catalog.json) · [早期配套包存档](https://github.com/lxl2000927/NeuralFrame/releases/tag/runtime-components-2026.11.06) · [完整声明](THIRD_PARTY_NOTICES.md)

## 数据与开发

游戏列表、设置和组件索引沿用 `%APPDATA%\dlss5-swapper-enhanced`。游戏原始备份保存在对应游戏目录。卸载管理器前，如果需要撤销插件部署，请先在游戏页执行恢复。

桌面界面见 `ui/src/`，Electron 入口是 `main.js` 和 `preload.js`，安装、组件、回滚和诊断逻辑在 `src/core/`。本地启动、原生资源准备和测试命令见[开发与构建](docs/BUILDING.md)。
