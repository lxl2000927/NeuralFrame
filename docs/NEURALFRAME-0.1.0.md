# NeuralFrame 0.1.0

Initial release of the NeuralFrame desktop reconstruction, based on the local
Enhanced 0.1.8 baseline and preserving its component/install core.

## First-round changes

- New name, generated N/frame logo, taskbar icon, installer identity and repository.
- One React + TypeScript renderer; route-level lazy loading and shared dark/light tokens.
- NVIDIA App-inspired sidebar, master/detail game settings and stable scroll regions.
- Per-game drafts; reading a disabled feature keeps it disabled. Editing only one
  rendering feature does not silently send a change to the other feature.
- Existing preview-token installs, component cache, version locks and rollback are reused.
- Component inventory, runtime diagnostics, online component releases, history clear,
  scan-folder preferences and F8 overlay preferences are accessible in the new shell.
- Renderer no longer loads legacy community/chat scripts or competing theme layouts.
- Browsing a game no longer repairs ReShade.ini permissions as a side effect.
- Component archives moved to lxl2000927/NeuralFrame and verified against all 14 hashes.

## Compatibility

Existing user configuration remains at `%APPDATA%/dlss5-swapper-enhanced` for this
transition. This preserves the library, downloads, custom models and version locks
without duplicating large files. Game backups remain in their existing directories.
No game DLL or configuration was changed while developing this reconstruction.
The removed repository's old download links no longer work; the new build contains
the migrated component URLs.

## Scope

Native C++ F8 drawing, shader code and rendering providers are retained. Desktop
checks cannot establish image quality, game compatibility or output FPS. Those
still require evidence from the actual running game.
Legacy frontend files remain as migration reference; the desktop entrypoint now
loads `src/ui-dist/index.html` only. The offscreen native-overlay frontend remains
separate. The next round can finish extracting main-process feature services and
expand plugin-specific capability schemas.
