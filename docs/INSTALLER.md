# Windows installer

Aurum uses a compact, frameless 728 × 470 installer with a neutral sage palette,
the approved Au logo, a contour pattern, and a visible circular close button.
The sidebar and top edge let users move the window. Native controls retain
keyboard navigation and accessibility while a small NSIS presentation plugin
draws rounded buttons and independent shortcut checkboxes.

The first screen includes the destination folder, an approximate installed size
in decimal MB, available disk space, separate Desktop and Start menu choices,
and a license link. Minecraft and Java downloads are separate. WebView2 is only
downloaded when missing; the installer itself does not require a WebView to render.
The final screen offers to launch Aurum.

## Language and size

The installer uses the current user's Windows **display language**, rather than
the region or keyboard layout. Russian, Ukrainian, Spanish, German, French,
Polish, and English are supported. Regional variants map to the same translation;
unsupported languages fall back to English. The selected language is saved for
the uninstaller. The launcher's own language setting remains independent.

Translations are small embedded string tables, compressed together with the
payload using solid LZMA. There are no downloaded language packs, bundled
translation engines, extra fonts, or browser runtimes for the installer UI.
The presentation DLL is small and uses only Windows system libraries, including
GDI+ for the antialiased close icon; no graphics runtime is bundled.
The displayed installed-size estimate adds 512 KiB for the generated uninstaller;
the actual size varies with the launcher build. The local 0.3.3 build was about
6.85 MB compressed and approximately 21.40 MB installed.

## Build

`beforeBundleCommand` runs `scripts/installer-assets.ps1`, which creates the
sidebar bitmap and compiles `src-tauri/installer/aurum-ui.cpp`. Generated assets
and DLLs are ignored by Git. Compilation uses the checkout's x86 LLVM-MinGW
compiler, or Visual Studio C++ x86 tools on Windows release runners. The latter
uses the static C runtime; no additional runtime installer is bundled.

Use `scripts/desktop.ps1 -Mode build` for the launcher and installer together,
or `-Mode bundle` for an already built launcher. Signed updater builds retain
the existing release workflow. For an unsigned local preview, use a temporary
config overlay setting `bundle.createUpdaterArtifacts` to `false`; do not disable
signed updater artifacts in the production configuration.

## Verification

`scripts/build-installer-ui.ps1 -Test` also compiles and runs the close-button
rendering regression test. It renders into memory, without desktop windows or
input automation, and checks visibility without hover, visual centering at five
sizes, sibling clipping, and hover feedback. The close button paints directly on
`WM_PAINT`; showing the window or changing pages raises and redraws the control.

`scripts/test-installer-language.ps1` compiles a small NSIS harness using the
production language-selection function. Sixteen cases cover regional variants,
unsupported languages, and the English fallback. The current system language
is also queried by the harness.

`scripts/test-installer.ps1 -SetupPath <QA installer>` accepts only the isolated
**Aurum Installer QA** product. Build it using a temporary Tauri config with
`identifier: app.aurum.installer.qa`, `productName: Aurum Installer QA`, and
`bundle.publisher: AurumInstallerQA`. It installs into `.test-data/installer-smoke`,
checks all four shortcut combinations, verifies `/UPDATE` and `/NS`, and uninstalls
without deleting an unrelated file. Production registry keys and game data are
not used by this test. The QA payload must not be launched during the test.

Both tests passed for the local 0.3.3 build. The latest close-button appearance
is left for user review; no computer-use automation was used for the final build.
The frontend build and unit tests also passed. An isolated copy of the home-page
UI tests verified the Russian and English installer announcement in both themes,
including visible dialog actions at the minimum launcher window size. UI test
screenshots and reports stay in `.test-data/`.

## Compatibility and provenance

The Tauri NSIS installation backend retains WebView2 detection, running-process
checks, updater flags, shortcut ownership checks, uninstall registration, and
explicit opt-in removal of application data. The production identifier remains
`app.auren.launcher`. Normal updates retain shortcut preferences.

`installer.nsi` is adapted from Tauri CLI v2.12.2's MIT-licensed template. Its
license is preserved in `src-tauri/installer/TAURI-MIT-LICENSE` and referenced in
`NOTICE`. The installer also places these license and notice files beside the
launcher. The Aurum presentation code and generated contour artwork are original
project contributions under the project license.
