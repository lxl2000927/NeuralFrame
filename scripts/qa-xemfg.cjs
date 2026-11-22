const { launchFixture } = require('../test/fixtures/launch-electron.cjs');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { HARDWARE_PROFILES, MODEL_DATABASE, RUNTIME_STACKS } = require('../src/core/neural-models');

const dir = 'D:\\QA\\Game';
const routeName = 'XeMFG 独立帧生成';
const pluginName = 'XeMFG · OptiScaler 插件';
const optiFgName = 'OptiFG · FSR 帧生成';
const optiHost = {hasOptiScalerConfig:true,optiFgHost:true};
const base = {
  hasNativeDlss:false, hasNativeFg:false, hasNativeDlssFg:false,
  hasXeMfgDx12Upscaler:false, hasXeMfgDlssSrDx12:false, hasXeMfgDlssSrVk:false, hasXeMfgDlssFgDx12:false,
  hasXeMfgDlssRrDx12:false, hasXeMfgDlssRrVk:false,
};
const cases = [
  ['DX12 XeSS/FSR input on Radeon', { hasXeMfgDx12Upscaler: true }, true],
  ['DX12 native DLSS-G alone', { hasNativeFg:true, hasNativeDlssFg:true, hasXeMfgDlssFgDx12:true }, true],
  ['DX12 native DLSS SR', { hasNativeDlss:true, hasXeMfgDlssSrDx12:true }, true],
  ['DX12 native DLSS RR', {hasXeMfgDlssRrDx12:true},true],
  ['DX12 generic DLSS modules without suitable exports', {hasNativeDlss:true,hasNativeDlssFg:true}, false],
  ['Vulkan native DLSS SR', { api:'vulkan', apiLabel:'Vulkan', hasNativeDlss:true, hasXeMfgDlssSrVk:true }, true],
  ['Vulkan native DLSS RR', {api:'vulkan',apiLabel:'Vulkan',hasXeMfgDlssRrVk:true},true],
  ['Vulkan OptiScaler 10 host with only DLSS RR', {api:'vulkan',apiLabel:'Vulkan',xeMfgOptiHost:'dx12-vulkan',hasXeMfgDlssRrVk:true},false],
  ['Vulkan generic DLSS without Vulkan exports', {api:'vulkan',apiLabel:'Vulkan',hasNativeDlss:true},false],
  ['Vulkan with DX12-only DLSS SR', {api:'vulkan',apiLabel:'Vulkan',hasNativeDlss:true,hasXeMfgDlssSrDx12:true},false],
  ['Vulkan FG without SR', { api:'vulkan', apiLabel:'Vulkan', hasNativeDlssFg:true, hasXeMfgDlssFgDx12:true, hasXeMfgDx12Upscaler:true }, false],
  ['DX12 generic upscaler without matching input', { hasNativeUpscaler: true }, false],
  ['DX11 native DLSS SR', {apiLabel:'DirectX 11', hasNativeDlss:true, hasXeMfgDlssSrDx12:true}, false],
  ['DX12 anti-cheat', {hasNativeDlss:true, hasXeMfgDlssSrDx12:true, antiCheatWarning:true}, false],
  ['DX12 OptiScaler 10 host and XeSS SR', { xeMfgOptiHost: 'dx12', hasXeMfgDx12Upscaler: true }, false, true],
  ['Vulkan supported OptiScaler 10 host and Vulkan upscaler', { api: 'vulkan', apiLabel: 'Vulkan', xeMfgOptiHost: 'dx12-vulkan', hasXeMfgVkUpscaler: true }, false, true],
  ['Vulkan with DX12-only OptiScaler 10 build', {api:'vulkan',apiLabel:'Vulkan',xeMfgOptiHost:'dx12',hasNativeDlss:true,hasXeMfgDlssSrVk:true}, false],
  ['OptiScaler host without native super-resolution input', {xeMfgOptiHost:'dx12',hasNativeDlssFg:true,hasXeMfgDlssFgDx12:true}, false],
  ['OptiFG with native FSR 2 input on Radeon', {...optiHost,hasOptiFgDx12Upscaler:true,optiFgInputs:['fsr2']},false,false,{optiFg:true,multiExe:true}],
  ['OptiFG with FSR 3.0 input', {...optiHost,hasOptiFgDx12Upscaler:true,optiFgInputs:['fsr3']},false,false,{optiFg:true,english:true}],
  ['OptiFG with a verified DLSS-only input', {...optiHost,hasNativeDlss:true,hasOptiFgDx12Upscaler:true,optiFgInputs:['dlss']},false,false,{optiFg:true}],
  ['OptiFG generic upscaler file only', {...optiHost,hasNativeUpscaler:true},false,false,{reason:'OptiFG 需要游戏提供宿主能读取的超分输入。'}],
  ['OptiFG with an unverified DLSS input', {...optiHost,hasNativeDlss:true},false,false,{reason:'OptiFG 需要游戏提供宿主能读取的超分输入。'}],
  ['OptiFG in a Vulkan game', {...optiHost,api:'vulkan',apiLabel:'Vulkan',hasOptiFgDx12Upscaler:true},false,false,{reason:'OptiFG 需要 64 位 DirectX 12 游戏。'}],
  ['OptiFG in a protected game', {...optiHost,antiCheatWarning:true,hasOptiFgDx12Upscaler:true},false,false,{reason:'OptiFG 不支持带反作弊保护的游戏。'}],
  ['Unidentified OptiScaler configuration blocks standalone XeMFG', {hasOptiScalerConfig:true,hasXeMfgDx12Upscaler:true},false,false,{reason:'游戏已有 OptiScaler 配置，与独立 XeMFG 冲突。'}],
  ['AFMF RX 6000 exclusive fullscreen', {}, false, false, {gpu:'AMD Radeon RX 6800 XT',afmf:true,exclusive:true}],
  ['AFMF Radeon 780M', {}, false, false, {gpu:'AMD Radeon 780M Graphics',afmf:true}],
  ['AFMF Radeon 890M', {}, false, false, {gpu:'AMD Radeon(TM) 890M',afmf:true}],
  ['AFMF Radeon 700M series', {}, false, false, {gpu:'AMD Radeon™ 700M Series Graphics',afmf:true}],
  ['AFMF Radeon 800M series', {}, false, false, {gpu:'AMD Radeon 800M Series Graphics',afmf:true}],
  ['AFMF absent for generic Radeon Graphics', {}, false, false, {gpu:'AMD Radeon(TM) Graphics',afmf:false}],
  ['AFMF absent for RX 580', {}, false, false, {gpu:'AMD Radeon RX 580',afmf:false}],
  ['AFMF absent on Linux', {}, false, false, {os:'Linux 6.17 (x64)',afmf:false}],
  ['AFMF absent for DirectX 9', {api:'d3d9',apiLabel:'DirectX 9'}, false, false, {afmf:false}],
];

async function verifyOptiFg(page, setup, backend, targetDir, input, fullCheck) {
  await setup.getByRole('button',{name:'查看 ' + optiFgName + ' 设置',exact:true}).click();
  const panel = page.getByRole('region',{name:optiFgName,exact:true});
  await expect(backend).toHaveAttribute('data-value','optifg');
  await expect(panel.getByRole('radio',{name:/OptiFG · FSR 帧生成/})).toBeFocused();
  await expect(panel.getByText('OptiScaler · AMD FidelityFX',{exact:true})).toBeVisible();
  await expect(panel.getByRole('radio',{name:/NVIDIA DLSS 帧生成/})).toContainText('需要 NVIDIA 显卡');
  await expect(panel.getByText(/Upscaler 输入和 FSR FG 输出/)).toBeVisible();
  await expect(panel.getByText(/已启用的 DLSS 神经渲染/)).toBeVisible();
  await expect(panel.getByText(/FG Active 和 HUD Fix/)).toBeVisible();
  const inputs = {fsr2:'FSR 2',fsr3:'FSR 3',dlss:'DLSS'};
  await expect(panel.getByText('可识别的游戏超分输入 · ' + inputs[input.optiFgInputs[0]],{exact:true})).toBeVisible();
  await expect(panel.getByText(/游戏需要允许当前显卡开启 DLSS/)).toHaveCount(input.optiFgInputs[0] === 'dlss' ? 1 : 0);
  await expect(panel.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:/神经渲染模型|同时启用 DLSS 神经渲染/})).toHaveCount(0);
  if (!fullCheck) return;
  assert.equal(await panel.evaluate(node=>node.scrollWidth <= node.clientWidth+1),true);
  if (process.env.NEURALFRAME_QA_OUT) await panel.screenshot({path:path.join(process.env.NEURALFRAME_QA_OUT,'optifg-960.png'),animations:'disabled'});
  const exe = setup.getByRole('combobox',{name:'可执行文件',exact:true});
  await exe.click();
  await page.getByRole('option',{name:/^Alt\\game.exe/}).click();
  await expect(panel).toHaveCount(0);
  await expect(backend).toHaveAttribute('data-value','reshade');
  await exe.click();
  await page.getByRole('option',{name:/^game.exe/}).click();
  await setup.getByRole('button',{name:'查看 ' + optiFgName + ' 设置',exact:true}).click();
  await expect(panel.getByRole('radio',{name:/OptiFG · FSR 帧生成/})).toBeFocused();
  const preview = panel.getByRole('button',{name:'预览帧生成设置'});
  await preview.click();
  await page.getByRole('heading',{name:'应用前变更预览'}).waitFor();
  await expect(page.getByRole('cell',{name:'OptiScaler.ini',exact:true})).toBeVisible();
  const audit = await page.evaluate(()=>window.qa.audit());
  assert.deepEqual(audit.requests.at(-1).patch,{route:'optifg',exePath:targetDir+'\\game.exe',apiOverride:'auto'});
  assert.equal(audit.prepared,0);
  await page.getByRole('button',{name:'确认应用',exact:true}).click();
  await expect(panel.getByText('已识别宿主').locator('+ dd')).toHaveText('OptiScaler · 0.2.0-patch1');
  const enabled = panel.getByText('已保存的 OptiFG 开关').locator('+ dd');
  await expect(enabled).toHaveText('开启');
  const more = page.locator('.apply-bar').getByRole('button',{name:'更多操作',exact:true});
  async function refresh() {
    await more.click();
    await page.getByRole('button',{name:'重新检测文件',exact:true}).click();
  }
  await page.evaluate(dir=>window.qa.setGraphicsOnDisk(dir,{enabled:false}),targetDir);
  await refresh();
  await expect(enabled).toHaveText('关闭');
  await page.getByRole('tab',{name:'运行诊断',exact:true}).click();
  const disk = page.getByRole('region',{name:'OptiFG 磁盘配置'});
  await expect(disk).toContainText('实际补帧效果请在游戏内查看');
  await expect(disk.getByText('已保存的 OptiFG 开关').locator('+ dd')).toHaveText('关闭');
  await expect(disk.getByText(/XeMFG|已保存的固定倍率/)).toHaveCount(0);
  await page.getByRole('tab',{name:'画质与补帧',exact:true}).click();
  await page.evaluate(({dir,input})=>window.qa.setGraphicsEvidence(dir,{...input,hasOptiFgDx12Upscaler:false,optiFgInputs:[]}),{dir:targetDir,input});
  await refresh();
  await expect(preview).toBeDisabled();
  await expect(panel.getByRole('alert')).toHaveText('OptiFG 需要游戏提供宿主能读取的超分输入。');
  await more.click();
  await expect(page.getByRole('button',{name:'一键卸载并恢复'})).toBeEnabled();
}

async function runCase(label, input, eligible, pluginEligible, machine = {}) {
  const { app, close } = await launchFixture();
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].show());
    if(label === cases[0][0] || machine.multiExe) await page.setViewportSize({width:960,height:800});
    const targetDir = machine.multiExe ? 'D:\\QA\\New' : dir;
    await page.evaluate(async ({dir, input, catalog, optiFg}) => {
      window.qa.setGraphicsEvidence(dir, input);
      window.qa.setGraphicsCatalog(catalog);
      if (!optiFg) await window.lab.componentPrepare();
    }, {dir:targetDir, input: {...base, ...input}, optiFg:machine.optiFg, catalog: {
      profiles: HARDWARE_PROFILES, models: MODEL_DATABASE, stacks: RUNTIME_STACKS, neuralMode: 'latest_compatible',
      os: machine.os || 'Windows_NT 10.0.26100 (x64)',
      gpu: {name: machine.gpu || 'AMD Radeon RX 7800 XT', nvidiaPresent: false, architecture: {sm: null}},
    }});
    await page.getByRole('navigation').getByRole('button', {name: '游戏', exact: true}).click();
    if (machine.multiExe) await page.locator('.game-list').getByRole('button',{name:/Unconfigured game/}).click();
    const setup = page.getByRole('region', {name: '安装与运行环境'});
    const backend = setup.getByRole('combobox', {name: '渲染后端', exact: true});
    await backend.click();
    await expect(page.getByRole('option', {name: routeName, exact: true})).toHaveCount(eligible ? 1 : 0);
    await expect(page.getByRole('option', {name: pluginName, exact: true})).toHaveCount(pluginEligible ? 1 : 0);
    await expect(page.getByRole('option', {name: optiFgName, exact: true})).toHaveCount(machine.optiFg ? 1 : 0);
    await page.keyboard.press('Escape');
    const engine = page.getByRole('radio', {name: /XeMFG 独立帧生成/});
    const afmf = setup.getByRole('button', {name:'查看 AMD 官方 AFMF 说明'});
    if (eligible || pluginEligible || machine.optiFg || machine.afmf === false) await expect(afmf).toHaveCount(0);
    if (machine.optiFg) {
      await verifyOptiFg(page,setup,backend,targetDir,{...base,...input},machine.multiExe);
      if (machine.english) {
        const nav = page.getByRole('navigation');
        await nav.getByRole('button',{name:'设置',exact:true}).click();
        await page.getByRole('combobox',{name:'语言',exact:true}).click();
        await page.getByRole('option',{name:'English',exact:true}).click();
        await nav.getByRole('button',{name:'Games',exact:true}).click();
        const englishPanel=page.getByRole('region',{name:'OptiFG · FSR Frame Generation',exact:true});
        if (!await englishPanel.count()) await page.getByRole('button',{name:'View OptiFG · FSR Frame Generation settings',exact:true}).click();
        await expect(englishPanel.getByText('Detected game upscaler inputs · FSR 3',{exact:true})).toBeVisible();
        await expect(englishPanel.getByText(/changes an Auto or DLSS upscaling backend to FidelityFX/)).toBeVisible();
      }
      return;
    }
    if (machine.afmf) {
      await expect(setup.getByText(/RX 6000 系列需要独占全屏/)).toHaveCount(machine.exclusive ? 1 : 0);
      await afmf.click();
      assert.equal(await page.evaluate(()=>window.qa.audit().projectLink),'amd-afmf');
      assert.equal(await page.evaluate(()=>window.qa.audit().requests.length),0);
    }
    if (pluginEligible) {
      await expect(engine).toHaveCount(0);
      await setup.getByRole('button', {name: '查看 ' + pluginName + ' 设置', exact: true}).click();
      const plugin = page.getByRole('region', {name: pluginName, exact:true});
      await expect(backend).toHaveAttribute('data-value', 'xemfg-optiscaler');
      await expect(plugin.getByText(/Upscaler 输入和 XeFG 输出/)).toBeVisible();
      await expect(plugin.getByRole('radio',{name:/XeMFG · OptiScaler 插件/})).toBeFocused();
      await expect(plugin.getByRole('combobox')).toHaveCount(0);
      await expect(page.getByRole('combobox', {name:/神经渲染模型|同时启用 DLSS 神经渲染/})).toHaveCount(0);
      await plugin.getByRole('button', {name:'预览帧生成设置'}).click();
      await page.getByRole('heading', {name:'应用前变更预览'}).waitFor();
      const patch = await page.evaluate(() => window.qa.audit().requests.at(-1).patch);
      assert.deepEqual(patch,{route:'xemfg-optiscaler',exePath:dir + '\\game.exe',apiOverride:'auto'});
      await page.getByRole('button', {name:'确认应用',exact:true}).click();
      await expect(plugin.getByText('倍率设置').locator('+ dd')).toHaveText('OptiScaler 游戏内菜单');
      await page.getByRole('tab',{name:'运行诊断',exact:true}).click();
      const disk = page.getByRole('region',{name:'XeMFG 磁盘配置'});
      await expect(disk).toContainText('OptiScaler 游戏内菜单');
      await expect(disk.getByText('已保存的固定倍率')).toHaveCount(0);
      return;
    }
    await expect(page.getByRole('radio', {name: /XeMFG · OptiScaler 插件/})).toHaveCount(0);
    if (!eligible) {
      await expect(engine).toHaveCount(0);
      await expect(setup.locator('.footnote').filter({hasText: machine.reason || 'XeMFG'})).toBeVisible();
      return;
    }
    await expect(engine).toBeVisible();
    await setup.getByRole('button', {name: '查看 ' + routeName + ' 设置', exact: true}).click();
    await expect(backend).toHaveAttribute('data-value', 'xemfg');
    const panel = page.getByRole('region', {name: routeName, exact: true});
    await expect(panel.getByRole('radio',{name:/XeMFG 独立帧生成/})).toBeFocused();
    assert.equal(await panel.evaluate(node=>node.scrollWidth <= node.clientWidth+1), true);
    if(label === cases[0][0] && process.env.NEURALFRAME_QA_OUT)
      await panel.screenshot({path:path.join(process.env.NEURALFRAME_QA_OUT,'xemfg-960.png')});
    const multiplier = panel.getByRole('combobox', {name: 'XeMFG 固定倍率', exact: true});
    await expect(multiplier).toHaveAttribute('data-value', '2');
    await expect(panel.getByText(input.api === 'vulkan' ? /Vulkan 下需在游戏中启用原生 DLSS 超分/ : /AMD 显卡优先选择 XeSS/)).toBeVisible();
    await expect(page.getByRole('combobox', {name: /同时启用 DLSS 神经渲染|神经渲染模型|补帧引擎/})).toHaveCount(0);
    if (label !== cases[0][0]) return;

    async function preview() {
      await panel.getByRole('button', {name: '预览帧生成设置', exact: true}).click();
      await page.getByRole('heading', {name: '应用前变更预览'}).waitFor();
      return page.evaluate(() => window.qa.audit().requests.at(-1).patch);
    }
    const cancel = () => page.getByRole('button', {name: '取消', exact: true}).click();
    const initial = await preview();
    assert.deepEqual(initial, {route: 'xemfg', exePath: dir + '\\game.exe', apiOverride: 'auto', graphics: {multiplier: 2}});
    await cancel();
    await multiplier.click();
    await expect(page.getByRole('option')).toHaveCount(5);
    await page.getByRole('option', {name: '5×', exact: true}).click();
    assert.deepEqual((await preview()).graphics, {multiplier: 5});
    await page.getByRole('button', {name: '确认应用', exact: true}).click();
    await expect(panel.getByText('已保存的固定倍率').locator('+ dd')).toHaveText('5×');
    const more = page.locator('.apply-bar').getByRole('button', {name: '更多操作', exact: true});
    async function refresh() {
      await more.click();
      await page.getByRole('button', {name: '重新检测文件', exact: true}).click();
    }
    await page.evaluate(dir => window.qa.setGraphicsOnDisk(dir, {dynamic: true, enabled: false, multiplier: 3}), dir);
    await refresh();
    await expect(panel.getByText('已保存的动态补帧').locator('+ dd')).toHaveText('开启');
    await expect(panel.getByText('已保存的 XeMFG 开关').locator('+ dd')).toHaveText('关闭');
    assert.equal((await preview()).graphics, undefined, 'Reapplying must preserve settings changed in the game');
    await cancel();
    await page.getByRole('button',{name:'配置预设',exact:true}).click();
    const gamePreset=page.getByRole('dialog',{name:'本地配置预设'});
    await expect(gamePreset.getByText(/当前补帧模式由游戏菜单管理/)).toBeVisible();
    await gamePreset.getByRole('textbox',{name:'预设名称'}).fill('Game-controlled mode');
    await gamePreset.getByRole('button',{name:'保存当前配置'}).click();
    await expect(page.getByText('此路线当前没有可保存的桌面参数',{exact:true})).toBeVisible();
    await expect(gamePreset.locator('.preset-row').filter({hasText:'Game-controlled mode'})).toHaveCount(0);
    await gamePreset.getByRole('button',{name:'关闭',exact:true}).click();
    await panel.getByRole('button', {name: '切换为固定 3×'}).click();
    assert.deepEqual((await preview()).graphics, {multiplier: 3});
    await cancel();
    await page.getByRole('tab', {name: '运行诊断', exact: true}).click();
    const readout = page.getByRole('region', {name: 'XeMFG 磁盘配置'});
    await expect(readout).toContainText('没有 XeMFG 专用的实时帧率或倍率读数');
    await expect(readout.getByText('已保存的固定倍率').locator('+ dd')).toHaveText('3×');
    await page.getByRole('tab', {name: '画质与补帧', exact: true}).click();
    await page.evaluate(dir => window.qa.setGraphicsEvidence(dir, {hasNativeDlss: false, hasNativeDlssFg: false, hasXeMfgDx12Upscaler: false}), dir);
    await refresh();
    await expect(panel.getByRole('button', {name: '预览帧生成设置'})).toBeDisabled();
    await more.click();
    await expect(page.getByRole('button', {name: '一键卸载并恢复'})).toBeEnabled();
  } finally {
    await close();
  }
}

(async () => {
  const failures = [];
  for (const [label, input, eligible, pluginEligible, machine] of cases) {
    try { await runCase(label, input, eligible, pluginEligible, machine); console.log('PASS:', label); }
    catch (error) { failures.push(label); console.error('FAIL:', label, error.message); }
  }
  assert.deepEqual(failures, []);
})().catch(error => { console.error(error); process.exitCode = 1; });
