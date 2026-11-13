$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# Arguments are data in the child environment, never interpolated PowerShell.
$request = $env:ENHANCED_RUNTIME_QUERY | ConvertFrom-Json
$targets = @($request.executables | ForEach-Object { [IO.Path]::GetFullPath($_) })
$names = @($targets | ForEach-Object { [IO.Path]::GetFileName($_) })
$found = @()
$unreadable = @()
foreach ($item in Get-CimInstance Win32_Process) {
  if ($names -notcontains $item.Name) { continue }
  if (-not $item.ExecutablePath) {
    $unreadable += @{ pid = $item.ProcessId; name = $item.Name }
    continue
  }
  if ($targets -notcontains $item.ExecutablePath) { continue }
  $modules = @()
  $moduleError = $null
  $started = $item.CreationDate.ToUniversalTime()
  try {
    $proc = Get-Process -Id $item.ProcessId -ErrorAction Stop
    $started = $proc.StartTime.ToUniversalTime()
    foreach ($module in $proc.Modules) {
      if ($module.ModuleName -match '(?i)(nvngx|renodx|mfg|dlss|reshade|optiscaler|rtx-encore|^version\.dll$|^dinput8\.dll$|^winmm\.dll$|^sl\.|^dxgi\.|^d3d\d+\.|^libxess)') {
        $modules += @{ path = $module.FileName; name = $module.ModuleName }
      }
    }
    # A failed enumeration may return no modules instead of throwing.
    if ($proc.HasExited) { continue }
    if ($proc.Modules.Count -eq 0) { $moduleError = 'access_denied' }
  } catch { $moduleError = 'access_denied_or_exited' }
  $found += @{ pid = $item.ProcessId; exe = $item.ExecutablePath; startedAt = $started.ToString('o'); processBirth = $started.ToFileTimeUtc().ToString(); modules = $modules; moduleError = $moduleError }
}
@{ processes = $found; unreadable = $unreadable } | ConvertTo-Json -Depth 5 -Compress
