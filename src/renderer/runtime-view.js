'use strict';
(function(root) {
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key=p=>String(p).replace(/\\/g,'/').replace(/\/$/,'').toLowerCase();
  const age=at=>at?new Date(at).toLocaleTimeString():'—';
  function mount(box,dir) {
    if(!root.lab.componentRuntime)return {refresh:async()=>{},updateRows:()=>{}};
    const section=document.createElement('section');section.className='component-runtime';
    section.innerHTML=`<div class="component-heading"><div><h3>运行时检测</h3><p class="hint">核对当前游戏进程、已加载模块及本次启动的遥测。</p></div><button type="button" class="ghost" data-runtime-refresh>检测运行状态</button></div><div class="runtime-toolbar"><label><input type="checkbox" data-runtime-auto> 每 5 秒刷新运行状态</label><span class="hint" data-runtime-time>尚未检测</span></div><div class="runtime-result"><p class="hint">进入实际游戏场景后检测。组件安装、功能开关和成功补帧分别核验。</p></div>`;
    box.querySelector('.component-heading').after(section);
    const button=section.querySelector('[data-runtime-refresh]'),auto=section.querySelector('[data-runtime-auto]'),result=section.querySelector('.runtime-result'),time=section.querySelector('[data-runtime-time]');
    let snapshot=null,busy=false,timer=null,expiry=null,appliedAt=null;
    const visible=()=>box.isConnected && !document.hidden && box.getClientRects().length>0;
    function updateRows(lastApplied) {
      if(lastApplied)appliedAt=lastApplied.restartRequired?Date.parse(lastApplied.at):null;
      for(const cell of box.querySelectorAll('[data-runtime-file]')) {
        const file=cell.dataset.runtimeFile;
        let label='尚未检测',detail='点击运行时检测。',code='waiting';
        if(!/\.(dll|addon32|addon64|asi|exe)$/i.test(file)){label='配置 / 资源';detail='不作为进程模块加载。';code='resource';}
        else if(snapshot){
          const same=(snapshot.modules||[]).find(m=>key(m.path)===key(file));
          const other=(snapshot.modules||[]).find(m=>key(m.name)===key(file).split('/').pop());
          if(same){label='已加载';detail=same.path;code='loaded';}
          else if(other){label='其他路径';detail=`实际加载：${other.path}`;code='other_path';}
          else if(snapshot.processState==='stopped'){label='游戏未运行';detail='没有匹配的游戏进程。';code='stopped';}
          else if(snapshot.processState!=='running'||snapshot.process?.moduleError){label='读取受限';detail='无法匹配进程或枚举模块，请看上方原因。';code='unreadable';}
          else{label='模块表未发现';detail='当前模块表未发现此路径；手动映射组件可能不会出现在模块表。';code='not_loaded';}
        }
        cell.innerHTML=`<span class="runtime-chip ${code}" title="${esc(detail)}">${esc(label)}</span>`;
      }
      const notice=box.querySelector('[data-component-restart]');
      if(notice&&snapshot){
        if(snapshot.processState==='stopped')notice.textContent='游戏当前未运行，下次启动将读取磁盘上的组件。';
        else if(appliedAt&&snapshot.process?.startedAt)notice.textContent=Date.parse(snapshot.process.startedAt)<appliedAt?'游戏启动早于上次应用：请重启游戏加载新文件。':'游戏已在上次应用后启动；各组件是否已加载，请查看模块检测。';
        else notice.textContent=snapshot.processState==='running'?'游戏正在运行；缺少上次应用时间，无法核对是否已经重启。':'本次无法核对游戏启动时间，请查看上方检测原因。';
      }
    }
    function render(data) {
      clearTimeout(expiry);
      const expiryTimes=[];
      for(const item of [data.nr,data.mfg])if(item.at && ['active','observed','initialized','off','idle','error','waiting','restart'].includes(item.state)) {
        const remaining=item.at+30000-Date.now();
        if(remaining<=0){item.state='stale';item.label='本次记录已过期';item.detail='超过 30 秒没有新遥测，请刷新检测当前状态。';}
        else expiryTimes.push(remaining);
      }
      if(expiryTimes.length)expiry=setTimeout(()=>{if(box.isConnected&&snapshot===data)render(data);},Math.min(...expiryTimes)+50);
      const card=(title,item)=>`<article class="runtime-card"><span class="component-eyebrow">${title}</span><strong class="runtime-chip ${esc(item.state)}">${esc(item.label)}</strong><p>${esc(item.detail)}</p>${item.requestedMultiplier?`<div class="runtime-facts">请求 ${esc(item.requestedMultiplier)}× · 已应用请求 ${esc(item.appliedMultiplier||'—')}×${item.pending?' · 等待切换':''}</div>`:''}${Number.isFinite(item.sourceFps)&&Number.isFinite(item.reportedOutputFps)?`<div class="runtime-facts">插件报告：基础 ${item.sourceFps.toFixed(1)} / 输出 ${item.reportedOutputFps.toFixed(1)} FPS</div>`:''}${item.source?`<details><summary>查看判断证据 · ${age(item.at)}</summary><code>${esc(item.source)}</code><code>${esc(item.evidence||'')}</code></details>`:''}</article>`;
      result.innerHTML=`${data.process?`<p class="runtime-process">游戏进程 <b>PID ${esc(data.process.pid)}</b> · 启动于 ${esc(new Date(data.process.startedAt).toLocaleString())}<small>${esc(data.process.exe)}</small></p>`:''}<div class="runtime-cards">${card('DLSS5 神经渲染',data.nr)}${card('DLSS-G / 多帧生成',data.mfg)}</div><p class="hint">仅 DLL 加载、开关开启或倍率请求成功，均不等于渲染生效。呈现计数来自提供程序；未测量屏幕实际显示 FPS。</p>${data.warnings?.length?`<details class="runtime-warnings"><summary>已排除的旧记录 / 诊断说明 (${data.warnings.length})</summary><ul>${data.warnings.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></details>`:''}${data.modules?.length?`<details class="runtime-modules"><summary>实际加载的相关模块 (${data.modules.length})</summary>${data.modules.map(m=>`<code>${esc(m.path)}</code>`).join('')}</details>`:''}`;
      time.textContent=`检测于 ${age(data.checkedAt)} · 30 秒无新遥测即过期`;
      // The old MFG row must not keep showing a historical log as live proof.
      const multiplier=box.parentElement?.querySelector('[data-runtime-mfg]');
      if(multiplier)multiplier.textContent=`${data.mfg.label} — ${data.mfg.detail}`;
      updateRows();
    }
    async function refresh() {
      if(busy||!box.isConnected)return;busy=true;button.disabled=true;button.textContent='检测中…';
      try {
        const data=await root.lab.componentRuntime(dir);
        if(!box.isConnected)return;
        if(!data?.ok)throw Error(data?.message||'检测失败');
        snapshot=data;render(data);
      } catch(e){if(box.isConnected){clearTimeout(expiry);snapshot=null;result.textContent=`无法完成检测：${e.message}。可点击重新检测。`;time.textContent='本次检测失败，已清除旧结果';updateRows();const multiplier=box.parentElement?.querySelector('[data-runtime-mfg]');if(multiplier)multiplier.textContent='本次运行时检测失败，不能确认当前生效状态。';const notice=box.querySelector('[data-component-restart]');if(notice)notice.textContent='本次未能核对启动时间；上次应用后需要重启游戏。';}}
      finally{busy=false;button.disabled=false;button.textContent='刷新运行状态';}
    }
    function schedule(){clearTimeout(timer);if(!auto.checked||!box.isConnected)return;timer=setTimeout(async()=>{if(visible())await refresh();schedule();},5000);}
    auto.onchange=()=>{if(auto.checked&&visible())refresh();schedule();};button.onclick=refresh;
    return {refresh,updateRows};
  }
  root.runtimeView={mount};
})(window);
