# DLSS 5 Swapper Enhanced · 独立分支 0.1.0

从 Enhanced 2.3.0 的本地增强版本继续开发，使用独立的软件版本号。

本版提供统一组件库、每款游戏独立选择版本、插件在线检查与下载、中文面板、运行时加载检测、变更预览、版本锁定和回滚。F8 桥接、中文适配层及旧游戏预加载器由程序内部维护，不作为独立插件选项展示。

安装、更新与适配范围见 [发行说明](RELEASE-NOTES.md)。之前的本地开发记录保存在 [历史说明](docs/LOCALIZATION-HISTORY.md)，原始上游说明保存在 [上游 README 归档](docs/UPSTREAM-README.md)。归档中的版本、发布链接和功能描述不代表本分支当前发行承诺。

项目仓库：[lxl2000927/DLSS5-Swapper-Enhanced](https://github.com/lxl2000927/DLSS5-Swapper-Enhanced)。软件更新检查使用本仓库的 Releases；插件更新继续使用各组件自己的来源。

## 下载

在 [Releases](https://github.com/lxl2000927/DLSS5-Swapper-Enhanced/releases/latest) 下载 Windows x64 版本：

- `Portable-x64.exe`：便携单文件，双击自解压运行，无需安装。
- `Setup-x64.exe`：安装版，可选择安装目录并创建快捷方式。

两种版本共用同一持久数据目录，已有游戏列表、组件库及版本锁定会保留。下载后可使用 `SHA256SUMS.txt` 校验。

## 开发

管理器使用 Electron / JavaScript，原生面板与汉化适配层源码在 `overlay/`；开发与构建命令见 `package.json` 和 `scripts/`。源码包保留构建入口，第三方运行库需按项目 payload 流程准备。现有用户数据目录仍为 `dlss5-swapper-enhanced`，避免升级丢失游戏、版本选择与锁定记录。

## 来源与许可

上游：[skyi7943-cmd/DLSS5-Swapper-Enhanced](https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced)，继承 Rakan Alkhaldi 的 MIT 开源代码。保留 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中的原作者署名与第三方声明。
