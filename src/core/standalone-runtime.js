'use strict';
const { neuralSettings } = require('./wuwa-profile');
const defaults = neuralSettings('rtx40_laptop');
const fields = Object.keys(defaults);

// The caller has already checked file age, PID and process birth. Settings in
// this protocol are REQUESTED; only the live extent/stage/scale are effective.
function parseStandalone(s, log, now, previous) {
  if (!Number.isSafeInteger(s.dlss5Evaluations) || !Number.isInteger(s.dlss5State)) return null;
  const count = s.dlss5Evaluations;
  // Upstream publishes by atomically replacing the status file. Its inode and
  // birth time change on every sample. History is keyed by process birth +
  // path in RuntimeStatus, not by file identity.
  const ready = s.dlss5 !== false && s.dlss5State === 2 && s.dlss5Live > 0 && s.dlss5Pending !== true;
  const advanced = previous && log.mtime > previous.at && count > previous.count;
  // Off/error/pending samples interrupt the evidence of continuous execution.
  // Re-enabling with a frozen cumulative count must wait for fresh progress.
  const lastProgress = !ready ? null : advanced ? log.mtime : previous && log.mtime >= previous.at && count >= previous.count ? previous.progress : null;
  const settings = Object.fromEntries(fields.filter(k => typeof s[k] === typeof defaults[k])
    .map(k => [k, s[k]]));
  const version = prefix => {
    const parts = ['Major', 'Minor', 'Build', 'Private'].map(k => s[prefix + 'Version' + k]);
    return parts.every(v => Number.isSafeInteger(v) && v >= 0) && parts.some(Boolean) ? parts.join('.') : null;
  };
  const standalone = {
    at: log.mtime, settings, enabled: s.dlss5 === true, pending: s.dlss5Pending === true,
    evaluations: count, failures: s.dlss5Failures,
    actual: s.dlss5Live > 0 && s.dlss5Pending !== true ? {
      stage: s.dlss5Stage, scale: s.dlss5EffectiveScale, passes: s.dlss5Passes,
      width: s.dlss5Width, height: s.dlss5Height,
      extentWidth: s.dlss5ExtentWidth, extentHeight: s.dlss5ExtentHeight,
      gpuMs: s.dlss5GpuMs,
    } : null,
    stack: { fg: version('activeProvider'), streamline: version('activeWrapper'), ota: s.activeWrapperUsesNvidiaOta === true },
  };
  const errors = { 3: '神经模型未找到', 4: '模型或显卡不受支持', 5: '需要更新显卡驱动',
    6: '神经渲染初始化失败', 7: '神经渲染执行失败', 8: '另一组件正在接管神经渲染',
    9: '缺少深度或运动矢量等输入', 10: '当前执行时机不受支持' };
  let state = 'waiting', label = '等待游戏执行神经渲染';
  let detail = '已读到本次进程的状态；开关和累计次数不能证明当前持续执行。';
  if (s.dlss5 === false || s.dlss5State === 0) {
    state = 'off'; label = '神经渲染已关闭';
  } else if (errors[s.dlss5State]) {
    state = 'error'; label = errors[s.dlss5State];
    detail = `组件状态 ${s.dlss5State}；返回码 ${s.dlss5Result ?? '未知'}。`;
  } else if (standalone.pending) {
    state = 'pending'; label = '参数等待应用'; detail = '组件正在等待 GPU 工作完成，回读参数尚不能作为实际生效参数。';
  } else if (s.dlss5State === 2 && s.dlss5Live > 0 && count > 0) {
    state = lastProgress && now - lastProgress <= 30000 ? 'active' : 'observed';
    label = state === 'active' ? '正在执行神经渲染' : '本次运行执行过，等待连续采样';
    detail = state === 'active' ? `已观察到执行计数增长；本次累计 ${count} 次。` :
      `本次累计 ${count} 次；需连续采样确认是否仍在执行。`;
  }
  return {
    nr: { state, label, detail, at: log.mtime, source: log.file,
      evidence: `PID=${s.pid}; dlss5State=${s.dlss5State}; evaluations=${count}; live=${s.dlss5Live}; pending=${s.dlss5Pending}` },
    standalone,
    history: { count, at: log.mtime, progress: lastProgress, fileId: log.fileId },
  };
}
module.exports = { parseStandalone };
