# NeuralFrame 0.1.0 — first reconstruction

Baseline: Enhanced 0.1.8, commit 39efdbf916f9f13bdef8680f13b4c036e2548214.
The original checkout and complete Git bundle are retained separately.

## Design contract

Reference: supplied NVIDIA App frontend/layout analyses and game-settings-concept.png.
Application title NeuralFrame; Chinese interface; dark baseline, common light tokens.
30px titlebar, 56px page header, 80px collapsed / 256px expanded navigation,
290px game list, 64px game rows, 48px setting rows (grow for long descriptions).
Background #191919, surface #222222, header #292929, accent #8bd529.
Segoe UI / Microsoft YaHei; 14px body, 12px secondary, 24px page title.
Lucide outline icons, 20px, 1.7 stroke. No background art, glass, gradients or glow.
Generated transparent N mark; game images use existing local artwork cache.

Navigation: 首页, 游戏, 组件, 叠加层, 历史, 设置.
Game tabs: 画质与补帧, 组件与版本, 运行诊断.
Important controls: 添加游戏, 刷新, 启动游戏, 撤销, 预览并应用.
Application state must distinguish drafts, installed files and live evidence.

## Architecture and scope

React/TypeScript desktop renderer, feature modules, one token stylesheet and typed
preload boundary. Existing install/review/rollback services stay authoritative.
Existing game manifests, version locks and component cache remain compatible.
The old userData directory remains the storage location for this transition;
NEURALFRAME_USER_DATA provides a separate QA profile. No migration rewrites games.
Opening the new desktop must not repair permissions or modify game configs.
Game detail reads are lazy and stale async results cannot overwrite another game.
Changing a selector only changes a per-game draft. File changes retain explicit
backend-generated preview tokens and locks.

The native F8 bridge and translated plugins are retained. Legacy renderer sources
are kept during migration for reference, but are not loaded by the new entrypoint.
First-round verification covers desktop shell, real library, drafts, component
inventory, runtime reads, preferences and packaging. Native rendering quality
requires game verification and is not inferred from a desktop UI test.

## Assets

mark.png generated with built-in Image Gen: a lime geometric N combining two
offset video-frame corners, transparent background, flat shape, no wordmark.
game-settings-concept.png generated from the supplied layout rules; it is a
reference, never shipped as interactive UI. Code-native text and controls.
Intentional deviations: actual game data/artwork replaces concept samples;
runtime status remains unconfirmed until requested; existing off settings stay off.
