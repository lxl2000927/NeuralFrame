$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$zig = Join-Path $root 'tools/zig-x86_64-windows-0.14.1/zig.exe'
$sdk = Join-Path $root 'tools/reshade-6.8.0'
$out = Join-Path $root 'tools/zh-tests'
New-Item -ItemType Directory -Path $out -Force | Out-Null
$env:ZIG_GLOBAL_CACHE_DIR = Join-Path $root 'tools/zig-cache'
$env:ZIG_LOCAL_CACHE_DIR = Join-Path $root 'tools/zig-local-cache'
foreach ($arch in @('x86_64', 'x86')) {
  $abi = Join-Path $out "$arch-abi.obj"
  $fixture = Join-Path $out "$arch-fixture.obj"
  $exe = Join-Path $out "$arch-test.exe"
  & $zig cc -target "$arch-windows-msvc" -x c++ -std=c++17 -O2 -fno-exceptions -fno-rtti -nostdinc -nostdlib -c (Join-Path $root 'overlay/zh-cn-abi.cpp') -o $abi
  if ($LASTEXITCODE -ne 0) { throw 'ABI build failed' }
  & $zig cc -target "$arch-windows-msvc" -x c++ -std=c++17 -O2 -fno-exceptions -fno-rtti -nostdinc -nostdlib -c (Join-Path $root 'test/zh-cn-abi-fixture.cpp') -o $fixture
  if ($LASTEXITCODE -ne 0) { throw 'Fixture build failed' }
  & $zig c++ -target "$arch-windows-gnu" -std=c++17 -O2 -static -fms-extensions -DWIN32_LEAN_AND_MEAN -DNOMINMAX -Wno-ignored-attributes -I $sdk (Join-Path $root 'test/zh-cn-native.cpp') $abi $fixture -o $exe
  if ($LASTEXITCODE -ne 0) { throw 'Native test build failed' }
  & $exe
  if ($LASTEXITCODE -ne 0) { throw "$arch native regression failed" }
}
