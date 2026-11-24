'use strict';
// 模块 B：NVIDIA x3/x4 多帧生成独立管理模块 (MFG Manager)
// 基于经过验证且 MIT 许可合规的开源方案 (mavismmg/MFGAdaUnlock-RenoDx v1.5.5 与 dashdogy/MFG-Unlocker v1.7.0)，
// 在不篡改磁盘签名、不绕过反作弊、不冒充 FSR/第三方插帧的前提下，为 RTX 40 系列 (Ada Lovelace 0x190) 提供进程内原生
// NVIDIA DLSS-G x2/x3/x4 多帧生成配置、注入器冲突检测、自动备份、一键恢复与真实运行时状态验证。

const fs = require('./preview-fs').fs;
const os = require('os');
const path = require('path');
const { resolvePayloadDir } = require('./payload-root');
const crypto = require('crypto');
const pe = require('./pe');
const journal = require('./file-journal');
const replaceFile = require('./replace-file');
const apply = require('./apply');
const feederConfig = require('./feeder-config');
const optiMfgConfig = require('./optiscaler-shared-config');
const { scanGame } = require('./scan');
const { detectGpuArchitecture } = require('./neural-models');
const classicGpuReason = '当前经典补帧路线使用 NVIDIA DLSS-G，需要 NVIDIA 显卡。';

function assertMfgGpu(nvidiaPresent) {
  if (nvidiaPresent === false) throw Object.assign(new Error(classicGpuReason), {code:'errMfgNvidiaRequired'});
}

// 经过验证的开源 MFG 解锁组件指纹表 (MIT License)
const MFG_UNLOCKERS = Object.freeze({
  renodxAddon: Object.freeze({
    id: 'renodx-mfgunlock-1.5.5',
    name: 'MFGAdaUnlock-RenoDx v1.5.5 (ReShade Add-on · 兼容 621.01+ 驱动)',
    upstream: 'https://github.com/mavismmg/MFGAdaUnlock-RenoDx',
    license: 'MIT',
    version: '1.5.5',
    releaseDate: '2026-10-23',
    fileName: 'renodx-mfgunlock.addon64',
    relPath: 'enhanced/mfg/renodx-mfgunlock.addon64',
    size: 4556800,
    sha256: 'e1529d0d20a5ec57c17beb740b14966e5d3ade24e229623d75029b900fd5943e',
    supportedDlssg: ['310.9.0.0', '310.9.1.0', '310.9.16.0'],
    supportedStreamline: ['2.13.0.0', '2.14.1.0', '2.14.16.0']
  }),
  asiPlugin: Object.freeze({
    id: 'mfg-unlocker-1.7.0',
    name: 'MFG-Unlocker v1.7.0 (OptiScaler ASI / Universal)',
    upstream: 'https://github.com/dashdogy/MFG-Unlocker',
    license: 'MIT',
    version: '1.7.0.1145',
    releaseDate: '2026-10-25',
    fileName: 'MFGUnlocker.dll',
    // OptiScaler's ASI contract remains on its paired 1.7.0 build. Wuthering
    // Waves selects the independent universal loader through engine-packages.
    relPath: 'enhanced/mfg-optiscaler-170/MFGUnlocker.dll',
    size: 14445568,
    sha256: 'e6b6e6b70a6ed3af839c9647a32fc22660ae6b2d655062c5c072246c91fc10c7',
    supportedDlssg: ['310.9.0.0', '310.9.1.0', '310.9.16.0']
  })
});

// 已知经过社区上游实测的 RTX 40 MFG 游戏兼容性知识库
const TESTED_MFG_GAMES = Object.freeze([
  { pattern: /cyberpunk\s*2077/i, title: 'Cyberpunk 2077', status: 'experimental', notes: '上游已实测通过 x3/x4 原生 DLSS-G 插帧，建议配合 DLSS-G 310.9.1+ 使用。' },
  { pattern: /alan\s*wake\s*2/i, title: 'Alan Wake 2', status: 'experimental', notes: '上游已实测通过 x3/x4 多帧生成，8GB 显存下建议 1080p 开启 DLSS Quality。' },
  { pattern: /s\.?t\.?a\.?l\.?k\.?e\.?r\.?\s*2|stalker2/i, title: 'S.T.A.L.K.E.R. 2: Heart of Chornobyl', status: 'experimental', notes: '支持原生 3x/4x 选择器与 OTA/内置 DLSS-G 310.9 提供程序。' },
  { pattern: /black\s*myth.*wukong|b1-win64-shipping/i, title: 'Black Myth: Wukong (黑神话：悟空)', status: 'experimental', notes: '上游已验证支持 x3/x4 多帧生成。' },
  { pattern: /hogwarts\s*legacy/i, title: 'Hogwarts Legacy', status: 'experimental', hdrFix: true, notes: '若开启 HDR 出现闪烁，请启用 Automatic Guard + UI Composition (HDR 兼容模式)。' },
  { pattern: /jusant/i, title: 'Jusant', status: 'experimental', hdrFix: true, notes: '建议在 HDR 模式下启用 Automatic Guard + UI Composition。' },
  { pattern: /mafia.*old\s*country/i, title: 'Mafia: The Old Country', status: 'experimental', hdrFix: true, notes: '建议在 HDR 模式下启用 Automatic Guard + UI Composition。' },
  { pattern: /onimusha/i, title: 'Onimusha: Way of the Sword', status: 'experimental', notes: '上游 PresentMon 验证在 4x 模式下达到 3.998x 真实帧生成步进。' },
  { pattern: /monster\s*hunter\s*wilds/i, title: 'Monster Hunter Wilds', status: 'experimental', notes: '首次安装或重建 shader.cache2 后请等待着色器编译完成并重启游戏。' },
  { pattern: /god\s*of\s*war\s*ragnar/i, title: 'God of War Ragnarök', status: 'experimental', notes: '上游已实测通过 RTX 40 x3/x4 多帧生成。' },
  { pattern: /spider-?man\s*2/i, title: "Marvel's Spider-Man 2", status: 'experimental', notes: '上游已实测通过 RTX 40 x3/x4 多帧生成。' },
  { pattern: /silent\s*hill\s*2/i, title: 'Silent Hill 2', status: 'experimental', notes: '上游已实测通过 RTX 40 x3/x4 多帧生成。' },
  { pattern: /ghost\s*of\s*tsushima/i, title: 'Ghost of Tsushima', status: 'experimental', notes: '上游已实测通过 RTX 40 x3/x4 多帧生成。' },
  { pattern: /horizon\s*forbidden\s*west/i, title: 'Horizon Forbidden West', status: 'experimental', notes: '上游已实测通过 RTX 40 x3/x4 多帧生成。' },
  { pattern: /starfield/i, title: 'Starfield', status: 'experimental', notes: '上游已实测通过 RTX 40 x3/x4 多帧生成。' },
  { pattern: /witcher\s*3/i, title: 'The Witcher 3: Wild Hunt', status: 'experimental', notes: 'DX12 模式下支持 DLSS-G 310.9.x 升级与 x3/x4 解锁。' },
  { pattern: /dying\s*light.*beast/i, title: 'Dying Light: The Beast', status: 'experimental', notes: '上游已实测通过 RTX 40 x3/x4 多帧生成。' },
  { pattern: /indiana\s*jones/i, title: 'Indiana Jones and the Great Circle', status: 'experimental', notes: 'Vulkan 游戏：需添加启动参数 +r_allowBlackListedLayers 1 允许 ReShade 层加载。' },
  { pattern: /doom.*dark\s*ages/i, title: 'DOOM: The Dark Ages', status: 'experimental', notes: 'Vulkan 游戏：需添加启动参数 +r_allowBlackListedLayers 1 允许 ReShade 层加载。' }
]);

// 检测 GPU 对 NVIDIA DLSS-G 与 x3/x4 MFG 的底层硬件支持能力（支持笔记本 40 系、40 系桌面卡、50 系桌面卡三档）
// 注意：遵循严格要求，x3/x4 在未经当前游戏运行时实测验证生效前，绝不提前标记为“已验证可用”！
function evaluateMfgGpuSupport(gpuName = '', driverVersion = '', hardwareProfile = null, standaloneEngine = null, nvidiaPresent = null) {
  const arch = detectGpuArchitecture(nvidiaPresent === false ? '' : gpuName);
  if (arch.code === 'blackwell') {
    return {
      gpuName,
      driverVersion,
      hardwareProfile: hardwareProfile || 'rtx50_desktop',
      architecture: arch,
      hardwareOpticalFlow: true,
      hardwareFlipMetering: true,
      nativeX2: true,
      nativeX3X4: true,
      unlockRequiredForX3X4: false,
      supportedModes: ['off', 'x2', 'x3', 'x4'],
      modeBadges: {
        off: { status: 'verified', badge: '已验证可用' },
        x2: { status: 'untested', badge: '原生支持（需游戏验证）' },
        x3: { status: 'untested', badge: '原生支持（需游戏验证）' },
        x4: { status: 'untested', badge: '原生支持（需游戏验证）' }
      },
      summary: `${gpuName} (Blackwell / sm_120) 原生支持多帧生成，无需解锁。插件用于倍率与动态模式控制；实际可用倍率仍取决于游戏、驱动和运行库，需进入游戏验证。`
    };
  }

  // The standalone loader has a different hardware contract from the paired
  // RenoDX Ada addon. Only a fingerprint-identified, integrated engine may use
  // this experimental support assessment; a filename/version label is not enough.
  if (['turing', 'ampere'].includes(arch.code) && standaloneEngine?.component === 'mfg-universal' &&
      standaloneEngine.verified && standaloneEngine.compatible && /^1\.7\.[012](?:\.\d+)?$/.test(standaloneEngine.version)) {
    return {
      gpuName, driverVersion, hardwareProfile, architecture: arch,
      hardwareOpticalFlow: false, hardwareFlipMetering: false,
      nativeX2: false, nativeX3X4: false, unlockRequiredForX3X4: true,
      supportedModes: ['off', 'x2', 'x3', 'x4'],
      modeBadges: {
        off: { status: 'verified', badge: '已验证可用' },
        x2: { status: 'experimental', badge: '社区支持（需游戏验证）' },
        x3: { status: 'experimental', badge: '社区支持（需游戏验证）' },
        x4: { status: 'experimental', badge: '社区支持（需游戏验证）' }
      },
      summary: `${gpuName} (${arch.family}) 使用已识别的 MFG-Unlocker ${standaloneEngine.version} 独立路线。RTX 20 / 30 的 DLSS 多帧生成属于社区扩展，需兼容的 Streamline 接入、DLSS-G 运行库和驱动；实际倍率需进入游戏验证。`
    };
  }

  if (arch.code === 'ada') {
    const isDesktop40 = !arch.isLaptop;
    return {
      gpuName,
      driverVersion,
      hardwareProfile: hardwareProfile || (isDesktop40 ? 'rtx40_desktop' : 'rtx40_laptop'),
      architecture: arch,
      hardwareOpticalFlow: true,
      hardwareFlipMetering: true,
      nativeX2: true,
      nativeX3X4: false,
      unlockRequiredForX3X4: true,
      supportedModes: ['off', 'x2', 'x3', 'x4'],
      // 在未经当前游戏运行时实测确认前，x3/x4 标记为“实验性支持”，绝不提前虚标为“已验证可用”
      modeBadges: {
        off: { status: 'verified', badge: '已验证可用' },
        x2: { status: 'untested', badge: '原生支持（需游戏验证）' },
        x3: { status: 'experimental', badge: '实验性支持 (需运行时验证)' },
        x4: { status: 'experimental', badge: '实验性支持 (需运行时验证)' }
      },
      summary: `${gpuName} (Ada Lovelace / sm_89) 原生支持 x2 帧生成；x3/x4 使用社区组件的实验性支持，需兼容游戏和运行库。显卡能力不代表当前游戏已加载或生效。`
    };
  }

  const unknown = arch.code === 'unknown' && nvidiaPresent !== false;
  const unavailable = unknown ? { status: 'untested', badge: '尚未确认' } : { status: 'incompatible', badge: '不兼容' };
  return {
    gpuName,
    driverVersion,
    hardwareProfile,
    architecture: arch,
    hardwareOpticalFlow: false,
    hardwareFlipMetering: false,
    nativeX2: false,
    nativeX3X4: false,
    unlockRequiredForX3X4: false,
    supportedModes: ['off'],
    modeBadges: {
      off: { status: 'verified', badge: '已验证可用' },
      x2: unavailable,
      x3: unavailable,
      x4: unavailable
    },
    summary: nvidiaPresent === false ? classicGpuReason : unknown ? '显卡架构未识别，无法确认多帧生成能力；应用时不启用 Ada 专用修补。请先在设置中确认显卡检测结果。'
      : `${gpuName} (${arch.family}) 不具备 Ada/Blackwell 原生 DLSS-G 硬件能力。社区方案须按具体组件、游戏输入与安装路线另行判断，不能仅凭档位确认支持。`
  };
}

// 检验单个 nvngx_dlssg.dll 是否为正版 NVIDIA DLSS-G 二进制文件，拒绝 dlssg_to_fsr3 等第三方替换件
function inspectDlssgBinary(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { exists: false, valid: false, isFakeWrapper: false, version: null, reason: '未检测到 nvngx_dlssg.dll' };
  }
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err) {
    return { exists: true, valid: false, isFakeWrapper: false, version: null, reason: `读取失败: ${err.message}` };
  }
  const bitness = pe.getBitness(filePath, {dllOnly:true});
  const version = pe.getFileVersion(filePath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  // 检查是否为 dlssg-to-fsr3 或 Universal DLSSG to FSR3 伪装 DLL
  const hasFsr3Spoof = buf.includes(Buffer.from('dlssg_to_fsr3', 'latin1')) ||
    buf.includes(Buffer.from('amd_fidelityfx', 'latin1')) ||
    pe.versionMentions(filePath, 'dlssg-to-fsr3') ||
    pe.versionMentions(filePath, 'Nukem9');

  if (hasFsr3Spoof) {
    return {
      exists: true,
      valid: false,
      isFakeWrapper: true,
      filePath,
      version,
      sha256,
      reason: '检测到 nvngx_dlssg.dll 实际为第三方 dlssg-to-fsr3 (AMD FSR3 替换补丁)，并非真正的 NVIDIA DLSS-G 运行时！'
    };
  }

  const hasNvidiaDlssg = buf.includes(Buffer.from('nvngx_dlssg.pdb', 'latin1')) ||
    buf.includes(Buffer.from('DLSSGInstanceManager', 'latin1')) ||
    (pe.versionMentions(filePath, 'NVIDIA') &&
      ['D3D12','VULKAN'].some(api => pe.hasExports(filePath,
        ['CreateFeature','EvaluateFeature','ReleaseFeature'].map(fn=>'NVSDK_NGX_'+api+'_'+fn), 'nvngx_dlssg.dll')));

  if (!hasNvidiaDlssg || bitness !== 64 || !pe.matchesNvidiaFeature(filePath, 'fg')) {
    return {
      exists: true,
      valid: false,
      isFakeWrapper: false,
      filePath,
      version,
      sha256,
      reason: '该 nvngx_dlssg.dll 不是有效的 64 位 NVIDIA NGX DLSS-G 原生运行时'
    };
  }

  const knownMfg = MFG_UNLOCKERS.renodxAddon.supportedDlssg.includes(version);
  return {
    exists: true,
    valid: true,
    isFakeWrapper: false,
    filePath,
    fileName: path.basename(filePath),
    size: buf.length,
    version: version || '0.0.0.0',
    sha256,
    supportsMfgX3X4: knownMfg,
    reason: knownMfg
      ? `NVIDIA 原生 DLSS-G ${version}，支持 x2/x3/x4 多帧生成管线`
      : '已识别 NVIDIA DLSS-G，此版本的多帧生成配套尚未验证。'
  };
}

// 检测游戏目录中的注入器冲突与第三方补帧干扰
function detectMfgInjectorConflicts(gameDir, exeDir, scan, primaryDlssg) {
  const conflicts = [];
  if (!exeDir || !fs.existsSync(exeDir)) return conflicts;

  let files = [];
  try { files = fs.readdirSync(exeDir); } catch { return conflicts; }

  for (const name of files) {
    const lower = name.toLowerCase();
    const full = path.join(exeDir, name);

    if (/dlssg_to_fsr3/i.test(lower)) {
      conflicts.push({
        severity: 'error',
        file: name,
        code: 'CONFLICT_DLSSG_TO_FSR3',
        message: `检测到第三方 FSR3 帧生成替换组件 (${name})，会劫持并阻止原生 NVIDIA DLSS-G 运行。`
      });
    }
    if (/^(version|winmm|dinput8|winhttp)\.dll$/i.test(lower)) {
      const isMfgProxy = pe.versionMentions(full, 'MFGUnlocker') ||
        (() => { try { return fs.readFileSync(full).includes(Buffer.from('RTXMFG-Universal')); } catch { return false; } })();
      if (isMfgProxy && files.some((f) => /^renodx-mfgunlock\.addon64$/i.test(f))) {
        conflicts.push({
          severity: 'warning',
          file: name,
          code: 'DUPLICATE_MFG_UNLOCKER',
          message: `同时存在独立代理版 MFGUnlocker (${name}) 与 ReShade 插件版 renodx-mfgunlock.addon64，双钩子同时拦截 slDLSSGSetOptions 可能导致冲突。`
        });
      }
    }
  }

  const candidates = new Set((scan?.dlssFiles || [])
    .filter(file => /^nvngx_dlssg\.dll$/i.test(file.name) && file.bitness === 64).map(file => file.path));
  const adjacent = files.find(name => /^nvngx_dlssg\.dll$/i.test(name));
  if (adjacent) candidates.add(path.join(exeDir, adjacent));
  for (const file of candidates) {
    const check = primaryDlssg?.filePath === file ? primaryDlssg : inspectDlssgBinary(file);
    if (check.isFakeWrapper) {
      conflicts.push({severity:'error', file:path.relative(gameDir,file), code:'CONFLICT_FAKE_DLSSG', message:check.reason});
    }
  }

  // 检查游戏图形 API 是否支持原生 DLSS-G (仅 DirectX 12 与 Vulkan 支持)
  const apiLabel = scan?.chosen?.apiLabel || '';
  if (apiLabel && !['DirectX 12','Vulkan'].includes(apiLabel)) {
    conflicts.push({
      severity: 'error',
      file: scan?.chosen?.name || '',
      code: 'UNSUPPORTED_API_FOR_MFG',
      message: `当前游戏图形接口为 ${apiLabel}，而 NVIDIA 原生 DLSS-G / Streamline 帧生成仅支持 DirectX 12 与 Vulkan。`
    });
  }

  if (scan?.chosen?.bitness && scan.chosen.bitness !== 64) {
    conflicts.push({
      severity: 'error',
      file: scan?.chosen?.name || '',
      code: 'UNSUPPORTED_BITNESS_FOR_MFG',
      message: '32 位游戏不支持 64 位 NVIDIA NGX DLSS-G 原生多帧生成。'
    });
  }

  return conflicts;
}

// 解析游戏目录与系统临时目录中的 MFG 运行时日志与遥测状态，验证 x2/x3/x4 是否真实生效
function verifyMfgRuntimeStatus(gameDir, exeDir) {
  const dirs = [...new Set([exeDir, gameDir].filter(Boolean))];
  let providerVerified = false;
  let temporalFixApplied = false;
  let blackwellKernelsActive = false;
  let requestedMultiplier = null;
  let effectiveMultiplier = null;
  let presentedFrames = 0;
  let dlssgStatus = null;
  const errors = [];
  const logSources = [];

  // 1. 解析 ReShade.log 中的 MFGAdaUnlock-RenoDx 遥测与补丁日志
  for (const d of dirs) {
    const reshadeLog = path.join(d, 'ReShade.log');
    if (fs.existsSync(reshadeLog)) {
      try {
        const size = fs.statSync(reshadeLog).size;
        const fd = fs.openSync(reshadeLog, 'r');
        const readLen = Math.min(size, 256 * 1024);
        const buf = Buffer.alloc(readLen);
        fs.readSync(fd, buf, 0, readLen, Math.max(0, size - readLen));
        fs.closeSync(fd);
        const text = buf.toString('utf8');

        if (/MFGUnlock|renodx-mfgunlock/i.test(text)) {
          logSources.push(path.relative(gameDir, reshadeLog));
        }
        if (/verified mapped DLSS-G provider|PopulateParameters.*patched|0x1B0.*applied|DLSS-G provider verified/i.test(text)) {
          providerVerified = true;
        }
        if (/temporal fix applied|slot-9 temporal|reconstructed-fatbin.*applied/i.test(text)) {
          temporalFixApplied = true;
        }
        if (/Blackwell framework-kernel.*active|BlackwellFrameworkKernels.*applied/i.test(text)) {
          blackwellKernelsActive = true;
        }
        const multMatch = [...text.matchAll(/(?:effective|active|observed)\s*multiplier\s*[:=]\s*(\d+)x?/gi)].pop();
        if (multMatch) effectiveMultiplier = Number(multMatch[1]);
        const reqMatch = [...text.matchAll(/(?:ForceMultiplier|requested\s*multiplier)\s*[:=]\s*(\d+)x?/gi)].pop();
        if (reqMatch) requestedMultiplier = Number(reqMatch[1]);
        const presMatch = [...text.matchAll(/presented(?:\s*frames)?\s*[:=]\s*(\d+)/gi)].pop();
        if (presMatch) presentedFrames = Math.max(presentedFrames, Number(presMatch[1]));
        if (/unknown provider.*failing closed|patch failed|incompatible DLSS-G/i.test(text)) {
          errors.push('MFGAdaUnlock-RenoDx 报告当前 nvngx_dlssg.dll 指纹未知或内存补丁未应用 (Fail-Closed)。');
        }
      } catch {}
    }

    // 2. 解析 MFG-Unlocker 的 RTXMFG-Universal.status.json 状态文件
    const statusJson = path.join(d, 'RTXMFG-Universal.status.json');
    if (fs.existsSync(statusJson)) {
      try {
        const status = JSON.parse(fs.readFileSync(statusJson, 'utf8'));
        logSources.push(path.relative(gameDir, statusJson));
        if (status.providerVerified || status.patched) providerVerified = true;
        if (status.temporalFixApplied || status.temporalPatched) temporalFixApplied = true;
        if (Number(status.effectiveMultiplier) >= 2) effectiveMultiplier = Number(status.effectiveMultiplier);
        if (Number(status.requestedMultiplier) >= 2) requestedMultiplier = Number(status.requestedMultiplier);
        if (Number(status.presentedFrames) > 0) presentedFrames = Math.max(presentedFrames, Number(status.presentedFrames));
        if (status.dlssgStatus) dlssgStatus = String(status.dlssgStatus);
        if (status.error) errors.push(String(status.error));
      } catch {}
    }
  }

  return {
    // This inspection has no running process identity. Keep historical values
    // for the report, never turn them into a current-session verdict.
    verifiedActive: false,
    providerVerified,
    temporalFixApplied,
    blackwellKernelsActive,
    requestedMultiplier,
    effectiveMultiplier,
    presentedFrames,
    dlssgStatus,
    logSources,
    errors
  };
}

// 读取当前游戏目录已配置的 MFG 模式与参数
function installedEngineInfo(file, release) {
  const matched = require('./xemfg-optiscaler').matches(file, release, !require('./preview-fs').active());
  return {version:matched ? release.version : pe.getFileVersion(file), recognizedBuild:matched};
}
function privateStreamlineIssue(dir, config, target, prepareDlssg = false) {
  const libraryPath = feederConfig.getIni(config,'Libraries','OptiDllPath');
  const hostRoot = libraryPath == null || /^auto$/i.test(libraryPath) ? 'OptiScaler' : libraryPath.replace(/[\\/]/g,path.sep);
  const relative = path.relative(dir,path.resolve(dir,hostRoot,'streamline'));
  const modules = ['sl.interposer.dll','sl.common.dll','sl.dlss_g.dll','sl.reflex.dll','sl.pcl.dll'];
  try {
    for (const name of modules) {
      const file = journal.safePath(dir,path.join(relative,name));
      const symbols = name === 'sl.interposer.dll' ? ['slInit','slShutdown','slGetFeatureFunction'] : ['slGetPluginFunction'];
      if (pe.getBitness(file,{dllOnly:true}) !== 64 || !pe.hasExports(file,symbols,name))
        return 'OptiScaler 私有 Streamline 目录缺少有效的 64 位组件：' + name;
    }
    const privateNgx = journal.safePath(dir,path.join(relative,'nvngx_dlssg.dll'));
    // Streamline prefers its private directory, then searches the game's NGX
    // folders. A conflicting private provider takes precedence over a good copy.
    const privateExists = fs.existsSync(privateNgx);
    const candidates = privateExists ? [privateNgx] : [path.join(dir,'nvngx_dlssg.dll'), ...(target.gameDlssgProviders || [])
      .filter(file => { const rel = path.relative(dir,file); return !path.isAbsolute(rel) && !rel.split(path.sep).includes('..'); })];
    const featurePath = feederConfig.getIni(config,'Libraries','NvngxFeaturePath');
    if (!privateExists && featurePath && !/^auto$/i.test(featurePath))
      candidates.push(path.resolve(dir,featurePath.replace(/[\\/]/g,path.sep),'nvngx_dlssg.dll'));
    if (prepareDlssg && !candidates.some(file => fs.existsSync(file))) return null;
    const api = target.api === 'vulkan' ? 'VULKAN' : 'D3D12';
    const exports = ['CreateFeature','EvaluateFeature','ReleaseFeature'].map(entry => 'NVSDK_NGX_' + api + '_' + entry);
    if (!candidates.some(file => pe.getBitness(file,{dllOnly:true}) === 64 && pe.versionMentions(file,'NVIDIA') &&
        pe.matchesNvidiaFeature(file,'fg') && pe.hasExports(file,exports,'nvngx_dlssg.dll')))
      return 'OptiScaler 未找到可用于 DLSSG 输出的 NVIDIA nvngx_dlssg.dll。';
  } catch { return '无法检查 OptiScaler 的私有 Streamline 目录。'; }
  return null;
}

function classicAsiInput(target, config, input) {
  if (input === 'dlssg') return target.hasGameStreamlineFg;
  if (input !== 'upscaler') return target.api !== 'vulkan' && target.classicFgInputs?.includes(input);
  const kinds = target.api === 'vulkan' ? [...(target.classicVkUpscalerInputs || []), ...(target.hasXeMfgDlssSrVk ? ['dlss'] : [])] : target.optiFgInputs || [];
  const keys = {dlss:['EnableDlssInputs'],xess:['EnableXeSSInputs'],ffx:['EnableFfxInputs','UseFfxInputs'],
    fsr2:['EnableFsr2Inputs','UseFsr2Inputs'],fsr3:['EnableFsr3Inputs','UseFsr3Inputs']};
  const setting = key => feederConfig.getIni(config,'Inputs',key)?.toLowerCase();
  return kinds.some(kind => keys[kind]?.every(key => setting(key) !== 'false') &&
    (kind !== 'fsr2' || !['UseFsr2Dx11Inputs','UseFsr2VulkanInputs'].some(key => setting(key) === 'true')));
}

function classicMfgTarget(target, manifest, requested = 'auto', prepareDlssg = false) {
  const dir = path.dirname(target.path), ini = path.join(dir, 'OptiScaler.ini');
  const canLoadAsi = fs.existsSync(ini) && require('./anr').hasMfgAsiHost(target.path, target.api);
  const optiRoute = manifest?.route === 'optiscaler' ||
    (canLoadAsi && !fs.existsSync(path.join(dir, 'renodx-dlss5.addon64')));
  const backend = requested === 'auto' ? (optiRoute ? 'mfg-unlocker-asi' : 'renodx-mfgunlock') : requested;
  if (backend === 'renodx-mfgunlock') return {backend, issue:target.hasNativeDlssFg ? null : '当前程序未检测到可供 NVIDIA 补帧使用的 DLSS-G 输入。'};
  if (backend !== 'mfg-unlocker-asi') throw Error('无效的补帧后端');
  if (!canLoadAsi)
    return {backend, issue:'未检测到当前程序可加载的 OptiScaler ASI 宿主。'};
  const config = feederConfig.readText(ini);
  const output = feederConfig.getIni(config,'FrameGen','FGOutput')?.trim().toLowerCase();
  const input = feederConfig.getIni(config,'FrameGen','FGInput')?.trim().toLowerCase();
  const replacement = feederConfig.getIni(config,'FrameGen','FGNvngxReplacement')?.toLowerCase() ?? 'auto';
  if (!['none','auto'].includes(replacement)) return {backend, issue:'OptiScaler 已选择其他 DLSSG 提供程序，请先在宿主中切回 NVIDIA 输出。'};
  if (output !== 'dlssg' || !classicAsiInput(target,config,input))
    return {backend, issue:'当前程序缺少与 OptiScaler 配置匹配的补帧输入或 DLSSG 输出。'};
  return {backend,issue:privateStreamlineIssue(dir,config,target,prepareDlssg)};
}
function readCurrentMfgConfiguration(exeDir) {
  if (!exeDir || !fs.existsSync(exeDir)) {
    return { installed: false, backend: null, mode: 'off', multiplier: 1, settings: {} };
  }

  const addonFile = path.join(exeDir, 'renodx-mfgunlock.addon64');
  const asiFile = path.join(exeDir, 'OptiScaler', 'plugins', 'MFGUnlocker.asi');
  const reshadeIni = path.join(exeDir, 'ReShade.ini');
  const universalJson = path.join(exeDir, 'RTXMFG-Universal.json');
  const optiIni = path.join(exeDir, 'OptiScaler.ini');

  if (fs.existsSync(addonFile)) {
    const iniText = feederConfig.readText(reshadeIni);
    const enabled = feederConfig.getIni(iniText, 'RenoDX.MFGUnlock', 'Enabled');
    const forceMult = Number(feederConfig.getIni(iniText, 'RenoDX.MFGUnlock', 'ForceMultiplier') || 0);
    const temporalFix = !/^(false|0)$/i.test(feederConfig.getIni(iniText, 'RenoDX.MFGUnlock', 'TemporalFix'));
    const qualityGuard = Number(feederConfig.getIni(iniText, 'RenoDX.MFGUnlock', 'QualityGuardMode') || 0);
    const runtimeSelection = Number(feederConfig.getIni(iniText, 'RenoDX.MFGUnlock', 'RuntimeSelectionMode') || 0);
    const adaptiveProfile = Number(feederConfig.getIni(iniText, 'RenoDX.MFGUnlock', 'AdaptiveQualityProfile') || 0);
    const isOff = /^(false|0)$/i.test(enabled);
    const mult = isOff ? 1 : ([2, 3, 4].includes(forceMult) ? forceMult : 3);
    // Disabled Ada fixes do not establish the physical GPU architecture.
    const mfgStrategy = !temporalFix ? 'native_controls' : (adaptiveProfile === 2 ? 'ada_desktop_ultra' : 'ada_laptop_safe');
    return {
      installed: !isOff,
      backend: 'renodx-mfgunlock',
      ...installedEngineInfo(addonFile, MFG_UNLOCKERS.renodxAddon),
      backendName: MFG_UNLOCKERS.renodxAddon.name,
      mode: isOff ? 'off' : `x${mult}`,
      multiplier: mult,
      mfgStrategy,
      settings: {
        enabled: !isOff,
        forceMultiplier: mult,
        temporalFix,
        qualityGuardMode: qualityGuard,
        runtimeSelectionMode: runtimeSelection,
        adaptiveQualityProfile: adaptiveProfile
      }
    };
  }

  if (fs.existsSync(asiFile)) {
    let mult = 3;
    let enabled = true;
    let temporalFix = true;
    const host = feederConfig.readText(optiIni);
    if (host) {
      const fm = Number(feederConfig.getIni(host, 'MfgUnlock', 'ForceMultiplier') || 3);
      if ([2, 3, 4].includes(fm)) mult = fm;
      enabled = !/^(false|0)$/i.test(feederConfig.getIni(host, 'MfgUnlock', 'Enabled'));
      temporalFix = !/^(false|0)$/i.test(feederConfig.getIni(host, 'MfgUnlock', 'TemporalFix'));
    }
    if (fs.existsSync(universalJson)) {
      try {
        const cfg = JSON.parse(feederConfig.readText(universalJson));
        if (typeof cfg.enabled === 'boolean') enabled = cfg.enabled;
        if (typeof cfg.temporalFix === 'boolean') temporalFix = cfg.temporalFix;
        const fm = Number(cfg.multiplier ?? cfg.forceMultiplier);
        if ([2, 3, 4].includes(fm)) mult = fm;
      } catch {}
    }
    // The ASI delegates FG to OptiScaler. Prefer the host's interpolation
    // count over the old NeuralFrame/Enhanced settings when it is present.
    const count = [feederConfig.getIni(host, 'DLSSG', 'OverrideInterpolationCount'),
      feederConfig.getIni(host, 'DLSSG', 'InterpolationCount')].map(Number).find(n => [1,2,3].includes(n));
    if (count !== undefined) { mult = count + 1; enabled = true; }
    const output = feederConfig.getIni(host,'FrameGen','FGOutput')?.trim().toLowerCase();
    const replacement = feederConfig.getIni(host,'FrameGen','FGNvngxReplacement')?.trim().toLowerCase();
    if (/^(false|0)$/i.test(feederConfig.getIni(host,'Plugins','LoadAsiPlugins')) ||
        /^(false|0)$/i.test(feederConfig.getIni(host,'FrameGen','Enabled')) ||
        (output && output !== 'dlssg') || (replacement && !['none','auto'].includes(replacement))) enabled = false;
    return {
      installed: enabled,
      backend: 'mfg-unlocker-asi',
      ...installedEngineInfo(asiFile, MFG_UNLOCKERS.asiPlugin),
      backendName: MFG_UNLOCKERS.asiPlugin.name,
      mode: enabled ? `x${mult}` : 'off',
      multiplier: enabled ? mult : 1,
      settings: { enabled, forceMultiplier: mult, temporalFix }
    };
  }

  return { installed: false, backend: null, backendName: null, mode: 'off', multiplier: 1, settings: {} };
}

// 全面扫描游戏的 MFG 状态、DLSS-G 版本、Streamline 组件、GPU 兼容性与实际生效倍率
async function inspectGameMfgStatus(gameDir, {
  payloadDir,
  gpuName = '',
  nvidiaPresent = null,
  driverVersion = '',
  hardwareProfile = null,
  scanResult
} = {}) {
  const scan = scanResult || await scanGame(gameDir);
  const exePath = scan.chosen ? scan.chosen.path : null;
  const exeDir = exePath ? path.dirname(exePath) : gameDir;

  // 查找游戏中的 nvngx_dlssg.dll
  const dlssgFiles = scan.dlssFiles.filter((f) => /^nvngx_dlssg\.dll$/i.test(f.name) && f.bitness === 64 && !f.featureMismatch);
  const exeDlssg = path.join(exeDir, 'nvngx_dlssg.dll');
  const primaryDlssgPath = fs.existsSync(exeDlssg)
    ? exeDlssg
    : (dlssgFiles[0] ? dlssgFiles[0].path : null);
  const dlssgCheck = inspectDlssgBinary(primaryDlssgPath);

  // 查找 Streamline 组件
  const streamline = scan.streamlineFiles.filter(file => file.bitness === scan.chosen?.bitness && file.bitness === 64 && !file.featureMismatch);
  const slInterposer = streamline.find(file => /^sl\.interposer\.dll$/i.test(file.name));
  const slDlssg = streamline.find(file => /^sl\.dlss_g\.dll$/i.test(file.name));
  const slReflex = streamline.find(file => /^sl\.reflex\.dll$/i.test(file.name));

  const streamlineStatus = {
    present: Boolean(slInterposer || slDlssg),
    interposerVersion: slInterposer ? slInterposer.version : null,
    dlssgPluginVersion: slDlssg ? slDlssg.version : null,
    reflexPluginVersion: slReflex ? slReflex.version : null,
    filesCount: streamline.length
  };

  const wuwa = require('./wuthering-waves');
  const protectedRoot = exePath && wuwa.gameRoot(gameDir, exePath);
  const proxy = protectedRoot &&
    wuwa.inspectProxy(exeDir, require('./backend-manager').readManifest(gameDir));
  let gpuSupport = evaluateMfgGpuSupport(gpuName, driverVersion, hardwareProfile,
    proxy?.mfg?.engine && { ...proxy.mfg.engine, component: 'mfg-universal' }, nvidiaPresent);
  // Absence of an identified standalone engine is missing route evidence,
  // not proof that every community solution is incompatible. Do not add
  // supported modes or native capability before the bytes are recognized.
  const pendingStandalone = Boolean(protectedRoot && ['turing', 'ampere'].includes(gpuSupport.architecture.code) &&
    gpuSupport.modeBadges.x2.status === 'incompatible');
  if (pendingStandalone) {
    const pending = { status: 'untested', badge: '需校验独立组件' };
    gpuSupport = { ...gpuSupport,
      modeBadges: { ...gpuSupport.modeBadges, x2: pending, x3: pending, x4: pending } };
  }
  const currentConfig = proxy?.mfg || readCurrentMfgConfiguration(exeDir);
  const externalXeMfg = nvidiaPresent === false && proxy?.mfg.settings.xemfgStandalone === 1;
  const conflicts = detectMfgInjectorConflicts(gameDir, exeDir, scan, dlssgCheck);
  let configIssue;
  if (!protectedRoot && currentConfig.installed && scan.chosen) {
    configIssue = currentConfig.recognizedBuild
      ? classicMfgTarget(scan.chosen,null,currentConfig.backend).issue
      : '当前补帧插件的文件指纹尚未识别。';
    if (configIssue) conflicts.push({severity:'warning',code:'MFG_CONFIGURATION_UNVERIFIED',message:configIssue});
  }
  const runtimeVerification = verifyMfgRuntimeStatus(gameDir, exeDir);

  // 匹配已知实测游戏条目
  const gameTitle = path.basename(gameDir);
  const exeName = exePath ? path.basename(exePath) : '';
  const knownGame = TESTED_MFG_GAMES.find((g) => g.pattern.test(gameTitle) || g.pattern.test(exeName)) || null;

  // 计算当前游戏的兼容性状态徽章（严守原则：未经测试实际生效绝不标为“已验证可用”）
  let status = 'untested';
  let statusBadge = '尚未测试';
  if (conflicts.some((c) => c.severity === 'error')) {
    status = 'incompatible';
    statusBadge = '不兼容';
  } else if (pendingStandalone) {
    statusBadge = '独立方案待校验';
  } else if (gpuSupport.modeBadges.x2.status === 'incompatible') {
    status = 'incompatible';
    statusBadge = externalXeMfg ? 'NVIDIA DLSS-G 不可用 · 外部 XeMFG 已配置' : '不兼容';
  } else if (configIssue) {
    statusBadge = '当前补帧配置待核验';
  } else if (currentConfig.mode === 'x2' && dlssgCheck.valid && gpuSupport.nativeX2) {
    status = 'verified';
    statusBadge = '文件已安装（需游戏验证）';
  } else if (currentConfig.installed && currentConfig.mode !== 'off' && gpuSupport.nativeX3X4 && dlssgCheck.supportsMfgX3X4) {
    status = 'verified';
    statusBadge = '文件已安装（需游戏验证）';
  } else if (gpuSupport.architecture.code !== 'unknown' && (currentConfig.installed || knownGame || (dlssgCheck.valid && streamlineStatus.present))) {
    status = 'experimental';
    statusBadge = '实验性支持';
  }

  return {
    ok: Boolean(scan.chosen),
    gameDir,
    gameName: gameTitle,
    exePath,
    exeDir,
    api: scan.chosen ? scan.chosen.apiLabel : null,
    bitness: scan.chosen ? scan.chosen.bitness : null,
    hardwareProfile: gpuSupport.hardwareProfile,
    gpuSupport,
    dlssg: dlssgCheck,
    streamline: streamlineStatus,
    currentConfig,
    ...(proxy ? { engine: currentConfig.engine, advanced: currentConfig.advanced,
      version: currentConfig.version, packageId: currentConfig.packageId } : {}),
    effectiveMultiplier: nvidiaPresent === false
      ? (externalXeMfg ? '已读取外部 XeMFG 配置，实际倍率待游戏验证' : 'NVIDIA DLSS-G 不可用')
      : currentConfig.installed ? `${currentConfig.mode} (待进入游戏验证)` : '未启用 (1x)',
    runtimeVerification,
    conflicts,
    knownGame,
    hasBackup: scan.hasBackup,
    status,
    statusBadge,
    unlockers: MFG_UNLOCKERS
  };
}

// 自动配置并安装/更新 MFG 模式 (Off / x2 / x3 / x4)，所有修改均纳入 _DLSS5_Backup 事务，支持一键恢复
async function applyMfgConfiguration(gameDir, options = {}, onLog = () => {}) {
  const {
    mode = 'off', // 'off' | 'x2' | 'x3' | 'x4'
    backend = 'auto', // 'auto' | 'renodx-mfgunlock' | 'mfg-unlocker-asi'
    upgradeDlssg = true, // 是否自动将旧版或缺失的 nvngx_dlssg.dll 升级至 310.9.1 / 310.9.16
    runtimeStack = null, // 'baseline-310.9.1' | 'oct2026-310.9.16'
    hdrCompatibility = false, // 是否开启 Automatic Guard + UI Composition (HDR 修复)
    hardwareProfile = 'rtx40_laptop', // 'rtx40_laptop' | 'rtx40_desktop' | 'rtx50_desktop'
    payloadDir
  } = options;

  // A preset controls tuning, not the GPU architecture. RTX 50 must never
  // receive Ada patches merely because the user borrows a lower-memory preset.
  // Without hardware evidence, leave architecture-specific patches disabled.
  const gpuArchitecture = detectGpuArchitecture(options.gpuName || '');
  const adaPatches = gpuArchitecture.code === 'ada';

  if (!['off', 'x2', 'x3', 'x4'].includes(mode)) {
    throw Object.assign(new Error(`无效的 MFG 模式: ${mode}`), { code: 'errInvalidMfgMode' });
  }
  if (mode !== 'off') assertMfgGpu(options.nvidiaPresent);

  const scan = require('./game-api').withGameApi(await scanGame(gameDir, options.exePath), options.apiOverride);
  if (!scan.chosen) throw Object.assign(new Error('未在游戏目录中找到可执行文件'), { code: 'errNoExe' });
  if (options.exePath && path.resolve(options.exePath).toLowerCase() !== path.resolve(scan.chosen.path).toLowerCase())
    throw Object.assign(new Error('所选游戏程序已不在扫描列表中，请重新选择。'), { code: 'errSelectedExeMissing' });
  const exePath = scan.chosen.path;
  const exeDir = path.dirname(exePath);
  const bitness = scan.chosen.bitness || 64;

  if (bitness !== 64) {
    throw Object.assign(new Error('NVIDIA DLSS-G 多帧生成仅支持 64 位游戏'), { code: 'errMfgBitness' });
  }
  if (!apply.canWrite(gameDir) || !apply.canWrite(exeDir)) {
    throw Object.assign(new Error('游戏目录无写入权限'), { code: 'errNoWriteAccess' });
  }

  return journal.transaction(gameDir, async () => {
    const manifest = apply.beginManifest(gameDir, exePath, scan.chosen.api || 'dxgi', {requireSameExe:true});
    const addonDest = path.join(exeDir, 'renodx-mfgunlock.addon64');
    const asiDest = path.join(exeDir, 'OptiScaler', 'plugins', 'MFGUnlocker.asi');
    const reshadeIniPath = path.join(exeDir, 'ReShade.ini');
    const optiIniPath = path.join(exeDir, 'OptiScaler.ini');

    // 当选择 Off 时，移除已安装的 MFG 解锁插件并清理配置项
    if (mode === 'off') {
      for (const target of [addonDest, asiDest]) {
        if (fs.existsSync(target)) {
          await apply.trackBeforeWrite(manifest, gameDir, target, { kind: 'disabled-component' });
          await replaceFile.makeWritable(target).catch(() => {});
          await fs.promises.unlink(target);
          onLog({ code: 'mfgComponentRemoved', params: { file: path.basename(target) } });
        }
      }
      if (fs.existsSync(reshadeIniPath)) {
        let iniText = feederConfig.readText(reshadeIniPath);
        iniText = feederConfig.setEarlyAddon(iniText, 'renodx-mfgunlock.addon64', false);
        iniText = feederConfig.setIni(iniText, 'RenoDX.MFGUnlock', 'Enabled', '0');
        await apply.writeTracked(manifest, gameDir, reshadeIniPath, iniText, { kind: 'config' });
      }
      await optiMfgConfig.configureAsi(gameDir, manifest, optiIniPath, null);
      manifest.hardwareProfile = hardwareProfile;
      manifest.mfg = { mode: 'off', multiplier: 1, backend: null, hardwareProfile, updatedAt: new Date().toISOString() };
      await apply.saveActiveManifest(gameDir, manifest);
      return { ok: true, mode: 'off', multiplier: 1, backend: null, hardwareProfile };
    }

    // 检查是否存在严重冲突（如 dlssg-to-fsr3）
    const conflicts = detectMfgInjectorConflicts(gameDir, exeDir, scan);
    const fatalConflict = conflicts.find((c) => c.severity === 'error');
    if (fatalConflict) {
      throw Object.assign(new Error(fatalConflict.message), { code: fatalConflict.code, conflicts });
    }

    const multiplier = Number(mode.slice(1)); // 2, 3, 4
    const {backend:selectedBackend, issue} = classicMfgTarget(scan.chosen, manifest, backend, upgradeDlssg);
    if (issue) throw Object.assign(Error(issue), {code:'errMfgInput'});

    // Older installs could replace the game's Streamline SDK. Repair only a
    // replacement still attributable to the active receipt. An archived backup
    // belongs to another install and may predate an official game update.
    for (const slName of ['sl.interposer.dll', 'sl.common.dll', 'sl.dlss.dll', 'sl.dlss_g.dll', 'sl.reflex.dll', 'sl.pcl.dll']) {
      const destination = path.join(exeDir, slName);
      const rel = path.relative(gameDir, destination);
      const receipt = manifest.replaced.find(entry => path.relative(entry.rel, rel) === '');
      if (!receipt?.newVersion || pe.getFileVersion(destination) !== receipt.newVersion) continue;
      const backup = apply.originalPath(gameDir, manifest, receipt.rel);
      const originalVersion = pe.getFileVersion(backup);
      if (!originalVersion || (receipt.oldVersion && receipt.oldVersion !== originalVersion)) continue;
      await journal.capture(gameDir, destination);
      await replaceFile.copyFile(backup, destination, { clearReadOnly: true });
      manifest.replaced = manifest.replaced.filter(entry => entry !== receipt);
    }

    // 1. 确保游戏具备支持 x2/x3/x4 的正版 nvngx_dlssg.dll (310.9.16.0)
    const effectivePayloadDir = resolvePayloadDir(payloadDir);

    // 50 系桌面卡默认优先使用 2026-10 最新 310.9.16 + Streamline 2.14.16 运行时栈
    const effectiveStack = runtimeStack || (hardwareProfile === 'rtx50_desktop' ? 'oct2026-310.9.16' : 'baseline-310.9.1');

    if (upgradeDlssg && effectivePayloadDir) {
      // MFGAdaUnlock-RenoDx v1.4.4 专为 DLSS-G 310.9.16.0 构建；
      // 仅升级 NGX C ABI 兼容的 nvngx_dlssg.dll (310.9.16.0)，严禁覆盖游戏自带的 sl.dlss_g.dll / sl.reflex.dll / sl.pcl.dll，
      // 否则当游戏自带旧版 sl.common.dll (如 HITMAN 3 的 Streamline 2.2.0.0) 时会因 C++ 插件结构体 ABI 不匹配在 sl.common.dll+0x47932 崩溃！
      const dlssgEnh = path.join(effectivePayloadDir, 'enhanced', 'streamline-2.14.16', 'nvngx_dlssg.dll');
      const srcDlssg = fs.existsSync(dlssgEnh)
        ? dlssgEnh
        : path.join(effectivePayloadDir, 'streamline', 'nvngx_dlssg.dll');

      if (fs.existsSync(srcDlssg)) {
        const dlssgTargets = scan.dlssFiles
          .filter((f) => /^nvngx_dlssg\.dll$/i.test(f.name) && f.bitness === 64 && !f.featureMismatch)
          .map((f) => f.path);
        if (!dlssgTargets.length) dlssgTargets.push(path.join(exeDir, 'nvngx_dlssg.dll'));

        for (const dest of dlssgTargets) {
          await apply.copyTracked(manifest, gameDir, srcDlssg, dest, {
            kind: 'runtime',
            runtimeBitness: 64,
            newVersion: pe.getFileVersion(srcDlssg)
          });
          onLog({
            code: 'mfgDlssgPrepared',
            params: { rel: path.relative(gameDir, dest), version: pe.getFileVersion(srcDlssg) }
          });
        }
      }
    }

    if (upgradeDlssg && selectedBackend === 'mfg-unlocker-asi') {
      const outputIssue = privateStreamlineIssue(exeDir,feederConfig.readText(optiIniPath),scan.chosen);
      if (outputIssue) throw Object.assign(Error(outputIssue),{code:'errMfgInput'});
    }

    // 2. 根据所选后端与硬件档位部署 MFG 解锁器与配置文件
    if (selectedBackend === 'renodx-mfgunlock') {
      const srcAddon = effectivePayloadDir ? path.join(effectivePayloadDir, MFG_UNLOCKERS.renodxAddon.relPath) : null;
      if (!srcAddon || !fs.existsSync(srcAddon)) {
        throw Object.assign(new Error('未找到内置 renodx-mfgunlock.addon64 组件载荷'), { code: 'errMfgPayloadMissing' });
      }
      // 校验 SHA-256 指纹
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(srcAddon)).digest('hex');
      if (actualHash !== MFG_UNLOCKERS.renodxAddon.sha256) {
        throw Object.assign(new Error('renodx-mfgunlock.addon64 SHA-256 校验不匹配'), { code: 'errMfgHashMismatch' });
      }

      // 若之前存在 ASI 版，先清理避免双钩子冲突
      await optiMfgConfig.configureAsi(gameDir, manifest, optiIniPath, null);
      if (fs.existsSync(asiDest)) {
        await apply.trackBeforeWrite(manifest, gameDir, asiDest, { kind: 'disabled-component' });
        await replaceFile.makeWritable(asiDest);
        await fs.promises.unlink(asiDest);
      }

      await require('./optional-graphics').prepareReShadeHost({
        gameDir,exe:scan.chosen,manifest,payloadDir:effectivePayloadDir,
        userDataDir:options.userDataDir || path.join(os.homedir(),'AppData','Roaming','dlss5-swapper-enhanced'),
        reshadeProxy:options.reshadeProxy,registryRunner:options.registryRunner
      },onLog);
      await apply.copyTracked(manifest, gameDir, srcAddon, addonDest, {
        kind: 'addon',
        newVersion: MFG_UNLOCKERS.renodxAddon.version
      });
      const licenseSrc = effectivePayloadDir ? path.join(effectivePayloadDir, 'enhanced', 'mfg', 'licenses', 'MFGAdaUnlock-RenoDx-LICENSE.txt') : null;
      if (licenseSrc && fs.existsSync(licenseSrc)) {
        await apply.copyTracked(manifest, gameDir, licenseSrc, path.join(exeDir, 'MFGAdaUnlock-RenoDx-LICENSE.txt'), { kind: 'license' });
      }

      // 写入 LoadFromDllMain=renodx-mfgunlock.addon64 与 AddonPath=.\：
      // 确保在杀手3 / 007 First Light 等会在 D3D12 之前创建并销毁临时 D3D11 设备的游戏中，
      // renodx-mfgunlock.addon64 保持常驻 (pin_addon=true) 并在 slInit 阶段抢先完成 nvngx_dlssg.dll 解锁补丁
      let iniText = feederConfig.readText(reshadeIniPath);
      iniText = feederConfig.setEarlyAddon(iniText, 'renodx-mfgunlock.addon64', true);
      let settingsPairs;

      if (!adaPatches) {
        // Physical RTX 50 keeps native MFG; an unrecognized GPU uses the same
        // conservative no-Ada-patch settings without claiming native support.
        // 严禁启用 Ada 40 系的 TemporalFix 和 BlackwellFrameworkKernels 补丁，保留 100% 原生第 5 代硬件 Flip Metering，仅注入倍率控制以兼容仅含 2x 菜单的老游戏
        settingsPairs = [
          ['OVERLAY', 'UiLanguage', 'zh-Hans'],
          ['ADDON', 'AddonPath', '.\\'],
          ['RenoDX.MFGUnlock', 'Enabled', '1'],
          ['RenoDX.MFGUnlock', 'MaxCount', '4'],
          ['RenoDX.MFGUnlock', 'ForceMultiplier', String(multiplier)],
          ['RenoDX.MFGUnlock', 'DynamicMFG', '1'],
          ['RenoDX.MFGUnlock', 'TemporalFix', '0'],
          ['RenoDX.MFGUnlock', 'BlackwellFrameworkKernels', '0'],
          ['RenoDX.MFGUnlock', 'ForceFlipMeteringOff', '0'],
          ['RenoDX.MFGUnlock', 'ExperimentalAdaptiveQuality', '0'],
          ['RenoDX.MFGUnlock', 'AdaptiveQualityProfile', '0'],
          ['RenoDX.MFGUnlock', 'AdaptiveQualityV3StabilityMode', '0'],
          ['RenoDX.MFGUnlock', 'AdaptiveQualityV3InpaintMode', '0'],
          ['RenoDX.MFGUnlock', 'IntermediateScatterRetention', '0'],
          ['RenoDX.MFGUnlock', 'ValidatedWarpBlend', '0'],
          ['RenoDX.MFGUnlock', 'BoundaryArtifactMitigationMode', '0'],
          ['RenoDX.MFGUnlock', 'RaiseFrameCeiling', '1'],
          ['RenoDX.MFGUnlock', 'HDRCompatibilityMode', hdrCompatibility ? '2' : '0'],
          ['RenoDX.MFGUnlock', 'QualityGuardMode', hdrCompatibility ? '2' : '0'],
          ['RenoDX.MFGUnlock', 'RuntimeSelectionMode', '1']
        ];
      } else if (hardwareProfile === 'rtx40_desktop') {
        // 档位 ②：RTX 40 系桌面卡满血高锐度低延迟补帧模式
        // 启用 Early DllMain 抢先注入、Dynamic MFG 动态多帧生成、Luminance+Directional V3 高锐度配置与 Reflex 低延迟保护
        settingsPairs = [
          ['OVERLAY', 'UiLanguage', 'zh-Hans'],
          ['ADDON', 'AddonPath', '.\\'],
          ['RenoDX.MFGUnlock', 'Enabled', '1'],
          ['RenoDX.MFGUnlock', 'MaxCount', '4'],
          ['RenoDX.MFGUnlock', 'ForceMultiplier', String(multiplier)],
          ['RenoDX.MFGUnlock', 'DynamicMFG', '1'],
          ['RenoDX.MFGUnlock', 'TemporalFix', '1'],
          ['RenoDX.MFGUnlock', 'BlackwellFrameworkKernels', '1'],
          ['RenoDX.MFGUnlock', 'ExperimentalAdaptiveQuality', '1'],
          ['RenoDX.MFGUnlock', 'AdaptiveQualityProfile', '2'],
          ['RenoDX.MFGUnlock', 'AdaptiveQualityV3StabilityMode', '1'],
          ['RenoDX.MFGUnlock', 'AdaptiveQualityV3InpaintMode', '1'],
          ['RenoDX.MFGUnlock', 'IntermediateScatterRetention', '1'],
          ['RenoDX.MFGUnlock', 'ValidatedWarpBlend', '1'],
          ['RenoDX.MFGUnlock', 'BoundaryArtifactMitigationMode', '1'],
          ['RenoDX.MFGUnlock', 'RaiseFrameCeiling', '1'],
          ['RenoDX.MFGUnlock', 'LatencyGuardMode', '0'],
          ['RenoDX.MFGUnlock', 'ReflexModeOverride', '0'],
          ['RenoDX.MFGUnlock', 'HDRCompatibilityMode', hdrCompatibility ? '2' : '0'],
          ['RenoDX.MFGUnlock', 'QualityGuardMode', hdrCompatibility ? '2' : '0'],
          ['RenoDX.MFGUnlock', 'RuntimeSelectionMode', '1']
        ];
      } else {
        // 档位 ①：笔记本 RTX 40 系列（默认黄金档 · 开启 Dynamic MFG 动态多帧生成 + 原生输入模式 QualityGuardMode=0 防黑屏）
        settingsPairs = [
          ['OVERLAY', 'UiLanguage', 'zh-Hans'],
          ['ADDON', 'AddonPath', '.\\'],
          ['RenoDX.MFGUnlock', 'Enabled', '1'],
          ['RenoDX.MFGUnlock', 'MaxCount', '4'],
          ['RenoDX.MFGUnlock', 'ForceMultiplier', String(multiplier)],
          ['RenoDX.MFGUnlock', 'DynamicMFG', '1'],
          ['RenoDX.MFGUnlock', 'TemporalFix', '1'],
          ['RenoDX.MFGUnlock', 'BlackwellFrameworkKernels', '1'],
          ['RenoDX.MFGUnlock', 'ExperimentalAdaptiveQuality', '1'],
          ['RenoDX.MFGUnlock', 'AdaptiveQualityProfile', '2'],
          ['RenoDX.MFGUnlock', 'IntermediateScatterRetention', '1'],
          ['RenoDX.MFGUnlock', 'ValidatedWarpBlend', '1'],
          ['RenoDX.MFGUnlock', 'BoundaryArtifactMitigationMode', '1'],
          ['RenoDX.MFGUnlock', 'RaiseFrameCeiling', '1'],
          ['RenoDX.MFGUnlock', 'HDRCompatibilityMode', hdrCompatibility ? '2' : '0'],
          ['RenoDX.MFGUnlock', 'QualityGuardMode', hdrCompatibility ? '2' : '0'],
          ['RenoDX.MFGUnlock', 'RuntimeSelectionMode', '1']
        ];
      }

      for (const [sec, key, val] of settingsPairs) {
        if (key === 'UiLanguage' && feederConfig.getIni(iniText, sec, key)) continue;
        iniText = feederConfig.setIni(iniText, sec, key, val);
      }
      await apply.writeTracked(manifest, gameDir, reshadeIniPath, iniText, { kind: 'config' });
      await apply.enableAddonInIni(exeDir, 'renodx-mfgunlock.addon64', (code, params) => onLog({ code, params }), gameDir, manifest, effectivePayloadDir);
      onLog({ code: 'mfgConfigured', params: { backend: 'renodx-mfgunlock', mode, multiplier, hardwareProfile } });
    } else {
      // 部署 MFG-Unlocker (OptiScaler ASI 插件模式)
      const srcAsi = effectivePayloadDir ? path.join(effectivePayloadDir, MFG_UNLOCKERS.asiPlugin.relPath) : null;
      if (!srcAsi || !fs.existsSync(srcAsi)) {
        throw Object.assign(new Error('未找到内置 MFGUnlocker.dll 组件载荷'), { code: 'errMfgPayloadMissing' });
      }
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(srcAsi)).digest('hex');
      if (actualHash !== MFG_UNLOCKERS.asiPlugin.sha256) {
        throw Object.assign(new Error('MFGUnlocker.dll SHA-256 校验不匹配'), { code: 'errMfgHashMismatch' });
      }

      if (fs.existsSync(addonDest)) {
        await apply.trackBeforeWrite(manifest, gameDir, addonDest, { kind: 'disabled-component' });
        await replaceFile.makeWritable(addonDest);
        await fs.promises.unlink(addonDest);
      }
      const previousIni = feederConfig.readText(reshadeIniPath);
      const nextIni = feederConfig.setEarlyAddon(previousIni, 'renodx-mfgunlock.addon64', false);
      if (previousIni !== nextIni) await apply.writeTracked(manifest, gameDir, reshadeIniPath, nextIni, { kind: 'config' });

      await apply.copyTracked(manifest, gameDir, srcAsi, asiDest, {
        kind: 'optiscaler-plugin',
        newVersion: MFG_UNLOCKERS.asiPlugin.version
      });
      const licenseSrc = effectivePayloadDir ? path.join(effectivePayloadDir, 'enhanced', 'mfg', 'licenses', 'MFG-Unlocker-LICENSE.txt') : null;
      if (licenseSrc && fs.existsSync(licenseSrc)) {
        await apply.copyTracked(manifest, gameDir, licenseSrc, path.join(exeDir, 'OptiScaler', 'licenses', 'MFG-Unlocker-LICENSE.txt'), { kind: 'license' });
      }

      await optiMfgConfig.configureAsi(gameDir, manifest, optiIniPath, multiplier);
      onLog({ code: 'mfgConfigured', params: { backend: 'mfg-unlocker-asi', mode, multiplier, hardwareProfile } });
    }

    manifest.hardwareProfile = hardwareProfile;
    manifest.mfg = {
      mode,
      multiplier,
      backend: selectedBackend,
      runtimeStack: effectiveStack,
      hardwareProfile,
      hdrCompatibility: selectedBackend === 'renodx-mfgunlock' && Boolean(hdrCompatibility),
      updatedAt: new Date().toISOString()
    };
    await apply.saveActiveManifest(gameDir, manifest);

    const support = evaluateMfgGpuSupport(options.gpuName || '', '', hardwareProfile);
    const capability = support.architecture.code === 'unknown' ? { status: 'untested', badge: '尚未测试' } : support.modeBadges[mode];
    return {
      ok: true,
      mode,
      multiplier,
      backend: selectedBackend,
      runtimeStack: effectiveStack,
      hardwareProfile,
      // Installation and hardware capability are not runtime verification.
      status: capability.status,
      statusBadge: capability.badge
    };
  });
}

module.exports = {
  assertMfgGpu,
  classicMfgTarget,
  MFG_UNLOCKERS,
  TESTED_MFG_GAMES,
  evaluateMfgGpuSupport,
  inspectDlssgBinary,
  detectMfgInjectorConflicts,
  verifyMfgRuntimeStatus,
  readCurrentMfgConfiguration,
  inspectGameMfgStatus,
  applyMfgConfiguration
};
