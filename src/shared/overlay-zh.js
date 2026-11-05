'use strict';
(function(root){
 const strings={
  'Bridge is off':'实时连接已关闭',
  'RenoDX is not loaded':'尚未加载 RenoDX',
  'Unsupported RenoDX binary; this build drives RenoDX 6.5.3 and v4.7':'RenoDX 插件版本不受支持；此连接组件支持 RenoDX 6.5.3 和 v4.7',
  'Unexpected ImGui interface; bridge refused':'ImGui 接口与预期不符，已停止连接',
  'RenoDX code fingerprint mismatch':'RenoDX 代码指纹不匹配',
  'UI dispatch changed; bridge refused':'界面调用接口已改变，已停止连接',
  'RenoDX controls unavailable':'RenoDX 控件暂不可用',
  'Feeder is not loaded':'尚未加载 Feeder',
  'Unsupported Feeder binary (this build drives x64 v1.17.0)':'Feeder 插件版本不受支持（此连接组件支持 64 位 v1.17.0）',
  'Feeder config unavailable; let Feeder initialize':'尚无法读取 Feeder 配置，请等待初始化完成',
  'Feeder cfg reloads every 60 delivered frames. Work resolution/filter/sharpness and the HDR10 bridge: DX11 only. NR is separate.':'Feeder 每输出 60 帧重新读取一次配置。工作分辨率、滤镜、锐度及 HDR10 桥接仅适用于 DX11；神经渲染独立控制。',
  'Enable Feeder and select an active mode in its original page. Disabled/inert Feeder does not reload cfg.':'请在 Feeder 原始面板中启用它并选择工作模式。Feeder 关闭或未工作时不会重新读取配置。',
  'Feeder cfg changed or write failed; retry':'Feeder 配置已改变或写入失败，请重试',
  'DLSS 5 Swapper Controls':'DLSS 5 Swapper 控制面板',
  'Invalid Windows PE binary.':'无效的 Windows PE 程序文件。',
  'Expected a regular Windows binary.':'请选择普通的 Windows 程序文件。',
  'ReShade add-ons must not exceed 64 MB.':'ReShade 插件文件不能超过 64 MB。',
  'Choose a .addon64 or .addon32 DLL with matching architecture.':'请选择位数匹配的 .addon64 或 .addon32 插件文件。',
  'Choose the game executable, not a DLL.':'请选择游戏的 .exe 可执行文件。',
  'Linked library directories are not allowed.':'插件库目录不能使用链接目录。',
  'Invalid overlay ID.':'叠加层标识无效。','Invalid overlay record.':'叠加层记录无效。',
  'Overlay changed since import. Import it again.':'叠加层文件在导入后已改变，请重新导入。',
  'Invalid installation record.':'安装记录无效。','Stored overlay checksum mismatch.':'已保存的叠加层文件校验值不匹配。',
  'Remove this overlay from its test game first.':'请先从测试游戏中移除此叠加层。',
  'Build the overlay add-on first.':'请先构建叠加层插件。',
  'Build the experimental add-on first (see Developer files).':'请先构建实验性叠加层插件（参见“开发文件”）。',
  'Expected a regular Windows executable.':'请选择普通的 Windows 可执行文件。',
  'Invalid executable architecture.':'可执行文件的架构无效。',
  'Overlay and executable architectures do not match.':'叠加层与游戏可执行文件的位数不匹配。',
  'The main app and toolchain directories cannot be overlay targets.':'不能将管理器或开发工具目录作为叠加层安装目标。',
  'Remove the previous test overlay before installing a new build.':'请先移除旧版测试叠加层，再安装新版本。',
  'Installed overlay was modified. Nothing was overwritten.':'已安装的叠加层文件被修改过，未覆盖任何内容。',
  'Installation directory changed. Nothing was removed.':'安装目录已改变，未移除任何内容。',
  'Overlay was modified. Nothing was removed.':'叠加层文件被修改过，未移除任何内容。',
  'Invalid overlay settings. Home and Escape are reserved; Windows-key shortcuts are not supported.':'叠加层设置无效。Home 和 Escape 为保留按键，不支持含 Windows 键的快捷键。',
  'Invalid custom overlay theme. Pick a colour and give it a name.':'自定义主题无效，请选择颜色并填写名称。',
  'Create a custom theme before selecting it.':'请先创建自定义主题，再选择它。',
  'Invalid overlay preference':'叠加层偏好设置无效',
  'The built-in overlay cannot be deleted.':'不能删除内置叠加层。',
  'Add a custom ReShade overlay':'添加自定义 ReShade 叠加层',
  'ReShade native add-ons':'ReShade 原生插件',
  'Native add-on — trusted developers only':'原生插件 — 请确认来源可信',
  'This file contains native code. A ReShade add-on can access your files when loaded by a game.':'此文件包含原生代码。游戏加载 ReShade 插件后，插件可以访问你的文件。',
  'Adding it here only stores a copy; it is not executed here. A checksum does not certify that the file is safe.':'在这里添加只会保存副本，不会执行插件。校验值一致不代表文件安全。',
  'Cancel':'取消','Add trusted file':'添加可信文件','Remove':'移除',
  'Your original imported file is kept.':'保留你导入时使用的原始文件。',
  'Select a CLOSED offline test game with ReShade add-on support':'选择已关闭且支持 ReShade 插件的离线测试游戏',
  'Windows game executable':'Windows 游戏可执行文件',
  'Overlay test — not a DLSS installation':'叠加层测试（此操作仅安装叠加层）',
  'Confirm the game is closed and already uses ReShade with add-on support. Keep DLSS 5 Swapper open while testing the built-in overlay.':'请确认游戏已关闭，并已安装支持插件的 ReShade。测试内置叠加层时，请保持 DLSS 5 Swapper 开启。',
  'Only a uniquely named overlay add-on is copied next to this executable. No existing DLLs or configuration files are replaced by installation. No Vulkan registry changes. Avoid online / anti-cheat games.':'只会在此可执行文件旁复制一个名称独立的叠加层插件，不替换现有 DLL 或配置文件，不修改 Vulkan 注册表。请避免用于联网或带反作弊的游戏。',
  "This overlay automatically connects through an undocumented, exact-build v4.7 adapter that temporarily redirects its UI dispatch. This may be incompatible with other add-ons. RenoDX itself saves settings you change. This is not NVIDIA's official SDK or overlay.":'此叠加层通过针对特定 v4.7 构建的非公开适配器自动连接，并临时重定向界面调用，可能与其他插件不兼容。你更改的设置由 RenoDX 自身保存。此组件不是 NVIDIA 官方 SDK 或叠加层。',
  'Install test overlay':'安装测试叠加层','Is the test game closed?':'测试游戏已关闭吗？',
  'Remove only the unchanged overlay this app copied. Keep ReShade, DLSS, presets, and every original file.':'仅移除本软件复制且未被修改的叠加层文件，保留 ReShade、DLSS、预设和所有原始文件。',
  'Remove test overlay':'移除测试叠加层'
 };
 const text=value=>typeof value==='string'?(strings[value]||value):value;
 const dialog=options=>{
  const out={...options};
  for(const key of ['title','message','detail'])if(typeof out[key]==='string')out[key]=out[key].split('\n\n').map(text).join('\n\n');
  if(/^Remove .+\?$/.test(options.message||''))out.message=`移除 ${options.message.slice(7,-1)}？`;
  if(out.buttons)out.buttons=out.buttons.map(text);
  if(out.filters)out.filters=out.filters.map(f=>({...f,name:text(f.name)}));
  return out;
 };
 const api={text,dialog,strings};if(typeof module==='object'&&module.exports)module.exports=api;else root.overlayZh=api;
})(typeof window==='object'?window:globalThis);
