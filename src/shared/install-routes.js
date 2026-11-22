'use strict';

// Keep the sheet and installer on the same compatibility policy. A copied
// nvngx DLL alone does not prove that the game has native NGX calls.
(function (root) {
  function nativeFile(scan, files, matches) {
    const added = new Set((scan?.install?.added || []).map(rel => rel.replace(/\\/g, '/').toLowerCase()));
    const bitness = scan?.chosen?.bitness;
    return files.some(file => file && !file.featureMismatch && file.bitness !== null && (!bitness || file.bitness === undefined || file.bitness === bitness) &&
      !added.has(String(file.rel || '').replace(/\\/g, '/').toLowerCase()) && matches(file));
  }
  const filename = file => file.name || String(file.rel || file.path || '').split(/[\\/]/).pop();
  function nativeDlssPresent(scan) {
    // A managed DLL next to the executable can coexist with the game's
    // original SR runtime in its engine/plugin directory.
    return nativeFile(scan, [scan?.primaryDlss, ...(scan?.dlssFiles || [])], file =>
      /^nvngx_dlss\.dll$/i.test(filename(file)) && !/^1\./.test(String(file.version || '').trim()));
  }
  function nativeUpscalerPresent(scan) {
    return nativeFile(scan, scan?.upscalerFiles || [], file =>
      /^(?:libxess(?:_dx11)?|ffx_fsr2(?!_api_(?:dx12|vk)(?:_|\.))\w*|ffx_fsr3(?:upscaler\w*|_x64)|amd_fidelityfx_(?:dx12|vk|upscaler\w*))\.dll$/i.test(filename(file)));
  }
  const fgProviders = {
    dlss: /^(?:nvngx_dlssg|sl\.dlss_g)\.dll$/i,
    xess: /^libxess_fg\.dll$/i,
    fsr: /^(?:ffx_fsr3frameinterpolation(?!_?swapchain)\w*|amd_fidelityfx_framegeneration_(?:dx12|vk))\.dll$/i,
    // Older distributions bundle upscaling and frame generation together.
    // Their presence cannot identify which input the game actually uses.
    'fsr-combined': /^(?:ffx_fsr3_x64|amd_fidelityfx_(?:dx12|vk))\.dll$/i
  };
  function nativeFgPresent(scan, kind = null) {
    const providers = kind ? [fgProviders[kind === true ? 'dlss' : kind]] : Object.values(fgProviders);
    return nativeFile(scan, [...(scan?.dlssFiles || []), ...(scan?.streamlineFiles || []), ...(scan?.upscalerFiles || [])],
      file => providers.some(provider => provider?.test(filename(file))));
  }
  function nativeXeMfgDx12UpscalerPresent(scan) {
    return nativeFile(scan, scan?.upscalerFiles || [], file => file.xeMfgDx12Input === true);
  }
  function xeMfgTargetIssue(target) {
    if (target?.antiCheatWarning || target?.launcherProtected) return 'XeMFG 不支持带反作弊保护的游戏。';
    if (!target || target.bitness !== 64 || target.emulator || !supportsMfg(target))
      return 'XeMFG 需要 64 位 DirectX 12 或 Vulkan 游戏。';
    return null;
  }
  function nativeXeMfgVkUpscalerPresent(scan) {
    return nativeFile(scan, scan?.upscalerFiles || [], file => file.xeMfgVkInput === true);
  }
  function xemfgReason(target) {
    const issue = xeMfgTargetIssue(target);
    if (issue) return issue;
    if (target.xeMfgOptiHost) return '已识别 OptiScaler 10 宿主，请使用 XeMFG 插件路线。';
    if (target.hasOptiScalerConfig || target.optiFgHost) return '游戏已有 OptiScaler 配置，与独立 XeMFG 冲突。';
    if (target.api === 'vulkan') return target.hasXeMfgDlssSrVk || target.hasXeMfgDlssRrVk
      ? null : 'Vulkan 下独立 XeMFG 需要游戏提供 DLSS 超分或光线重建输入。';
    if (target.hasXeMfgDlssSrDx12 || target.hasXeMfgDlssRrDx12 || target.hasXeMfgDlssFgDx12 || target.hasXeMfgDx12Upscaler) return null;
    return '独立 XeMFG 需要游戏提供 DLSS-G、DLSS 超分或光线重建、XeSS 超分或 FSR 3.1 及更新版本的超分输入。';
  }
  function xemfgOptiReason(target) {
    const issue = xeMfgTargetIssue(target);
    if (issue) return issue;
    if (!target.xeMfgOptiHost || (target.api === 'vulkan' && target.xeMfgOptiHost !== 'dx12-vulkan'))
      return 'XeMFG 插件需要与当前图形 API 兼容的 OptiScaler 10 宿主及 Intel 配套运行库。';
    if (target.api === 'vulkan' ? target.hasXeMfgDlssSrVk || target.hasXeMfgVkUpscaler
      : target.hasXeMfgDlssSrDx12 || target.hasXeMfgDx12Upscaler) return null;
    return 'XeMFG 插件的 Upscaler 模式需要游戏提供可用的超分输入。';
  }
  function optiFgReason(target) {
    if (target?.antiCheatWarning || target?.launcherProtected) return 'OptiFG 不支持带反作弊保护的游戏。';
    if (target?.bitness !== 64 || target.emulator || target.api !== 'dxgi' || target.apiLabel !== 'DirectX 12')
      return 'OptiFG 需要 64 位 DirectX 12 游戏。';
    if (!target.optiFgHost) return 'OptiFG 需要已识别的 OptiScaler 宿主和配套 AMD FSR 帧生成运行库。';
    if (!target.hasOptiFgDx12Upscaler) return 'OptiFG 需要游戏提供宿主能读取的超分输入。';
    return null;
  }
  function encoreReason(target, api = target?.api) {
    if (target?.launcherProtected) return '鸣潮继续使用独立加载路线，不切换 Encore。';
    if (target?.antiCheatWarning) return 'Encore 不支持带反作弊保护的游戏。';
    if (!target || target.bitness !== 64 || !['dxgi', 'vulkan'].includes(api) ||
        (api === 'dxgi' && !['DirectX 11', 'DirectX 12'].includes(target.apiLabel)))
      return 'Encore 首批支持 64 位 DirectX 11、DirectX 12 和 Vulkan 游戏。';
    if (target.hasNativeFg !== false) return target.hasNativeFg
      ? '已检测到原生帧生成文件；Encore 首批仅适配没有原生补帧的游戏。'
      : '帧生成文件检查尚未完成。';
    return null;
  }
  function optiReason(target, api = target && target.api) {
    if (!target || target.bitness !== 64 || target.emulator) return 'optiUnsupported';
    if (!['dxgi', 'vulkan'].includes(api) || target.apiLabel === 'DirectX 10') return 'optiUnsupported';
    if (!target.hasNativeDlss && !target.hasNativeUpscaler) return 'optiNeedsDlss';
    return null;
  }
  function routesFor(target, api = target && target.api) {
    if (!target || target.launcherProtected || ![32, 64].includes(target.bitness)) return [];
    // DirectX 10 games present through DXGI (dxgi.dll), which ReShade hooks
    // identically to DirectX 11 to drive the Feeder pipeline.
    if (api === 'd3d10' || (api === 'dxgi' && target.apiLabel === 'DirectX 10')) return ['feeder'];
    // DirectDraw and DX8 both reach modern hardware only through dgVoodoo's
    // 32-bit wrapper, so the Feeder route is the only one either can take.
    if (api === 'd3d8' || api === 'ddraw') return target.bitness === 32 ? ['feeder'] : [];
    if (['d3d9', 'opengl', 'vulkan'].includes(api)) {
      const list = !optiReason(target, api) ? ['feeder', 'optiscaler'] : ['feeder'];
      if (!encoreReason(target, api)) list.push('encore');
      // The DLSS Tool presents on D3D9 itself - "D3D9 and D3D11 use a
      // same-adapter, device-only D3D12 endpoint" - so it does not need
      // dgVoodoo's translation the way the Feeder route does here. OpenGL and
      // Vulkan are not on its list, and the add-on is 64-bit only.
      // An emulator is a 64-bit DirectX program like any other, and PCSX2 was
      // shown running this route when it was set up by hand (#359). It is
      // offered, never recommended: the Feeder stays the suggested route.
      if (api === 'd3d9' && target.bitness === 64) list.push('renodx');
      return list;
    }
    if (api !== 'dxgi') return [];
    const native = target.bitness === 64 && !target.emulator && target.apiLabel === 'DirectX 12' && target.hasNativeDlss !== false;
    const routes = native ? ['native', 'feeder'] : ['feeder'];
    if (!optiReason(target, api)) routes.push('optiscaler');
    // #251. The DLSS Tool hooks Present, and its own description says what that
    // covers: "Present supports D3D9, D3D11, and D3D12 presentation. D3D9 and
    // D3D11 use a same-adapter, device-only D3D12 endpoint." So DX11 is offered
    // too - it is the larger half of the games with no DLSS of their own, and
    // the reason this route exists. D3D9 goes through dgVoodoo here and is a
    // separate question. 32-bit is out: the add-on is 64-bit only.
    if (target.bitness === 64) routes.push('renodx');
    if (!encoreReason(target, api)) routes.push('encore');
    return routes;
  }
  function recommendedRoute(scan, target = scan.chosen) {
    if (target?.launcherProtected) return 'wuwa-proxy';
    const routes = routesFor(target);
    const nativeDlss = target?.hasNativeDlss ?? nativeDlssPresent(scan);
    const relativePath = value => String(value || '').replace(/\\/g,'/').toLowerCase();
    const installedTarget = !scan.install?.exe || relativePath(scan.install.exe) === relativePath(target?.rel);
    const wanted = installedTarget && scan.install?.route === 'feeder'
      ? 'feeder' : nativeDlss ? 'native' : 'feeder';
    return routes.includes(wanted) ? wanted : (routes[0] || null);
  }
  const componentRoutes = ['anr', 'anr-addon', 'sm86', 'sm86-delta', 'xemfg', 'xemfg-optiscaler', 'optifg'];
  function anrGpuReason(gpuName) {
    const name = String(gpuName || '').replace(/\((?:TM|R)\)|[™®]/gi,' ').replace(/\s+/g,' ').trim();
    if (/\bGTX\s*(?:[2-9]\d\d|10\d\d)\b/i.test(name))
      return 'ANR FG 需要支持的 FP16 显卡。';
    // B20 lists Intel Arc A/B. Names such as "Intel Graphics" alone cannot
    // identify the device; HD, UHD and Iris explicitly identify older lines.
    if (/\bIntel\b/i.test(name) && /\b(?:(?:U?HD) Graphics|Iris(?: Xe| Plus| Pro)? Graphics|Iris Xe MAX)\b/i.test(name))
      return '这款 Intel 显卡不在 ANR FG 的支持列表内。';
    // Older Radeon names are distinct from the four-digit RX 5000+ families.
    // A generic Radeon Graphics label alone cannot identify an architecture.
    const legacyRadeon = /\bRadeon\s+(?:RX\s*(?:[456]\d\d(?:X|XT)?\b|Vega\b)|(?:Pro\s+)?Vega\s+\d+\b|R[579]\s+M?\d{3}\b|HD\s*\d{4}\b|VII\b)/i;
    if (legacyRadeon.test(name))
      return '这款 Radeon 不在 ANR FG 的支持列表内。';
    return null;
  }
  function anrNeuralReason(target, gpuSm) {
    if (!target?.hasNativeDlss) return 'ANR 联用神经渲染需要原生 DLSS 超分输入。';
    if (!gpuSm) return 'DLSS 神经渲染需要识别到兼容的 NVIDIA CUDA 显卡。ANR 补帧可单独使用。';
    return null;
  }
  function afmfDriverMode(target, hardware) {
    if (!target || target.launcherProtected || target.hasNativeFg !== false || target.hasNativeDlssFg ||
        hardware?.gpu?.nvidiaPresent !== false || !/^Windows_NT 10\.0\b/i.test(hardware.os || '')) return null;
    const supportedApi = target.api === 'opengl' || target.api === 'vulkan' ||
      (target.api === 'dxgi' && ['DirectX 11', 'DirectX 12'].includes(target.apiLabel));
    if (!supportedApi) return null;
    const card = /\bRadeon(?:\s*(?:\(TM\)|™))?\s+(?:RX\s*([679])\d{3}(?:\s*(?:XTX|XT|GRE|M|S))?|[78]\d{2}M)\b/i.exec(hardware.gpu.name || '');
    if (!card) return null;
    return card[1] === '6' ? 'afmf-fullscreen' : 'afmf';
  }
  function supportsMfg(target) {
    return target?.bitness === 64 && (target.api === 'vulkan' ||
      (target.api === 'dxgi' && target.apiLabel === 'DirectX 12'));
  }
  function supportsPerformanceMonitor(target) {
    return !!target && !target.launcherProtected && [32,64].includes(target.bitness) &&
      (['dxgi','d3d10','d3d9','vulkan','opengl'].includes(target.api) ||
        (target.bitness === 32 && ['ddraw','d3d8'].includes(target.api)));
  }
  function componentRoutesFor(target) {
    if (!target || target.launcherProtected || ![32, 64].includes(target.bitness)) return [];
    const dx12 = target.api === 'dxgi' && target.apiLabel === 'DirectX 12';
    const available = [];
    if (target.bitness === 64 && (dx12 || target.api === 'vulkan') && !target.emulator) {
      if (!xemfgReason(target)) available.push('xemfg');
      if (!xemfgOptiReason(target)) available.push('xemfg-optiscaler');
      if (!optiFgReason(target)) available.push('optifg');
      if (target.hasNativeDlssFg) {
        available.push('anr');
        if (target.hasAnrAddonHost) available.push('anr-addon');
      }
      if (dx12 && target.hasNativeDlssFg) available.push('sm86');
      if (/(?:^|[\\/])Binaries[\\/]Win64[\\/]DeltaForceClient-Win64-Shipping\.exe$/i.test(target.path || target.rel || ''))
        available.push('sm86-delta');
    }
    return available;
  }
  const graphicsRouteReasons = Object.freeze({xemfg:xemfgReason, 'xemfg-optiscaler':xemfgOptiReason, optifg:optiFgReason});
  const api = { routesFor, recommendedRoute, nativeDlssPresent, nativeUpscalerPresent, nativeXeMfgDx12UpscalerPresent, nativeXeMfgVkUpscalerPresent, nativeFgPresent, encoreReason, optiReason, xemfgReason, xemfgOptiReason, optiFgReason, graphicsRouteReasons, anrGpuReason, anrNeuralReason, afmfDriverMode, componentRoutes, componentRoutesFor, supportsPerformanceMonitor, supportsMfg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.installRoutes = api;
})(typeof window !== 'undefined' ? window : globalThis);
