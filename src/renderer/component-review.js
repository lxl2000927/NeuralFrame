'use strict';
(function(root) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const version = info => info?.version || (info ? '无版本资源' : '不存在');
  const size = n => n == null ? '—' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;
  const actionNames = {add:'新增',replace:'替换',remove:'删除',keep:'保留'};
  let busy = false;
  function confirmPlan(plan) {
    const dialog = document.createElement('dialog');
    dialog.className = 'component-dialog'; dialog.setAttribute('aria-labelledby', 'componentPreviewTitle');
    const counts = Object.keys(actionNames).map(key => `${actionNames[key]} ${plan.rows.filter(r => r.action === key).length}`).join(' · ');
    const changed = plan.rows.filter(row => row.action !== 'keep'), kept = plan.rows.filter(row => row.action === 'keep');
    const rowHtml = row => `<tr><td><span class="component-action ${row.action}">${actionNames[row.action]}</span></td><td><b>${esc(row.rel)}</b><small>${esc(row.category)}${row.scope === 'shared' ? ' · 游戏目录外的共享组件 / 管理记录' : ''}</small>${row.source ? `<details><summary>文件来源</summary><code>${esc(row.source)}</code></details>` : ''}</td><td>${esc(version(row.before))}<small>${size(row.before?.size)}</small>${row.backup ? `<small>${row.backup.create ? '将备份' : '原始备份'}：${esc(row.backup.version || '无版本资源')}</small>` : ''}</td><td>${esc(version(row.after))}<small>${size(row.after?.size)}</small></td></tr>`;
    const table = rows => `<div class="component-table-wrap"><table class="component-table"><thead><tr><th>操作</th><th>目标文件</th><th>当前</th><th>应用后</th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`;
    dialog.innerHTML = `<header><div><span class="component-eyebrow">应用前检查</span><h2 id="componentPreviewTitle">${plan.kind === 'restore' ? '恢复原始文件预览' : '组件变更预览'}</h2><p>${esc(plan.dir)}</p></div><button type="button" data-review-cancel aria-label="关闭预览">✕</button></header><div class="component-dialog-body"><div class="component-summary">${counts}</div><p class="hint">目前没有写入游戏文件。确认时会重新校验；文件或来源发生变化后需要重新预览。预览有效期为 10 分钟。</p>${plan.lock ? `<p class="component-notice">${plan.kind === 'restore' ? '恢复成功后将解除这个游戏的版本锁定。' : '此游戏已锁定版本：允许调整参数，禁止更换、移除或增加组件。'}</p>` : ''}${plan.conflicts.length ? `<div class="component-error"><b>版本锁定已阻止应用</b><ul>${plan.conflicts.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p>请返回组件清单查看差异；如需更换组合，请手动解锁后重新预览。</p></div>` : ''}${changed.length ? table(changed) : '<p class="hint">没有组件文件需要变更。</p>'}${kept.length ? `<details class="component-kept"><summary>查看 ${kept.length} 个保留文件</summary>${table(kept)}</details>` : ''}${plan.externalSteps?.length ? `<div class="component-notice"><b>共享 Vulkan 注册变更</b>${plan.externalSteps.map(x => `<code>${esc(x.file + ' ' + x.args.join(' '))}</code>`).join('')}</div>` : ''}<p class="hint">原始文件备份沿用现有 _DLSS5_Backup；事务临时文件与备份元数据已合并显示，不计入上面的组件数量。</p></div><footer><span>写入成功后，请重启游戏加载新文件。</span><button type="button" class="ghost" data-review-cancel>取消</button><button type="button" class="primary" id="componentConfirm" ${plan.conflicts.length ? 'disabled' : ''}>确认${plan.kind === 'restore' ? '恢复' : '应用'}</button></footer>`;
    document.body.appendChild(dialog);
    return new Promise(resolve => {
      let done = false;
      const finish = answer => { if (done) return; done = true; dialog.close(); dialog.remove(); resolve(answer); };
      dialog.querySelectorAll('[data-review-cancel]').forEach(button => button.onclick = () => finish(false));
      dialog.querySelector('#componentConfirm').onclick = () => finish(true);
      dialog.oncancel = event => { event.preventDefault(); finish(false); };
      dialog.showModal(); dialog.querySelector('[data-review-cancel]').focus();
    });
  }
  async function prepare(dependencies) {
    const dialog=document.createElement('dialog');dialog.className='component-dialog';
    dialog.innerHTML='<header><h2>准备配套组件</h2></header><div class="component-dialog-body"><p data-progress role="status">正在检查已有缓存…</p><progress style="width:100%"></progress><p class="hint">仅下载当前操作需要的组件。完成后保留在独立缓存，软件升级无需重复下载；此时尚未修改游戏。</p></div><footer><button type="button" class="ghost">取消下载</button></footer>';
    document.body.append(dialog);dialog.showModal();
    const cancel=()=>{root.lab.componentCancelPrepare?.();dialog.querySelector('button').disabled=true;dialog.querySelector('[data-progress]').textContent='正在取消…';};
    dialog.querySelector('button').onclick=cancel;dialog.oncancel=e=>{e.preventDefault();cancel();};
    const unsubscribe=root.lab.onComponentProgress?.(p=>{
      const progress=dialog.querySelector('progress');
      if(p.total){progress.max=p.total;progress.value=p.loaded;}else progress.removeAttribute('value');
      dialog.querySelector('[data-progress]').textContent=`${p.name} · ${p.stage==='download'?((p.loaded/1048576).toFixed(1)+' / '+(p.total/1048576).toFixed(1)+' MB'):p.stage==='verify'?'校验中':p.stage==='ready'?'已就绪':'检查本地缓存'}`;
    });
    try{return await root.lab.componentPrepare(dependencies);}finally{unsubscribe?.();dialog.close();dialog.remove();}
  }
  async function run(operation) {
    if (busy) return {ok:false,message:'另一个组件操作正在进行，请先完成或取消。'};
    busy = true;
    try {
      let result = await operation();
      for (let tries = 0; result?.dependencies?.length && tries < 3; tries++) {
        const ready = await root.ask({ title:'准备预览所需的组件', body:`${result.message}${result.downloads?.length ? '\n\n所需组件（已有缓存将复用）：\n'+result.downloads.map(p=>p.name+' · '+(p.size/1048576).toFixed(1)+' MB').join('\n') : ''}\n\n只准备管理器缓存，完成后重新生成文件清单，不会在这一步安装到游戏。`, confirm:'准备缓存', cancel:'取消', tone:'accent' });
        if (!ready) return {ok:false,cancelled:true};
        const prepared = await prepare(result.dependencies);
        if (!prepared?.ok) return prepared;
        result = await operation();
      }
      if (!result?.preview) return result;
      if (!await confirmPlan(result.preview)) return {ok:false,cancelled:true};
      const applied = await operation(result.preview.token);
      if (applied?.recordWarning) await root.ask({ title:'组件记录提示', body:applied.recordWarning, confirm:'知道了', cancel:'关闭', tone:'accent' });
      return applied;
    } catch (error) { return {ok:false,message:error.message}; }
    finally { busy = false; }
  }
  function mount(container, dir) {
    if (!root.lab.componentInventory || !container) return;
    let box = container.querySelector('.component-inventory');
    if (box) return;
    box = document.createElement('section'); box.className = 'component-inventory';
    box.innerHTML = '<div class="component-heading"><div><h3>游戏组件与版本锁定</h3><p class="hint">按需读取磁盘文件，不在后台持续扫描。</p></div><button type="button" class="ghost" data-component-load>查看组件</button></div><div class="component-inventory-body" hidden></div>';
    container.append(box);
    if(root.lab.libraryComponents){const choose=document.createElement('button');choose.className='ghost';choose.textContent='选择组件版本';choose.onclick=()=>root.componentLibrary.open(dir);box.querySelector('.component-heading').append(choose);}
    const runtime = root.runtimeView?.mount(box, dir);
    const body = box.querySelector('.component-inventory-body'), load = box.querySelector('[data-component-load]');
    let loading = false;
    const refresh = async () => {
      if (loading) return; loading = true; load.disabled = true; load.textContent = '读取中…'; body.hidden = false;
      try {
        const data = await root.lab.componentInventory(dir);
        if (!box.isConnected) return;
        if (!data?.ok) throw Error(data?.message || '读取组件失败');
        const drift = data.rows.filter(r => r.lockState === 'drift');
        body.innerHTML = `<div class="component-lockbar"><div><b>${data.lock ? '当前组合已锁定' : '尚未锁定版本'}</b><p class="hint">${data.lock ? `锁定于 ${esc(new Date(data.lock.at).toLocaleString())}，仅允许调整配置参数。` : '在游戏中验证稳定后，可锁定当前组件文件，避免安装或更新时更换版本。'}</p></div><button type="button" class="ghost" data-component-lock>${data.lock ? '解除锁定' : '锁定当前组合'}</button></div>${drift.length ? `<p class="component-error">${drift.length} 个文件已偏离锁定组合，可能被游戏更新或其他工具修改。请核对后决定是否解锁。</p>` : ''}${data.lastApplied?.restartRequired ? '<p class="component-notice" data-component-restart>上次应用后需要重启游戏；检测运行状态后可核对启动时间。</p>' : ''}<p class="hint">磁盘版本与进程加载情况分别列出。运行状态刷新不重新计算文件哈希；无版本资源的插件使用 SHA-256 区分。</p>${data.rows.length ? `<div class="component-table-wrap"><table class="component-table"><thead><tr><th>组件 / 路径</th><th>磁盘版本</th><th>记录与恢复</th><th>加载</th></tr></thead><tbody>${data.rows.map(row => `<tr><td><b>${esc(row.name)}</b><small>${esc(row.category)}</small><details><summary>路径 / 来源 / 指纹</summary><code>${esc(row.rel)}</code><small>${esc(row.source)}</small><code>SHA-256: ${esc(row.sha256 || '—')}</code></details></td><td>${esc(row.present ? row.version || '无版本资源' : '文件缺失')}<small>${size(row.size)}</small>${row.lockState ? `<span class="component-action ${row.lockState === 'match' ? 'keep' : 'remove'}">${row.lockState === 'match' ? '与锁定一致' : '偏离锁定'}</span>` : ''}</td><td>${row.writtenAt ? '已记录写入' : '磁盘检测'}<small>${row.backup ? `原始备份：${esc(row.backup.version || '无版本资源')}` : '未发现原始替换备份'}</small></td><td data-runtime-file="${esc(row.scope === 'shared' ? row.rel : dir.replace(/[\\/]$/, '') + '/' + row.rel)}">尚未检测</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">没有发现受支持的组件文件。</p>'}`;
        runtime?.updateRows(data.lastApplied);
        runtime?.refresh();
        body.querySelector('[data-component-lock]').onclick = async event => {
          const go = await root.ask({ title: data.lock ? '解除版本锁定？' : '锁定当前组件组合？', body: data.lock ? '解除后，下一次应用可更换组件。这个操作不会修改游戏文件。' : '请确认已在游戏中验证当前组合稳定。锁定会记录当前文件的完整 SHA-256，阻止管理器更换、移除或增加组件；仍可调整不涉及组件更换的参数。其他工具和游戏更新不受此锁控制，也不会额外复制一套 DLL。', confirm: data.lock ? '解除锁定' : '已验证，锁定', cancel:'取消', tone:'accent' });
          if (!go) return;
          event.target.disabled = true;
          try { const result = await root.lab.componentLock(dir, !data.lock); if (!result?.ok) throw Error(result?.message || '锁定操作失败'); await refresh(); }
          catch (error) { await root.ask({ title:'未能更新锁定', body:error.message, confirm:'知道了', cancel:'关闭' }); }
          finally { event.target.disabled = false; }
        };
      } catch (error) { body.textContent = error.message; }
      finally { loading = false; load.disabled = false; load.textContent = '刷新组件'; }
    };
    load.onclick = refresh;
  }
  root.componentReview = { run, mount, prepare };
})(window);
