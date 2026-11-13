# RTX Encore 接入（调试版，推荐 2.4.1）

游戏页 → 画质与补帧 → 安装与运行环境 → 渲染后端选择 **RTX Encore**。引擎版本区分别显示已安装、推荐和上次检查得到的上游最新版本。首次安装推荐 2.4.1；已有安装默认保持原版，只有明确选择推荐或库内已适配版本才换版。保留原版 2.3.0 选择。选择本身不下载、不写游戏文件；调整参数后点击「预览并应用 Encore 配置」，按需准备组件、检查变更、确认后部署。需要关闭游戏，应用后重新启动，游戏内按 **Insert** 打开 Encore 面板。

## 当前范围

- 首批适配 Windows 上的 64 位 DX11、DX12、Vulkan、NVIDIA RTX 20/30/40/50 系列。游戏目录未发现原生 FG 文件才开放新增帧生成路线；这是文件检查，不是完整的引擎能力证明。
- 新增 DLSS 帧生成 Off / 2–6×，5–6× 标记实验性；运动估计选择游戏矢量（缺失时回退）、Encore、vort Shader、NVIDIA Optical Flow 质量/速度。
- 无原生 DLSS SR 时可选择附加 DLSS（游戏分辨率 / DLAA），已有原生 SR 时默认跟随游戏，也可显式设置比例覆盖。NR 可独立开启，支持模型选择、工作分辨率、33–100% 自定义比例与 1–4 次处理；仍校验模型文件指纹和实际 GPU 架构。当前仅接受 310.8.0 / 310.9.16 模型协议。
- 首批不开放 XeSS/XeFG、Smooth Motion、驱动文件移植、自动修改游戏引擎配置或全量 Encore 设置。Intel 引擎的运行库未随此 NVIDIA 适配路线准备，不应在游戏内切换这些引擎。
- 2.4.1 开放每遍 NR 的 `inherit / before-sr / after-sr / present` 位置；混合位置需要兼容的原生 DLSS，超分前路线不支持 RR / DLAA。原生 DLSS SR 的 `dlssRenderScale=custom` 比例范围为 33–100%，2.3.0 为 50–100%。这与 NR 自身 33–100% 的工作分辨率比例是两项不同设置。无原生 SR 的附加 DLSS 仍使用游戏分辨率 / DLAA。切换版本时不兼容的已启用配置会明确拒绝，不静默忽略或夹值。
- 已有原生补帧的游戏继续使用现有路线；鸣潮（包括缺官服资源清单的渠道）保留独立加载，前后端均拒绝 Encore。不会替换其启动器校验文件。

## 部署与配置保护

组件检查更新直接读取 [SilyNoMeta/rtx-encore](https://github.com/SilyNoMeta/rtx-encore/releases) 的 Releases。推荐 [v2.4.1](https://github.com/SilyNoMeta/rtx-encore/releases/tag/v2.4.1) 压缩包 SHA-256：`e5383604a9289c70c8a47e73e4c22503c9e5834d9ed0058dc4754b3d79409202`；主 DLL SHA-256：`9a6dcc15058919618959edfa4510f5ffb913f4facf265c99ca3c49bc49c170c2`。旧 2.3.0 DLL 指纹 `b668a747e5eba576b544e4c6a790ce9c2d52b80389fe4f6ec999b6020f612471` 继续适配。未知指纹版本可以下载留存，完成协议与加载适配前不开放应用；版本名称不能代替文件校验。保留上游第三方声明。公开仓库是文档和发布入口，不是引擎源码。

加载文件按 `version.dll`、`dinput8.dll`、`winmm.dll`、`dxgi.dll` 顺序选择空闲名称，只部署一份。保留其他工具占用的代理；发现未知 Encore、MFG、OptiScaler、RenoDX NR 或 Feeder 冲突时拒绝叠装。首批尚无手动覆盖代理名称入口。

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
