'use strict';

// Documentation evidence is intentionally independent of file availability and
// installation policy. Each entry refers to an exact release, not the current
// default branch or all releases of a component.
const CHECKED_AT = '2026-11-14';
const SOURCES = {
  renodx190: { label: 'RenoDX MFG 1.9.0 版本说明', url: 'https://github.com/mavismmg/MFGAdaUnlock-RenoDx/blob/1.9.0/docs/releases/1.9.0.md' },
  renodx155: { label: 'RenoDX MFG 1.5.5 版本说明', url: 'https://github.com/mavismmg/MFGAdaUnlock-RenoDx/blob/1.5.5/docs/releases/1.5.5.md' },
  universal171: { label: 'MFG Unlocker 1.7.1 项目说明', url: 'https://github.com/dashdogy/MFG-Unlocker/blob/v1.7.1/README.md' },
  universal170: { label: 'MFG Unlocker 1.7.0 项目说明', url: 'https://github.com/dashdogy/MFG-Unlocker/blob/v1.7.0/README.md' },
  encore241: { label: 'Encore 2.4.1 更新记录', url: 'https://github.com/SilyNoMeta/rtx-encore/blob/v2.4.1/CHANGELOG.md#241' },
  encore230: { label: 'Encore 2.3.0 项目说明', url: 'https://github.com/SilyNoMeta/rtx-encore/blob/v2.3.0/README.md' },
  feeder117: { label: 'DLSS5 Feeder 1.17.0 版本说明', url: 'https://github.com/jlrouzies-fr/DLSS5-Feeder/releases/tag/v1.17.0' },
  feeder119: { label: 'DLSS5 Feeder 1.19.0 版本说明', url: 'https://github.com/jlrouzies-fr/DLSS5-Feeder/releases/tag/v1.19.0' },
  streamline214: { label: 'Streamline 2.14.16 帧生成集成说明', url: 'https://github.com/NVIDIA-RTX/Streamline/blob/v2.14.16/docs/ProgrammingGuideDLSS_G.md' },
  dlss310916: { label: 'NVIDIA DLSS 310.9.16 版本说明', url: 'https://github.com/NVIDIA/DLSS/releases/tag/v310.9.16' },
  reshade680: { label: 'ReShade 6.8.0 项目说明', url: 'https://github.com/crosire/reshade/blob/v6.8.0/README.md' },
};
const catalog = new Map();
const record = (scope, status, detail) => ({ scope, status, detail });
function add(component, versions, label, summary, records, sourceIds) {
  const evidence = { label, summary, records, sources: sourceIds.map(id => SOURCES[id]), checkedAt: CHECKED_AT };
  for (const version of versions) catalog.set(`${component}:${version}`, evidence);
}

add('mfg-renodx', ['1.9.0'], '已整理支持范围与测试记录',
  '1.9.0 分别记录 XMX、NVIDIA 帧生成与 RTX 50 原生功能的状态，各路线的测试结果不能互相替代。', [
    record('RTX 30 · XMX', '已有实卡反馈', 'RTX 3060 Ti 测试版和 RTX 3080 有 XMX 运行反馈；3080 的 Onimusha 测试需将游戏 DLSSG 310.5.2 换为 310.9.x。'),
    record('RTX 20 / 30 · NVIDIA 帧生成', '实卡确认尚未完成', '项目只记录了在 RTX 4070 SUPER 上模拟 RTX 30 的检查；这不等同于 RTX 20 / 30 实卡确认。RTX 20 在该版本说明中列为尚未测试。'),
    record('RTX 50 · Dynamic MFG', '控制原生多帧生成', '不修改 RTX 50 的原生帧生成模块；RTX 5090D 的测试者确认此版本恢复了 Dynamic MFG 开关。'),
  ], ['renodx190']);

add('mfg-renodx', ['1.5.5'], '已有指定环境的功能测试',
  '1.5.5 主要修复 XeMFG 文件部署与同步问题，DLSS-G 后端未变更；公开测试限定于指定硬件与游戏。', [
    record('RTX 4070 SUPER · 驱动 621.01', '已记录游戏内功能检查', 'Elden Ring 修复缺失的 libxess_fg.dll 后可启动 XeMFG；关闭强制垂直同步后记录到 4 倍帧生成。'),
    record('Dragon’s Dogma 2 · XeMFG', '已记录游戏内功能检查', '替换过旧的 libxess_fg.dll 后可启动 XeMFG，记录了 Streamline 路线的 4 倍 / 6 倍运行检查。'),
    record('测试范围', '未包含画质与延迟测量', '上述记录是功能检查，不是所有游戏、显卡的兼容保证，也未测量图像质量或实际输入延迟。'),
  ], ['renodx155']);

const native50 = record('RTX 50', '原生多帧生成 · 菜单控制', 'RTX 50 已原生支持 DLSS 多帧生成；项目不修改 NVIDIA 的帧生成代码，只提供相关菜单控制。');
const nativeIntegration = record('DLSS 多帧生成', '需要游戏原生集成', '需要游戏已有 Streamline DLSS 帧生成集成；可用倍率还取决于显卡、运行库及驱动设置，菜单出现不代表游戏已生效。');
add('mfg-universal', ['1.7.1'], '已整理项目支持说明',
  '1.7.1 对 DLSS 多帧生成、神经渲染和实验性 XeMFG 分别说明条件，不能把其中一条路线的支持范围用于全部功能。', [
    native50,
    nativeIntegration,
    record('DLSS 5 神经渲染', '需要模型与游戏输入', '要求可用的 SR / DLAA / RR 路径及匹配显卡的模型；1.7.1 新增的 DX11 菜单和神经渲染支持不等于 DX11 DLSS 多帧生成支持。'),
    record('独立 XeMFG', '实验性路线', '可通过独立路线或 OptiScaler 使用；这是另一条帧生成路径，不能替代 DLSS 多帧生成的原生集成要求。'),
  ], ['universal171']);
add('mfg-universal', ['1.7.0'], '已整理项目支持说明',
  '1.7.0 将 RTX 20 的 DLSS 多帧生成列为实验性；神经渲染需要另备兼容模型，未沿用后续版本的 DX11 新增说明。', [
    native50,
    nativeIntegration,
    record('RTX 20 · DLSS 多帧生成', '实验性支持', '该版本项目说明将 RTX 20 支持标为实验性；不能据此承诺所有 RTX 20 游戏均可运行。'),
    record('DLSS 5 神经渲染', '模型不包含在组件中', '通过 SR / DLAA / RR 路径接入；项目不提供或自动下载模型，需另备匹配显卡的模型文件。'),
  ], ['universal170']);

add('encore', ['2.4.1'], '已整理版本说明与验证范围',
  '2.4.1 新增神经渲染多阶段控制并修复帧生成启动问题；发布记录明确区分自动检查、早期测试反馈和仍待游戏内确认的修复。', [
    record('神经渲染多阶段控制', '实验性功能', '提供 pre / post / final 阶段与最多 4 轮处理；实际可用输入与功能取决于游戏和渲染接口，不能由菜单选项推断生效。'),
    record('原生帧生成 3 倍 / 4 倍启动', '自动检查通过 · 游戏内待确认', '修复启动时帧生成提供方尚未识别而限制为 2 倍的问题；发布记录中的 Stalker 2 修复仍待反馈者确认。'),
    record('Horizon · final 阶段 HUD 闪烁', '自动与回放检查 · 游戏内待确认', '较早候选版本有阶段运行反馈；最终 HUD 修复的自动与回放检查不等同于最终版本的游戏内确认。'),
  ], ['encore241']);
add('encore', ['2.3.0'], '已整理项目支持说明',
  '2.3.0 面向 RTX 20 / 30 / 40 提供帧生成与神经渲染扩展；没有原生 DLSS 的游戏采用实验性接入路线。', [
    record('没有原生 DLSS 的游戏', '实验性路线', '项目说明覆盖 DX11 / DX12 / Vulkan 的扩展接入；功能仍依赖游戏可提供的输入，不能保证所有同接口游戏可用。'),
    record('神经渲染 · final 阶段', '实验性功能 · 默认关闭', '可尝试最终画面神经渲染；运动向量、深度及 HUD 等条件会影响路线与效果，需在具体游戏中检查。'),
    record('RTX 50', '已具备原生功能', '项目说明将 RTX 50 的原生帧生成与 NVIDIA Smooth Motion 单独说明，不将 RTX 50 描述为需要解锁多帧生成。'),
  ], ['encore230']);

const feederModel = record('Feeder 与模型的关系', '模型必须匹配显卡', '发布说明中的原始 310.8.0 和 Lecram 310.8 模型仅适用于 RTX 50；RTX 20 / 30 / 40 需另配对应模型。这是模型限制，不是 Feeder 本身只支持 RTX 50。');
const feeder117 = [
  record('1.17.0 · 32 位桥接', '需要配套宿主', '32 位插件与 64 位辅助宿主需使用配套协议版本；旧版或测试版文件不能随意混用。'),
  record('1.17.0 · 辅助宿主', '已记录离线自检', '辅助宿主搭配 RenoDX 6.1.0 / 7.0.0-rc8 / 8.0.1，在驱动 617.14 上各有 300 次自检记录；这是宿主自检，不是游戏内功能验证。'),
  record('1.17.0 · 64 位输出稳定器', '尚未进行游戏内测试', '发布说明明确将此功能列为未进行游戏内测试，不能把宿主自检结果扩展到该功能。'),
];
const feeder119 = [
  record('1.19.0 · MSAA / OpenGL 修复', '最终修复尚未游戏内测试', '发布记录说明 MSAA 深度提示与 OpenGL 复制路径的最终修复未在游戏内运行；早期测试版的反馈不能替代正式版确认。'),
  record('1.19.0 · 32 位桥接', '需要配套宿主', '32 位插件与 64 位辅助宿主需成套使用；构建成功不代表所有游戏可用。'),
];
add('feeder', ['1.17', '1.17.0'], '已整理版本说明与验证范围', 'Feeder 提供没有原生输入路径时的接入与桥接；模型、宿主自检和游戏测试需要分开看。', [...feeder117, feederModel], ['feeder117']);
add('feeder', ['1.19', '1.19.0'], '已整理版本说明与验证范围', '1.19.0 的最终修复尚未进行游戏内确认；项目中较早的测试版反馈不能自动用于本版本。', [...feeder119, feederModel], ['feeder119']);
add('feeder', ['1.17 + 1.19'], '已整理配套版本的说明', '此配套包含 1.17 与 1.19；以下记录分别标注版本，不把其中一个版本的检查结果用于另一个版本。', [...feeder117, ...feeder119, feederModel], ['feeder117', 'feeder119']);

add('streamline', ['2.14.16'], '已整理功能集成条件',
  'NVIDIA 的 Streamline 帧生成说明用于游戏集成；运行库文件存在不代表游戏已接入对应功能。', [
    record('DLSS 帧生成输入', '需要游戏提供', '集成说明要求深度、运动向量、无 HUD 画面及逐帧常量，且相关缓冲区需在呈现时保持有效。'),
    record('实际功能支持', '由运行时检查', '游戏需查询当前适配器的功能支持；DLSS 帧生成还要求相应 Windows 版本和硬件加速 GPU 计划等条件。'),
  ], ['streamline214']);
for (const component of ['dlss-sr', 'dlss-rr']) {
  add(component, ['310.9.16', '310.9.16.0'], '已提供版本说明',
    'NVIDIA 的 310.9.16 SDK 说明只记录修复与稳定性改进，没有列出逐游戏测试矩阵。', [
      record('310.9.16 发布内容', '修复与稳定性改进', '这是 SDK 的发布说明，不用于证明本地 DLL 的身份、具体游戏的兼容性或实际画质。'),
    ], ['dlss310916']);
}
add('reshade', ['6.8.0'], '已整理插件加载说明',
  'ReShade 是后处理与插件宿主；它能加载 Add-on，不代表各插件提供的神经渲染或帧生成功能都可用。', [
    record('Add-on 扩展', '宿主能力', '项目说明允许用扩展 DLL 增加 ReShade 或应用功能；具体插件的输入要求、显卡范围及测试记录需查看该插件项目。'),
  ], ['reshade680']);

function projectEvidence(component, version) {
  // Accept only the conventional release-tag prefix. Do not strip prerelease
  // suffixes, infer semver ranges, or map model names with the same DLL version.
  const exactVersion = typeof version === 'string' ? version.trim().replace(/^v(?=\d)/, '') : '';
  const evidence = typeof component === 'string' && catalog.get(`${component}:${exactVersion}`);
  if (!evidence) return {
    label: '暂未整理此版本说明',
    summary: '尚未整理这个版本的项目说明与测试记录，不代表它不兼容。能否应用另按 NeuralFrame 的接入情况与游戏条件判断。',
    records: [], sources: [], checkedAt: null,
  };
  return {
    label: evidence.label, summary: evidence.summary,
    records: evidence.records.map(item => ({ ...item })),
    sources: evidence.sources.map(item => ({ ...item })), checkedAt: evidence.checkedAt,
  };
}

// Exact external-link allowlist consumed by the main process. No remote input
// or arbitrary repository path can add a URL to this list.
function projectEvidenceSources() {
  return [...new Set(Object.values(SOURCES).map(source => source.url))];
}

module.exports = { projectEvidence, projectEvidenceSources };
