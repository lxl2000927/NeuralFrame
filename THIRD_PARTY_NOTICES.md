# Third-party notices

## Chinese localization supplement 1 (2026-11-04)

`overlay/zh-cn-extra.json` incorporates Simplified Chinese translations from
Yukikaze20170315/RenoDX-DLSS5-Generic, commit
`9bb6c0fec57ecb28c77938f3feb8155433396d93`, `zh-Hans.hpp` (Copyright (C) 2026,
SPDX-License-Identifier: MIT). Source:
https://github.com/Yukikaze20170315/RenoDX-DLSS5-Generic
The imported translations are supplemented with locally reviewed MFG 1.5.5
UI/diagnostic translations and terminology corrections. The upstream table
describes itself as machine-translated; this supplement does not claim a
complete linguistic review of every inherited entry.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## OptiScaler DLSS-NR (optional download)

OptiScaler DLSS-NR is an independently licensed project, not part of this
application's MIT-licensed implementation:
https://github.com/Dagherbou/OptiScaler_DLSSNR

A second, independently licensed project is offered per game: the pre-SR
multipass fork of the same idea, pinned at the DLSS5-Feeder author's build of
it. Everything below applies to both.
https://github.com/wilsjo2/OptiScaler-DLSSNR-PreSR-Multipass
https://github.com/jlrouzies-fr/OptiScaler-DLSSNR-PreSR-Multipass

The optional backend downloads the official archive of the build a game names
directly from its release page, with a pinned SHA-256 checksum. No upstream
executable, DLL or source is bundled with Swapper, and its setup/removal
scripts are not executed. Upstream binaries remain unmodified; configuration
and tracked deployment are performed by this application.

The upstream GNU GPL version 3 licence (commit 393e070) is downloaded and
checksum-verified separately because it is not included in Dagherbou's release
ZIP; the pre-SR fork carries its own copy inside the archive the pinned digest
already covers, and the fork's PeripheralWarp and FidelityFX v1 notices travel
with it.
The licence, RenoDX attribution, and supplied DirectX/FidelityFX/XeSS notices
are retained in the cache and copied into `OptiScaler/licenses` in the game.
Corresponding upstream source: https://github.com/Dagherbou/OptiScaler_DLSSNR/tree/393e070
Corresponding upstream source for the fork:
https://github.com/jlrouzies-fr/OptiScaler-DLSSNR-PreSR-Multipass/tree/v0.8.92

NVIDIA's Neural Rendering runtime is not supplied by this OptiScaler release.
This integration uses the existing Swapper payload's `nvngx_dlssnr.dll`; it
does not relicense that file or imply NVIDIA support for the integration.

## DLSS5-Feeder

The bundled client add-ons, 64-bit helper, shader and diagnostic verifier are
from the official DLSS5-Feeder v1.17.0 release:
https://github.com/jlrouzies-fr/DLSS5-Feeder/releases/tag/v1.17.0

The project's MIT licence is included in payload/feeder/licenses/DLSS5-Feeder-LICENSE.txt.
Release archive and component checksums are pinned in src/core/feeder-release.js.

## RenoDX DLSS 5 add-ons

Two builds of ShortFuse's RenoDX neural consumer are bundled: the generic
DLSS 5 add-on that every route installs, and the DLSS Tool build that the
multipass route installs in its place.
https://github.com/clshortfuse/renodx

Both are redistributed from the community release repository the upstream
Feeder installer also draws on, and each is pinned by release URL and digest in
src/core/renodx-release.js:
https://github.com/RankFTW/rhi-repo/releases

## dgVoodoo2

dgVoodoo2 is a separately licensed runtime dependency for DX8/DX9 translation:
https://github.com/dege-diosg/dgVoodoo2
https://dege.freeweb.hu/dgVoodoo2/ReadmeGeneral/

Its binaries are not bundled with this application. When a DX8/DX9 installation
is requested, the application downloads the complete official v2.87.5 archive,
verifies its pinned SHA-256 checksum and retains the original documentation
and licence in its component cache. dgVoodoo2 remains under its author's
licence, not this application's MIT licence.

## DLSS5-Autopilot

The emulator profile table and parts of the Vulkan/Feeder installation model
were adapted from DLSS5-Autopilot:
https://github.com/Kizzuwatnaa/DLSS5-Autopilot

MIT License

Copyright (c) 2026 DLSS 5 Autopilot contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

DLSS5-Autopilot downloads third-party components at runtime. Those components
remain under their own licences.

## Game-library artwork (local supplement 1.4)

Game artwork is fetched at runtime from public official store assets, not
bundled with the application or licensed under its MIT license. Artwork,
logos and characters remain the property of their respective rights holders.
Known title mappings reference these official listings:

- Wuthering Waves: https://store.steampowered.com/app/3513350/Wuthering_Waves/
- Honkai: Star Rail: https://store.epicgames.com/p/honkai-star-rail

The UI uses installed system fonts, preferring Noto Sans SC with Microsoft
YaHei fallbacks. No font binaries are redistributed by this supplement.

## MFGAdaUnlock-RenoDx (Enhanced MFG Add-on)

`renodx-mfgunlock.addon64` (v1.4.4, 2026-10-17) is bundled from:
https://github.com/mavismmg/MFGAdaUnlock-RenoDx/releases/tag/v1.4.4

Licensed under the MIT License (Copyright (c) 2026 mavismmg). The full license
text is included in `payload/enhanced/mfg/licenses/MFGAdaUnlock-RenoDx-LICENSE.txt`.

## MFG-Unlocker (RTXMFG Universal Unlocker)

`MFGUnlocker.dll` / `MFGUnlocker.asi` (v1.5.0-hotfix.1, 2026-10-15) is bundled from:
https://github.com/dashdogy/MFG-Unlocker/releases/tag/v1.5.0-hotfix.1

Licensed under the MIT License (Copyright (c) 2026 dashdogy). The full license
text is included in `payload/enhanced/mfg/licenses/MFG-Unlocker-LICENSE.txt`.

## NVIDIA Streamline SDK v2.14.16 & DLSS / DLSS-G 310.9.16.0

The October 2026 runtime stack in `payload/enhanced/streamline-2.14.16/` is
sourced from the official NVIDIA Streamline v2.14.16 release (2026-10-13):
https://github.com/NVIDIA-RTX/Streamline/releases/tag/v2.14.16

Streamline interposer and plugin binaries (`sl.*.dll`) are provided under the
NVIDIA Streamline MIT License; NVIDIA NGX binaries (`nvngx_dlss.dll` and
`nvngx_dlssg.dll` v310.9.16.0) remain under the NVIDIA NGX SDK License Agreement.

## DLSS5-Feeder v1.19.0 (October 2026 Update)

The optional October 2026 Feeder stack in `payload/enhanced/feeder-1.19.0/` is
sourced from the official DLSS5-Feeder v1.19.0 release (2026-10-16):
https://github.com/jlrouzies-fr/DLSS5-Feeder/releases/tag/v1.19.0
Licensed under the MIT License.


## Enhanced upstream 32-bit WinMM preloader (local build)

`payload/enhanced/zh-cn/winmm.dll` is compiled from the MIT-licensed Enhanced
repository at commit `bb72b7c6f7bcc9f2935898df12e151f59a3ddd90`:
https://github.com/skyi7943-cmd/DLSS5-Swapper-Enhanced/commit/bb72b7c6f7bcc9f2935898df12e151f59a3ddd90
The corresponding C source, export definition and build script are included in
the source package. The project MIT license is included at the package root.
