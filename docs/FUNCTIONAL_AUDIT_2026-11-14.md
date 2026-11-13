# NeuralFrame 功能与组件逐项检查

完成核对：2026-11-14。检查、修复和测试执行于 11 月 13 日；中断后的最终日志与工作区核对于 11 月 14 日完成。仅调试，未打包、提交或发布。

## 范围与结论

五路分别检查安装与恢复、组件获取与身份、游戏/组件/叠加层界面、游戏发现与封面、运行状态与诊断。主代理核对主进程接线、共享配置操作和最终界面。

- 已对当前 **16 类组件、7 个模型**以及主要页面和安装路线建立逐项记录。
- **82 个 preload 调用均有对应 IPC 处理器**；这项是接口完整性核对，不表示每个分支均已动态执行。
- 隔离测试资源中的 **16 个包、169 个文件**长度及 SHA-256 全部匹配；没有在真实游戏中加载这些文件。
- 本轮修复 11 类可复现问题，见下表。各分路静态检查、实际测试和平台限制分开记录，不能将代码检查或模拟进程当作游戏实测。

## 修复明细

| 问题 | 修复后的行为 | 主要位置 |
| --- | --- | --- |
| 联合 NR/MFG 子阶段丢失手选 EXE | 子阶段及返回状态沿用所选主程序；程序消失时拒绝回退操作其他目录 | combined-manager、neural-models、mfg-manager |
| Feeder 删除旧包装器/效果文件未备份 | 删除纳入原始备份和事务，成功后还原及失败回滚都能恢复原字节 | apply |
| 私有注册表删除失败被误报成功 | 只有成功读取父级并证明确实不存在才认定清理完成，否则保留可重试恢复记录 | legacy-installscript |
| 启用插件会解除其他插件的禁用状态 | 精确匹配插件文件名或旧名称，保留相似名称、其他架构及无关禁用项 | feeder-config、apply、main |
| Encore 配套发布页打不开 | 固定运行库目录中的发布方纳入来源链接允许列表 | project-links |
| 倍率卡片长期显示过期证据 | 执行采样和 FPS 分别按时间失效，过期后停止展示有效倍率，可重新检测 | GraphicsPanels |
| 档位/模型/运行库与硬件支持提示失真 | 使用实际配置、模型目录、运行库版本与物理 GPU 支持信息，修正 75% 分辨率、架构、FG 版本和原生/实验性提示 | GraphicsPanels |
| 鸣潮改名或渠道直接布局漏识别 | 在直接布局中使用双主程序证据识别，保留原嵌套布局 | library-standalone |
| 非 PE32/PE32+ 文件被当成 32 位游戏 | 拒绝不支持或损坏的可选头魔数，不进入可安装候选 | pe |
| 独立加载器与 OptiScaler 诊断日志遗漏 | 将三个固定日志/状态文件加入来源白名单，继续执行大小与文件类型限制 | diagnostics |
| 诊断确认后新出现的日志被自动导出 | 仅导出确认名单与重新验证后的有效来源交集，返回实际选入章节的数量 | diagnostics、main |

## 统一验证

- 最终全量 **648/648 通过，0 失败、0 跳过**，约 149 秒，包含隔离资源和原生桥接探针。
- TypeScript 与 UI 构建通过；仅构建前端资源，没有生成安装包。
- 完整 Electron 工作流通过：导航、草稿、下载/取消、预览/确认、诊断、模型获取、Encore 和鸣潮路线隔离。
- 新增界面回归先在旧构建复现失败，再在修复构建通过：倍率过期、独立 FPS 过期、真实目录/档位说明。主题草稿专项也通过。
- 160 游戏封面专项通过：并发峰值 4、自动全库扫描 0。
- 本机游戏库隔离只读检查通过：鸣潮、星穹铁道、草稿/撤销、运行与文件信息、导航、960px 布局及深浅主题；无脚本错误。首次游戏页面可操作约 2.8 秒，属于此隔离冷启动观测，不能当作所有机器的性能保证。
- 新专项已加入 `npm run test:workflow`。最终 `git diff --check` 通过。

## 主进程及公共界面补查

| 功能 | 核对内容 | 证据或边界 |
| --- | --- | --- |
| 启动/单实例/托盘/关闭 | 第二实例、隐藏恢复、退出、调试重启、运行中写入互斥 | single-instance、close-to-tray 与完整测试；未重启用户正在使用的窗口 |
| 设置持久化/重置 | 主题、语言、分组、扫描、隐藏恢复、目录排除、窗口记忆；重置索引与游戏配置的边界 | 主 IPC/Utilities 源码、library-state-race、排除/分组/窗口测试；未重置真实设置 |
| 硬件信息 | 自动硬件匹配、显示信息、请求失效、读取与游戏配置写入分离 | hardware-ipc/HardwareSettings 源码、硬件档位测试、本机隔离读取 |
| 附加组件 | 选择后暂存、保存失败、同名互斥、缺失文件、关闭/移除、只在支持路线附带 | Addons 与主 IPC；精确启用插件的核心及主进程回归 |
| 历史与导出 | 筛选、复制、详情、打开路径、清理不删除备份；导出来源和实际计数 | history、history-ipc、diagnostics、desktop-audit-integration |
| 关于/来源链接 | 检查更新复用请求、不自动下载安装、固定目的地允许列表 | update-check、project-links；未把代码白名单验证当作在线连通性验证 |
| 公共控件 | 下拉焦点、方向键、Escape、弹窗关闭、禁用状态、页面保留与通知 | 源码复核及 Electron 工作流；未进行完整辅助技术认证 |
| 接口与资源 | preload 与 main/hardware/overlay 处理器对应，配套资源身份 | ipc-inventory.json、components-pinned-resources.json；非每个异常分支全覆盖声明 |
| 旧界面与平台 | 当前主窗口加载 ui-dist；共享旧 overlay 渲染代码另由运行状态分路检查 | 未将未启用的旧主界面视为当前已测试页面；未新增打包和跨平台实机验证 |

## 尚需实机验证

没有修改真实游戏或实际用户配置。真实游戏内画质、帧率、延迟、反作弊兼容性、远端 WeGame 启动、Linux/Proton 及全部模拟器环境尚未实测。自动发现中的 EA/WeGame 专用元数据支持不能由本轮通用目录识别测试替代。对文件的哈希/角色/架构验证，也不等于验证发行者签名或实际渲染效果。

## 逐项覆盖记录

下列矩阵保留各分路的验证层级。矩阵中交由主代理的最终界面、主 IPC 接线及封面检查，均已按上面的“统一验证”完成。


### 安装与恢复

#### 功能与组件覆盖矩阵

以下“实际验证”均指本轮已经运行的测试文件；“静态检查”只表示阅读入口、保护条件及状态流，不能视为真实运行。

| 功能 / 组件 | 拥有文件及静态检查内容 | 实际验证 | 未实测边界 |
| --- | --- | --- | --- |
| 原生 ReShade / RenoDX 安装与重装 | apply、addon-policy、replace-file：按 API/架构选代理与 add-on；已有加载器复用；原生 SR/NR 文件及第三方消费者处理；组件备份与原始内容恢复 | apply-repeat、renderer-dll、consumer-conflict、shader-compiler、reshade-writable、readonly-attribute、hard-link-writes、apply-xbox | 未启动商业游戏；未验证图形效果或所有第三方 ReShade 版本 |
| RenoDX / Multipass 输入路线 | apply、mfg-manager：原生输入/Multipass 消费者选择，缺依赖拒绝，已有 Streamline 的保留与缺失时补齐 | multipass、native-input-route、install-routes、enhanced-modules | 未实测渲染帧内容、UI 分离质量或具体 GPU 性能 |
| 32 / 64 位 Feeder、dgVoodoo | apply、feeder-config：DirectDraw/D3DImm/D3D8/D3D9 路线，host64、add-on 位数、Lumenite 与 shader/config 路径；废弃文件清理事务 | apply-32bit、apply-feeder64、directdraw、preloader32、feeder-config、panel-settings；新增清理成功还原与注入失败回滚用例 | 未运行真实旧游戏；使用固定资源和合成 PE/品牌夹具 |
| ReShade 外部安装器与辅助流程 | apply、install-guards：已有文件记录、预览与安装顺序、辅助过程返回/失败路径 | ordinary-install-transaction、reshade-writable、compatibility-regressions | 测试注入 setup runner；没有在用户机器真实安装外部 ReShade |
| MFG RenoDX / ASI 参数 | mfg-manager、wuwa-profile、combined-manager：启用/关闭、架构/API 限制、QualityGuard/HDR/模式参数、已存在文件归属；手选 exe 传递 | panel-settings、native-input-route、combined-transaction、combined-selected-exe、install-routes | 不代表游戏内实际补帧倍率、输入源效果或延迟已经验证 |
| 鸣潮独立加载及 WeGame 无清单回退 | wuthering-waves、wuwa-profile、combined-manager：官方清单保护、缺失与不可读的区别；仅主程序旁部署；RTXManager 收据/指纹归属；模型切换、锁及还原 | wuthering-waves：官方清单、缺失清单、非法/拒绝访问清单、外部已有部署、后续更新、配置转换、部署失败、Win32 共享锁、重试和还原 | 无本机 WeGame 游戏/启动器实测；无清单渠道是隔离目录布局验证，不宣称全部渠道实机通过 |
| Encore 2.3.0 | encore、encore-config、combined-manager：DX11/DX12/Vulkan 支持判断、固定 payload、代理冲突、JSONC/BOM/未知参数、模型/补帧选择、现存文件归属及失败恢复 | encore-install、encore-config、encore-ipc、encore-diagnostics、backend-profile、backend-journal，使用独立研究目录固定 payload | 未进入无原生 FG 的实际游戏；不能推断输出质量或游戏特有兼容性 |
| OptiScaler 可选桥接 | optiscaler、apply：构建选择、代理占用、_12 桥接选项、旧转发文件处理、已有模型/用户设置保留 | optiscaler、optiscaler-build-choice、optiscaler-debug-helper | 未实机测试 FSR/XeSS 转接与最终渲染效果 |
| 旧 32 位预加载桥与私有注册表 | legacy-compat、legacy-installscript、apply：仅选定旧路线启用，不接管第三方 winmm，默认值不覆盖用户设置，脚本解析限制与私有命名空间，外部步骤失败可重试 | legacy-231、preloader32、preloader-native、legacy-registry-recovery；原生探针实际执行，其他注册表流程使用模拟 runner | 原生探针只覆盖测试宿主，不等同于全部 DirectDraw/OpenGL 游戏；未运行供应商安装脚本 |
| Vulkan 共享 layer | vulkan-layer、apply、backend-manager：共享安装归属、最后使用者清理、目录指向与注册表失败处理、外部提交阶段 | vulkan-layer、apply-vulkan-wrapper、restore-integrity、backend-journal | 注册表 runner 模拟，不写系统 layer 注册；未启动 Vulkan 游戏或模拟器 |
| Proton / Linux 路线 | proton、apply：Steam 次级库 prefix 与客户端路径分离，选择 Proton 工具及环境构造 | linux-proton，Windows 下隔离的 Linux 风格目录与配置夹具 | 没有 Linux/Wine/Proton 真机执行 |
| 后端切换与每路线设置保存 | backend-manager、encore、apply、file-journal：按程序/API/路线隔离配置，保留用户 preset，失败回滚、旧后端恢复、第三方篡改拒绝 | backend-profile、backend-journal、combined-transaction、encore-install、ordinary-install-transaction | 未遍历每个任意第三方插件组合；已验证支持路线的固定场景 |
| 联合 NR + MFG、单项关闭与重复应用 | combined-manager、mfg-manager、neural-models apply 入口：同一预览/事务，依赖和执行顺序，所选程序一致性，返回状态对应程序 | combined-transaction、combined-selected-exe、apply-repeat、wuthering-waves | 没有真实游戏运行中的热更新；程序关闭保护以受控进程夹具验证 |
| 原始备份、文件 journal、完整还原 | file-journal、replace-file、apply、backend-manager：安全路径、junction/hardlink、原子记录、嵌套事务、回滚失败与可重试外部阶段、已更新的第三方文件 | restore-integrity、restore-recovery、apply-failed-restore、ordinary-install-transaction、hard-link-writes、readonly-attribute、backend-journal | 注入故障覆盖既定阶段，无法穷举所有硬件断电/磁盘损坏；未作真实磁盘故障测试 |
| 组件预览确认与目标漂移 | component-deploy、component-review、preview-fs、install-guards：审阅内容与实际源/目标/选中 exe 一致，取消/无确认不写，源变更与回滚竞争拒绝 | component-review、component-review-recovery、component-executable-race、component-rollback-race、combined-selected-exe | 没有人工操作 UI 的竞态压力测试；UI 由主代理串行检查 |
| 安装前锁、驱动/API/架构保护 | install-guards、apply、encore、mfg-manager：运行进程、共享游戏锁、驱动门槛、可执行程序与 API 支持校验 | driver-barrier、rendering-api、install-routes、preloader32、encore-install、wuthering-waves | 未杀进程或中断真实游戏；进程清单失败和占用使用受控夹具 |
| INI 配置与 add-on 启用策略 | feeder-config、addon-policy、apply、encore-config：保留未知键，规范必要字段，早期加载顺序，精确 DisabledAddons 处理，本地化文件归属 | feeder-config、panel-settings、restore-integrity、encore-config；新增精确启用/完整恢复回归 | 未遍历任意手工损坏配置；已有解析与异常夹具不等于所有外部配置格式 |

### 组件与模型

#### 16 类组件逐项检查

所有分类定义与 provider 来自 `component-definitions.js`；允许应用策略来自 `component-compatibility.js`；入库和状态来自 `component-library.js`；下载和来源映射来自 `component-updates.js`。下表的版本均是当前代码固定版本，不声称是上游最新版本。

| 组件 | 来源与固定组合 | 应用和获取检查 | 动态证据/限制 |
| --- | --- | --- | --- |
| RTX Encore | 固定包 `SilyNoMeta/rtx-encore` 2.3.0；无独立可选更新 provider | 作为游戏路线管理；与 modern SL/FG 依赖一起准备，DLSS 超分和 NR 按配置追加 | 固定 2 文件匹配；来源链接已修；路线依赖隔离用例通过，实际注入交游戏实测 |
| DLSS SR | RankFTW/rhi-repo 可选发布；配套 310.9.1 / 310.9.16 | 检查真实 SR 特征，不能用 NR/FG 冒充；入库可选，实际应用另核对游戏目标 | 12 配套文件匹配；角色拒绝、持久化、更新回滚、选择保留通过 |
| DLSS FG | RankFTW/rhi-repo 可选发布；配套 310.9.1 / 310.9.16 | 检查 FG 二进制特征；未知上游版可入库，未适配不能替换固定插件协议组合 | 12 文件匹配；下载前策略与匹配字节信任用例通过 |
| Streamline | NeuralFrame 固定组合 2.13 / 2.14.16 | 成组路线管理；不能把目录中的单个 DLL 当可自由替换版本 | 34 文件匹配；requiredPacks 与实际 IPC 准备通过 |
| DLSS RR | NeuralFrame 固定组合 310.9.1 | 成组管理；现有游戏检测到 RR 才加入相应依赖，NR 分类不冒认 RR | 6 文件匹配；NR/SR/RR/FG marker 区分和依赖测试通过 |
| DLSS NR | SmarterGamers 与 RankFTW 两来源；7 条目录记录见下表 | 由 DLL 指纹确认身份，ZIP 指纹另记；检查 64 位 PE、NR 特征、Fatbin 和 SM；下载不等于生效 | 配套 6 文件匹配；不同 SF-v2、310.9.16 独立身份、架构拒绝、缺失选择拒绝均通过 |
| RenoDX NR | RankFTW/rhi-repo 更新；固定 8.5.0-rc10 | 未适配新插件不能自动继承固定版 trustedAdapter；驱动风险指纹单独阻断 | 7 文件匹配；未来插件入库但不可替换、已适配字节复用及驱动阻断通过 |
| RenoDX 多通道 | RankFTW/rhi-repo；固定 SF 26.1003.2350 | 作为替代消费者处理，不能与通用 NR 消费者重复安装；固定 ABI 关联保留 | 6 文件匹配；多通道消费者区分及参数不擅改测试通过 |
| MFG RenoDX | mavismmg/MFGAdaUnlock-RenoDx；固定 1.5.5 | 插件、FG 库和面板适配匹配；未知版本只能存入库 | 7 文件匹配；未适配替换被拒、seed 信任修复、下载与取消通过 |
| MFG Universal | dashdogy/MFG-Unlocker；固定 1.7.0 | 独立加载/OptiScaler 组合按固定路线使用；鸣潮只请求需要的包，复用现有代理时可免独立加载器包 | 7 文件匹配；MFG-only、restore/off 不额外取 NR/SR/SL，以及实际IPC隔离准备通过 |
| Feeder | jlrouzies-fr/DLSS5-Feeder；固定 1.17 + 1.19 | 宿主、32/64位客户端和 shader 成组，不能按单个文件任意替换；版本/协议固定配套 | 57 文件匹配；配置保留、父子运行栈分离、固定协议/指纹检查通过 |
| ReShade | NeuralFrame 固定组合 6.8.0 | 32/64位 DLL 与 Vulkan JSON 成组；无可选上游 provider；列表正常不代表已安装 | 10 文件匹配；PE 位数与固定组合检查通过，真实驱动注册不在本路执行 |
| 32位预加载器 | localization 包中的 winmm.dll；版本按指纹区分 | 内部路线组件，不提供任意外部替换；本地构建与旧指纹分开标记 | localization 文件校验包含它；本路未重新编译/执行 native bridge |
| 中文面板适配层 | localization 固定包 zh1.10 | pinned/internal；未来插件不覆盖适配层；缺文件报依赖失败 | 3 文件匹配；下载前策略、未来插件拒绝测试通过 |
| F8 叠加层 | 管理器随包资源；内部 pinned | 单独叠加层库维护安装，不走任意上游版本替换 | 本路核对分类、导入权限与来源；叠加层安装/协议动态审查交其它路 |
| OptiScaler | Dagherbou/OptiScaler_DLSSNR 更新；路线内固定构建 | 可下载保存，应用只走已适配路线；按固定构建分缓存，源包不得混合；必须识别真实 OptiScaler.dll | 构建来源/哈希、分目录、真实DLSS/API/GPU/进程门槛、独立计划及无forwarder检查通过 |

#### 7 条神经渲染模型目录

| ID | 来源/身份依据 | 目录 SM | 获取/验证结论 |
| --- | --- | --- | --- |
| 310.8.SF-v2 | SmarterGamers；DLL 8270b350cd82… | 75/86/89/120 | 配套包或 tagged LFS 独立资产；与 RankFTW SF-v2 字节身份不同；配套实际资源校验通过 |
| 310.8.SF-v2-rankftw | RankFTW；DLL 6eb209e764f3…；ZIP 1da359418949… | 75/86/89/120 | 单独下载包、指纹、来源；不会因 SF-v2 同名合并成配套副本 |
| 310.9.16 | RankFTW；DLL cdfa6c1ec784…；ZIP dbeb1f2790b5… | 75/86/89/120 | 固定下载 ID 指向独立包；未下载不冒认 SF-v2 可用；导入后按实际文件版本展示 |
| 310.8.0-RTX40 | 历史 RHI 目录；DLL d2f76227f5bf… | 89/120 | 未有本地匹配文件时仅为目录提示；更新列表能提供该标签的下载记录，不用名称授予信任 |
| 310.8.SF | 历史 RHI 目录；DLL fb17b72bfdd9… | 75/86/89/120 | 保留历史模型与来源；仅正确指纹计为对应本地版本 |
| 310.8.Lecram | 历史 RHI 目录；DLL a9095b37ccba… | 120 | 可入库，但在 Ada 上必须拒绝应用；目录架构提示不作为实际二进制验证证据 |
| 310.8.0-stock | 历史目录，无已确认 DLL SHA-256 | 120 | 不编造本地可用指纹；上游包可下载，但只有实际文件检测结果才用于游戏选择 |

旧 ID `310.9.16-oct2026` 在早期数据中实际指向配套 SF-v2，别名保持旧字节身份，不等同新的独立 `310.9.16`。已读对应身份回归，避免擅自把旧配置换成另一份模型。

此表中 SM 是当前目录数据，不表示七个历史二进制全部在本轮逐一运行过。未知手动模型的组件表采用保守架构提示，游戏模型选择通过 `inspectNeuralModelBinary` 读取实际 Fatbin；本轮不把未知目录标签提升为验证成功。

#### 跨组件功能检查矩阵

| 功能 | 已读实现与检查要点 | 实际验证 |
| --- | --- | --- |
| 检查更新 | 同仓库多个 provider 合并请求、stable 过滤、ETag/304、5分钟缓存、限流退避、每来源失败保留 stale，不把断网当“最新” | component-library / update-check 用例通过；GitHub网络由注入响应模拟 |
| SmarterGamers 模型 | release asset 优先，否则标签固定的 Git LFS 指针；大小/sha/url有约束，失败标签单独 stale，不能因304永远不重试 | tagged LFS、资产去重、错误指针重试测试通过 |
| ZIP/DLL 导入 | 组件固定文件集、合法相对路径、PE位数、SR/FG/NR角色；ZIP traversal/symlink/大小上限/大小写冲突/重复不同版本拒绝 | component-library 与 binary-inspection 用例通过 |
| 指纹与来源 | DLL与归档指纹分离；内容ID去重；同名不同字节独立；旧index不能覆盖实际文件版本；package provenance归档关联可追加 | 两源SF-v2、310.9.16、手动导入与修复测试通过 |
| 下载/续传 | >8MiB并行range、4工人、断点恢复、服务器忽略range回退、错误range和坏sha拒绝、超时重试仅网络错误 | asset-download 8 项通过；未进行真实外网测速 |
| 取消 | 传输、目录初始化、缓存读取、校验、运行时最终发布与空请求时序；清理partial/staging；可再次重试 | component-ipc/runtime-payload/component-library/asset-download 用例通过 |
| 缓存修复 | 运行时与库内副本分开；文件缺失/截断/同尺寸损坏修复；seed记录首次兼容升级；有效副本按hash复用 | 各缓存回归通过；16包169文件实际校验通过 |
| 信任与适配 | UI兼容标签同部署策略；pinned/internal、route、pending、selectable分开；新标签不获得旧ABI信任，只有已适配相同字节可复用 | component-availability/component-library通过 |
| 安装依赖计划 | restore不准备；NR/MFG关闭不多下载；32位/MFG限制；自定义模型不下载替代模型；Encore与鸣潮独立组合 | runtime-payload依赖及真实隔离IPC通过；最终写游戏的路线复核交第1路 |
| 旧依赖获取 | dgVoodoo与Lumenite固定URL/hash；预览仅报告依赖；先验证包再解压；cache-proof检出松散缓存变化；VC runtime检查实际位数 | component-download/runtime-prerequisites通过；未运行真实防病毒程序 |
| 固定协议/ABI | Feeder客户端/宿主及Vulkan层指纹，RenoDX消费者与多通道区别，已知驱动崩溃版本阻断 | feeder-config/driver-barrier/multipass通过；实际游戏内ABI调用未执行 |
| 内容链接 | provider/固定runtime发布方白名单，repo/releases范围，HTTPS，无用户凭据/非标准端口 | 新project-links与rendering-api **7/7**通过 |

### 界面操作

| 功能 | 实现 | 本轮检查及结果 | 验证方式 |
|---|---|---|---|
| 游戏选择与草稿归属 | Games.tsx/GameEditor | 按游戏目录卸载编辑器，草稿由上层持有；路线、组件覆盖、Encore 按 EXE 独立保留 | 静态；草稿逻辑测试 |
| 详情与配置读取 | useGameInspection.ts/useProfileTarget.ts | 30 秒缓存、订阅清理、过期响应隔离、32 项上限、错误重试、手选档位投影与物理 GPU 分离 | 静态 |
| 还原可用性 | useRestoreStatus.ts | 目录/激活/版本标识对应；错误不能提供可还原状态 | 静态 |
| 目录复制/打开/启动 | Games.tsx | 调用路径与错误回报；启动期间不支持并行应用 | 静态；执行后端由主代理覆盖 |
| 反作弊提示 | Games.tsx | 汇总主程序及候选程序信息、展开控制、确认与文件预览分别处理 | 静态 |
| 四个子页与键盘切换 | Games.tsx | ARIA 标识、方向键/Home/End、日志仅在画质页、草稿跨页保留 | 静态；最终工作流复核 |
| 程序/API/路线选择 | GameSetup.tsx/resolveSetup | 已安装/手选/推荐优先级、丢失 EXE 错误、Encore 失配仍可说明原因；API/代理偏好立即持久化且触发重读 | 静态；共享路线单测由安装分路覆盖 |
| 鸣潮保护路线 | GameSetup.tsx/GraphicsPanels.tsx | 程序/后端固定、原生栈只读、缺官服清单渠道说明、独立参数对照 | 静态；实际部署由安装分路覆盖 |
| OptiScaler 构建与 ReShade 代理 | GameSetup.tsx | 只在适用路线显示、异步构建列表、保存锁、失败回报 | 静态 |
| 安装状态与已检测文件 | GameSetup.tsx | 当前后端、原生版本与待应用版本分开；路径按相对路径为键，独立滚动 | 静态 |
| 硬件档位与默认栈 | HardwareProfileChoices.tsx/domain.ts | 三档来源、实际参数、RTX 50 默认栈、仅修改当前游戏草稿 | 静态；草稿逻辑测试 |
| NR 模式/模型/运行库 | GraphicsPanels.tsx | 旧版/兼容模式切换、GPU 架构提示、下载状态；发现旧静态说明盖过真实目录，详见修复记录 | 静态交叉比对 neural-models.js |
| 补帧倍率/HDR 输入 | GraphicsPanels.tsx/domain.ts | 固定/动态/继承模式范围、鸣潮不暴露不存在的 QualityGuard 设置、单模块应用隔离 | 静态；草稿逻辑测试 |
| 单次倍率检测 | GraphicsPanels.tsx/MultiplierReading | 发现手动读取后没有 30 秒失效处理，且没有独立检查 fpsAt | 静态确认；新增 Electron 复现由主代理协调 |
| 分模块/联合/一键应用 | Games.tsx/domain.ts/GraphicsActions.tsx | 不自动开启原为 off 的重应用；单模块提交不带另一模块草稿；成功后按作用范围清理 | 隔离草稿逻辑测试 |
| 安装方式应用/撤销/恢复 | Games.tsx | 预览确认、成功重读、失败保留草稿、恢复清除路线/版本/Encore 草稿 | 静态；最终工作流复核 |
| Encore 所有输入 | EncorePanel.tsx | FG 倍率、运动估计、附加 SR、NR 开关/模型/工作分辨率/比例/次数；未知模式、原生 SR 冲突、模型版本/架构拦截 | 静态；后台由安装分路回归 |
| 模型表 | GameReports.tsx/ModelTable | 七条身份不按标签合并；目录/本地/下载/导入指引、GPU 与档位兼容、复制完整指纹、选择不立即写入 | 静态；目录/草稿逻辑测试 |
| 游戏已装组件/版本锁 | Games.tsx/GameComponents | 文件缺失/锁漂移、锁定按钮条件、版本筛选、配套默认语义、预览更新/回滚/恢复 | 静态；部署事务由安装分路验证 |
| 运行诊断 | Games.tsx/RuntimePanel | 单次/自动检测、防重入、后台暂停、30 秒过期、独立 FPS 时间、状态失败清除、模块/磁盘信息分开 | 静态 |
| 鸣潮独立参数回读 | StandaloneStatus.tsx | 5 秒轮询、后台暂停、过期标记、待应用/已保存/实际参数分开，pending 不当作生效 | 静态 |
| 配置诊断和显存估算 | GameReports.tsx/diagnostics.ts | 缺数据不显示通过、无双模块无需协同检查、显存未知不推算为零、区分配置与运行证据 | 隔离诊断逻辑测试 |
| 日志显示/复制/清空 | useJobLog.ts/SessionLog.tsx | 目录过滤、200 条上限、最新在前、详细字段保留、复制失败/清除反馈、生命周期清理 | 静态；最终工作流复核 |
| 组件列表与硬件独立读取 | Library.tsx | 缓存与上游检查结果时间比较、物理架构独立读取、失效响应保护、刷新错误保留旧列表 | 静态 |
| 检查更新与限流 | Library.tsx | 检查中禁用、缓存结果/下次时间、模型视图只显示有关来源错误 | 静态 |
| 本地组件/指定模型导入 | Library.tsx | 类型过滤、只入库、模型指纹目标、取消/异常留弹窗、成功关闭；既有文件对话框由后端验证 | 静态 |
| 分类/搜索/组合筛选 | LibraryComponents.tsx/libraryCatalog.ts | 类型数与版本数区分、按名称/版本/来源/文件多词搜索，历史条目参与筛选；条件芯片及清除 | 隔离目录逻辑测试 |
| 版本分组/来源身份 | libraryCatalog.ts | 仅验证指纹/明确配套链接合并，同名异源 SF-v2 分开，下载后行 ID 稳定 | 隔离目录逻辑测试 |
| 本地/可应用状态 | libraryCatalog.ts | 损坏优先正常运行缓存；未知/架构不符/未来未适配/路线管理分别表示 | 隔离目录逻辑测试 |
| 历史与内置组件折叠 | LibraryComponents.tsx | 查找时自动显示匹配历史、分类计数包括内置但显示计数只数展开范围；不是目录丢失 | 静态 |
| 详情抽屉与来源链接 | LibraryComponents.tsx | 适用路线、依赖、下一步、来源与分发方分开、技术字段折叠、返回配套版本、关闭动画和低动画模式 | 静态；链接白名单由组件分路覆盖 |
| 下载/校验/取消 | DownloadAction.tsx/useOperation.tsx | 行内一个状态动作、按传输种类与 ID 匹配、初始库下载可取消、固定准备排队期间无虚假取消入口 | 静态；后端取消由组件分路覆盖 |
| 依赖准备/文件预览 | useOperation.tsx | 最多三轮依赖准备、不可应用冲突、备份/保留/外部步骤、确认 token、取消不报完成、错误清理监听器 | 静态；最终工作流复核 |
| 窗口切回刷新 | useWindowReturn.ts | focus/visibility 合并、最短间隔、操作/草稿时延迟、卸载清理；仅当前页读模型 | 静态 |
| 叠加层文件/服务/连接 | Overlay.tsx | 三种状态分开，错误清除旧桥接数据，页面/窗口隐藏时停止轮询与预览 | 静态；最终工作流复核 |
| 外观配色/自定义/删除/撤销 | Overlay.tsx | 未应用草稿保留、零差异清空、无效自定义切内置保留旧设置、保存失败不丢草稿 | 静态；已有专门 Electron 草稿回归交主代理运行 |
| 热键/附带安装开关 | Overlay.tsx | 与主题分别保存，Tab/Escape 与保留键规则、命令失败提示、保存后刷新读取版本隔离 | 隔离热键测试 + 静态 |
| 预览 iframe | overlay-preview.ts/Overlay.tsx | 仅父窗口配置消息、主题/语言/色值校验、设计模式无实际桥接，宽度缩放且单内部滚动 | 静态 |
| 面板导入/安装/移除/开发者文件 | Overlay.tsx | 取消 null 不报成功、成功后重读、损坏插件不允许安装但可移除、安装记录不当作已加载 | 静态；实际 IPC 互斥由其它分路覆盖 |
| 布局与可访问性 | 对应 CSS/TSX | 窄容器重排、长路径换行、ARIA 状态/分组、字段 disabled、减少动画/透明度模式 | 静态；深浅色/960px 最终截图交主代理 |

### 游戏发现与封面

#### 功能覆盖矩阵

“夹具通过”表示本轮动态运行对应测试；“静态复核”表示检查实现和调用条件，不能等同于运行了该平台或游戏。

| 功能 | 实现 | 核对点与本轮证据 |
|---|---|---|
| Steam 库发现 | `library.js:steam` | ACF/VDF、安装目录存在、工具排除、多个库；Linux/Steam artwork/grouping 夹具通过。未访问真实 Steam 服务。 |
| Steam 图像缓存 | `steamPoster/steamArtwork` | 固定文件名探测，平铺/新版子目录、竖图和横图分工；本地缓存专项通过。 |
| Steam 无清单残留 | `isBrokenSteamOrphan` | DLL 依赖、SxS/嵌套启动器不确定时保留；binary/legacy 库分组相关夹具通过，未扫描所有真实库。 |
| DLC/共享占位去重 | `canonicalGame/dedupe` | Phantom Liberty 需实际主程序证据，共享存根不能盖住正常条目；grouping 夹具通过。 |
| Epic Games | `library.js:epic` | 静态复核 `.item` 读取、卸载目录残留过滤、异常逐条跳过；当前没有独立 Epic launcher 实机动态验证。 |
| GOG | `library.js:gog` | 静态复核只读注册表、真实目录存在、工具过滤；没有 GOG 实机验证。 |
| Ubisoft | `library.js:ubisoft` | InstallDir 正斜线、残留目录、异常键；ubisoft 夹具通过。 |
| Xbox / Microsoft Store | `library.js:xbox` | `.GamingRoot`、PackageRepository、Content 规范化、身份去重；xbox 库专项通过。 |
| Xbox 可执行文件 | `scan.js:xboxExecutables` | MicrosoftGame.config、越界路径拒绝、辅助程序过滤、声明 ARM64 排除、加密程序保留架构；scan-xbox 通过。未运行 MSIX 游戏。 |
| Kuro / 鸣潮 | `library-standalone.js` | 官服外层、固定客户端根、改名双主程序根、无效目录、去重；新增红绿回归通过。 |
| HoYoPlay / Starward | `library-standalone.js` | StarRail.exe + UnityPlayer.dll、有限容器递归、非游戏启动器排除；standalone 夹具通过。 |
| 卸载记录定位 | `library.js:standalone` | 已知游戏记录的 InstallLocation/DisplayIcon/UninstallString 只解析不执行，移动路径；注册表夹具通过。 |
| EA / Origin | 通用 folder / manual 路径 | 当前没有专用 EA 元数据发现器。手选目录与通用游戏根可识别；没有声称自动枚举所有 EA 库。本轮不新增平台适配。 |
| WeGame | 通用 folder / standalone 路径 | 当前没有专用 WeGame 元数据发现器。修复支持符合鸣潮双主程序证据的直接根；未知渠道嵌套和远端机器未实测。 |
| 手选单游戏/扫描来源 | `library.js:folder` | Unreal 根不是 Engine/Binaries 列表，非游戏内容/备份/资产不进自动来源；folder-add/auto-scan/standalone 通过。 |
| 自动扫描边界 | `drives/autoRoots/holdsGame` | 静态复核限制目录深度、系统目录/工具排除、库目录形状；auto-scan 夹具通过。大量可移动盘/失联网络盘耗时未实测。 |
| 排除与隐藏 | `filterExcluded/isInside` + main 入口 | 目录边界区分、手选记录保留、恢复来源；exclusions/folder-add 夹具通过。main 状态写入由主代理复核。 |
| Linux Steam / Flatpak | `linuxSteamRoots/steam` | XDG、历史路径、Flatpak、多库 compatdata 前缀；linux-proton 夹具通过；未在 Linux/Proton 真机运行。 |
| 扫描遍历 | `scan.js:walk` | 深度 12、备份/着色器/工具排除、Xbox Content 例外、不可读目录容错；deep-dlss/scan-xbox 通过。 |
| PE 32/64 位 | `pe.js:readHeaders/getBitness` | 魔数有效性修复、异常/文件句柄释放、32/64 位正例；新增 binary-inspection 通过。位数读取不代表 ARM64 与 x64 ABI 可互换。 |
| PE 导入与版本 | `getImports/getFileVersion` | 常规/延迟导入、资源表有界读取、零版本字符串回退；architecture/rendering-api 等夹具覆盖。没有执行被扫描程序。 |
| API 字符串扫描 | `pe.js:findMarkers` | 单次分块、跨块/重叠/正则字符、无结果、文件更换；binary-inspection 通过。 |
| 符号持久缓存 | `scan-cache.js` | 文件身份/size/mtime/ctime、配置目录、原子写入、512 项上限、安装读取不启用；binary-inspection/inspection 通过。 |
| API 识别 | `scan.js:detectApi` | imports/engine/strings/同架构模块/文件名证据顺序；rendering-api/architecture 通过。 |
| DXVK / vkd3d | `isVulkanWrapper/vulkanWrapperBeside` | 内容证据及位数，ReShade 不冒充 Vulkan 包装层；scan-vulkan-wrapper 通过。 |
| 引擎渲染器 | `detectEngineApi/rendererBeside` | 同目录同架构、真实模块、代理和工具排除、候选预算；renderer/undetected/emulators 夹具通过。 |
| RDR2 | `gameApiProfile/rdr2Renderer` | system.xml 明确 Vulkan 才切换、默认 DX12、OneDrive 读取路径；rdr2-renderer 通过。 |
| 模拟器 | `emulators.js` | 19 个既有配置按准确 EXE 名映射；Play.exe 需消除同名游戏误认；emulators 夹具通过。没有逐模拟器真机启动。 |
| 未识别 API 的程序 | `scanGame` | 游戏证据存在才提供未知候选、上限 8、错误理由区分；scan-undetected-api 通过。 |
| 多主程序选择 | `scanGame` | SP/MP、编辑器/备份降权、同名候选数量、已保存/明确选中目标保留；scan-architecture 通过。应用目标传递由安装代理修复。 |
| 组件目录归属 | `scanGame:belongsTo` | 独立可执行文件目录边界、DLSS/Streamline/XeSS/FSR/插件仅归当前目标；architecture/encore 相关已有夹具与静态复核。 |
| 原生能力 | `scanGame` + install-routes | SR/FG/替代超分分别推导、不能看到任意 NGX 就假设支持；rendering-api/scan-deep-dlss 通过。 |
| ReShade 状态 | `inspectReShade` | 代理/ASI/32/64预加载、版本与真实 addon-support 符号；compatibility-regressions 通过。 |
| 兼容保护 | `compatibility.js` | ModOrganizer 管理目录、反作弊提示、shader compiler、重复注入/所有权/架构；compatibility-regressions 通过。未运行反作弊或改变其文件。 |
| API 覆盖键 | `game-api.js` | 游戏路径 + 相对EXE哈希，auto 保留检测结果；rendering-api 通过。保存入口由主代理复核。 |
| 后台 worker 排队 | `game-inspection.js` | 同请求共享、当前选择优先、替换未需要请求、普通读不被误取消、close/error 全部结算；inspection 通过。 |
| 分阶段详情 | `game-inspection-worker.js` | 扫描先返回、模型/硬件后返回、失败不吞有效文件结果、写后generation隔离；inspection 通过。 |
| Steam 图像定位 | `steamart.js` | known appid 不搜索、标题规范化/匹配、已知非Steam游戏、portrait/hero/tile分工；steamart 通过（mock网络）。 |
| 图像网络节流 | `steamart.js` | 320ms 请求起始间隔、同搜索/详情请求共享、失败可重试、10s timeout；steamart 通过（mock网络）。 |
| 图像有效性/大小 | `steamart.js:download` | 16 MiB 上限、流读取超限、2000bytes占位排除、PNG/JPEG/WebP magic；steamart 通过（mock网络）。 |
| 缓存身份与期限 | `art-cache.js` | 请求身份独立于搜索结果、同路径新游戏、单资源负缓存、损坏立即重试；art/artwork IPC 通过。 |
| 前端封面队列 | `artworkQueue.ts` | 并发4、当前详情优先、离屏任务释放、修复epoch/旧响应不盖新图、旧视图释放不删新任务；queue 通过。 |
| 前端可见性/修复 | `useArtwork.ts` | 滚动根观察器共享、隐藏页不请求、160px预取、局部更新、原图失败一次修复/横图回退；静态复核，最终160游戏UI由主代理协调。 |
| 游戏筛选与列表 | `GameBrowser` + game-filters | 搜索NFKC、API/可安装/DLSS/插件组合、真实统计、平台分组、保留选择；game-filters 通过，最终UI由主代理协调。 |
| 首页与卡片 | `Home/GameCard` | 图片按cover用途，左右滚动/减少动画偏好、最近游戏匹配、拖入只调已有接口、鼠标/键盘菜单、日志复制失败；静态复核，具体IPC/最终UI由主代理覆盖。 |

### 运行状态、面板、诊断与历史

#### 按功能检查

表中“动态”表示本轮实际运行隔离测试；“静态”表示阅读调用链或原生实现，不表示已进入真实游戏。最后的 Electron 界面验证由主代理统一运行。

| 功能 | 主要实现 | 检查与验证 |
|---|---|---|
| 内置插件文件存在/损坏提示 | `overlays.builtin/builtinStatus`、`overlay-ipc bridge` | 动态：missing-addon，PE 损坏与缺失可辨；轻量轮询不全读插件 |
| 自定义32/64位导入 | `overlays.readNative/add` | 动态：格式、PE类型、扩展名和架构；64 MiB插件上限；不加载导入代码 |
| 大型游戏EXE检查 | `overlays.readNative` | 动态：只读头部/类型/位数，游戏EXE不受插件体积上限误伤 |
| 原始导入文件保留 | `overlays.add/remove` | 动态：存储副本与元数据；删除仅动库文件 |
| 库文件损坏修复 | `overlays.add/verifyCustom` | 动态：损坏文件/元数据重新导入可修，失败不误报成功 |
| 非法ID/路径记录 | `overlays.idCheck/readJson/installation` | 静态＋existing动态用例：固定哈希ID、大小限制、符号链接与目录约束 |
| 同名/同内容插件 | `overlays.add` | 动态：内容地址与独立架构，保留既有有效记录 |
| 独立安装 | `overlay-ipc install`、`overlays.install` | 动态：独占写入、不覆盖现存文件、架构匹配、禁止软件目录 |
| 重复安装/文件缺失 | `overlays.install` | 动态：可重装已删副本；非同指纹文件不覆盖 |
| 独立卸载 | `overlays.uninstall` | 动态：核对目录/指纹，只删除对应副本；被用户修改则拒绝 |
| 已删除游戏清理记录 | `overlays.uninstall/forgetMissing` | 动态：可释放失效记录，不触及其他游戏 |
| 删除仍被游戏使用的插件 | `overlays.remove` | 静态＋动态：安装记录存在时拒绝删除库条目 |
| 软件开发者文件入口 | `overlay-ipc source` | 动态：开发源码目录/打包资源目录分别正确 |
| 安装确认与操作锁 | `overlay-ipc mutate` | 动态：与实际main互斥锁串行，确认不占锁，失败保持`ok:false,error` |
| 等待期间版本锁改变 | `overlay-ipc uninstall` | 动态：组件列表等待后重新读锁，原文件/记录保持 |
| 与安装路线共同部署 | `game-overlay.routes/prepare/attach` | 动态：只适用支持的64位DX11/12路线；预览不写盘 |
| 内置面板升级 | `game-overlay.attach` | 动态：只退休同游戏旧副本，外部记录延后提交 |
| 面板升级后失败回滚 | `game-overlay.attach` | 动态：恢复游戏文件、manifest和库记录 |
| 升级预览后文件被改 | `game-overlay.prepare/attach` | 动态：重新核对指纹，拒绝删除被改文件 |
| Xbox受限程序 | `game-overlay.attach` | 动态：沿用扫描确认的架构，不额外全读受限EXE |
| Feeder配置补全 | `game-overlay.completeFeederConfig` | 静态：仅缺键时补已有版本默认值，保留用户值 |
| 外观偏好读写 | `overlay-preferences` | 动态：BOM、缺省值、主题/自定义色与名称验证，改变主题保留快捷键 |
| 快捷键范围与保留键 | `overlay-hotkey`、`overlay-preferences` | 动态：字母数字/功能键/修饰组合合法，Home/Escape/Win等拒绝 |
| 本地桥接生命周期 | `overlay-bridge` | 动态：真实临时命名管道，启动/关闭、endpoint归属与清理 |
| 第二游戏连接与接管 | `overlay-bridge` | 动态：活跃客户端保持唯一；失联后新会话接管；清空旧状态 |
| 命令会话隔离 | `overlay-bridge control`、`overlay-protocol.command` | 动态：旧session即使epoch相同仍拒绝；只接受对应webContents |
| 传输尺寸/输入上限 | `overlay-protocol`、`overlay-bridge` | 静态＋协议测试：帧尺寸/字节数、按键/滚轮范围、pending/rate上限 |
| 状态结构与工具ID | `overlay-protocol.status` | 动态：工具数量、ID/类型/范围、RenoDX和Feeder结构校验 |
| 上游版本标签变化 | `overlay-protocol.status` | 动态：Feeder旧8控件/新控件与不同版本标签，合法结构不因名称拒绝 |
| 状态角标命令 | `overlay-protocol.command` | 动态：独立角标可用，保留ID不误驱动同ID着色器 |
| RenoDX桥接开启与NR开关区分 | `overlay-live`、`renodx-ui-bridge.hpp` | 静态：命令200只开桥接采样，真正NR开关为103，未把二者混淆 |
| 实时面板滑条/输入/风格/下拉 | `renderer/overlay-live`、`overlay-panel` | 静态：值域、失联禁用、编辑态保护、DOM世代避免旧编辑跨游戏；本轮未用真实GPU执行 |
| 主题/翻译/原生表面 | `renderer/overlay-surface` | 静态：同源主题变量、有限翻译缓存、偏好更新重绘；无新修改 |
| 进程定位与多实例 | `core/runtime-status` | 动态：精确路径、PID/出生标识、权限失败、多进程歧义和后续共享日志隔离 |
| 日志边界与轮转 | `runtime-status.readTail/logEvents` | 动态：256KiB完整行、旧会话/部分行/截断重写/附加字节、查询缓存 |
| NR生效证据 | `runtime-status.parseEvents` | 动态：成功执行计数证明，开关/初始化/累计曾执行不冒充实时成功 |
| MFG状态与倍率 | `runtime-status.parseMfgStatus` | 动态：错误/重启/关闭优先，提供程序呈现与倍率请求区分，FPS独立时效 |
| 独立NR连续执行 | `standalone-runtime.parseStandalone` | 动态：计数增长、30秒窗口、关闭/错误/pending中断，重启后重新取证 |
| 实际参数与保存参数 | `standalone-runtime` | 静态＋动态：requested settings与live extent/stage/scale分开；UI最终由主代理核验 |
| 模块路径状态 | `runtime-status.moduleState` | 动态：相同路径已加载、其他路径、未运行、读取受限与资源文件区别 |
| 诊断固定日志 | `diagnostics.sources/report` | 动态：本轮补独立加载器/OptiScaler，原ReShade/Feeder/Encore/manifest/crash保持 |
| Encore诊断日志轮转 | `diagnostics.addEncoreLogs` | 动态：白名单、每类最近3份、有限枚举，不导出dump/无关文件 |
| 诊断读取竞态与大小 | `diagnostics.readTail` | 动态：同句柄、有上限、增长截断不越界、不含未读NUL |
| 诊断链接文件/目录 | `diagnostics.sources` | 动态：链接日志目录拒绝，游戏根本身可为合法库路径 |
| 诊断确认名单的稳定性 | `diagnostics.report(approvedSources)` | 动态：确认后新日志/轮换不能扩大来源；删除、链接替换重新验证；main接线由主代理完成 |
| 历史记录字段/方向 | `history.operation` | 动态：实际文件前后版本/hash、各自runtime栈、HDR输入策略、restore方向 |
| 历史迁移与去重 | `history.fromManifests/list` | 动态：发现目录不扫全盘、完成/故障manifest分离、重复操作不混淆 |
| 历史坏行/写失败 | `history.read/append/record` | 动态：坏行不中断其它记录，写失败pending可复制/重试去重 |
| 清空历史 | `history.clear` | 动态：原子替换和cutoff、重开不重新导入、失败保留记录、备份文件保留 |
| 旧版renderer运行视图 | `renderer/runtime-view.js` | 静态：轮询仅可见、状态过期、检测失败清旧证据、DOM转义；主桌面已用React路径 |
