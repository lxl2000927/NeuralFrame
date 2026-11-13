"""Build immutable, separately downloadable runtime packs from verified payload.

Does not collect/replace native binaries, or publish anything. Archives from
authors who require their own distribution links remain on their existing fetch
routes (notably LumeniteFX and dgVoodoo).
"""
from pathlib import Path
import hashlib, json, sys, zipfile

source = Path(__file__).resolve().parents[1]
payload = source / 'payload'
out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else source / 'build-output/runtime-packs'
out.mkdir(parents=True, exist_ok=True)
bootstrap = source / 'dist/runtime-bootstrap'
bootstrap.mkdir(parents=True, exist_ok=True)
release = 'runtime-components-2026.11.06'
repo = json.loads((source / 'package.json').read_text(encoding='utf-8'))['distribution']['releaseRepository']
# Engine releases remain the authors' immutable original archives. Rebuilding
# unrelated runtime packs must not downgrade them or replace their source URLs.
current_catalog = json.loads((source / 'src/core/runtime-catalog.json').read_text(encoding='utf-8'))
upstream_engines = [p for p in current_catalog['packs'] if p['id'] in ['mfg-universal', 'mfg-optiscaler-170', 'encore']]
if len(upstream_engines) != 3:
    raise ValueError('Missing verified original engine release records')
groups = {}

def add(key, name, component, version, paths, bundled=False):
    groups[key] = dict(id=key, name=name, component=component, version=version, bundled=bundled,
                       paths=sorted(set(p.replace('\\', '/') for p in paths)))
    # Display provenance is independent of the archive host. Keep it when
    # rebuilding existing packs; never attribute third-party files to our repo.
    upstreams = next((p.get('upstreams') for p in current_catalog['packs'] if p['id'] == key), None)
    if upstreams:
        groups[key]['upstreams'] = upstreams

def under(folder):
    return [p.relative_to(payload).as_posix() for p in (payload/folder).rglob('*') if p.is_file()]

add('nr-3108', '神经渲染模型 310.8.SF-v2', 'dlss-nr', '310.8.0.0', ['streamline/nvngx_dlssnr.dll'])
for key, folder, version in [('baseline','streamline','310.9.1'),('modern','enhanced/streamline-2.14.16','310.9.16')]:
    add('sr-'+key, 'DLSS 超分 '+version, 'dlss-sr', version, [folder+'/nvngx_dlss.dll'])
    add('fg-'+key, 'DLSS 帧生成 '+version, 'dlss-fg', version, [folder+'/nvngx_dlssg.dll'])
    add('sl-'+key, 'Streamline '+('2.13' if key=='baseline' else '2.14.16'), 'streamline', '2.13' if key=='baseline' else '2.14.16',
        [p for p in under(folder) if Path(p).name not in ['nvngx_dlss.dll','nvngx_dlssg.dll','nvngx_dlssnr.dll','nvngx_dlssd.dll']])
add('rr-baseline','DLSS 光线重建','dlss-rr','310.9.1',['streamline/nvngx_dlssd.dll'])
add('renodx-nr','RenoDX 神经渲染插件','renodx-nr','8.5.0-rc10',['renodx-dlss5.addon64','feeder/host64/renodx-dlss5.addon64'])
add('renodx-multipass','RenoDX 多通道插件','renodx-multipass','SF 26.1003.2350',['feeder/host64/renodx-dlss.addon64'])
add('feeder','Feeder 加载链与着色器','feeder','1.17 + 1.19',
    [p for p in under('feeder') if not p.startswith('feeder/host64/')] + under('enhanced/feeder-1.19.0'))
add('reshade','ReShade 加载器','reshade','6.8.0',under('reshade-vulkan')+['ReShade_Setup_6.8.0_Addon.exe'])
for key, component, file, license, version in [('mfg-renodx','mfg-renodx','renodx-mfgunlock.addon64','MFGAdaUnlock-RenoDx-LICENSE.txt','1.5.5')]:
    add(key,'MFG 解锁 '+version,component,version,['enhanced/mfg/'+file,'enhanced/mfg/licenses/'+license])
add('mfg-license','MFG Unlocker 开源许可','mfg-universal','1.7.1',['enhanced/mfg/licenses/MFG-Unlocker-LICENSE.txt'],True)
add('localization','中文适配与预加载桥接','localization','zh1.10',
    ['enhanced/zh-cn/dlss5-zh-cn.addon32','enhanced/zh-cn/dlss5-zh-cn.addon64','enhanced/zh-cn/winmm.dll'],True)

def sha(data): return hashlib.sha256(data).hexdigest()

packs=[]
for key, group in groups.items():
    data={p:((source/'assets/licenses/MFG-Unlocker-LICENSE.txt') if key=='mfg-license' else (payload/p)).read_bytes() for p in group.pop('paths')}
    if key=='mfg-license' and any(sha(blob)!='433da96087fd9b91afd44c6350ca92da53167c9636a0a71e428f71036d8c372f' for blob in data.values()):
        raise ValueError('MFG Unlocker licence fingerprint mismatch')
    if not group['bundled']:
        data['licenses/'+key+'/THIRD_PARTY_NOTICES.md']=(source/'THIRD_PARTY_NOTICES.md').read_bytes()
        for p in (payload/'streamline').glob('*.license.txt'):
            data['licenses/'+key+'/'+p.name]=p.read_bytes()
        data['licenses/'+key+'/MANAGER-LICENSE.txt']=(source/'LICENSE').read_bytes()
    group['files']=[dict(path=p,size=len(b),sha256=sha(b)) for p,b in sorted(data.items())]
    for rel, blob in data.items():
        if group['bundled'] or rel.startswith('licenses/'):
            target=bootstrap/rel
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(blob)
    group['contentId']=sha(json.dumps(group['files'],separators=(',',':')).encode())
    if not group['bundled']:
        name=key+'-'+group['contentId'][:16]+'.zip'
        archive=out/name
        with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for rel,b in sorted(data.items()):
                info=zipfile.ZipInfo(rel,(2026,11,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
                info.external_attr=0o100644<<16
                z.writestr(info,b,compresslevel=6)
        raw=archive.read_bytes()
        group.update(archive=name,size=len(raw),sha256=sha(raw),url=f'https://github.com/{repo}/releases/download/{release}/{name}')
    packs.append(group)
packs.extend(upstream_engines)
catalog=dict(schema=1,release=release,repository=repo,packs=packs)
raw=json.dumps(catalog,ensure_ascii=False,indent=2)+'\n'
(source/'src/core/runtime-catalog.json').write_text(raw,encoding='utf-8')
(out/'runtime-catalog.json').write_text(raw,encoding='utf-8')
(out/'SHA256SUMS.txt').write_text(''.join(sha(p.read_bytes())+'  '+p.name+'\n' for p in sorted(out.iterdir()) if p.is_file() and p.name!='SHA256SUMS.txt'),encoding='utf-8')
print(json.dumps(dict(packs=len(packs),downloadable=sum(not p['bundled'] for p in packs),downloadBytes=sum(p.get('size',0) for p in packs),bundledBytes=sum(f['size'] for p in packs if p['bundled'] for f in p['files'])),ensure_ascii=False))
