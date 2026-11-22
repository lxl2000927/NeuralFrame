'use strict';
const installRoutes = require('../shared/install-routes');

const SCHEMA = 'neuralframe-compatibility-report';
const emptyReasons = {
  'xbox-protected': '此 Xbox 游戏未暴露可读取的主程序。',
  installer: '此目录是安装包，请选择已安装游戏的目录。',
  'no-exe': '没有可执行文件',
  'renderer-in-dll': '渲染器位于 DLL',
  'no-graphics-exe': '未识别图形程序',
};

function relativeExe(value) {
  if (typeof value !== 'string' || /^(?:[a-z]:|[\\/])/i.test(value) ||
      value.split(/[\\/]/).includes('..') || /[\0-\x1f]/.test(value)) return '';
  return value.slice(0, 500);
}

// The optional engines have their own hardware policy. Use the same preflight
// that applies them and avoid evaluating component files or preparing assets.
function routeAvailable(route, dir, scan, target, gpu) {
  if (gpu?.nvidiaPresent === false && ['native', 'feeder', 'renodx', 'optiscaler'].includes(route)) return false;
  if ((route === 'anr' || route === 'anr-addon') && installRoutes.anrGpuReason(gpu?.name)) return false;
  if (route === 'encore' || route.startsWith('sm86')) {
    if (gpu?.nvidiaPresent === false) return false;
    try {
      if (route === 'encore') require('./encore').assertTarget(dir, scan, target, gpu?.name);
      else require('./optional-graphics').validateTarget({
        gameDir: dir, exePath: target.path, api: target.api, apiLabel: target.apiLabel,
        bitness: target.bitness, route, gpuName: gpu?.name, target,
      });
    } catch (error) {
      if (error.code === 'errEncore' || error.code === 'errGraphicsRoute') return false;
      throw error;
    }
  }
  return true;
}

function assess({name, dir, scan, target, hardware, antiCheat, installIssue, linux, proton}) {
  const gpu = hardware?.gpu;
  const candidateCount = scan.exeCandidates?.length || 0;
  const common = {name, candidateCount, antiCheat};
  if (!target) return {...common, status: 'unsupported', message: emptyReasons[scan.emptyReason] || '未识别图形程序'};
  Object.assign(common, {
    exe: target.rel, api: target.apiLabel || '', bitness: target.bitness,
    nativeDlss: target.hasNativeDlss, nativeFg: target.hasNativeFg, nativeDlssFg: target.hasNativeDlssFg,
  });
  if (installIssue) return {...common, status: 'unsupported', message: '此目录由模组管理器管理。'};
  if (linux && !proton) return {...common, status: 'verify', message: '请在 Steam 中用 Proton 启动一次并确认兼容环境。'};
  let routes;
  if (target.launcherProtected) {
    const client = /(?:^|[\\/])Client[\\/]Binaries[\\/]Win64[\\/]Client-Win64-Shipping\.exe$/i.test(target.path);
    const supported = client && target.bitness === 64 && ['dxgi', 'vulkan'].includes(target.api) &&
      !['DirectX 10', 'DirectX 11'].includes(target.apiLabel) && gpu?.nvidiaPresent !== false;
    routes = supported ? ['wuwa-proxy'] : [];
  } else {
    routes = [...installRoutes.routesFor(target), ...installRoutes.componentRoutesFor(target)]
      .filter(route => routeAvailable(route, dir, scan, target, gpu));
  }
  if (linux && target.api === 'vulkan') routes = routes.filter(route => ['xemfg', 'xemfg-optiscaler'].includes(route));
  const uncertainGpu = gpu?.nvidiaPresent == null;
  const ambiguousApi = !target.api || target.apiLabel === 'DirectX 11/12';
  const needsReview = antiCheat || ambiguousApi || uncertainGpu || (!routes.length && candidateCount > 1);
  const status = needsReview ? 'verify' : routes.length ? 'supported' : 'unsupported';
  let message = '';
  if (antiCheat) message = '检测到反作弊保护，请在游戏详情中确认。';
  else if (ambiguousApi) message = '请在游戏详情中确认实际使用的图形 API。';
  else if (uncertainGpu) message = '显卡识别尚未完成，请在游戏详情中确认。';
  else if (!routes.length) message = '当前程序、图形 API 与显卡没有匹配的安装路线。';
  const preferred = installRoutes.recommendedRoute(scan, target);
  const recommendedRoute = routes.includes(preferred) ? preferred :
    ['xemfg-optiscaler', 'optifg', 'xemfg', 'anr'].find(route => routes.includes(route)) || routes[0] || '';
  const driverHint = !routes.length && installRoutes.routesFor(target).includes('feeder')
    ? installRoutes.afmfDriverMode(target, hardware) : null;
  return {...common, status, routes, recommendedRoute, driverHint, message};
}

function row(value) {
  if (!value || typeof value.name !== 'string' || !value.name.trim()) throw Error('扫描结果缺少游戏名称');
  const routes = Array.isArray(value.routes)
    ? value.routes.filter(route => typeof route === 'string' && /^[a-z0-9-]+$/.test(route)).slice(0, 32) : [];
  return {
    name: value.name.trim().slice(0, 160), exe: relativeExe(value.exe),
    candidateCount: Number.isSafeInteger(value.candidateCount) && value.candidateCount > 0 ? value.candidateCount : 0,
    status: ['supported', 'verify', 'unsupported', 'error'].includes(value.status) ? value.status : 'verify',
    api: typeof value.api === 'string' ? value.api.slice(0, 80) : '', bitness: [32, 64].includes(value.bitness) ? value.bitness : null,
    nativeDlss: value.nativeDlss === true, nativeFg: value.nativeFg === true, nativeDlssFg: value.nativeDlssFg === true,
    antiCheat: value.antiCheat === true, routes,
    recommendedRoute: routes.includes(value.recommendedRoute) ? value.recommendedRoute : '',
    driverHint: ['afmf', 'afmf-fullscreen'].includes(value.driverHint) ? value.driverHint : null,
    message: typeof value.message === 'string' ? value.message.slice(0, 500) : '',
  };
}

function createReport(rows, generatedAt = new Date().toISOString(), options = {}) {
  if (!Array.isArray(rows) || rows.length > 500) throw Error('批量扫描最多支持 500 个游戏');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw Error('扫描报告选项格式不受支持');
  const complete = options.complete === undefined ? true : options.complete;
  if (typeof complete !== 'boolean') throw Error('扫描报告完整性标记无效');
  const total = options.total === undefined ? rows.length : options.total;
  if (!Number.isSafeInteger(total) || total < 0) throw Error('扫描报告总数无效');
  const {scanStatus} = options;
  if (scanStatus !== undefined && (complete || !['stopped', 'error'].includes(scanStatus)))
    throw Error('扫描报告完整性标记无效');
  return {schema: SCHEMA, version: 1, generatedAt, readOnly: true, complete, total,
    ...(scanStatus ? {scanStatus} : {}), rows: rows.map(row)};
}

// Older v1 reports predate the completeness fields: default them and keep the
// exact values when a report already carries them.
function parseReport(value) {
  if (!value || value.schema !== SCHEMA || value.version !== 1 || value.readOnly !== true ||
      typeof value.generatedAt !== 'string') throw Error('扫描报告格式不受支持');
  const options = {};
  if (value.complete !== undefined) options.complete = value.complete;
  if (value.total !== undefined) options.total = value.total;
  if (value.scanStatus !== undefined) options.scanStatus = value.scanStatus;
  return createReport(value.rows, value.generatedAt, options);
}

function csv(report) {
  function cell(value) {
    let content = String(value ?? '');
    if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/.test(content) || /^[\t\r\n]/.test(content))) content = "'" + content;
    return '"' + content.replaceAll('"', '""') + '"';
  }
  const columns = ['name', 'exe', 'candidateCount', 'status', 'api', 'bitness', 'nativeDlss', 'nativeFg', 'nativeDlssFg', 'antiCheat', 'recommendedRoute', 'routes', 'driverHint', 'message'];
  const partial = report.complete === false;
  const header = partial ? [...columns, 'scanStatus', 'completed', 'plannedTotal'] : columns;
  const scan = partial ? [report.scanStatus ?? 'stopped', report.rows.length, report.total] : [];
  const records = report.rows.map(item => [
    ...columns.map(key => Array.isArray(item[key]) ? item[key].join('|') : item[key]),
    ...scan,
  ]);
  if (partial && records.length === 0) {
    // Keep the scan metadata available even if it stopped before any game finished.
    records.push([...columns.map(() => ''), ...scan]);
  }
  return '\uFEFF' + [header, ...records].map(values => values.map(cell).join(',')).join('\r\n') + '\r\n';
}
module.exports = {SCHEMA, assess, createReport, parseReport, csv};
