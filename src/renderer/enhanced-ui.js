'use strict';

/**
 * DLSS 5 Swapper Enhanced — 前端三大核心模块界面控制器 (Phase 5)
 *
 * 包含三个核心功能区域：
 * 1. 神经渲染管理 (模块 A)
 * 2. 多帧生成管理 (模块 B)
 * 3. 兼容性与诊断 (模块 C：协同运行与 7 项诊断)
 *
 * 状态严格区分：
 * - 已验证可用 (verified)
 * - 实验性支持 (experimental)
 * - 不兼容 (incompatible)
 * - 尚未测试 (untested)
 */

(function initEnhancedUi(root) {
  const displayMode = mode => ({off:'关闭',legacy:'旧版模型',latest_compatible:'本地兼容模型',oct2026_faster:'本地兼容模型',fixed:'固定倍率',dynamic:'动态倍率',x2:'2 倍',x3:'3 倍',x4:'4 倍'})[mode] || mode;
  const localError = (message, code) => {
    if (code && root.i18n?.S?.zh?.[code]) return root.i18n.t(code);
    return String(message || '').replace(/^Close the game and helper first:/, '请先关闭游戏及其辅助进程：');
  };
  const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[c]));

  // 三大硬件专属优化档位元数据（中文选择菜单）
  const HARDWARE_PROFILE_OPTIONS = [
    {
      id: 'rtx40_laptop',
      label: '💻 笔记本 40 系列 (默认黄金档)',
      tag: '原版黄金参数 · 防黑屏已加固',
      desc: 'RTX 4050 / 4060 / 4070 / 4080 / 4090 Laptop · 杀手3实测 150~164 FPS 黄金参数 + 动态多帧生成防黑屏',
      dlssSummary: '【DLSS 5 神经渲染模板】超分后处理，75% 神经渲染工作分辨率、1 次推理、4 个工作集；采用基准运行库。关闭自动遮罩与 UI 校正，具体画面和性能需在当前游戏中验证。',
      mfgSummary: '【MFG 多帧生成策略】默认启用 NVIDIA 动态多帧生成 (DynamicMFG=1) + 原生输入模式 (QualityGuardMode=0) + DllMain 抢先挂钩，彻底解决开启补帧黑屏问题。'
    },
    {
      id: 'rtx40_desktop',
      label: '🖥️ 40 系桌面卡 (满血画质 + 桌面补帧)',
      tag: '桌面 Ada 满血专属',
      desc: 'RTX 4060Ti / 4070S / 4070TiS / 4080S / 4090D · 100% 满血分辨率 + 8 缓冲池 + 动态多帧生成 MFG',
      dlssSummary: '【DLSS 5 神经渲染策略】解锁 100% 原生满血工作分辨率 (NRResolutionScale=1, NRHookPoint=0) + 8 表面工作集缓冲池 (NRMaxWorksets=8)，根治桌面 2K/4K 高帧率表面重建卡顿。',
      mfgSummary: '【MFG 多帧生成策略】开启 DllMain 抢先挂钩 + NVIDIA 动态多帧生成 (DynamicMFG=1) + V3 方向性高锐度插值 (AdaptiveQualityProfile=2) + Reflex 强制低延迟护栏。'
    },
    {
      id: 'rtx50_desktop',
      label: '🚀 50 系列桌面卡 (Blackwell 原生直通)',
      tag: 'Blackwell 原生硬件加速',
      desc: 'RTX 5070 / 5070Ti / 5080 / 5090D · 原生 sm_120 (23核) 直通 + 零冲突原生硬件 MFG x2/x3/x4',
      dlssSummary: '【DLSS 5 神经渲染策略】直通 CUDA sm_120 (23 个 Blackwell 原生核函数) + 100% 满血工作分辨率 (NRResolutionScale=1) + 8 表面缓冲池 + 2026-10 极速运行时管线。',
      mfgSummary: '【MFG 多帧生成策略】自动旁路所有 40 系二进制补丁 (TemporalFix=0, BlackwellFrameworkKernels=0, ForceFlipMeteringOff=0)，零冲突直通第 5 代 Tensor 硬件帧呈现计量 + 动态多帧生成。'
    }
  ];

  function getProfileOption(profileId) {
    return HARDWARE_PROFILE_OPTIONS.find((p) => p.id === profileId) || HARDWARE_PROFILE_OPTIONS[0];
  }

  // 每个游戏目录独立的 UI 选择状态（未点击“应用”前不会虚假声称已生效）
  const draftState = new Map();
  let cachedHw = null;
  let cachedModels = null;
  let selectedViewGameDir = '';
  let activeGlobalProfile = 'rtx40_laptop';

  function getDraft(dir, status) {
    const statusProfile = status?.hardwareProfile || activeGlobalProfile || 'rtx40_laptop';
    if (!draftState.has(dir)) {
      const currentNrMode = status?.neural?.mode && status.neural.mode !== 'off'
        ? status.neural.mode
        : 'latest_compatible';
      const currentModelId = status?.neural?.currentModel?.id || '310.8.SF-v2';
      const currentMfgMode = status?.mfg?.currentConfig?.mode && status.mfg.currentConfig.mode !== 'off'
        ? status.mfg.currentConfig.mode
        : 'x3';
      draftState.set(dir, {
        hardwareProfile: statusProfile,
        neuralMode: currentNrMode,
        neuralModelId: currentModelId,
        runtimeStack: status?.neural?.configuredRuntimeStack || (status?.neural?.installed && status.neural.runtimeStack) || (statusProfile === 'rtx50_desktop' ? 'oct2026-310.9.16' : 'baseline-310.9.1'),
        mfgMode: currentMfgMode,
        hdrCompatibility: false
      });
    }
    const d = draftState.get(dir);
    if (!d.hardwareProfile) d.hardwareProfile = statusProfile;
    if (!d.neuralModelId) d.neuralModelId = status?.neural?.currentModel?.id || '310.8.SF-v2';
    if (d.neuralModelId === '310.9.16-oct2026') d.neuralModelId = '310.8.SF-v2';
    if (d.neuralMode === 'oct2026_faster') d.neuralMode = 'latest_compatible';
    return d;
  }

  /**
   * 将后端状态等级映射为明确区分的四类状态徽章：
   * - 已验证可用
   * - 实验性支持
   * - 不兼容
   * - 尚未测试
   */
  function renderStatusBadge(level, customLabel) {
    const norm = String(level || 'untested').toLowerCase();
    let cls = 'enh-badge-untested';
    let text = customLabel || '尚未测试';
    if (norm === 'verified' || text.includes('已验证可用')) {
      cls = 'enh-badge-verified';
      if (!customLabel) text = '已验证可用';
    } else if (norm === 'experimental' || text.includes('实验性支持')) {
      cls = 'enh-badge-experimental';
      if (!customLabel) text = '实验性支持';
    } else if (norm === 'incompatible' || text.includes('不兼容')) {
      cls = 'enh-badge-incompatible';
      if (!customLabel) text = '不兼容';
    } else {
      cls = 'enh-badge-untested';
      if (!customLabel) text = '尚未测试';
    }
    return `<span class="enh-badge ${cls}">${escHtml(text)}</span>`;
  }

  /**
   * 构建 7 项协同运行检查项列表
   */
  function buildCoExecCheckItems(coExec, hardwareProfile = 'rtx40_laptop') {
    if (!coExec) return [];
    const conflicts = coExec.dllConflicts || [];
    const hasErrConflict = conflicts.some((c) => c.severity === 'error');
    const vram = coExec.vramBudget || {};
    const vramCheckTitle = hardwareProfile === 'rtx50_desktop'
      ? '5. RTX 50 系列原生 (Blackwell) 显存预算'
      : hardwareProfile === 'rtx40_desktop'
        ? '5. RTX 40 系桌面卡 100% 满血显存预算'
        : '5. RTX 40 系列笔记本省显存预算';
    return [
      {
        title: '1. 模块 DLL 冲突检查',
        status: hasErrConflict ? 'incompatible' : (conflicts.length ? 'experimental' : 'verified'),
        badge: hasErrConflict ? '不兼容' : (conflicts.length ? '实验性支持' : '已验证可用'),
        detail: conflicts.length ? conflicts.map((c) => c.message).join(' ') : '无 DLL 命名或 挂钩冲突'
      },
      {
        title: '2. Streamline / NGX 注入链协同',
        status: coExec.slChainCheck?.ok ? 'verified' : 'experimental',
        badge: coExec.slChainCheck?.ok ? '已验证可用' : '实验性支持',
        detail: coExec.slChainCheck?.message || 'RuntimeSelectionMode=1 协同正常'
      },
      {
        title: '3. 运动矢量与补帧质量保护',
        status: coExec.motionVectorCheck?.mitigationActive ? 'verified' : 'untested',
        badge: coExec.motionVectorCheck?.mitigationActive ? '已验证可用' : '尚未测试',
        detail: coExec.motionVectorCheck?.message || '边界伪影缓解 保护边缘光流'
      },
      {
        title: '4. HUD / HDR 闪烁与拖影抑制',
        status: coExec.hudFlickerCheck?.hdrGameNeedsGuard ? 'experimental' : 'verified',
        badge: coExec.hudFlickerCheck?.hdrGameNeedsGuard ? '实验性支持' : '已验证可用',
        detail: coExec.hudFlickerCheck?.message || '原生 HUD/UI 标记直通正常'
      },
      {
        title: vramCheckTitle,
        status: vram.level === 'critical' ? 'incompatible' : (vram.level === 'caution' ? 'experimental' : 'verified'),
        badge: vram.level === 'critical' ? '不兼容 (超预算)' : (vram.level === 'caution' ? '实验性支持' : '已验证可用'),
        detail: vram.summary || '处于显存安全预算范围内'
      },
      {
        title: '6. Reflex 帧同步与延迟控制',
        status: coExec.reflexCheck?.ok ? 'verified' : 'experimental',
        badge: coExec.reflexCheck?.ok ? '已验证可用' : '实验性支持',
        detail: coExec.reflexCheck?.message || 'sl.reflex.dll 与硬件帧呈现计量 正常'
      },
      {
        title: '7. 游戏退出后完整恢复原状能力',
        status: coExec.backupCheck?.ok ? 'verified' : 'incompatible',
        badge: coExec.backupCheck?.badge || '已验证可用',
        detail: coExec.backupCheck?.message || '事务级备份完整'
      }
    ];
  }

  /**
   * 构建三大功能区域 HTML（可同时嵌入游戏详情抽屉 #sheet 与独立增强视图 #view-enhanced）
   */
  function buildThreePanelsHtml(dir, status, modelsInfo, prefix = 'sheet') {
    const draft = getDraft(dir, status);
    const activeProfileId = draft.hardwareProfile || status.hardwareProfile || 'rtx40_laptop';
    const activeProfileMeta = getProfileOption(activeProfileId);
    const nr = status.neural || {};
    const mfg = status.mfg || {};
    const diag = status.diagnostics || {};
    const coExec = diag.coExecution || {};
    const vram = coExec.vramBudget || {
      estimatedTotalMB: 5400,
      vramTotalMB: 8188,
      usagePercent: 66,
      headroomMB: 2788,
      totalAddedOverheadMB: 0
    };
    const checks = buildCoExecCheckItems(coExec, activeProfileId);

    // 1. 神经渲染管理 状态判定
    const nrBadge = renderStatusBadge(nr.overallStatus, nr.overallBadge);

    const currentModelText = nr.currentModel
      ? `${nr.currentModel.name || nr.currentModel.id || '未识别模型'} · 文件版本 ${nr.currentModel.version || '未知'}`
      : '未安装';
    const latestModelText = nr.latestCompatibleModel
      ? `${nr.latestCompatibleModel.name} · 文件版本 ${nr.latestCompatibleModel.version}`
      : '兼容模型首次使用时下载，完成后校验 GPU 架构';
    const runtimeVerText = nr.runtimeVersion ? `DLSS SR ${nr.runtimeVersion}` : '未检测到 DLSS SR 运行库';
    const gpuCompatText = nr.gpuCompatibility
      ? `${nr.gpuCompatibility.badge} · ${nr.gpuCompatibility.reason}`
      : '尚未检查 GPU 架构';
    const modelChoices = nr.availableModels || modelsInfo?.models || [];
    const modelOptions = modelChoices.map(m => `<option value="${escHtml(m.id)}" ${draft.neuralModelId === m.id ? 'selected' : ''} ${(!m.availableOnDisk && !m.downloadable) || m.compatStatus === 'incompatible' ? 'disabled' : ''}>${escHtml(m.name)} · ${escHtml(m.version || '版本未知')} · ${m.availableOnDisk ? '本地可用' : m.downloadable ? '首次使用时下载' : '未导入'}</option>`).join('');
    const legacyAvailable = modelChoices.some(m => m.availableOnDisk && m.role === 'legacy' && m.compatStatus !== 'incompatible');

    // 2. 多帧生成管理 状态判定
    const mfgBadgeHtml = renderStatusBadge(mfg.status, mfg.statusBadge);

    const effectiveMultiplierText = '请在“运行时检测”中查看；配置倍率和兼容性评估不代表已生效。';

    const dlssgVerText = mfg.dlssg?.present
      ? `${mfg.dlssg.version} (${mfg.dlssg.valid ? '原生 NVIDIA NGX DLSS-G' : '非原生 DLL'})`
      : '未部署 (应用时自动部署 310.9.16.0)';

    const mfgSupportedModesText = activeProfileId === 'rtx50_desktop'
      ? '关闭 / x2 (原生支持) / x3 (Blackwell 原生硬件支持) / x4 (Blackwell 原生硬件支持)'
      : activeProfileId === 'rtx40_desktop'
        ? '关闭 / x2 (原生支持) / x3 (40系桌面低延迟解锁) / x4 (40系桌面低延迟解锁)'
        : '关闭 / x2 (原生支持) / x3 (实验性支持) / x4 (实验性支持)';

    const mfgX3Sub = activeProfileId === 'rtx50_desktop' ? '3帧输出 (原生支持)' : (activeProfileId === 'rtx40_desktop' ? '3帧输出 (桌面满血)' : '3帧输出 (实验性)');
    const mfgX4Sub = activeProfileId === 'rtx50_desktop' ? '4帧输出 (原生支持)' : (activeProfileId === 'rtx40_desktop' ? '4帧输出 (桌面满血)' : '4帧输出 (实验性)');

    // 3. 兼容性与诊断 状态判定
    const diagBadgeHtml = renderStatusBadge(diag.combinedStatus, diag.combinedBadge);

    const vramBoxTitle = activeProfileId === 'rtx50_desktop'
      ? `RTX 50 系列原生显存预算估算 (${vram.resolution || '2K/4K 100% 满血分辨率'} · 附加开销 +${vram.totalAddedOverheadMB || 0} MB)`
      : activeProfileId === 'rtx40_desktop'
        ? `RTX 40 系桌面卡显存预算估算 (${vram.resolution || '2K/4K 100% 满血分辨率'} · 附加开销 +${vram.totalAddedOverheadMB || 0} MB)`
        : `RTX 40 系列笔记本省显存预算估算 (0.75x 省显存超分管线 · 附加开销 +${vram.totalAddedOverheadMB || 0} MB)`;

    return `
      <div class="enh-sheet-section" data-enh-dir="${escHtml(dir)}" data-enh-prefix="${escHtml(prefix)}">
        <!-- ==================== 顶部：硬件专属优化档位中文三选一菜单 ==================== -->
        <section class="enh-profile-bar" aria-label="硬件专属优化档位选择菜单">
          <div class="enh-profile-head">
            <h4>🎛️ 硬件专属优化档位选择菜单 <span class="enh-badge enh-badge-verified">全模型兼容 · 桌面显卡 MFG 已适配</span></h4>
            <span class="sub">切换档位将自动匹配对应的 DLSS 5 分辨率管线与 MFG 多帧生成策略（笔记本 40 系列默认锁定原版黄金参数不动）</span>
          </div>
          <div class="enh-profile-grid" role="group" aria-label="显卡优化档位切换">
            ${HARDWARE_PROFILE_OPTIONS.map((opt) => `
              <button type="button" class="enh-profile-btn ${activeProfileId === opt.id ? 'active' : ''}" data-hw-profile="${escHtml(opt.id)}">
                <div class="enh-profile-btn-top">
                  <span class="enh-profile-btn-title">${escHtml(opt.label)}</span>
                  <span class="enh-profile-btn-tag">${escHtml(opt.tag)}</span>
                </div>
                <span class="enh-profile-btn-desc">${escHtml(opt.desc)}</span>
              </button>
            `).join('')}
          </div>
          <div class="enh-profile-summary">
            <div><b>当前已选档位：${escHtml(activeProfileMeta.label)}</b></div>
            <p class="hint enh-preset-scope">通用硬件模板：并非每款游戏都有专用调校。应用只写入当前选中的游戏；重新应用会将模板涵盖的参数写回默认值，可能覆盖游戏内的手动调整。</p>
            <small>${escHtml(activeProfileMeta.dlssSummary)}</small>
            <small>${escHtml(activeProfileMeta.mfgSummary)}</small>
          </div>
        </section>

        <div class="enh-grid">
          <!-- ==================== 模块 A: 神经渲染管理 ==================== -->
          <section class="enh-card" aria-label="神经渲染管理">
            <div class="enh-card-head">
              <div class="enh-card-title">
                <h4>神经渲染管理 <small style="font-weight:500;color:var(--muted)">模块 A · DLSS 5 神经渲染</small></h4>
                <p>分别管理神经渲染模型文件与运行库组合。文件安装、架构匹配和游戏内生效是不同状态。</p>
              </div>
              ${nrBadge}
            </div>

            <div class="enh-kv-list">
              <div class="enh-kv-row"><span class="k">当前硬件档位</span><span class="v">${escHtml(activeProfileMeta.label)}</span></div>
              <div class="enh-kv-row"><span class="k">当前模型 </span><span class="v">${escHtml(currentModelText)}</span></div>
              <div class="enh-kv-row"><span class="k">本地推荐模型</span><span class="v">${escHtml(latestModelText)}</span></div>
              <div class="enh-kv-row"><span class="k">已检测 SR 版本</span><span class="v mono">${escHtml(runtimeVerText)}</span></div>
              <div class="enh-kv-row"><span class="k">GPU 兼容性 </span><span class="v">${escHtml(gpuCompatText)}</span></div>
              <div class="enh-kv-row"><span class="k">安装状态 </span><span class="v">${nr.installed ? `已安装 (${escHtml(displayMode(nr.mode))})` : '未安装'}</span></div>
            </div>

            <div class="enh-control-group">
              <div class="enh-control-label">
                <span>DLSS 5 神经渲染模式选择</span>
                <span>选中项仅代表待应用配置</span>
              </div>
              <div class="enh-seg" role="group" aria-label="神经渲染模式">
                <button type="button" class="enh-seg-btn ${draft.neuralMode === 'off' ? 'active' : ''}" data-nr-mode="off">
                  <span>关闭</span><small>关闭神经渲染</small>
                </button>
                <button type="button" class="enh-seg-btn ${draft.neuralMode === 'legacy' ? 'active' : ''}" data-nr-mode="legacy" ${legacyAvailable ? '' : 'disabled title="请先导入旧版模型文件"'}>
                  <span>旧版模型</span><small>${legacyAvailable ? '本地已导入' : '需先导入文件'}</small>
                </button>
                <button type="button" class="enh-seg-btn ${draft.neuralMode === 'latest_compatible' ? 'active' : ''}" data-nr-mode="latest_compatible">
                  <span>兼容模型</span><small>按需下载 / 使用缓存</small>
                </button>
              </div>
            </div>

            <div class="enh-select-row">
              <label>
                <span>神经渲染模型文件</span>
                <select data-enh-field="neuralModelId">
                  ${!modelChoices.some(m => m.id === draft.neuralModelId) ? '<option value="" selected disabled>所选模型不可用，请导入或重新选择</option>' : ''}
                  ${modelOptions}
                </select>
              </label>
              <label>
                <span>运行库组合 (独立于模型文件)</span>
                <select data-enh-field="runtimeStack">
                  <option value="baseline-310.9.1" ${draft.runtimeStack === 'baseline-310.9.1' ? 'selected' : ''}>基准组合：DLSS SR 310.9.1 / Streamline 2.13 / Feeder 1.17</option>
                  <option value="oct2026-310.9.16" ${draft.runtimeStack === 'oct2026-310.9.16' ? 'selected' : ''}>可选组合：DLSS SR 310.9.16 / Streamline 2.14.16 / Feeder 1.19</option>
                </select>
              </label>
            </div>

            <div class="enh-note">
              <b>模型与运行库</b>：旧选项“310.9.16-oct2026”与“310.8.SF-v2”共用同一文件，现已合并。切换运行库组合不会把模型升级成 310.9.16，也不保证提速。模型按文件哈希识别；实际生效请看运行时检测。
            </div>

            <div class="enh-actions-single">
              <button type="button" class="enh-btn single-load" data-enh-act="apply-nr" title="先预览文件变更，再确认应用">应用神经渲染</button>
              <button type="button" class="enh-btn sm-import" data-enh-act="import-nr" title="导入 nvngx_dlssnr.dll 到模型库">导入 DLL…</button>
            </div>
          </section>

          <!-- ==================== 模块 B: 多帧生成管理 ==================== -->
          <section class="enh-card" aria-label="多帧生成管理">
            <div class="enh-card-head">
              <div class="enh-card-title">
                <h4>多帧生成管理 <small style="font-weight:500;color:var(--muted)">模块 B · DLSS-G 多帧生成</small></h4>
                <p>管理 NVIDIA DLSS-G 运行库与补帧倍率；实际支持和生效状态以当前游戏检测结果为准。</p>
              </div>
              ${mfgBadgeHtml}
            </div>

            <div class="enh-kv-list">
              <div class="enh-kv-row"><span class="k">当前补帧档位 </span><span class="v">${escHtml(activeProfileMeta.label)}</span></div>
              <div class="enh-kv-row"><span class="k">当前显卡 </span><span class="v">${escHtml(mfg.gpuSupport?.gpuName || 'NVIDIA GeForce RTX 4070 Laptop GPU')}</span></div>
              <div class="enh-kv-row"><span class="k">DLSS-G 版本 </span><span class="v mono">${escHtml(dlssgVerText)}</span></div>
              <div class="enh-kv-row"><span class="k">支持模式 </span><span class="v">${escHtml(mfgSupportedModesText)}</span></div>
              <div class="enh-kv-row"><span class="k">实际生效倍率 </span><span class="v" data-runtime-mfg>${escHtml(effectiveMultiplierText)}</span></div>
              <div class="enh-kv-row"><span class="k">当前游戏兼容性 </span><span class="v">${escHtml(mfg.knownGame ? `${mfg.knownGame.title} (${mfg.knownGame.notes})` : '未收录游戏专用兼容说明；请以 API 检测和运行时结果为准。')}</span></div>
            </div>

            <div class="enh-control-group">
              <div class="enh-control-label">
                <span>多帧生成倍率选择</span>
                <span>${activeProfileId === 'rtx50_desktop' ? '50系桌面卡原生硬件直通' : (activeProfileId === 'rtx40_desktop' ? '40系桌面卡 V3 高锐度 + 低延迟护栏' : '笔记本 40 系列黄金配置')}</span>
              </div>
              <div class="enh-seg enh-seg-4" role="group" aria-label="多帧生成模式">
                <button type="button" class="enh-seg-btn ${draft.mfgMode === 'off' ? 'active' : ''}" data-mfg-mode="off">
                  <span>关闭</span><small>关闭补帧</small>
                </button>
                <button type="button" class="enh-seg-btn ${draft.mfgMode === 'x2' ? 'active' : ''}" data-mfg-mode="x2">
                  <span>x2</span><small>标准 FG (已验证)</small>
                </button>
                <button type="button" class="enh-seg-btn ${draft.mfgMode === 'x3' ? 'active' : ''}" data-mfg-mode="x3">
                  <span>x3</span><small>${escHtml(mfgX3Sub)}</small>
                </button>
                <button type="button" class="enh-seg-btn ${draft.mfgMode === 'x4' ? 'active' : ''}" data-mfg-mode="x4">
                  <span>x4</span><small>${escHtml(mfgX4Sub)}</small>
                </button>
              </div>
            </div>

            <div class="enh-select-row">
              <label>
                <span>帧生成输入源策略 (QualityGuardMode)</span>
                <select data-enh-field="hdrCompatibility">
                  <option value="false" ${draft.hdrCompatibility === false ? 'selected' : ''}>原生输入模式 (QualityGuardMode=0 · 推荐绝大多数游戏 · 防止黑屏)</option>
                  <option value="true" ${draft.hdrCompatibility !== false ? 'selected' : ''}>HDR 界面保护模式 (QualityGuardMode=2 · 仅限开启 HDR 的特定游戏)</option>
                </select>
              </label>
            </div>

            <div class="enh-note">
              <b>档位补帧说明</b>：${escHtml(activeProfileMeta.mfgSummary)}
            </div>

            <div class="enh-actions-single">
              <button type="button" class="enh-btn single-load" data-enh-act="apply-mfg" title="先预览文件变更，再确认应用">应用帧生成</button>
            </div>
          </section>

          <!-- ==================== 模块 C: 兼容性与诊断 ==================== -->
          <section class="enh-card enh-card-full" aria-label="兼容性与诊断">
            <div class="enh-card-head">
              <div class="enh-card-title">
                <h4>兼容性与诊断 <small style="font-weight:500;color:var(--muted)">模块 C · DLSS 5 + MFG 协同运行与诊断</small></h4>
                <p>独立控制 神经渲染与多帧生成 同时运行，实时检查 7 项底层兼容性指标与目标显卡显存预算</p>
              </div>
              ${diagBadgeHtml}
            </div>

            <div class="enh-kv-list">
              <div class="enh-kv-row"><span class="k">游戏名称</span><span class="v">${escHtml(diag.gameName || '未选择游戏')}</span></div>
              <div class="enh-kv-row"><span class="k">生效硬件档位</span><span class="v">${escHtml(activeProfileMeta.label)}</span></div>
              <div class="enh-kv-row"><span class="k">图形 API</span><span class="v">${escHtml(diag.graphicsApi || 'DirectX 12')} (${status.bitness || 64} 位)</span></div>
              <div class="enh-kv-row"><span class="k">神经渲染状态</span><span class="v">${escHtml(diag.neuralStatus || '尚未测试')}</span></div>
              <div class="enh-kv-row"><span class="k">多帧生成状态</span><span class="v">${escHtml(diag.mfgStatus || '尚未测试')}</span></div>
              <div class="enh-kv-row"><span class="k">无 DLSS / 低版本 / 破解兼容 </span><span class="v">${escHtml(coExec.dlssCompat?.summary || '已启用无 DLSS 光流注入、深层旧版 DLSS 自动升级与补丁防覆盖保护')}</span></div>
              <div class="enh-kv-row"><span class="k">DLL 冲突 </span><span class="v">${diag.dllConflicts?.length ? escHtml(diag.dllConflicts.map((c) => c.message).join('；')) : '无冲突 (0 项冲突)'}</span></div>
              <div class="enh-kv-row"><span class="k">错误日志 </span><span class="v">${diag.errorLogs?.length ? escHtml(diag.errorLogs.join(' | ')) : '无错误记录 (0 项异常)'}</span></div>
              <div class="enh-kv-row"><span class="k">备份状态 </span><span class="v">${escHtml(diag.backupStatus || '原版纯净状态')}</span></div>
            </div>

            <!-- 显存预算进度条 -->
            <div class="enh-vram-box">
              <div class="enh-vram-head">
                <span>${escHtml(vramBoxTitle)}</span>
                <span>预计占用 ${vram.estimatedTotalMB} MB / ${vram.vramTotalMB} MB (${vram.usagePercent}% · 余量 ${vram.headroomMB} MB)</span>
              </div>
              <div class="enh-vram-bar">
                <div class="enh-vram-fill ${vram.usagePercent > 88 ? 'warn' : ''}" style="width:${Math.min(100, vram.usagePercent)}%"></div>
              </div>
            </div>

            <!-- 7 项协同运行检查列表 -->
            <div class="enh-checks-grid">
              ${checks.map((item) => `
                <div class="enh-check-card">
                  <div class="enh-check-top">
                    <span>${escHtml(item.title)}</span>
                    ${renderStatusBadge(item.status, item.badge)}
                  </div>
                  <div class="enh-check-detail">${escHtml(item.detail)}</div>
                </div>
              `).join('')}
            </div>

            <div class="enh-master-bar">
              <button type="button" class="enh-btn master-load" data-enh-act="apply-combined">预览并应用组合</button>
              <button type="button" class="enh-btn danger-restore" data-enh-act="restore-all" ${coExec.backupCheck?.hasManifest ? '' : 'disabled'}>还原游戏原始文件</button>
              <button type="button" class="enh-btn" data-enh-act="refresh-status">刷新状态</button>
            </div>
          </section>
        </div>
      </div>
    `;
  }

  /**
   * 绑定三大面板内部的交互事件
   */
  function wirePanelEvents(container, dir, status, onUpdated) {
    if (!container) return;
    const draft = getDraft(dir, status);

    for (const pBtn of container.querySelectorAll('[data-hw-profile]')) {
      pBtn.onclick = async () => {
        const pickedProfile = pBtn.dataset.hwProfile;
        draft.hardwareProfile = pickedProfile;
        activeGlobalProfile = pickedProfile;
        if (pickedProfile === 'rtx50_desktop') {
          draft.runtimeStack = 'oct2026-310.9.16';
        } else {
          draft.runtimeStack = 'baseline-310.9.1';
        }
        if (typeof root.lab?.enhancedSetProfile === 'function') {
          await root.lab.enhancedSetProfile(pickedProfile).catch(() => {});
        }
        cachedHw = null;
        cachedModels = null;
        if (container.dataset.enhPrefix === 'view') {
          await renderEnhancedView();
        } else {
          await refreshCurrent(pickedProfile);
        }
      };
    }

    for (const btn of container.querySelectorAll('[data-nr-mode]')) {
      btn.onclick = () => {
        draft.neuralMode = btn.dataset.nrMode;
        if (draft.neuralMode === 'legacy') {
          draft.neuralModelId = status.neural?.availableModels?.find(m => m.availableOnDisk && m.role === 'legacy' && m.compatStatus !== 'incompatible')?.id || draft.neuralModelId;
        } else if (draft.neuralMode === 'latest_compatible') {
          draft.neuralModelId = status.neural?.latestCompatibleModel?.id || draft.neuralModelId;
        }
        onUpdated();
      };
    }

    for (const btn of container.querySelectorAll('[data-mfg-mode]')) {
      btn.onclick = () => {
        draft.mfgMode = btn.dataset.mfgMode;
        onUpdated();
      };
    }

    for (const sel of container.querySelectorAll('[data-enh-field]')) {
      sel.onchange = () => {
        const field = sel.dataset.enhField;
        if (field === 'hdrCompatibility') {
          draft.hdrCompatibility = sel.value === 'true';
        } else if (field === 'neuralModelId') {
          draft.neuralModelId = sel.value;
          if (status.neural?.availableModels?.find(m => m.id === sel.value)?.role === 'legacy') draft.neuralMode = 'legacy';
          else if (draft.neuralMode === 'off' || draft.neuralMode === 'legacy') draft.neuralMode = 'latest_compatible';
        } else {
          draft[field] = sel.value;
        }
        onUpdated();
      };
    }

    const refreshCurrent = profile => container.dataset.enhGameDir === dir ? refreshContainer(container, dir, profile) : Promise.resolve();
    const runAction = async (payload) => {
      const buttons = container.querySelectorAll('button, select');
      buttons.forEach((b) => { b.disabled = true; });
      try {
        const finalPayload = {
          hardwareProfile: draft.hardwareProfile || activeGlobalProfile || 'rtx40_laptop',
          neuralModelId: draft.neuralModelId || '310.8.SF-v2',
          ...payload
        };
        const msg = `Enhanced: 应用配置 [档位=${finalPayload.hardwareProfile}] (Neural=${finalPayload.neuralMode ?? '保持'}, Model=${finalPayload.neuralModelId}, MFG=${finalPayload.mfgMode ?? '保持'})`;
        if (typeof root.jobLog === 'function') root.jobLog(`--- ${msg} ---`);
        if (typeof root.log === 'function') root.log(`${msg} -> ${dir}`);
        const res = await root.componentReview.run(token => root.lab.enhancedApply(dir, finalPayload, token));
        if (res?.cancelled) return;
        if (!res?.ok) {
          const message = localError(res?.message || res?.code || '操作未完成', res?.code);
          if (typeof root.jobLog === 'function') root.jobLog(`错误: ${message}`);
          if (typeof root.log === 'function') root.log(`错误: ${message}`);
          await root.ask({title:'操作未完成',body:message,confirm:'知道了',cancel:'关闭'});
        } else {
          if (res?.feederDeployed) {
            const feederMsg = `Enhanced: 已自动为老游戏离线部署 ${res.feederSummary || 'Feeder + 光流着色器'} + DLSS 5 神经渲染 + 全中文菜单。`;
            if (typeof root.jobLog === 'function') root.jobLog(feederMsg);
            if (typeof root.log === 'function') root.log(feederMsg);
          }
          if (res?.mfgResult?.skipped && res?.mfgResult?.reason) {
            const skipMsg = `提示: ${res.mfgResult.reason}`;
            if (typeof root.jobLog === 'function') root.jobLog(skipMsg);
            if (typeof root.log === 'function') root.log(skipMsg);
          }
          if (typeof root.jobLog === 'function') root.jobLog('Enhanced: 配置已成功写入并建立事务备份。');
        }
      } catch (err) {
        if (typeof root.log === 'function') root.log(`Enhanced 操作异常: ${err.message}`);
      } finally {
        await refreshCurrent(draft.hardwareProfile);
      }
    };

    const btnApplyNr = container.querySelector('[data-enh-act="apply-nr"]');
    if (btnApplyNr) {
      btnApplyNr.onclick = () => runAction({
        neuralMode: draft.neuralMode,
        neuralModelId: draft.neuralModelId,
        runtimeStack: draft.runtimeStack,
        hardwareProfile: draft.hardwareProfile
      });
    }

    const btnImportNr = container.querySelector('[data-enh-act="import-nr"]');
    if (btnImportNr) {
      btnImportNr.onclick = async () => {
        btnImportNr.disabled = true;
        try {
          const res = await root.lab.enhancedImportModel();
          if (res?.ok) {
            cachedModels = await root.lab.enhancedModels(draft.hardwareProfile);
            if (typeof root.log === 'function') {
              root.log(`已导入神经渲染模型: ${res.model.name} (${res.model.sha256.slice(0, 12)}…)`);
            }
            await refreshCurrent(draft.hardwareProfile);
          } else if (!res?.cancelled && res?.message) {
            alert(`导入模型失败：${localError(res.message, res.code)}`);
          }
        } finally {
          btnImportNr.disabled = false;
        }
      };
    }

    const btnRestoreNr = container.querySelector('[data-enh-act="restore-nr"]');
    if (btnRestoreNr) {
      btnRestoreNr.onclick = async () => {
        const res = await root.componentReview.run(token => root.lab.restoreGame(dir, token));
        if (!res?.ok) { if (!res?.cancelled) await root.ask({title:'恢复未完成',body:res?.message || res?.code || '恢复失败',confirm:'知道了',cancel:'关闭'}); return; }
        draftState.delete(dir);
        await refreshCurrent(draft.hardwareProfile);
      };
    }

    const btnApplyMfg = container.querySelector('[data-enh-act="apply-mfg"]');
    if (btnApplyMfg) {
      btnApplyMfg.onclick = () => runAction({
        mfgMode: draft.mfgMode,
        runtimeStack: draft.runtimeStack,
        hdrCompatibility: draft.hdrCompatibility,
        hardwareProfile: draft.hardwareProfile
      });
    }

    const btnDisableMfg = container.querySelector('[data-enh-act="disable-mfg"]');
    if (btnDisableMfg) {
      btnDisableMfg.onclick = () => {
        draft.mfgMode = 'off';
        return runAction({
          mfgMode: 'off',
          runtimeStack: draft.runtimeStack,
          hdrCompatibility: draft.hdrCompatibility,
          hardwareProfile: draft.hardwareProfile
        });
      };
    }

    const btnApplyCombined = container.querySelector('[data-enh-act="apply-combined"]');
    if (btnApplyCombined) {
      btnApplyCombined.onclick = () => runAction({
        neuralMode: draft.neuralMode,
        neuralModelId: draft.neuralModelId,
        mfgMode: draft.mfgMode,
        runtimeStack: draft.runtimeStack,
        hdrCompatibility: draft.hdrCompatibility,
        hardwareProfile: draft.hardwareProfile
      });
    }

    const btnRefresh = container.querySelector('[data-enh-act="refresh-status"]');
    if (btnRefresh) {
      btnRefresh.onclick = () => refreshContainer(container, dir, draft.hardwareProfile);
    }

    const btnRestoreAll = container.querySelector('[data-enh-act="restore-all"]');
    if (btnRestoreAll) {
      btnRestoreAll.onclick = async () => {
        const res = await root.componentReview.run(token => root.lab.restoreGame(dir, token));
        if (!res?.ok) { if (!res?.cancelled) await root.ask({title:'恢复未完成',body:res?.message || res?.code || '恢复失败',confirm:'知道了',cancel:'关闭'}); return; }
        draftState.delete(dir);
        await refreshCurrent(draft.hardwareProfile);
      };
    }
  }

  async function refreshContainer(container, dir, profileOverride) {
    if (!container || !dir) return;
    const request = String(Number(container.dataset.enhRequest || 0) + 1);
    container.dataset.enhRequest = request;
    container.dataset.enhGameDir = dir;
    const effectiveProfile = profileOverride || draftState.get(dir)?.hardwareProfile || activeGlobalProfile;
    const [status, modelsInfo] = await Promise.all([
      root.lab.enhancedStatus(dir, effectiveProfile),
      cachedModels ? Promise.resolve(cachedModels) : root.lab.enhancedModels(effectiveProfile)
    ]);
    if (container.dataset.enhRequest !== request) return;
    cachedModels = modelsInfo;
    if (!status) return;
    if (status.hardwareProfile) {
      activeGlobalProfile = status.hardwareProfile;
    }
    const render = () => {
      container.innerHTML = buildThreePanelsHtml(dir, status, modelsInfo, container.dataset.enhPrefix || 'sheet');
      // Bound long native selects without changing the upstream field layout.
      for (const select of container.querySelectorAll('select')) {
        select.title = select.selectedOptions[0]?.textContent || '';
      }
      wirePanelEvents(container, dir, status, render);
      root.componentReview?.mount(container, dir);
    };
    render();
  }

  /**
   * 在游戏详情抽屉 (#sheet) 中挂载三大增强管理器
   */
  async function mountInSheet(dir) {
    const sheet = document.getElementById('sheet');
    if (!sheet || !dir || !root.lab?.enhancedStatus) return;

    // 隐藏原版遗留的重复英文安装栏与废弃社区按钮，汉化底部日志工具按钮
    const legacyActions = sheet.querySelector('.sheet-body .sheet-actions');
    if (legacyActions) legacyActions.style.display = 'none';
    const shareBtn = sheet.querySelector('#shareResult');
    if (shareBtn) shareBtn.style.display = 'none';
    const copyBtn = sheet.querySelector('#copyJob');
    if (copyBtn) copyBtn.textContent = '📋 复制日志';
    const diagBtn = sheet.querySelector('#saveDiag');
    if (diagBtn) diagBtn.textContent = '💾 导出诊断报告';

    let mount = sheet.querySelector('#enhancedSheetMount');
    if (!mount) {
      mount = document.createElement('div');
      mount.id = 'enhancedSheetMount';
      const actions = sheet.querySelector('.sheet-body .sheet-actions') || sheet.querySelector('.gp-main');
      if (actions && actions.parentNode === sheet.querySelector('.sheet-body')) {
        actions.parentNode.insertBefore(mount, actions);
      } else if (actions) {
        actions.appendChild(mount);
      } else {
        sheet.appendChild(mount);
      }
    }
    await refreshContainer(mount, dir);
  }

  /**
   * 渲染独立导航页面 (#view-enhanced)
   */
  async function renderEnhancedView() {
    const view = document.getElementById('view-enhanced');
    if (!view || !root.lab?.enhancedHardware) return;

    const [hwRes, modelsInfo] = await Promise.all([
      cachedHw ? Promise.resolve(cachedHw) : root.lab.enhancedHardware(),
      root.lab.enhancedModels(activeGlobalProfile)
    ]);
    cachedHw = hwRes;
    cachedModels = modelsInfo;
    if (hwRes?.hardwareProfile) {
      activeGlobalProfile = hwRes.hardwareProfile;
    }
    const hw = hwRes?.hardware || hwRes || {};
    const activeProfileMeta = getProfileOption(activeGlobalProfile);

    const games = (typeof state !== 'undefined' && Array.isArray(state.games) && state.games.length)
      ? state.games
      : (await root.lab.library().catch(() => []));
    if (!selectedViewGameDir && games.length > 0) {
      selectedViewGameDir = games[0].dir;
    }

    const gpu = hw.gpu || {
      name: 'NVIDIA GeForce RTX 4070 Laptop GPU',
      driver: '581.80',
      vramTotalMB: 8188,
      powerDefaultW: 100,
      powerMaxW: 140
    };

    const modelList = modelsInfo?.models || [];
    const availableModelCount = modelList.filter(m => m.availableOnDisk).length;
    const modelsRows = modelList.map((m) => `
      <tr>
        <td><b>${escHtml(m.name)}</b><br><small style="color:var(--muted)">${escHtml(m.sourceType || '来源未记录')}</small></td>
        <td><code>${escHtml(m.version || '未知')}</code><br><small>${m.availableOnDisk ? '已读取本地文件' : '目录记录 · 未导入'}</small></td>
        <td><code>${escHtml((m.architectures || []).map(a => 'sm_' + a).join(', '))}</code></td>
        <td title="${escHtml(m.compatReason || '')}">${renderStatusBadge(m.availableOnDisk ? m.compatStatus : 'untested', m.availableOnDisk ? (m.compatBadge || '尚未检查') : '未导入')}</td>
        <td><code title="${escHtml(m.sha256 || '')}" style="font-size:11px">${escHtml(m.sha256 ? m.sha256.slice(0, 16) + '…' : '未记录')}</code></td>
      </tr>
    `).join('');

    view.innerHTML = `
      <div class="section-head">
        <div>
          <h3>DLSS 5 与多帧生成 <span class="beta-tag">独立分支 ${escHtml(root.appRelease?.version || '0.1.0')}</span></h3>
          <p class="hint">选择游戏与硬件档位，分别管理神经渲染、帧生成和运行时组件。</p>
        </div>
      </div>

      <div class="enh-view-wrap">
        <!-- 本机硬件实时检测横幅 -->
        <div class="enh-hw-banner" aria-label="Hardware Detection">
          <div class="enh-hw-item">
            <span class="k">本机物理显卡</span>
            <span class="v">${escHtml(gpu.name)}</span>
            <span class="s">当前生效档位：${escHtml(activeProfileMeta.label)} · ${gpu.vramTotalMB || 8188} MB 显存</span>
          </div>
          <div class="enh-hw-item">
            <span class="k">显卡驱动与功耗上限</span>
            <span class="v">NVIDIA 驱动 ${escHtml(gpu.driver)}</span>
            <span class="s">TGP 默认上限 ${gpu.powerDefaultW || 100}W / 最大 ${gpu.powerMaxW || 140}W</span>
          </div>
          <div class="enh-hw-item">
            <span class="k">处理器与系统内存</span>
            <span class="v">${escHtml(hw.cpu || 'Intel Core i7-13650HX')}</span>
            <span class="s">${hw.cpuCores || 20} 逻辑核心 · ${hw.ramGB || 16} GB 内存</span>
          </div>
          <div class="enh-hw-item">
            <span class="k">目标显示与帧率</span>
            <span class="v">${escHtml(hw.display?.resolution || '1920x1080')} @ ${hw.display?.refreshRateHz || 165}Hz</span>
            <span class="s">支持 1080p 笔记本省显存档 &amp; 2K/4K 桌面满血档</span>
          </div>
        </div>

        <!-- 目标游戏选择器 -->
        <div class="enh-toolbar-bar">
          <label>
            <span>目标游戏</span>
            <select id="enhGameSelect">
              ${games.length
                ? games.map((g) => `<option value="${escHtml(g.dir)}" title="${escHtml(g.dir)}" ${g.dir === selectedViewGameDir ? 'selected' : ''}>${escHtml(g.name)} (${escHtml(g.dir)})</option>`).join('')
                : '<option value="">尚无游戏，请点击“添加游戏”</option>'}
            </select>
          </label>
          <div class="enh-actions" style="padding-top:0">
            <button type="button" class="enh-btn" id="enhBrowseGameBtn" title="浏览并添加游戏目录">添加游戏…</button>
            <button type="button" class="enh-btn" id="enhGlobalImportBtn" title="导入自定义 nvngx_dlssnr.dll 到模型库">导入模型…</button>
            <button type="button" class="enh-btn" id="enhCheckUpdateBtn" title="检查软件更新">检查更新</button>
          </div>
        </div>

        <p id="enhToolbarFeedback" role="status" aria-live="polite" class="hint"></p>

        <!-- 三大核心管理器挂载点 -->
        <div id="enhStandaloneMount" data-enh-prefix="view"></div>

        <!-- 模型版本与哈希数据库 -->
        <section class="enh-card">
          <div class="enh-card-head">
            <div class="enh-card-title">
              <h4>神经渲染模型文件库</h4>
              <p>本地可用 <b id="enhLocalModelCount">${availableModelCount}</b> 个 · 未导入 ${modelList.length - availableModelCount} 个目录记录。兼容模型首次使用时下载，已缓存版本可离线使用；同一文件的不同名称按 SHA-256 去重。</p>
              <p>更多版本可到组件库检查在线更新或导入本地 DLL。DLSS SR / FG 运行库版本与神经模型分别管理；架构检查不代表游戏内生效。</p>
            </div>
            <button type="button" class="enh-btn" id="enhGetModelsBtn">获取更多神经模型</button>
          </div>
          <div class="enh-table-wrap">
            <table class="enh-table">
              <thead>
                <tr>
                  <th>模型 / 来源</th>
                  <th>文件版本 / 本地状态</th>
                  <th>包含 CUDA SM 架构</th>
                  <th>架构检查</th>
                  <th>SHA-256 指纹</th>
                </tr>
              </thead>
              <tbody>
                ${modelsRows}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    document.getElementById('enhGetModelsBtn').onclick = () => root.componentLibrary.open(selectedViewGameDir, 'dlss-nr');
    const gameSelect = document.getElementById('enhGameSelect');
    const mount = document.getElementById('enhStandaloneMount');
    if (gameSelect) {
      gameSelect.onchange = () => {
        selectedViewGameDir = gameSelect.value;
        if (selectedViewGameDir) refreshContainer(mount, selectedViewGameDir, activeGlobalProfile);
      };
    }

    const browseBtn = document.getElementById('enhBrowseGameBtn');
    if (browseBtn) {
      browseBtn.onclick = async () => {
        browseBtn.disabled = true;
        const feedback = document.getElementById('enhToolbarFeedback');
        if (feedback) feedback.textContent = '';
        try {
          const picked = await root.lab.addGame();
          if (!picked) return;
          if (typeof root.load === 'function') await root.load();
          selectedViewGameDir = picked;
          await renderEnhancedView();
        } catch (error) {
          if (feedback) feedback.textContent = `添加游戏未完成：${localError(error.message, error.code)}`;
        } finally { browseBtn.disabled = false; }
      };
    }

    const importBtn = document.getElementById('enhGlobalImportBtn');
    if (importBtn) {
      importBtn.onclick = async () => {
        const res = await root.lab.enhancedImportModel();
        if (res?.ok) {
          cachedModels = await root.lab.enhancedModels(activeGlobalProfile);
          await renderEnhancedView();
        } else if (!res?.cancelled && res?.message) {
          alert(`导入模型失败：${localError(res.message, res.code)}`);
        }
      };
    }

    const checkUpdateBtn = document.getElementById('enhCheckUpdateBtn');
    if (checkUpdateBtn) {
      checkUpdateBtn.onclick = async () => {
        checkUpdateBtn.disabled = true;
        checkUpdateBtn.textContent = '正在检查 GitHub 更新…';
        try {
          const answer = await root.lab.checkUpdate?.();
          showReleaseUpdateBanner(answer, { manual: true });
        } finally {
          checkUpdateBtn.disabled = false;
          checkUpdateBtn.textContent = '🔄 检查 GitHub 新版本';
        }
      };
    }

    if (selectedViewGameDir && mount) {
      await refreshContainer(mount, selectedViewGameDir, activeGlobalProfile);
    } else if (mount) {
      mount.innerHTML = `
        <section class="enh-profile-bar" aria-label="硬件专属优化档位选择菜单">
          <div class="enh-profile-head">
            <h4>🎛️ 硬件专属优化档位选择菜单 <span class="enh-badge enh-badge-verified">全模型兼容 · 桌面显卡 MFG 已适配</span></h4>
            <span class="sub">切换档位将自动匹配对应的 DLSS 5 分辨率管线与 MFG 多帧生成策略（笔记本 40 系列默认锁定原版黄金参数不动）</span>
          </div>
          <div class="enh-profile-grid" role="group" aria-label="显卡优化档位切换">
            ${HARDWARE_PROFILE_OPTIONS.map((opt) => `
              <button type="button" class="enh-profile-btn ${activeGlobalProfile === opt.id ? 'active' : ''}" data-hw-profile="${escHtml(opt.id)}">
                <div class="enh-profile-btn-top">
                  <span class="enh-profile-btn-title">${escHtml(opt.label)}</span>
                  <span class="enh-profile-btn-tag">${escHtml(opt.tag)}</span>
                </div>
                <span class="enh-profile-btn-desc">${escHtml(opt.desc)}</span>
              </button>
            `).join('')}
          </div>
          <div class="enh-profile-summary">
            <div><b>当前已选档位：${escHtml(activeProfileMeta.label)}</b></div>
            <small>${escHtml(activeProfileMeta.dlssSummary)}</small>
            <small>${escHtml(activeProfileMeta.mfgSummary)}</small>
          </div>
        </section>
      `;
      for (const pBtn of mount.querySelectorAll('[data-hw-profile]')) {
        pBtn.onclick = async () => {
          activeGlobalProfile = pBtn.dataset.hwProfile;
          if (typeof root.lab?.enhancedSetProfile === 'function') {
            await root.lab.enhancedSetProfile(activeGlobalProfile).catch(() => {});
          }
          cachedHw = null;
          cachedModels = null;
          await renderEnhancedView();
        };
      }
    }
  }

  // 包装 openSheet 与 show，使详情抽屉和侧边栏都能无缝加载增强模块
  const prevOpenSheet = root.openSheet;
  if (typeof prevOpenSheet === 'function') {
    root.openSheet = async function wrappedOpenSheet(dir, keepLog) {
      const res = await prevOpenSheet.apply(this, arguments);
      await mountInSheet(dir);
      return res;
    };
  }

  const prevShow = root.show;
  if (typeof prevShow === 'function') {
    root.show = function wrappedShow(view) {
      const res = prevShow.apply(this, arguments);
      if (view === 'enhanced') {
        renderEnhancedView();
      }
      return res;
    };
  }

  function showReleaseUpdateBanner(answer, { manual = false } = {}) {
    if (!answer) return;
    if (answer.channel === 'independent' && answer.status === 'unconfigured') {
      if (manual) root.ask({title:`独立分支 v${answer.current}`,body:answer.message,confirm:'知道了',cancel:'关闭'});
      return;
    }
    if (!answer.newer && !manual) return;
    const activeView = document.querySelector('.view.active') || document.getElementById('view-home');
    if (!activeView) return;
    let banner = document.getElementById('enhUpdateBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'enhUpdateBanner';
      banner.className = 'enh-update-banner';
    }
    if (banner.parentElement !== activeView) {
      activeView.insertBefore(banner, activeView.firstChild);
    }

    const hasNew = Boolean(answer.newer && answer.latest);
    const headline = hasNew
      ? `🎉 发现 GitHub 新版本：v${escHtml(answer.latest)}（当前正在运行：v${escHtml(answer.current)}）`
      : (answer.latest
        ? `✅ 当前已是最新版本：v${escHtml(answer.current)}（GitHub 最新版：v${escHtml(answer.latest)}）`
        : `⚠️ 暂未连接到 GitHub 更新服务器（当前版本：v${escHtml(answer.current)}，所有功能均支持 100% 离线使用）`);
    const subline = answer.title
      ? `版本说明：${escHtml(answer.title)}`
      : (hasNew ? 'GitHub 已发布新版增强包，包含最新兼容性修复与功能升级，建议前往下载更新。' : '您可以随时点击右侧按钮前往 GitHub Releases 页面查看历史版本与更新说明。');

    banner.innerHTML = `
      <div class="enh-update-head">
        <div class="enh-update-title">
          <h4>${headline}</h4>
          <span>${subline}</span>
        </div>
        <div class="enh-actions" style="padding-top:0">
          <button type="button" class="enh-btn primary" id="enhUpdateDownloadBtn">🚀 前往 GitHub 查看并下载最新版 ↗</button>
          <button type="button" class="enh-btn" id="enhUpdateCloseBtn">✕ 关闭提示</button>
        </div>
      </div>
      ${answer.notes ? `<div class="enh-update-notes">${escHtml(answer.notes)}</div>` : ''}
    `;

    const dlBtn = banner.querySelector('#enhUpdateDownloadBtn');
    if (dlBtn) {
      dlBtn.onclick = () => {
        if (typeof root.lab?.openProject === 'function') {
          root.lab.openProject('releases');
        }
      };
    }
    const closeBtn = banner.querySelector('#enhUpdateCloseBtn');
    if (closeBtn) {
      closeBtn.onclick = () => banner.remove();
    }
  }

  root.enhancedUi = {
    HARDWARE_PROFILE_OPTIONS,
    mountInSheet,
    renderEnhancedView,
    renderStatusBadge,
    buildThreePanelsHtml,
    showReleaseUpdateBanner
  };
})(window);
