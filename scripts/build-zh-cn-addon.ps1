param([switch] $Stage)
$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$zig = Join-Path $appRoot 'tools/zig-x86_64-windows-0.14.1/zig.exe'
$sdk = Join-Path $appRoot 'tools/reshade-6.8.0'
if (!(Test-Path -LiteralPath $zig) -or !(Test-Path -LiteralPath (Join-Path $sdk 'reshade.hpp'))) {
    throw 'Run npm run overlay:prepare first.'
}

$outputDir = Join-Path $appRoot 'build-output/zh-cn'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$env:SOURCE_DATE_EPOCH = '0'
$env:ZIG_GLOBAL_CACHE_DIR = Join-Path $appRoot 'tools/zig-cache'
$env:ZIG_LOCAL_CACHE_DIR = Join-Path $appRoot 'tools/zig-local-cache'

$targets = @(
    @{ Arch = 'x86_64-windows-gnu'; OutName = 'dlss5-zh-cn.addon64' },
    @{ Arch = 'x86-windows-gnu';    OutName = 'dlss5-zh-cn.addon32' }
)

foreach ($t in $targets) {
    $outFile = Join-Path $outputDir $t.OutName
    $abiFile = Join-Path $outputDir ($t.OutName + '.abi.obj')
    $msvcTarget = $t.Arch.Replace('-gnu', '-msvc')
    & $zig cc -target $msvcTarget -x c++ -std=c++17 -O2 -fno-exceptions -fno-rtti -nostdinc -nostdlib -c (Join-Path $appRoot 'overlay/zh-cn-abi.cpp') -o $abiFile
    if ($LASTEXITCODE -ne 0) { throw 'Chinese text-measurement ABI thunk compilation failed.' }
    $args = @(
        'c++',
        '-target', $t.Arch,
        '-std=c++17',
        '-O2',
        '-shared',
        '-static',
        '-s',
        '-lbcrypt',
        '-fms-extensions',
        '-DWIN32_LEAN_AND_MEAN',
        '-DNOMINMAX',
        '-I', $sdk,
        (Join-Path $appRoot 'overlay/zh-cn-overlay.cpp'),
        $abiFile,
        '-o', $outFile
    )
    & $zig @args
    if ($LASTEXITCODE -ne 0) {
        throw "$($t.OutName) compilation failed."
    }

    $stream = [IO.File]::OpenRead($outFile)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $hasher.Dispose()
    }
    Write-Output "Built $outFile (SHA-256 $hash)"
}

if ($Stage) {
    $stageScript = @'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [root, output] = process.argv.slice(1);
const catalogPath = path.join(root,'src/core/runtime-catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const pack = catalog.packs.find(p => p.id === 'localization');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
for (const file of pack.files.filter(f => /\.addon(?:32|64)$/.test(f.path))) {
  const bytes = fs.readFileSync(path.join(output,path.basename(file.path)));
  const target = path.join(root,'dist/runtime-bootstrap',file.path);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temp = target + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp,bytes,{flag:'wx'});
  fs.renameSync(temp,target);
  file.size = bytes.length;
  file.sha256 = hash(bytes);
}
pack.contentId = hash(JSON.stringify(pack.files));
fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2) + '\n');
'@
    & node -e $stageScript $appRoot $outputDir
    if ($LASTEXITCODE -ne 0) { throw 'Failed to stage the localization add-ons.' }
}
