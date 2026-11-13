'use strict';
// 模块 C：DLSS 5 神经渲染 + NVIDIA MFG 多帧生成联合运行与兼容性诊断管理器
// 支持独立控制 Neural Rendering (Off / Legacy Model / Latest Compatible Model) 与
// Multi Frame Generation (Off / x2 / x3 / x4)，并全面执行 7 项联合兼容性、显存预算、Reflex 延迟与备份完整性检查。

const fs = require('./preview-fs').fs;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const pe = require('./pe');
const journal = require('./file-journal');
const apply = require('./apply');
const backends = require('./backend-manager');
const feederConfig = require('./feeder-config');
const { scanGame } = require('./scan');
const { apiPreferenceKey, withGameApi } = require('./game-api');
const neuralModels = require('./neural-models');
const wuwa = require('./wuthering-waves');
const mfgManager = require('./mfg-manager');
const { selectHardwareProfile } = require('./hardware-profile');

// 硬件环境缓存（避免每次刷新面板重复调用外部进程）
let cachedHardwareInfo = null;

function runCmd(file, args, timeout = 8000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || '').trim());
    });
  });
}

// 显示器随窗口变化，由主进程单独读取。
async function detectHardwareEnvironment(forceRefresh = false) {
  if (cachedHardwareInfo && !forceRefresh) return cachedHardwareInfo;

  const cpus = os.cpus() || [];
  const cpuModel = cpus[0] ? cpus[0].model.trim() : 'Unknown CPU';
  const totalRamGB = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;

  let gpuName = '';
  let driverVersion = '';
  let vramTotalMB = null;
  let vramUsedMB = null;
  let vramFreeMB = null;
  let powerDefaultW = null;
  let powerMaxW = null;

  try {
    const smiOut = await runCmd('nvidia-smi.exe', [
      '--query-gpu=name,driver_version,memory.total,memory.used,memory.free,power.default_limit,power.max_limit',
      '--format=csv,noheader,nounits'
    ]);
    const fields = smiOut.split(/\r?\n/).map(line => line.split(',').map(value => value.trim()))
      .find(row => row.length === 7 && row[0] && !/^(?:N\/A|unknown|\[.*\])$/i.test(row[0]));
    if (fields) {
      gpuName = fields[0];
      if (/^\d+(?:\.\d+)+$/.test(fields[1])) driverVersion = fields[1];
      const numbers = fields.slice(2).map(value => /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null);
      [vramTotalMB, vramUsedMB, vramFreeMB, powerDefaultW, powerMaxW] = numbers;
      vramTotalMB = vramTotalMB || null;
      powerDefaultW = powerDefaultW || null;
      powerMaxW = powerMaxW || null;
    }
  } catch {}

  const gpuArch = neuralModels.detectGpuArchitecture(gpuName);
  cachedHardwareInfo = {
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: cpuModel,
    cpuCores: cpus.length,
    ramGB: totalRamGB,
    gpu: {
      name: gpuName,
      detected: Boolean(gpuName),
      driver: driverVersion,
      architecture: gpuArch,
      vramTotalMB,
      vramUsedMB,
      vramFreeMB,
      powerDefaultW,
      powerMaxW
    },
    display: null
  };
  return cachedHardwareInfo;
}

function savedProfile(manifest) {
  const isProfile = id => Object.hasOwn(neuralModels.HARDWARE_PROFILES, id || '');
  const entries = [manifest?.neuralRendering, manifest?.mfg]
    .filter(entry => isProfile(entry?.hardwareProfile))
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  // Enhanced 2.3.0's Off branch only wrote the nested module profile.
  // This can leave the top-level value missing or left over from the previous On.
  const latest = entries[0];
  if (latest?.mode === 'off' && Date.parse(latest.updatedAt)) return latest.hardwareProfile;
  return isProfile(manifest?.hardwareProfile) ? manifest.hardwareProfile : latest?.hardwareProfile;
}

// 解析当前生效的硬件优化档位（优先使用用户显式选择的档位，其次读取游戏备份清单，最后按显卡型号自动匹配）
function resolveHardwareProfile(requestedProfile, gpuName = '', manifestProfile = null, defaultProfile = null, vramTotalMB) {
  return selectHardwareProfile({ requestedProfile, manifestProfile, defaultProfile, gpu: { name: gpuName, vramTotalMB } }).id;
}

// 评估在各硬件档位（笔记本 40 系列 8GB / 40 系桌面卡 / 50 系桌面卡）下同时或单独开启 DLSS 5 与 MFG 的显存预算
function estimateVramBudget({
  neuralMode = 'off', mfgMode = 'off', vramTotalMB, hardwareProfile = 'rtx40_laptop'
} = {}) {
  const desktop = hardwareProfile === 'rtx40_desktop' || hardwareProfile === 'rtx50_desktop';
  const baseGame1080pMB = desktop ? 6800 : 5400;
  const neuralOverheadMB = neuralMode === 'off' ? 0 : (desktop ? 920 : 680);
  const mfgCosts = desktop ? { x2: 420, x3: 620, x4: 820 } : { x2: 340, x3: 510, x4: 660 };
  if (mfgMode !== 'off' && !Object.hasOwn(mfgCosts, mfgMode)) return {
    hardwareProfile, level: 'unknown', vramTotalMB: vramTotalMB || null,
    summary: '动态、跟随游戏或高倍率模式没有固定显存估算，请以游戏中的实际占用为准。'
  };
  const mfgOverheadMB = mfgCosts[mfgMode] || 0;
  const totalAddedOverheadMB = neuralOverheadMB + mfgOverheadMB;
  const estimatedTotalMB = baseGame1080pMB + totalAddedOverheadMB;
  const measured = Number.isFinite(vramTotalMB) && vramTotalMB > 0;
  const headroomMB = measured ? vramTotalMB - estimatedTotalMB : null;
  const usagePercent = measured ? Math.round(100 * estimatedTotalMB / vramTotalMB) : null;
  let level = 'unknown';
  if (measured) {
    if (headroomMB < 400) level = 'critical';
    else if (desktop ? headroomMB < 800 : headroomMB < 1000 && totalAddedOverheadMB > 800) level = 'caution';
    else level = 'safe';
  }
  return {
    resolution: '1920x1080',
    hardwareProfile, baseGame1080pMB, neuralOverheadMB, mfgOverheadMB, totalAddedOverheadMB, estimatedTotalMB,
    vramTotalMB: measured ? vramTotalMB : null, headroomMB, usagePercent, level,
    summary: measured
      ? `1080p 参考占用 ${estimatedTotalMB} / ${vramTotalMB} MiB，参考余量 ${headroomMB} MiB。`
      : `1080p 参考占用 ${estimatedTotalMB} MiB，未检测到显存容量。`
  };
}

// 执行 7 项 DLSS 5 + MFG 联合运行深度兼容性检查
function evaluateCoExecutionChecks(gameDir, scan, neuralStatus, mfgStatus, hardware, hardwareProfile = 'rtx40_laptop',
  launcherProtected = Boolean(wuwa.gameRoot(gameDir, scan.chosen?.path))) {
  const exeDir = scan.chosen ? path.dirname(scan.chosen.path) : gameDir;
  const bothActive = neuralStatus.mode !== 'off' && mfgStatus.currentConfig.mode !== 'off';

  // 1. 各模块的 DLL 是否冲突（若当前未开启 MFG 补帧模块，则忽略仅针对 MFG 的 API/位数提示，防止 DX8/DX9/DX10/DX11/32位老游戏误报红色“不兼容”）
  const mfgActive = Boolean(mfgStatus.currentConfig?.installed && mfgStatus.currentConfig?.mode && mfgStatus.currentConfig?.mode !== 'off');
  const dllConflicts = [...(mfgStatus.conflicts || [])].filter((c) => {
    if (!mfgActive && (c.code === 'UNSUPPORTED_API_FOR_MFG' || c.code === 'UNSUPPORTED_BITNESS_FOR_MFG')) {
      return false;
    }
    return true;
  });
  const hasReshadeAddonNr = fs.existsSync(path.join(exeDir, 'renodx-dlss5.addon64')) ||
    fs.existsSync(path.join(exeDir, 'renodx-dlss.addon64'));
  const hasReshadeAddonMfg = fs.existsSync(path.join(exeDir, 'renodx-mfgunlock.addon64'));
  const hasOptiAsiMfg = fs.existsSync(path.join(exeDir, 'OptiScaler', 'plugins', 'MFGUnlocker.asi'));
  if (hasReshadeAddonNr && hasOptiAsiMfg) {
    dllConflicts.push({
      severity: 'warning',
      file: 'MFGUnlocker.asi',
      code: 'MIXED_BACKEND_HOOKS',
      message: '检测到 ReShade 神经渲染插件与 OptiScaler ASI 版 MFG 插件混用，建议统一使用 ReShade 插件版 renodx-mfgunlock.addon64。'
    });
  }

  // 2. Streamline、NGX 及注入链是否兼容
  const reshadeIni = path.join(exeDir, 'ReShade.ini');
  const iniText = feederConfig.readText(reshadeIni);
  const runtimeSelectionMode = feederConfig.getIni(iniText, 'RenoDX.MFGUnlock', 'RuntimeSelectionMode');
  const slCoherent = !bothActive || !hasReshadeAddonNr || !hasReshadeAddonMfg || runtimeSelectionMode === '1';
  const slChainCheck = {
    ok: slCoherent && (mfgStatus.streamline.present || mfgStatus.dlssg.valid || mfgStatus.currentConfig.mode === 'off'),
    runtimeSelectionMode: runtimeSelectionMode || '0',
    message: bothActive && hasReshadeAddonNr && hasReshadeAddonMfg
      ? (runtimeSelectionMode === '1'
        ? '已配置 RuntimeSelectionMode=1 (LoadFromDllMain)；实际 Streamline / NGX 绑定是否成功需查看本次游戏运行诊断。'
        : '注意：RenoDX DLSS 5 与 MFGUnlock 同时存在时建议将 RuntimeSelectionMode 设为 1，以防止 NGX 上下文绑定错位。')
      : '未检测到需要检查的 ReShade 双插件组合；此处不判断运行时 NGX 上下文是否冲突。'
  };

  // 3. 神经渲染是否影响运动矢量与补帧质量
  const bamMode = feederConfig.getIni(iniText, 'RenoDX.MFGUnlock', 'BoundaryArtifactMitigationMode');
  const motionVectorCheck = {
    ok: true,
    configurationSupported: hasReshadeAddonMfg && !launcherProtected,
    mitigationActive: hasReshadeAddonMfg && !launcherProtected && (bamMode === '1' || bamMode === '2'),
    message: launcherProtected || !hasReshadeAddonMfg
      ? '当前加载路线不提供 RenoDX 边界伪影缓解配置；运动矢量和插帧质量需在游戏中确认。'
      : bamMode === '1' || bamMode === '2'
        ? `已配置边界伪影缓解模式 ${bamMode}；实际插帧质量需在游戏中确认。`
        : '未检测到边界伪影缓解配置。'
  };

  // 4. 多帧生成是否引发闪烁、HUD 异常或拖影
  const qualityGuardMode = feederConfig.getIni(iniText, 'RenoDX.MFGUnlock', 'QualityGuardMode') || '0';
  const hudFlickerCheck = {
    ok: true,
    configurationSupported: hasReshadeAddonMfg && !launcherProtected,
    qualityGuardMode,
    hdrGameNeedsGuard: Boolean(mfgStatus.knownGame && mfgStatus.knownGame.hdrFix && qualityGuardMode !== '2'),
    message: mfgStatus.knownGame && mfgStatus.knownGame.hdrFix
      ? `该游戏在 HDR 下有 UI 保护建议；当前 QualityGuardMode=${qualityGuardMode}，实际效果需在游戏中确认。`
      : '按现有配置检查 HUD 输入策略，无法从磁盘文件确认画面稳定性。'
  };

  // 5. 是否超过目标显卡档位的显存预算限制
  const vramBudget = estimateVramBudget({
    neuralMode: neuralStatus.mode,
    neuralModelId: neuralStatus.currentModel?.id || '310.8.SF-v2',
    mfgMode: mfgStatus.currentConfig.mode,
    vramTotalMB: hardware?.gpu?.vramTotalMB,
    hardwareProfile
  });

  // 6. Reflex、帧同步和延迟控制是否仍有效
  const hasReflexDll = Boolean(mfgStatus.streamline.reflexPluginVersion) ||
    fs.existsSync(path.join(exeDir, 'sl.reflex.dll'));
  const reflexCheck = {
    ok: mfgStatus.currentConfig.mode === 'off' || hasReflexDll,
    hasReflexDll,
    reflexVersion: mfgStatus.streamline.reflexPluginVersion,
    hardwareFlipMetering: Boolean(mfgStatus.gpuSupport.hardwareFlipMetering),
    message: hasReflexDll
      ? '已检测到 Reflex DLL，是否执行需在游戏中验证。'
      : '未检测到独立 Reflex DLL，无法据此判断延迟控制是否生效。'
  };
  if (launcherProtected) {
    slChainCheck.message = '保留游戏原生 Streamline；独立加载器在运行时接入，是否成功请看本次进程的遥测。';
    hudFlickerCheck.message = '使用游戏原生输入；未配置 RenoDX QualityGuard，HUD 与 HDR 表现需要在游戏中验证。';
    reflexCheck.message = '使用游戏及独立组件的 Reflex 与帧调度；此处的文件检查不代表低延迟控制已经生效。';
  }

  // 7. 游戏关闭后能否完整恢复原状
  const manifest = backends.readManifest(gameDir);
  const pendingJournal = journal.hasPendingRecovery(gameDir);
  const archived = !manifest && !pendingJournal && scan.hasBackup ? apply.recoverableManifest(gameDir)?.manifest : null;
  const backupRecord = manifest || archived;
  let backupFilesIntact = true;
  if (Array.isArray(backupRecord?.replaced)) {
    for (const item of backupRecord.replaced) {
      try {
        if (!fs.existsSync(apply.originalPath(gameDir, backupRecord, item.rel))) {
          backupFilesIntact = false;
          break;
        }
      } catch {
        backupFilesIntact = false;
        break;
      }
    }
  }
  const backupCheck = {
    ok: backupFilesIntact && !pendingJournal,
    hasManifest: Boolean(backupRecord),
    replacedCount: backupRecord?.replaced?.length || 0,
    addedCount: backupRecord?.added?.length || 0,
    pendingJournal,
    backupFilesIntact,
    badge: '无 NeuralFrame 部署记录',
    message: '未找到 NeuralFrame 部署记录；这不代表游戏目录没有其他工具或用户的修改。'
  };
  if (pendingJournal) {
    backupCheck.badge = '有中断的操作待恢复';
    backupCheck.message = '关闭游戏后可从事务记录恢复文件。';
  } else if (backupRecord && !backupFilesIntact) {
    backupCheck.badge = '备份异常';
    backupCheck.message = '缺少原始备份文件，请检查游戏目录中的 _DLSS5_Backup。';
  } else if (archived) {
    backupCheck.badge = '可从历史备份恢复';
    backupCheck.message = '发现与历史清单匹配的残留组件，可预览将恢复的文件。';
  } else if (manifest) {
    backupCheck.badge = '已验证可用 (可完整还原)';
    backupCheck.message = `已记录 ${manifest.replaced.length} 个替换文件与 ${manifest.added.length} 个新增文件于 _DLSS5_Backup，支持游戏关闭后一键完整还原。`;
  }

  // 8. 破解版 / 离线免安装版 / 老版本 DLSS 深度兼容与补丁保护状态
  const addedRelSet = new Set(
    (manifest && Array.isArray(manifest.added) ? manifest.added : [])
      .map((r) => path.normalize(String(r)).toLowerCase())
  );
  const nativeDlssItems = (scan.dlssFiles || []).filter((f) => {
    const rel = path.normalize(path.relative(gameDir, f.path)).toLowerCase();
    return !addedRelSet.has(rel) && /^(nvngx_dlss|_?nvngx)\.dll$/i.test(f.name);
  });
  const replacedDlssItems = (manifest && Array.isArray(manifest.replaced) ? manifest.replaced : [])
    .filter((r) => /^(nvngx_dlss|_?nvngx)\.dll$/i.test(path.basename(String(r.rel || ''))));
  const hasDlss1x = nativeDlssItems.length > 0 && nativeDlssItems.every((f) => f.version && /^1\./.test(String(f.version).trim()));
  const safeHookInfo = apply.selectSafeReShadeHook
    ? apply.selectSafeReShadeHook(exeDir, scan.chosen?.api || 'dxgi', scan.chosen?.apiLabel || '', 'dxgi')
    : { hook: 'dxgi.dll', avoidedConflict: null };

  let dlssCompatMode = 'native_ready';
  let dlssCompatSummary = '已检测到游戏原有 DLSS 文件，可预览兼容的组件更新；文件存在不代表神经渲染已经生效。';
  if (replacedDlssItems.length > 0) {
    const sample = replacedDlssItems[0];
    dlssCompatMode = 'upgraded_from_low';
    dlssCompatSummary = `部署记录包含 ${replacedDlssItems.length} 处 DLSS 文件替换（${sample.oldVersion || '未知版本'} → ${sample.newVersion || '未知版本'}）；实际加载版本请查看运行诊断。`;
  } else if (hasDlss1x) {
    dlssCompatMode = 'dlss1x_feeder';
    dlssCompatSummary = `检测到 DLSS 1.x (${nativeDlssItems[0].version})，需要通过 Feeder 路线提供神经渲染输入；请先预览安装。`;
  } else if (nativeDlssItems.length === 0) {
    const upscalerCount = (scan.upscalerFiles || []).length;
    dlssCompatMode = 'no_dlss_feeder';
    dlssCompatSummary = upscalerCount > 0
      ? `未检测到游戏原有 DLSS 文件（检测到 ${upscalerCount} 个 FSR/XeSS 组件），可评估 Feeder 或 OptiScaler 路线；神经渲染与帧生成的支持条件分别检查。`
      : '未检测到游戏原有 DLSS 文件，可评估 Feeder 神经渲染路线；这不代表游戏支持帧生成解锁。';
  } else if (nativeDlssItems.some((f) => f.version && /^[23]\./.test(String(f.version).trim()))) {
    const lowVer = nativeDlssItems.find((f) => f.version && /^[23]\./.test(String(f.version).trim()));
    dlssCompatMode = 'low_dlss_ready';
    dlssCompatSummary = `检测到游戏原有 DLSS ${lowVer.version}（${lowVer.rel}），可预览组件更新并保留原文件备份；运行库更新不等于启用神经渲染。`;
  }
  if (manifest?.route === 'feeder' && ['dlss1x_feeder', 'no_dlss_feeder'].includes(dlssCompatMode))
    dlssCompatSummary = '已记录 Feeder 安装路线；实际模型、工作分辨率和加载情况请查看游戏配置与运行诊断。';
  if (launcherProtected) {
    dlssCompatMode = 'wuwa-proxy';
    dlssCompatSummary = '鸣潮保留启动器校验的 DLSS 文件。神经渲染与补帧使用主程序旁的 version.dll。';
  } else if (safeHookInfo.avoidedConflict) {
    dlssCompatSummary += ` 检测到 ${safeHookInfo.avoidedConflict} 被其他组件占用，安装预览将评估 ${safeHookInfo.hook} 备用入口。`;
  }

  return {
    bothActive,
    dllConflicts,
    slChainCheck,
    motionVectorCheck,
    hudFlickerCheck,
    vramBudget,
    reflexCheck,
    backupCheck,
    dlssCompat: {
      mode: dlssCompatMode,
      summary: dlssCompatSummary,
      hook: launcherProtected ? 'version.dll' : safeHookInfo.hook,
      avoidedConflict: launcherProtected ? null : safeHookInfo.avoidedConflict
    }
  };
}

// 获取游戏的三大核心模块完整状态与诊断报告（供 UI 面板一次性渲染）
async function inspectCombinedStatus(gameDir, { payloadDir, userDataDir, hardwareProfile, defaultHardwareProfile, detectedHardware, apiOverrides, apiOverride, scanResult, exePath } = {}) {
  const [hardware, detected] = await Promise.all([
    detectedHardware || detectHardwareEnvironment(),
    scanResult || scanGame(gameDir, exePath)
  ]);
  const savedApi = detected.chosen && apiOverrides?.[apiPreferenceKey(gameDir, detected.chosen.path)];
  const scan = withGameApi(detected, apiOverride || (require('../shared/rendering-api').valid(savedApi) ? savedApi : 'auto'));
  const gpuName = hardware.gpu.name;
  const driverVersion = hardware.gpu.driver;
  const manifest = backends.readManifest(gameDir);
  const selection = selectHardwareProfile({ requestedProfile: hardwareProfile, manifestProfile: savedProfile(manifest),
    defaultProfile: defaultHardwareProfile, gpu: hardware.gpu });
  const effectiveProfile = selection.id;
  // Both independent Apply actions share the stack picker. Restore its last valid selection.
  const configuredStack = [manifest?.neuralRendering, manifest?.mfg]
    .filter(entry => neuralModels.RUNTIME_STACKS.some(stack => stack.id === entry?.runtimeStack))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];

  const protectedRoot = wuwa.gameRoot(gameDir, scan.chosen?.path);
  const [neuralStatus, mfgStatus, nativeRuntimeStack] = await Promise.all([
    neuralModels.inspectGameNeuralStatus(gameDir, { payloadDir, userDataDir, gpuName, hardwareProfile: effectiveProfile, scanResult: scan }),
    mfgManager.inspectGameMfgStatus(gameDir, { payloadDir, gpuName, driverVersion, hardwareProfile: effectiveProfile, scanResult: scan }),
    protectedRoot ? wuwa.inspectNativeStack(protectedRoot) : null
  ]);
  const encore = require('./encore').inspect(gameDir, scan, manifest);
  if (encore.installed) {
    const neuralEnabled = encore.settings.neuralMode !== 'off';
    neuralStatus.mode = encore.settings.neuralMode;
    neuralStatus.installed = Boolean(encore.filesPresent && neuralEnabled && neuralStatus.dependencies.hasNeuralDll);
    neuralStatus.dependencies.hasConsumer = encore.filesPresent;
    neuralStatus.dependencies.consumerAddons = encore.filesPresent ? [encore.proxy] : [];
    // Encore NR can run on the presented image without SR or RenoDX. Keep
    // observed file facts, but do not inherit the other route's requirements.
    neuralStatus.dependencies.missing = [
      ...(!encore.filesPresent ? ['Encore 配套组件'] : []),
      ...(neuralEnabled && !neuralStatus.dependencies.hasNeuralDll ? ['nvngx_dlssnr.dll'] : [])
    ];
    const modelIncompatible = neuralEnabled && neuralStatus.dependencies.hasNeuralDll && neuralStatus.gpuCompatibility?.status === 'incompatible';
    neuralStatus.overallStatus = modelIncompatible ? 'incompatible' : 'experimental';
    neuralStatus.overallBadge = encore.error ? '配置读取失败' : modelIncompatible ? '不兼容' : 'Encore 配置已读取，运行效果待验证';
    mfgStatus.currentConfig = {installed:encore.filesPresent,backend:'encore',mode:encore.settings.mfgMode,
      multiplier:/^x[2-6]$/.test(encore.settings.mfgMode)?Number(encore.settings.mfgMode.slice(1)):null};
    // Native DLSS-G cannot present through DX11; Encore's added-FG adapter
    // handles it. Other injector/architecture conflicts remain actionable.
    if (scan.chosen?.bitness === 64 && scan.chosen?.apiLabel === 'DirectX 11')
      mfgStatus.conflicts = mfgStatus.conflicts.filter(c => c.code !== 'UNSUPPORTED_API_FOR_MFG');
    mfgStatus.effectiveMultiplier = encore.settings.mfgMode === 'off' ? '未启用 (1x)' : `${encore.settings.mfgMode} (待进入游戏验证)`;
    mfgStatus.status = 'experimental';
    mfgStatus.statusBadge = encore.error ? '配置读取失败' : 'Encore 新增帧生成 · 待运行验证';
  }

  const coExecution = evaluateCoExecutionChecks(gameDir, scan, neuralStatus, mfgStatus, hardware, effectiveProfile, Boolean(protectedRoot));
  if (protectedRoot && nativeRuntimeStack?.indexMissing)
    coExecution.dlssCompat.summary = '当前渠道未提供官服资源清单，使用独立加载保护：仅管理主程序旁的补丁文件，不替换游戏原有 DLSS / Streamline。';
  if (encore.installed) {
    coExecution.dlssCompat.summary = 'Encore 使用独立加载器与配套运行库新增帧生成；配置读取不代表已在游戏中生效。';
    coExecution.slChainCheck = {ok:!!encore.filesPresent,message:'Encore 配套运行库已登记；请在运行诊断与游戏内面板核对执行状态。'};
    coExecution.motionVectorCheck.configurationSupported = false;
    coExecution.motionVectorCheck.message = 'Encore 使用自身的运动估计设置，不读取 RenoDX 的边界保护参数。';
    coExecution.hudFlickerCheck.configurationSupported = false;
    coExecution.hudFlickerCheck.message = 'Encore 使用自身的 HUD 处理设置，不读取 RenoDX QualityGuard。';
    coExecution.vramBudget = {hardwareProfile:effectiveProfile,level:'unknown',vramTotalMB:hardware.gpu.vramTotalMB || null,
      summary:'Encore 尚无显存预算模型，请以游戏中的实际占用为准。'};
  }

  // 汇总错误日志
  const errorLogs = [
    ...(neuralStatus.logs.errors || []).map((e) => `[Neural Rendering] ${e.code}: ${e.message} (${e.file})`),
    ...(mfgStatus.runtimeVerification.errors || []).map((e) => `[MFG Manager] ${e}`),
    ...(coExecution.dllConflicts || []).map((c) => `[Conflict:${c.severity.toUpperCase()}] ${c.message}`)
  ];

  // 综合诊断状态徽章
  let combinedStatus = 'untested';
  let combinedBadge = '尚未测试';
  if (coExecution.dllConflicts.some((c) => c.severity === 'error') || neuralStatus.overallStatus === 'incompatible') {
    combinedStatus = 'incompatible';
    combinedBadge = '不兼容';
  } else if (neuralStatus.overallStatus === 'verified' && (mfgStatus.currentConfig.mode === 'off' || mfgStatus.status === 'verified')) {
    combinedStatus = 'verified';
    combinedBadge = '已验证可用';
  } else if (neuralStatus.installed || mfgStatus.currentConfig.installed) {
    combinedStatus = 'experimental';
    combinedBadge = '实验性支持';
  }

  return {
    ok: Boolean(scan.chosen),
    gameName: path.basename(gameDir),
    gameDir,
    exePath: scan.chosen ? scan.chosen.path : null,
    graphicsApi: scan.chosen ? scan.chosen.apiLabel : 'Unknown',
    bitness: scan.chosen ? scan.chosen.bitness : null,
    installedRoute: scan.install ? scan.install.route : null,
    hardwareProfile: effectiveProfile,
    hardwareProfileSource: selection.source,
    hardwareProfileInfo: neuralModels.getHardwareProfileInfo(effectiveProfile),
    configuredRuntimeStack: configuredStack?.runtimeStack || null,
    launcherProtected: Boolean(protectedRoot),
    nativeRuntimeStack,
    encore,
    standaloneProfile: protectedRoot ? {
      target: require('./wuwa-profile').neuralSettings(effectiveProfile),
      saved: mfgStatus.currentConfig?.backend === 'wuwa-proxy' ? mfgStatus.currentConfig.settings : null,
      adapterVersion: manifest?.neuralRendering?.profileAdapterVersion || null
    } : null,
    hardwareProfiles: neuralModels.HARDWARE_PROFILES,
    hardware: {
      ...hardware,
      activeProfile: effectiveProfile,
      activeProfileInfo: neuralModels.getHardwareProfileInfo(effectiveProfile),
      gpu: {
        ...hardware.gpu,
        architecture: hardware.gpu.architecture
      }
    },
    neural: neuralStatus,
    mfg: mfgStatus,
    diagnostics: {
      gameName: path.basename(gameDir),
      graphicsApi: scan.chosen ? scan.chosen.apiLabel : 'Unknown',
      hardwareProfile: effectiveProfile,
      hardwareProfileLabel: neuralModels.getHardwareProfileInfo(effectiveProfile).label,
      neuralStatus: neuralStatus.overallBadge,
      mfgStatus: mfgStatus.statusBadge,
      dllConflicts: coExecution.dllConflicts,
      errorLogs,
      backupStatus: coExecution.backupCheck.badge,
      coExecution,
      combinedStatus,
      combinedBadge
    }
  };
}

// 联合应用 DLSS 5 神经渲染与 NVIDIA MFG 配置（支持独立控制两个模块，自动处理双插件协同与 Streamline 补齐）
function applyCombinedConfiguration(gameDir, config = {}, onLog = () => {}) {
  return journal.group(gameDir, () => applyCombinedStages(gameDir, config, onLog));
}
async function applyCombinedStages(gameDir, config, onLog) {
  config = require('./component-deploy').claimGraphicsModel(gameDir, config);
  const {
    neuralMode, // 'off' | 'legacy' | 'latest_compatible'
    mfgMode, // 'off' | 'x2' | 'x3' | 'x4'
    runtimeStack = 'baseline-310.9.1',
    hdrCompatibility = false,
    ensureStreamline = true,
    hardwareProfile,
    payloadDir,
    userDataDir
  } = config;
  const neuralModelId = neuralModels.normalizeModelId(config.neuralModelId);
  const effectivePayloadDir = require('./payload-root').resolvePayloadDir(payloadDir);

  const hardware = await detectHardwareEnvironment();
  const gpuName = hardware.gpu.name;
  const existingManifest = backends.readManifest(gameDir);
  const effectiveProfile = resolveHardwareProfile(hardwareProfile, gpuName, savedProfile(existingManifest), config.defaultHardwareProfile, hardware.gpu.vramTotalMB);
  // RTX 50 系列桌面卡默认优先启用 oct2026-310.9.16 运行时管线（除非调用方显式指定）
  const effectiveRuntimeStack = (effectiveProfile === 'rtx50_desktop' && !config.runtimeStack)
    ? 'oct2026-310.9.16'
    : runtimeStack;

  const scan = withGameApi(await scanGame(gameDir, config.exePath), config.apiOverride);
  if (!scan.chosen) throw Object.assign(new Error('未在游戏目录中找到可执行文件'), { code: 'errNoExe' });
  if (config.exePath && path.resolve(config.exePath).toLowerCase() !== path.resolve(scan.chosen.path).toLowerCase())
    throw Object.assign(new Error('所选游戏程序已不在扫描列表中，请重新选择。'),{code:'errSelectedExeMissing'});
  const exePath = scan.chosen.path;
  const exeDir = path.dirname(exePath);

  await require('./install-guards').assertGameClosed(gameDir, exePath);
  const protectedRoot = wuwa.gameRoot(gameDir, exePath);
  if (protectedRoot && config.route === 'encore') throw Object.assign(new Error('鸣潮继续使用独立加载路线，不切换 Encore。'), {code:'errEncore'});
  if (protectedRoot) {
    const result = await wuwa.configure(gameDir, protectedRoot, scan, {
      ...config, payloadDir:effectivePayloadDir, gpuName, hardwareProfile:effectiveProfile,
    }, onLog);
    result.status = await inspectCombinedStatus(gameDir, {exePath, apiOverride:config.apiOverride, payloadDir:effectivePayloadDir,
      userDataDir, hardwareProfile:effectiveProfile});
    return result;
  }

  if (config.route === 'encore' || (!config.route && existingManifest?.route === 'encore')) {
    const encore = require('./encore');
    encore.assertTarget(gameDir,scan,scan.chosen,gpuName);
    const current = encore.inspect(gameDir,scan,existingManifest);
    if (current.error) throw Object.assign(new Error(current.error),{code:'errEncoreConfig'});
    // Validate against the selected engine's fingerprint-backed capabilities in
    // install(), not the default adapter version before the engine is resolved.
    const settings = {...current.settings,...config.encore,
      ...(neuralMode !== undefined ? {neuralMode} : {}), ...(mfgMode !== undefined ? {mfgMode} : {}),
      ...(config.neuralModelId ? {neuralModelId} : {})};
    let model;
    if (settings.neuralMode !== 'off') {
      const available = neuralModels.listNeuralModels({payloadDir:effectivePayloadDir,userDataDir,gpuName,hardwareProfile:effectiveProfile});
      model = neuralModels.findLocalModel(available,settings.neuralModelId,config.neuralModelSha256);
      if (!model && settings.neuralModelId !== '310.8.SF-v2') throw Object.assign(new Error('请先在模型库下载或导入所选神经渲染模型。'),{code:'errModelNotOnDisk'});
      if (model) {
        const inspected = neuralModels.inspectNeuralModelBinary(model.filePath,{fresh:true});
        const compatible = neuralModels.evaluateModelGpuCompatibility(inspected,gpuName);
        if (!inspected.valid || inspected.sha256 !== model.sha256 || !compatible.compatible)
          throw Object.assign(new Error(compatible.reason || '神经模型校验失败，请重新预览。'),{code:'errModelNotOnDisk'});
      }
    }
    if (config.requirePayload) await config.requirePayload({kind:'enhanced',route:'encore',
      reuseProxy:current.installed && config.encorePackageId === undefined,
      config:{...config,neuralMode:settings.neuralMode,encore:settings},customModel:!!model,target:scan.chosen,scan});
    if (settings.neuralMode !== 'off' && !model) throw Object.assign(new Error('请先准备所选神经渲染模型。'),{code:'errModelNotOnDisk'});
    await backends.install({gameDir,exePath,api:scan.chosen.api,apiLabel:scan.chosen.apiLabel,bitness:scan.chosen.bitness,
      route:'encore',payloadDir:effectivePayloadDir,encoreSettings:settings,model,gpuName,userDataDir,
      encorePackageId:config.encorePackageId,
      antiCheatAcknowledged:config.antiCheatAcknowledged},onLog);
    return {ok:true,restartRequired:true,status:await inspectCombinedStatus(gameDir,{exePath,payloadDir:effectivePayloadDir,userDataDir,apiOverride:config.apiOverride})};
  }

  // Match the setup page: FG/NR or Reflex/Streamline DLLs alone do not prove
  // native DLSS SR input. Exclude runtimes added by a previous deployment.
  const prevManifest = backends.readManifest(gameDir);
  const hasNativeDlss = require('../shared/install-routes').nativeDlssPresent({
    ...scan, install: prevManifest || scan.install
  });

  const { scanSource } = require('./scan');
  const { ensureDgVoodoo, ensureLumenite } = require('./runtime-components');
  const target = scan.chosen;
  const targetBitness = target.bitness || 64;
  const targetApi = target.api || 'dxgi';
  const targetApiLabel = target.apiLabel || 'DirectX 12';
  const isLegacyApiOr32Bit = targetBitness === 32 ||
    ['ddraw', 'd3d8', 'd3d9', 'd3d10', 'opengl'].includes(targetApi) ||
    targetApiLabel === 'DirectX 10' ||
    targetApiLabel === 'DirectX 11';
  const needsFullFeeder = !hasNativeDlss || isLegacyApiOr32Bit;
  const canRunMfg = targetBitness === 64 &&
    ['dxgi', 'vulkan'].includes(targetApi) &&
    targetApiLabel !== 'DirectX 10' &&
    targetApiLabel !== 'DirectX 11';
  if (!canRunMfg && neuralMode === undefined && mfgMode && mfgMode !== 'off') {
    throw Object.assign(new Error('多帧生成需要 64 位 DirectX 12 或 Vulkan 游戏。'), { code: 'errMfgUnsupportedApi' });
  }
  const effectiveUserDataDir = userDataDir || path.join(os.homedir(), 'AppData', 'Roaming', 'dlss5-swapper-enhanced');

  if (config.requirePayload) {
    const checkLocalModel = neuralModelId && (config.neuralModelSha256 || neuralModelId !== '310.8.SF-v2');
    const localModels = neuralMode && neuralMode !== 'off' && checkLocalModel
      ? neuralModels.listNeuralModels({payloadDir:effectivePayloadDir,userDataDir:effectiveUserDataDir,gpuName,hardwareProfile:effectiveProfile}) : [];
    const customModel = Boolean(neuralModels.findLocalModel(localModels, neuralModelId, config.neuralModelSha256));
    const release = localModels.find(model => model.id === neuralModelId && model.downloadId);
    if (release && !customModel) {
      throw Object.assign(new Error(`请先在模型库中将 ${release.version} 下载入库。`), {code:'errModelNotOnDisk'});
    }
    const isOpti = prevManifest?.route === 'optiscaler' || scan.install?.optiscaler?.installed ||
      (fs.existsSync(path.join(exeDir,'OptiScaler.ini')) && !fs.existsSync(path.join(exeDir,'renodx-dlss5.addon64')));
    await config.requirePayload({kind:'enhanced',config:{...config,neuralModelId,hardwareProfile:effectiveProfile,runtimeStack:effectiveRuntimeStack},
      route:neuralMode && neuralMode!=='off' ? (needsFullFeeder?'feeder':'native') : (isOpti?'optiscaler':'native'),
      mfgRoute:isOpti?'optiscaler':'native',target,scan,customModel});
  }
  let neuralResult = null;
  let mfgResult = null;
  let feederDeployed = false;
  let feederSummary = null;

  // 若用户在无原生 DLSS 的老游戏 (DX8/DX9/DX10/DX11/OpenGL/32位) 上点击“一键应用全部配置”或“单独加载 DLSS 5”，
  // 全自动部署离线 dgVoodoo2 + ReShade + Feeder + LumeniteFX 光流着色器 + host64 + DLSS 5 神经渲染模型 + 全中文菜单！
  // 注意：拥有原生 DLSS 的现代 64 位 DX12/Vulkan 游戏 (!needsFullFeeder) 保持原有黄金逻辑 100% 不变。
  if (needsFullFeeder && neuralMode !== undefined && neuralMode !== 'off' && effectivePayloadDir) {
    const probe = scanSource(effectivePayloadDir);
    // A user-imported model can bootstrap Feeder without downloading the
    // default model first. Feed the selected, locally validated file into the
    // same tracked installer; the later model selection still checks the GPU.
    if (probe.ok && neuralModelId) {
      const available = neuralModels.listNeuralModels({payloadDir:effectivePayloadDir,userDataDir:effectiveUserDataDir,gpuName,hardwareProfile:effectiveProfile});
      const model = neuralModels.findLocalModel(available, neuralModelId, config.neuralModelSha256);
      if (model) {
        probe.payload = probe.payload.filter(file => file.name.toLowerCase() !== 'nvngx_dlssnr.dll');
        probe.payload.push({name:'nvngx_dlssnr.dll',path:model.filePath,version:model.version});
        probe.hasNeuralRendering=true;
      }
    }
    if (probe && probe.ok && probe.feeder) {
      if (['d3d8', 'd3d9', 'ddraw'].includes(targetApi)) {
        probe.feeder.dgVoodooDir = await ensureDgVoodoo(effectiveUserDataDir);
        onLog({ code: 'legacyWrapperReady', params: { api: targetApi, bitness: targetBitness } });
      }
      try {
        probe.feeder.lumeniteRoot = await ensureLumenite(effectiveUserDataDir);
        onLog({ code: 'motionProviderReady', params: { provider: 'LumeniteFX Kernel 2.0' } });
      } catch (err) {
        probe.feeder.lumeniteRoot = null;
        onLog({ code: 'motionProviderFallback', params: { error: err.message } });
      }
      const enhDir = path.join(effectivePayloadDir, 'enhanced', 'feeder-1.19.0');
      const enhAddon32 = path.join(enhDir, 'dlss5-feed.addon32');
      if (fs.existsSync(enhAddon32)) probe.feeder.addon32 = enhAddon32;
      const enhAddon64 = path.join(enhDir, 'dlss5-feed.addon64');
      if (fs.existsSync(enhAddon64)) probe.feeder.addon64 = enhAddon64;
      const enhHost64 = path.join(enhDir, 'host64', 'dlss5-feed-host64.exe');
      if (fs.existsSync(enhHost64)) probe.feeder.host64 = enhHost64;
      const enhFeedFx = path.join(enhDir, 'reshade-shaders', 'Shaders', 'DLSS5_Feed.fx');
      if (fs.existsSync(enhFeedFx)) probe.feeder.feedShader = enhFeedFx;
      if (fs.existsSync(enhAddon32) || fs.existsSync(enhAddon64)) probe.feeder.version = '1.19.0';

      const setupName = fs.existsSync(effectivePayloadDir)
        ? fs.readdirSync(effectivePayloadDir).find((f) => /^ReShade_Setup_.*_Addon\.exe$/i.test(f))
        : null;
      const reshadeSetup = setupName ? path.join(effectivePayloadDir, setupName) : null;

      await journal.transaction(gameDir, async () => {
        const safeHook = apply.selectSafeReShadeHook
          ? apply.selectSafeReShadeHook(exeDir, targetApi, targetApiLabel, config.reshadeProxy || 'dxgi')
          : { proxy: config.reshadeProxy || 'dxgi' };
        const mf = await apply.applySwap({
          gameDir,
          exePath: target.path,
          api: targetApi,
          apiLabel: targetApiLabel,
          bitness: targetBitness,
          route: 'feeder',
          emulator: target.emulator,
          source: probe,
          reshadeSetup,
          vulkanLayerTarget: path.join(effectiveUserDataDir, 'reshade-vulkan'),
          reshadeProxy: safeHook.proxy || 'dxgi',
          installReShade: true,
          addMissingDlss: true,
          addStreamline: false,
          upgradeReShade: false
        }, onLog);
        if (fs.existsSync(enhFeedFx)) {
          await apply.copyTracked(
            mf,
            gameDir,
            enhFeedFx,
            path.join(exeDir, 'reshade-shaders', 'Shaders', 'DLSS5_Feed.fx'),
            { kind: 'shader' }
          );
        }
        mf.hardwareProfile = effectiveProfile;
        await apply.saveActiveManifest(gameDir, mf);
      });

      feederDeployed = true;
      const wrapperTag = ['d3d8', 'd3d9', 'ddraw'].includes(targetApi) ? 'dgVoodoo2 + ' : '';
      const opticalTag = probe.feeder.lumeniteRoot ? 'LumeniteFX Kernel 2.0 光流' : 'vort_Motion 光流';
      const hostTag = targetBitness === 32 ? ' + host64 跨进程桥接' : '';
      feederSummary = `${targetBitness}位 ${targetApiLabel} (${wrapperTag}Feeder + ${opticalTag}${hostTag})`;
    }

    neuralResult = await neuralModels.applyNeuralModelSelection(gameDir, {
      exePath,
      apiOverride: config.apiOverride,
      mode: neuralMode,
      modelId: neuralModelId,
      expectedSha256: config.neuralModelSha256,
      resetNeuralTuning: config.resetNeuralTuning === true,
      runtimeStack: effectiveRuntimeStack,
      hardwareProfile: effectiveProfile,
      payloadDir: effectivePayloadDir,
      userDataDir: effectiveUserDataDir,
      gpuName
    }, onLog);
  } else if (neuralMode !== undefined) {
    // 1. 应用神经渲染设置（现代原生 DLSS 游戏与关闭模式保持原有逻辑 100% 不变）
    neuralResult = await neuralModels.applyNeuralModelSelection(gameDir, {
      exePath,
      apiOverride: config.apiOverride,
      mode: neuralMode,
      modelId: neuralModelId,
      expectedSha256: config.neuralModelSha256,
      resetNeuralTuning: config.resetNeuralTuning === true,
      runtimeStack: effectiveRuntimeStack,
      hardwareProfile: effectiveProfile,
      payloadDir: effectivePayloadDir,
      userDataDir,
      gpuName
    }, onLog);

    // 若启用了神经渲染且游戏为 64 位，自动补齐或升级 renodx-dlss5.addon64 (v8.5.0-rc10) 与 ReShade；
    // 若游戏本身无原生 DLSS (!hasNativeDlss)，自动一并部署 Feeder 1.19.0 (dlss5-feed.addon64 + 着色器 + dlss5-feed.cfg)
    if (neuralMode !== 'off' && scan.chosen.bitness === 64 && effectivePayloadDir) {
      await journal.transaction(gameDir, async () => {
        const manifest = apply.beginManifest(gameDir, exePath, scan.chosen.api || 'dxgi');
        manifest.hardwareProfile = effectiveProfile;
        await apply.retireOldShaderCompiler(manifest, gameDir, exeDir, (code, params) => onLog({ code, params }));

        const destConsumer = path.join(exeDir, 'renodx-dlss5.addon64');
        const hasOtherConsumer = fs.existsSync(path.join(exeDir, 'renodx-dlss.addon64')) ||
          Boolean(scan.install?.optiscaler?.installed);
        const srcConsumer = path.join(effectivePayloadDir, 'renodx-dlss5.addon64');
        const consumerNeedsUpdate = fs.existsSync(srcConsumer) && (
          (!fs.existsSync(destConsumer) && !hasOtherConsumer) ||
          (fs.existsSync(destConsumer) && fs.statSync(destConsumer).size !== fs.statSync(srcConsumer).size)
        );

        if (consumerNeedsUpdate || (!fs.existsSync(destConsumer) && !hasOtherConsumer)) {
          if (fs.existsSync(srcConsumer)) {
            if (apply.setAsideRivalConsumers) {
              await apply.setAsideRivalConsumers(manifest, gameDir, exeDir, 'renodx-dlss5.addon64', (code, params) => onLog({ code, params }));
            }
            await apply.copyTracked(manifest, gameDir, srcConsumer, destConsumer, {
              kind: 'addon',
              newVersion: pe.getFileVersion(srcConsumer)
            });
            await apply.enableAddonInIni(exeDir, 'renodx-dlss5.addon64', (code, params) => onLog({ code, params }), gameDir, manifest);
          }
        } else if (fs.existsSync(destConsumer)) {
          await apply.enableAddonInIni(exeDir, 'renodx-dlss5.addon64', (code, params) => onLog({ code, params }), gameDir, manifest);
        }

        const srcDlss = effectiveRuntimeStack === 'oct2026-310.9.16'
          ? path.join(effectivePayloadDir, 'enhanced', 'streamline-2.14.16', 'nvngx_dlss.dll')
          : path.join(effectivePayloadDir, 'streamline', 'nvngx_dlss.dll');
        if (fs.existsSync(srcDlss) && !fs.existsSync(path.join(exeDir, 'nvngx_dlss.dll'))) {
          await apply.copyTracked(manifest, gameDir, srcDlss, path.join(exeDir, 'nvngx_dlss.dll'), {
            kind: 'runtime',
            newVersion: pe.getFileVersion(srcDlss)
          });
        }

        const reshadeCheck = scan.reshade;
        if (scan.chosen.api === 'vulkan') {
          const vulkanLayer = require('./vulkan-layer');
          const vkSrcDir = path.join(effectivePayloadDir, 'reshade-vulkan');
          const vkTargetDir = path.join(
            userDataDir || path.join(os.homedir(), 'AppData', 'Roaming', 'dlss5-swapper-enhanced'),
            'reshade-vulkan'
          );
          if (fs.existsSync(path.join(vkSrcDir, 'ReShade64.dll'))) {
            manifest.vulkanLayer = await vulkanLayer.register({
              sourceDir: vkSrcDir,
              targetDir: vkTargetDir,
              gameDir,
              bitness: 64
            });
          }
          await apply.retireVulkanDxgi(manifest, gameDir, exeDir);
        } else if (!reshadeCheck || !reshadeCheck.installed || !reshadeCheck.addonSupport) {
          const bundledReshade = path.join(effectivePayloadDir, 'reshade-vulkan', 'ReShade64.dll');
          if (fs.existsSync(bundledReshade)) {
            const safeHook = apply.selectSafeReShadeHook
              ? apply.selectSafeReShadeHook(exeDir, scan.chosen.api, scan.chosen.apiLabel, config.reshadeProxy || 'dxgi')
              : { hook: 'dxgi.dll' };
            const hookName = safeHook.hook || 'dxgi.dll';
            const hookFile = path.join(exeDir, hookName);
            const hookExisted = fs.existsSync(hookFile);
            await apply.copyTracked(manifest, gameDir, bundledReshade, hookFile, { kind: 'reshade' });
            manifest.reshade.installedByUs = !hookExisted;
            manifest.reshade.file = hookName;
          }
        }

        // 若该游戏不具备原生 DLSS 且未安装 OptiScaler，自动部署 Feeder 1.19.0 深度与运动矢量馈送管线
        if (!hasNativeDlss && !Boolean(scan.install?.optiscaler?.installed)) {
          const srcFeeder119 = path.join(effectivePayloadDir, 'enhanced', 'feeder-1.19.0', 'dlss5-feed.addon64');
          const srcFeederFallback = path.join(effectivePayloadDir, 'feeder', 'dlss5-feed.addon64');
          const srcFeeder = fs.existsSync(srcFeeder119) ? srcFeeder119 : srcFeederFallback;
          const destFeeder = path.join(exeDir, 'dlss5-feed.addon64');
          if (fs.existsSync(srcFeeder)) {
            await apply.copyTracked(manifest, gameDir, srcFeeder, destFeeder, {
              kind: 'feeder',
              newVersion: pe.getFileVersion(srcFeeder)
            });
            await apply.enableAddonInIni(exeDir, 'dlss5-feed.addon64', (code, params) => onLog({ code, params }), gameDir, manifest);
          }

          // 部署 ReShade 馈送着色器与纹理 (DLSS5_Feed.fx + vort_Motion.fx / LumeniteFX)
          const copyDirTracked = async (srcRoot, destRoot) => {
            const queue = [''];
            while (queue.length) {
              const relDir = queue.shift();
              const srcDir = path.join(srcRoot, relDir);
              for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
                const rel = path.join(relDir, entry.name);
                if (entry.isDirectory()) queue.push(rel);
                else if (entry.isFile()) {
                  await apply.copyTracked(manifest, gameDir, path.join(srcRoot, rel), path.join(destRoot, rel), { kind: 'shader' });
                }
              }
            }
          };
          const baseShaderRoot = path.join(effectivePayloadDir, 'feeder', 'reshade-shaders');
          const destShaderRoot = path.join(exeDir, 'reshade-shaders');
          if (fs.existsSync(baseShaderRoot)) {
            await copyDirTracked(baseShaderRoot, destShaderRoot);
          }
          const enhancedFeedFx = path.join(effectivePayloadDir, 'enhanced', 'feeder-1.19.0', 'reshade-shaders', 'Shaders', 'DLSS5_Feed.fx');
          if (fs.existsSync(enhancedFeedFx)) {
            await apply.copyTracked(
              manifest,
              gameDir,
              enhancedFeedFx,
              path.join(destShaderRoot, 'Shaders', 'DLSS5_Feed.fx'),
              { kind: 'shader' }
            );
          }

          // 查找本机已缓存的 LumeniteFX 光流内核（若存在则使用 provider=3，否则回退至内置 vort_Motion.fx provider=2）
          let provider = 2;
          const compDir = path.join(
            userDataDir || path.join(os.homedir(), 'AppData', 'Roaming', 'dlss5-swapper-enhanced'),
            'components'
          );
          if (fs.existsSync(compDir)) {
            try {
              const findLumenite = (dir, depth = 0) => {
                if (depth > 3) return null;
                if (fs.existsSync(path.join(dir, 'Shaders', 'lumenite_Kernel.fx'))) return dir;
                for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                  if (ent.isDirectory() && /^lumenite/i.test(ent.name)) {
                    const hit = findLumenite(path.join(dir, ent.name), depth + 1);
                    if (hit) return hit;
                  }
                }
                return null;
              };
              const lumRoot = findLumenite(compDir);
              if (lumRoot) {
                await copyDirTracked(path.join(lumRoot, 'Shaders'), path.join(destShaderRoot, 'Shaders'));
                if (fs.existsSync(path.join(lumRoot, 'Textures'))) {
                  await copyDirTracked(path.join(lumRoot, 'Textures'), path.join(destShaderRoot, 'Textures'));
                }
                provider = 3;
              }
            } catch { /* fallback to provider 2 */ }
          }

          const gameIniPath = path.join(exeDir, 'ReShade.ini');
          let gameIni = feederConfig.configureGameReShade(feederConfig.readText(gameIniPath), provider);
          gameIni = feederConfig.configureConsumer(gameIni, { host: false, xenia: false });
          let presetFile = feederConfig.presetPath(exeDir, gameIni);
          const presetRel = path.relative(gameDir, presetFile);
          if (presetRel.startsWith('..') || path.isAbsolute(presetRel)) {
            gameIni = feederConfig.setIni(gameIni, 'GENERAL', 'PresetPath', '.\\ReShadePreset.ini');
            presetFile = path.join(exeDir, 'ReShadePreset.ini');
          }
          await apply.writeTracked(manifest, gameDir, gameIniPath, gameIni, { kind: 'config' });
          await apply.writeTracked(
            manifest,
            gameDir,
            presetFile,
            feederConfig.configurePreset(feederConfig.readText(presetFile), provider, { xenia: false }),
            { kind: 'config' }
          );
          const cfgPath = path.join(exeDir, 'dlss5-feed.cfg');
          await apply.writeTracked(
            manifest,
            gameDir,
            cfgPath,
            feederConfig.configureFeed(feederConfig.readText(cfgPath)),
            { kind: 'config' }
          );
          manifest.route = 'feeder';
          manifest.feeder = { version: '1.19.0', provider };
        } else {
          if (!manifest.route) manifest.route = 'native';
        }
        await apply.saveActiveManifest(gameDir, manifest);
      });
    }
  }

  // 2. 应用多帧生成设置（若调用方指定了 mfgMode）
  if (mfgMode !== undefined) {
    if (!canRunMfg) {
      if (mfgMode === 'off' && targetBitness === 64) {
        mfgResult = await mfgManager.applyMfgConfiguration(gameDir, {
          exePath,
          apiOverride: config.apiOverride,
          mode: 'off',
          runtimeStack: effectiveRuntimeStack,
          hdrCompatibility,
          upgradeDlssg: false,
          hardwareProfile: effectiveProfile,
          payloadDir: effectivePayloadDir,
          userDataDir
        }, onLog);
      } else {
        mfgResult = {
          ok: true,
          mode: 'off',
          requestedMode: mfgMode,
          multiplier: 1,
          skipped: mfgMode !== 'off',
          reason: mfgMode !== 'off'
            ? `当前游戏为 ${targetBitness} 位 ${targetApiLabel}；仅 64 位 DirectX 12 / Vulkan 路线支持原生 DLSS-G，已跳过多帧生成。`
            : null
        };
      }
    } else {
      mfgResult = await mfgManager.applyMfgConfiguration(gameDir, {
        exePath,
        apiOverride: config.apiOverride,
        reshadeProxy: config.reshadeProxy,
        gpuName,
        mode: mfgMode,
        runtimeStack: effectiveRuntimeStack,
        hdrCompatibility,
        upgradeDlssg: true,
        hardwareProfile: effectiveProfile,
        payloadDir: effectivePayloadDir,
        userDataDir
      }, onLog);

      // 注意：绝不向原本没有 sl.interposer.dll 的游戏强行注入外源 sl.common.dll / sl.dlss_g.dll (2.14.16.0)，
      // 也不覆盖游戏自带的 Streamline 组件，防止破坏游戏自身 Streamline ABI 导致帧生成选项变灰或误触发 Streamline Hook 检查。
    }
  }

  // 3. 若两个模块同时处于激活状态且均使用 ReShade Addon，强制同步 LoadFromDllMain=renodx-mfgunlock.addon64 与 RuntimeSelectionMode=1；
  //    并确保 [RenoDX.DLSS5] 保持 ConfigVersion=7 与对应档位的分辨率比例（对于自带 Streamline 的游戏自动写入 EnableHooks=1）
  const reshadeIni = path.join(exeDir, 'ReShade.ini');
  const hasNrAddon = fs.existsSync(path.join(exeDir, 'renodx-dlss5.addon64')) ||
    fs.existsSync(path.join(exeDir, 'renodx-dlss.addon64'));
  const hasMfgAddon = fs.existsSync(path.join(exeDir, 'renodx-mfgunlock.addon64'));
  const hasNativeStreamline = fs.existsSync(path.join(exeDir, 'sl.interposer.dll')) ||
    fs.existsSync(path.join(exeDir, 'sl.common.dll')) ||
    (Array.isArray(scan.streamlineFiles) && scan.streamlineFiles.length > 0);
  const isDesktopProfile = effectiveProfile === 'rtx40_desktop' || effectiveProfile === 'rtx50_desktop';
  if ((hasNrAddon || hasMfgAddon) && fs.existsSync(reshadeIni)) {
    await journal.transaction(gameDir, async () => {
      const manifest = apply.beginManifest(gameDir, exePath, scan.chosen.api || 'dxgi');
      manifest.hardwareProfile = effectiveProfile;
      let iniText = feederConfig.readText(reshadeIni);
      iniText = feederConfig.setIni(iniText, 'ADDON', 'AddonPath', '.\\');
      if (hasMfgAddon) {
        iniText = feederConfig.setEarlyAddon(iniText, 'renodx-mfgunlock.addon64', true);
        iniText = feederConfig.setIni(iniText, 'RenoDX.MFGUnlock', 'RuntimeSelectionMode', '1');
      }
      if (hasNrAddon && neuralMode !== undefined && neuralMode !== 'off') {
        iniText = feederConfig.setIni(iniText, 'RenoDX.DLSS5', 'ConfigVersion', '7');
        if (hasNativeStreamline) {
          iniText = feederConfig.setIni(iniText, 'RenoDX.DLSS5', 'EnableHooks', '1');
        }
        iniText = feederConfig.setIni(iniText, 'RenoDX.DLSS5', 'NRResolutionScale', isDesktopProfile ? '1' : '0.75');
        iniText = feederConfig.setIni(iniText, 'RenoDX.DLSS5', 'NRFollowInputRes', '0');
        iniText = feederConfig.setIni(iniText, 'RenoDX.DLSS5', 'NRHookPoint', '0');
        iniText = feederConfig.setIni(iniText, 'RenoDX.DLSS5', 'NRMaxWorksets', isDesktopProfile ? '8' : '4');
        iniText = feederConfig.setIni(iniText, 'RenoDX.DLSS5', 'UiLanguage', 'zh-Hans');
      }
      await apply.writeTracked(manifest, gameDir, reshadeIni, iniText, { kind: 'config' });
      await apply.saveActiveManifest(gameDir, manifest);
    });
  }

  const updatedStatus = await inspectCombinedStatus(gameDir, {
    exePath,
    apiOverride: config.apiOverride,
    payloadDir: effectivePayloadDir,
    userDataDir,
    hardwareProfile: effectiveProfile
  });
  return {
    ok: true,
    hardwareProfile: effectiveProfile,
    feederDeployed,
    feederSummary,
    neuralResult,
    mfgResult,
    status: updatedStatus
  };
}

module.exports = {
  resolveHardwareProfile,
  detectHardwareEnvironment,
  estimateVramBudget,
  evaluateCoExecutionChecks,
  inspectCombinedStatus,
  applyCombinedConfiguration
};
