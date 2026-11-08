'use strict';
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

// Rounded Electron DIP bounds cannot recover the exact pixel size on a scaled monitor.
async function windowsPixelBounds() {
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = `$ErrorActionPreference = 'Stop'
Add-Type -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr SetThreadDpiAwarenessContext(System.IntPtr value);' -Name DisplayDpi -Namespace NeuralFrame
Add-Type -AssemblyName System.Windows.Forms
if ([NeuralFrame.DisplayDpi]::SetThreadDpiAwarenessContext([IntPtr](-4)) -eq [IntPtr]::Zero) { throw 'DPI context unavailable' }
$bounds = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.Bounds | Select-Object X,Y,Width,Height }
ConvertTo-Json -InputObject @($bounds) -Compress`;
  const { stdout } = await execFile(exe, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 4000 });
  return JSON.parse(stdout);
}

function createDisplayReader(screen, readBounds = windowsPixelBounds) {
  let cached;
  return async function currentDisplay(window, refresh = false) {
    const display = window && !window.isDestroyed()
      ? screen.getDisplayMatching(window.getBounds())
      : screen.getPrimaryDisplay();
    if (!display || display.detected === false) return null;
    const result = {};
    if (Number.isFinite(display.displayFrequency) && display.displayFrequency > 0) result.refreshRateHz = display.displayFrequency;
    const { bounds, scaleFactor } = display;
    if (!(bounds?.width > 0 && bounds.height > 0)) return result;
    if (scaleFactor === 1) {
      result.resolution = `${bounds.width}x${bounds.height}`;
    } else if (screen.dipToScreenPoint && process.platform === 'win32') {
      const point = screen.dipToScreenPoint({ x: bounds.x + Math.floor(bounds.width / 2), y: bounds.y + Math.floor(bounds.height / 2) });
      const key = [display.id, bounds.width, bounds.height, scaleFactor, display.rotation, point.x, point.y].join('/');
      if (refresh || cached?.key !== key) cached = { key, bounds: readBounds().catch(() => []) };
      const rect = (await cached.bounds).find(r => point.x >= r.X && point.x < r.X + r.Width && point.y >= r.Y && point.y < r.Y + r.Height);
      if (rect) result.resolution = `${rect.Width}x${rect.Height}`;
    }
    return result;
  };
}

module.exports = { createDisplayReader };
