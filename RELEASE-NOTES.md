# NeuralFrame 0.1.0

面向 Windows x64 的正式版。可下载便携单文件或安装版；开发者可下载含原生启动资源的源码包。

- 游戏库支持扫描、手动添加、横向封面与按游戏配置。桌面界面支持简体中文和 English。
- 神经渲染与多帧生成可独立设置。应用前显示文件变更，支持版本锁定、组件回滚和恢复游戏原始文件。
- 组件与软件独立更新。大型运行包按需下载，校验 SHA-256；重复检查复用缓存，遇到上游限流会显示可重试时间。
- 运行诊断区分已安装、已加载与倍率生效证据。F8 面板支持主题和热键设置。
- 用户设置沿用原数据目录，游戏备份位于各游戏目录。涉及反作弊的游戏请先确认允许加载第三方插件。

下载后可用 PowerShell 的 `Get-FileHash -Algorithm SHA256` 对照随附的 `SHA256SUMS.txt`。[使用说明与组件来源](https://github.com/lxl2000927/NeuralFrame/blob/v0.1.0/README.md) · [进度与待办](https://github.com/lxl2000927/NeuralFrame/blob/v0.1.0/PROJECT_STATUS.md)
