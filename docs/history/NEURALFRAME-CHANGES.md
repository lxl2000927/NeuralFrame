# NeuralFrame 桌面重构记录

## NeuralFrame 0.1.0

Initial release of the NeuralFrame desktop reconstruction, based on the local
Enhanced 0.1.8 baseline and preserving its component/install core.

### First-round changes

- New name, generated N/frame logo, taskbar icon, installer identity and repository.
- One React + TypeScript renderer; route-level lazy loading and shared dark/light tokens.
- NVIDIA App-inspired sidebar, master/detail game settings and stable scroll regions.
- Per-game drafts; reading a disabled feature keeps it disabled. Editing only one
  rendering feature does not silently send a change to the other feature.
- Existing preview-token installs, component cache, version locks and rollback are reused.
- Component inventory, runtime diagnostics, online component releases, history clear,
  scan-folder preferences and F8 overlay preferences are accessible in the new shell.
- Renderer no longer loads legacy community/chat scripts or competing theme layouts.
- Browsing a game no longer repairs ReShade.ini permissions as a side effect.
- Component archives moved to lxl2000927/NeuralFrame and verified against all 14 hashes.

### Compatibility

Existing user configuration remains at `%APPDATA%/dlss5-swapper-enhanced` for this
transition. This preserves the library, downloads, custom models and version locks
without duplicating large files. Game backups remain in their existing directories.
No game DLL or configuration was changed while developing this reconstruction.
The removed repository's old download links no longer work; the new build contains
the migrated component URLs.

### Scope

Native C++ F8 drawing, shader code and rendering providers are retained. Desktop
checks cannot establish image quality, game compatibility or output FPS. Those
still require evidence from the actual running game.
Legacy frontend files remain as migration reference; the desktop entrypoint now
loads `src/ui-dist/index.html` only. The offscreen native-overlay frontend remains
separate. The next round can finish extracting main-process feature services and
expand plugin-specific capability schemas.

## NeuralFrame 0.1.1 · 界面细节与切页性能

- 新 Logo 使用简洁的绿色几何「5」与帧结构，更新标题栏、任务栏、便携版和安装器图标。
- 去掉导航顶部多余空白，首页按钮与右侧 56px 页眉上下对齐。
- 保留已访问页面状态，回到游戏配置时不再重复扫描；显式刷新和完成应用后仍重新读取。
- 页面保留草稿、滚动位置和已展开的内容；离开运行诊断页面时暂停轮询，返回时重新检测。
- 首页封面按完整内容显示，竖版封面使用 2:3 容器；横图完整居中显示，不拉伸或裁切。
- 增加卡片悬浮、键盘焦点与进入箭头反馈；遵循系统减少动画设置。
- 用统一的深浅主题下拉菜单替换系统原生蓝色选中菜单。支持方向键、Home/End、回车确认、Esc 取消、Tab 和点击外部关闭；长版本名可换行，弹出位置受窗口边界约束。
- 界面版本号由 package.json 在构建时注入，避免标题栏与软件版本不同步。

同一隔离游戏库的三次往返对照中，回切游戏页从约 7.6–7.9 秒降至 24–35 毫秒。该结果针对已加载页面的切换，不代表首次扫描速度。

组件、安装核心及游戏内原生渲染代码没有改变。

## NeuralFrame 0.1.2 · 首页卡片与侧栏调整

- 首页卡片限制为最大 148px 宽，不再随窗口无限拉大；缩小标题区和间距，封面继续完整显示。
- 去掉首页导航的固定背景，仅当前页面显示选中色块；首页仍与右侧页眉保持高度对齐。
- 侧栏保留 80px / 256px 两种宽度，并加入短暂的宽度过渡。展开前后保持导航行高和位置一致。
- 收起与展开按钮始终显示图标、文字和明确的操作提示，并记住上次使用状态。
- 修复窄窗口下展开状态与实际显示不一致的问题；960px 窗口也可正常展开和收起。
- 遵循系统减少动画设置，保留上一版的快速切页、下拉菜单和草稿机制。

本版调整桌面界面，不修改游戏目录或渲染组件。
