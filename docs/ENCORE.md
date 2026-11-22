# RTX Encore 接入（推荐 2.5.0）

在游戏页的「画质与补帧 → 安装与运行环境」选择 **RTX Encore**。首次安装推荐 2.5.0，已有安装保持当前引擎。可显式选择推荐版本，或选择已入库的原版 2.3.0、2.4.1、2.4.2。关闭游戏后调整参数，点击「预览并应用 Encore 配置」，检查变更并确认。重新启动游戏后按 **Insert** 打开 Encore 面板。

## 当前范围

Encore 仅供离线游戏使用。应用检查目标目录与程序附近的反作弊组件，发现已知保护时阻止预览和部署。无法由文件判断的在线模式请按作者要求避开。[上游安装说明](https://github.com/SilyNoMeta/rtx-encore/blob/v2.5.0/docs/INSTALLATION.md)

在无原生 DLSS 超分的目标中，2.5.0 提供 **MWSR、NIS、FSR 1**。选择空间超分时将输出设为屏幕分辨率。DX11 / DX12 游戏需以同宽高比的小窗口运行，每个维度最多放大两倍。Vulkan 需要游戏使用兼容的呈现格式。只开启空间超分时，首次安装只部署 Encore、对应的第三方声明与 JSONC。参数可随 Encore 预设导出和导入。[上游使用指南](https://github.com/SilyNoMeta/rtx-encore/blob/v2.5.0/docs/GAMES-WITHOUT-DLSS.md)

空间锐化范围为 0–100%，默认 30%。SMAA 1x 和 FXAA 3.11 都能在缩放前或缩放后运行，HUD 也参与处理。SMAA 另有低、中、高、极高四档。应用会保留其他锐化设置和游戏中的独立调参。游戏内效果取决于实际呈现路径。[上游配置字段](https://github.com/SilyNoMeta/rtx-encore/blob/v2.5.0/docs/SETTINGS.md#superresolutionsharpening)

- 首批适配 Windows 上的 64 位 DX11、DX12、Vulkan、NVIDIA RTX 20/30/40/50 系列。游戏目录未发现原生 FG 文件才开放新增帧生成路线；这是文件检查，不是完整的引擎能力证明。
- 新增 DLSS 帧生成 Off / 2–6×，5–6× 标记实验性；运动估计选择游戏矢量（缺失时回退）、Encore、vort Shader、NVIDIA Optical Flow 质量/速度。
- 无原生 DLSS SR 时可选择附加 DLSS（游戏分辨率 / DLAA），已有原生 SR 时默认跟随游戏，也可显式设置比例覆盖。NR 可独立开启，支持模型选择、工作分辨率、33–100% 自定义比例与 1–4 次处理；仍校验模型文件指纹和实际 GPU 架构。当前仅接受 310.8.0 / 310.9.16 模型协议。
- 首批不开放 XeSS/XeFG、Smooth Motion、驱动文件移植、自动修改游戏引擎配置或全量 Encore 设置。Intel 引擎的运行库未随此 NVIDIA 适配路线准备，不应在游戏内切换这些引擎。
- 2.4.1 开放每遍 NR 的 `inherit / before-sr / after-sr / present` 位置；混合位置需要兼容的原生 DLSS，超分前路线不支持 RR / DLAA。原生 DLSS SR 的 `dlssRenderScale=custom` 比例范围为 33–100%，2.3.0 为 50–100%。这与 NR 自身 33–100% 的工作分辨率比例是两项不同设置。无原生 SR 的附加 DLSS 仍使用游戏分辨率 / DLAA。切换版本时不兼容的已启用配置会明确拒绝，不静默忽略或夹值。
- 已有原生补帧的游戏继续使用现有路线；鸣潮（包括缺官服资源清单的渠道）保留独立加载，前后端均拒绝 Encore。不会替换其启动器校验文件。

## 部署与配置保护

组件检查更新读取作者的发行仓库。2.5.0 原包 SHA-256 为 `249a22ff63bbbeedc29d1509c1f7bb21570e18cf09a1ae3eeba775855beacbda`，主 DLL 为 `58fff4489e2222cb263e17142613693869acec458e0fa0b7ab260482fbf8c762`。清单另行校验该版第三方声明。历史引擎保留各自的文件指纹与声明，游戏页仅应用已适配的指纹。[官方 2.5.0 发行包](https://github.com/SilyNoMeta/rtx-encore/releases/tag/v2.5.0)

加载文件按 `version.dll`、`dinput8.dll`、`winmm.dll`、`dxgi.dll` 顺序选择空闲名称，只部署一份。保留其他工具占用的代理；发现未知 Encore、MFG、OptiScaler、RenoDX NR 或 Feeder 冲突时拒绝叠装。首批尚无手动覆盖代理名称入口。

开发环境可将作者的 `RTX-Encore-v2.5.0.zip` 放入 `vendor/component-cache/`。采集脚本校验压缩包、主 DLL 和声明，再写入 `payload/enhanced/encore/`。发行版仍通过组件库从作者的发行页按需获取。

新增 FG 固定使用 `nvngx_dlssg.dll` 310.9.16 及 Streamline 2.14.16 的 `sl.interposer.dll`、`sl.common.dll`、`sl.dlss_g.dll`、`sl.reflex.dll`、`sl.pcl.dll`。这些文件位于所选 EXE 旁。未知同名文件不覆盖，原有深层 DLSS/Streamline 文件不替换。组件页可以准备 Encore 缓存，实际应用由游戏页统一管理；存在其他运行库版本覆盖时给出提示并保留原选择。

`rtx-encore.jsonc` 按 v4 协议增量修改，仅更新页面负责的参数。保留注释、菜单、风格、曝光、处理顺序和未知字段；格式损坏、重复字段或不支持的协议会停止写入。启用新增 FG 时关闭 Smooth Motion，避免双重补帧。未应用的普通路线草稿与 Encore 草稿分开保存；Encore 草稿还按游戏和 EXE 分别保留，切换目标不会串用倍率或神经渲染参数。

新配置推荐自定义 NR 比例 75%；读取已有配置时，缺失的比例沿用上游默认 67%，避免一次补帧修改改变已有 NR 行为。NR 关闭时不要求修改其隐藏参数。已有原生 SR 的游戏仍可关闭从游戏内或外部工具开启的附加 SR。目标失效、检测到原生 FG 或参数不适配时保留当前后端选择，并在应用前说明原因。

已开启新增 FG 的已有配置，`mode: game`（包括省略 `mode`）按上游规则读取为 2×；`mode: fixed` 省略 `multiplier` 时读取为默认 4×。调整神经渲染后保存仍保留该倍率；动态倍率和 XeFG 等未适配设置继续提示不支持。

文件变更接入现有预览、版本锁定、归属记录、失败回滚和卸载恢复。切换路线保存各自配置。还原或切换前重新核对已部署文件的指纹：其他工具后来修改的文件会保留并中止操作；游戏内可编辑的 JSONC 不按不可变文件处理。重复加载检查也覆盖 EXE 旁的其他 DLL/ASI 及 `plugins`、`scripts` 中的加载文件。Vulkan 路线切换仍遵循原来的共享图层保护，可能需要先还原；Encore 自身不注册 ReShade 全局 Vulkan 图层。

## 验证与限制

自动化覆盖 JSONC 保留、模型/配套指纹、模拟游戏真实文件部署、预览无写入、失败回滚、恢复、鸣潮隔离、DX11/DX12/Vulkan 路由，以及真实 IPC 的按需准备和多 EXE 切换流程。Electron 界面流程检查后端选择、取消/确认、切页、切游戏和切 EXE 保留草稿，以及失效目标的应用拦截。

页面的「已部署 · 待运行验证」表示文件及配置状态，**不表示已经成功渲染或输出对应倍率**。运行诊断可以枚举加载文件；Encore 自己的遥测协议暂未适配为执行计数。Encore 状态使用自身的依赖和 API 条件，不套用原生 DLSS-G 的 DX11 限制、RenoDX 依赖或显存估算；模型架构不兼容及其他加载器冲突仍会提示。

诊断导出包含其 JSONC、`rtx-encore-logs/rtx-encore-status.json` 及已知名称的会话/崩溃文本日志（存在时）。每个日志目录最多取最近 3 份普通日志和 3 份崩溃日志，单文件保留末尾 256 KiB；不导出内存转储及指向外部文件的链接。实际生效、画质、HUD、帧率、延迟和稳定性需要在具体游戏内核对。本轮不写入真实游戏、不打包、不发布。

依据：[v2.3.0 安装说明](https://github.com/SilyNoMeta/rtx-encore/blob/v2.3.0/docs/INSTALLATION.md)、[无原生 DLSS 游戏](https://github.com/SilyNoMeta/rtx-encore/blob/v2.3.0/docs/GAMES-WITHOUT-DLSS.md)、[配置协议](https://github.com/SilyNoMeta/rtx-encore/blob/v2.3.0/docs/SETTINGS.md)。
