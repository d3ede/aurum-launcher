# Verification history — Auren 0.1.0 to Aurum 0.3.1

These records describe checks performed for each update. Historical installer paths, sizes, and hashes refer to those specific builds; the public 0.3.1 artifact is recorded at the end.

## Public release 0.3.9 — October 15, 2026

[Aurum Launcher 0.3.9](https://github.com/d3ede/aurum-launcher/releases/tag/v0.3.9)
is built from source commit `0626618ebb6f620f951ade3c2f75c10e4bb7b380`.
The installer repairs existing Aurum Desktop and Start menu links pointing to
older copies outside the registered installation folder, while preserving
shortcut customization and leaving deleted/unrelated links alone.

The [signed Windows release workflow](https://github.com/d3ede/aurum-launcher/actions/runs/38642214894)
passed its frontend build, 13 unit tests, 54 regular Rust tests, Clippy and all
44 UI scenarios. Installer checks passed 17 path cases, 16 display-language
cases, close-control rendering, and eight shortcut cases, including the real
Tauri executable's product resource and Unicode paths. Local tests also covered
the full isolated QA installation/update/uninstall cycle without `/D`, stale
links with both saved choices off, `/NS`, deleted links and unrelated targets.
The three existing JDK-dependent process tests remain ignored.

Versions 0.3.7 and 0.3.8 were not published because Windows Script Host rejected
the Cyrillic shortcut fixture on the release server. The test now uses native
`IShellLinkW` interfaces. Its [standalone Windows Server check](https://github.com/d3ede/aurum-launcher/actions/runs/38641614576)
passed before the final release. Those source tags were preserved; their failed
runs never replaced the previous public installer or update manifest.

All four release assets are published. The ordinary public
`releases/latest/download/` URLs return the new installer, signature and manifest.
Downloaded bytes match GitHub's asset digests and `SHA256SUMS.txt`; the manifest
offers 0.3.9 using its immutable installer URL and matching signature.
The installer identifies itself as **Aurum Launcher 0.3.9**, is **6.97 decimal MB**
(6,965,780 bytes), and has SHA256:

```text
70c9c162f92c3476ee1daa320d3b1aa6e86f9de7bd806687119eb7e9f54e051f
```

Native Minisign verification passed against the configured public key; altered
installer bytes and an altered signed version were rejected. The downloaded
installer was not executed, and production game/account data was not used.
This verification record follows the tagged source without changing its tag
or published artifacts.

## Shortcut repair — development build, October 14–15, 2026

Automatic NSIS updates now repair existing product-owned Desktop and Start menu
shortcuts that point to older copies outside the registered installation folder.
This change is prepared for a future installer; the published 0.3.6 assets are
unchanged.

The native plugin compiled successfully, and its eight-case NSIS regression
passed for old/current targets, Unicode paths, unrelated executables, missing
targets/links, custom shortcut metadata and a real Tauri executable's product
resource. A separate **Aurum Installer QA**
bundle used the existing 0.3.5 payload and the modified installer backend without
launching the payload. Its silent installation/update/uninstall smoke test passed
all four shortcut combinations and reproduced stale Desktop/Start menu links.
Updating without `/D` repaired both links using the registered destination even
with both stored shortcut choices disabled. `/NS` left old links untouched;
deleted links stayed deleted, unrelated links were preserved, and uninstall kept
an unrelated file. Only the QA registry namespace and test-owned shortcuts were
used; game/account data and production Aurum shortcuts were not changed.

The production frontend build, 13 unit tests, the close-control rendering test,
and both home-page UI scenarios passed. The UI scenarios checked Russian/English
shortcut announcements, both themes and the minimum window size. Rust sources
and launcher update protocol were unchanged. No desktop input automation was used.

## Public release 0.3.6 — October 14, 2026

[Aurum Launcher 0.3.6](https://github.com/d3ede/aurum-launcher/releases/tag/v0.3.6) is built from source commit `81509e2bc1109ebbf1fbe99990350af3245e562b`. Selecting a drive or share root now adds an `Aurum Launcher` directory; explicit folders retain their locations, and automatic updates preserve registered installation paths.

Local checks passed: production frontend build, 13 Vitest tests, 54 regular Rust tests, Clippy, all 43 Playwright scenarios, 17 installer-path cases with repeated normalization, 16 display-language cases, and the close-control rendering regression test. The three existing JDK-dependent process tests remain ignored. The [Windows release workflow](https://github.com/d3ede/aurum-launcher/actions/runs/38568299465) completed successfully, including the new installer regression checks, and published all four signed-update assets from the tag.

The ordinary `releases/latest/download/` links were used to download and verify the public installer, signature, and manifest. Downloaded bytes match GitHub's asset digests and `SHA256SUMS.txt`. The installer identifies itself as Aurum Launcher **0.3.6** and is **6.97 MB** (6,966,402 bytes). SHA256:

```text
04ebc43ddbd66d2eac974c12086de0b1468bbd0e3bff698bb895c83f39c02bbb
```

The public `latest.json` offers 0.3.6 using its immutable installer URL and matching signature. The native Minisign verifier validates the downloaded installer with the configured public key; altered installer bytes and an altered signed version are both rejected. The downloaded installer was not executed during verification. This record is committed after the tagged application source without changing its tag or public assets.

## Public release 0.3.5 — October 14, 2026

[Aurum Launcher 0.3.5](https://github.com/d3ede/aurum-launcher/releases/tag/v0.3.5) is built from source commit `9d4473eb9589538926a587210e36737021171dd8`. The tag contains the compact home panels, installed content manager, catalog views and image gallery, and multilingual installer with the corrected close control. The README now uses one current English preview at `docs/launcher-en.png`; the test screenshot gallery is removed from Git, and QA captures go to ignored `.test-data/screenshots/` storage.

Local checks passed: production frontend build, 13 Vitest tests, 54 regular Rust tests, Clippy, all 43 Playwright scenarios, and the installer close-control rendering test. The three JDK-dependent process tests remain ignored in the regular suite. The [Windows release workflow](https://github.com/d3ede/aurum-launcher/actions/runs/38563003814) passed its code and UI checks, built the signed setup from the tag, and published the release assets.

The public installer is **6.97 MB** (6,966,031 bytes). Its downloaded bytes match GitHub's asset digest and `SHA256SUMS.txt`. SHA256:

```text
1b32254f5ae0fe46346b4c16890279f864d42670defbb9a73b31b916f6b32a2d
```

The public `latest.json` offers 0.3.5 and points to its immutable installer URL with the matching updater signature. A separate real WebView2/Tauri client with version 0.3.1 and an owned test data directory downloaded the public installer and verified its signature. Its installation permission was explicitly denied; the installer was not executed and user game data was not used. Only this verification record changes after the tagged application source.

## Installed content manager — October 14, 2026

The instance content view uses compact project/version/action columns, 52 px icons, readable versions, adjacent switches and trash actions, sorting, and a single state/source/author filter panel. It checks compatible updates on opening and every five minutes while the view is mounted, with a compact update-all action. Full version strings and filenames remain in tooltips. Local Fabric, Quilt, Forge and NeoForge metadata provides names, versions, authors and bounded image previews. Modrinth SHA1 lookups identify imported files and cache project metadata. Unknown local files remain manageable without promising catalog updates.

Verification: production frontend build, 13 Vitest checks, 54 regular Rust tests (three existing JDK-dependent process tests remain ignored), Clippy, and all 43 UI scenarios. UI checks use an isolated local port when the standard development port is occupied. New tests cover filtering/sorting, project pages, separate versions, larger action targets, partial/offline update errors, running-game restrictions, both themes, and minimum window size. Rust tests cover legacy state compatibility, bounded archive metadata/images, hash-bound identity, compatible/newer releases, concurrent removal/toggling, and cancellation inside a registered bulk operation.

The `content_manager_fixture` example downloaded older actual Sodium and Iris files into `.test-data/`, including a disabled Sodium file, and verified recognition and available updates. `scripts/native-content-manager-smoke.mjs` then used real Tauri IPC and Modrinth downloads to open the project page, update both projects, preserve the disabled state, toggle Sodium, and move the local fixture to trash. No account was added and no game was launched. Native screenshots are `.test-data/screenshots/content-manager-native-light.png` and `content-manager-native-dark.png`. Live CurseForge update/download integration was not exercised; its existing catalog adapter remains subject to API-key availability.

## Home layout refresh — October 14, 2026

The home page now has a main content column and a compact account/release sidebar. Navigation and quick launch include locally drawn SVG line-and-pixel patterns. The quick-launch card shows the real instance status and opens the instance's settings tab directly. The sidebar sits 14 px from the right edge, with a 16 px column gap and compact card padding. The news header contains a single “Show all” action; rows cover the published 0.3.3 updater release, instance import, and the skin library. Only the published release has a date. Its details are based on `docs/releases/v0.3.3.md` and link to update settings. No generated illustrations or additional landscape images were added.

Both themes were inspected at 1280×820. At 960×680 the right column moves below the main content without horizontal overflow. New strings have Russian and English dictionaries; other locales retain the existing English fallback. Screenshots: `.test-data/screenshots/home-light.png`, `.test-data/screenshots/home-dark.png`, and `.test-data/screenshots/home-small.png`.

Production TypeScript/Vite build and all 11 Vitest tests passed. Both new home UI tests and the four general interface tests passed, including launch/stop, account navigation, direct settings navigation, release-dialog keyboard dismissal and the minimum window size. The full UI run passed 35 tests; one profile-icon navigation test timed out during concurrent workspace updates. Both profile-icon tests passed on an isolated rerun without changes to the icon editor. The local Windows preview is built separately with `scripts/desktop.ps1 -Mode build -NoBundle -NoSign`; this is not a published updater release.

## Update: restoring running games — October 14, 2026

After Aurum closes and reopens, game status is restored from real Java processes whose exact `--gameDir` belongs to an existing instance. Relaunching or modifying a running instance is blocked; **Stop** works for restored processes. Status updates automatically when a game exits. Command lines and tokens are not persisted. On Windows, stopping checks process creation time on the same HANDLE used for termination, protecting against PID reuse.

- 46 regular Rust tests passed, including a check that a mismatched creation time never terminates a process. Workspace/all-target Clippy with `-D warnings` passed.
- Three Java tests were explicitly run with `AURUM_PROCESS_TEST_JAVA=C:\Program Files\Java\jdk-25.0.2\bin\java.exe`: restoration after a new Engine is created and targeted stopping without killing unrelated Java; removal of exited games without stale status after reopening; and two processes for one instance. They are normally ignored because they require a JDK. The explicit command `cargo test -p auren-core --test process_recovery -- --ignored` passed.
- Production TypeScript/Vite build and four main-interface Playwright tests passed.
- `scripts/native-session-smoke.mjs` passed using real WebView2/IPC: launching an owned Java fixture through normal game launch, closing through **Close Aurum**, preserving the game process, reopening with **Running**/**Stop**, stopping through the UI, then a second launch/close/reopen cycle and automatic status removal after external termination of the test process. No real Minecraft instance was launched in this test. Result: `.test-data/native-session-1791932698089/result.json`; screenshot: `.test-data/screenshots/session-restored-native.png`. User games were not stopped.

The corrected Aurum was opened with normal data. Four Java processes present before changing the window retained their PIDs and start times. Installer: `target/skins-build/release/bundle/nsis/Aurum Launcher_0.3.1_x64-setup.exe`, 6,462,105 bytes. SHA256: `85B015355B4919024916EEF990857A0F04EDEE2260D3490329237C20F02DBF60`.

## Update: import progress and speed — October 14, 2026

The global progress card is hidden while the Modrinth dialog is open. Import progress moved into a persistent footer next to **Stop**. Copied data is shown in decimal MB separately from percentage; file counters for other operations retain their units. Both themes and 960×680 layout were checked, including actual button accessibility and cancellation with the correct operation ID.

Local copying uses one blocking worker, a reusable 1 MiB buffer, and progress updates every 150 ms. Repeated parent-directory creation, Tokio scheduling for every read/write, and forced `sync_all` for each file were removed in favor of ordinary writes through the OS file cache. Originals are preserved; staged data is committed only after checking for source changes. Cancellation removes the current partial copy. After a power failure, the copy can be retried from the original.

For the same synthetic instance (1,000 JSON configurations and a 128 MiB file), import time fell from 4.527 to 0.373 seconds, and progress events from 1,520 to 5. Measurements used a local Windows temporary directory with file caching; they do not guarantee the same speed on a user's drive or for a 15,740 MB instance.

12 Rust import tests and workspace/all-target Clippy with `-D warnings` passed. Four import Playwright tests passed. Real WebView2/Rust IPC also copied two isolated instances while preserving originals: `.test-data/native-modrinth-1791930263983/result.json`. The user's import was not interrupted. Screenshots: `.test-data/screenshots/modrinth-progress-light.png` and `modrinth-progress-dark.png`.

Installer: `target/skins-build/release/bundle/nsis/Aurum Launcher_0.3.1_x64-setup.exe`, 6,435,544 bytes. SHA256: `77D766D06ED2A9D8DF0394DA02E2895C4435C5F28B580EB97B8E5393B85E7E53`. The updated executable was opened with normal user data only after confirming that the import had finished or stopped.

## Update: skin library — Aurum 0.3.0

On October 14, 2026, a dedicated **Skins & capes** tab added saved appearances, nine default characters (18 textures for both arm types), manual rotation, a ground plane instead of a glow effect, and seven animation modes. The library is stored separately in `skin-library.json`; existing account PNGs are preserved.

- Production TypeScript/Vite build and 6 Vitest tests passed.
- 40 Rust tests passed, including 7 new library checks: all 18 default textures, PNG limits, multiple saved skins/capes, persistence across restart, editing/deletion, legacy PNGs, and preservation of a corrupted library.
- Workspace/all-target Clippy with `-D warnings` passed.
- All 17 UI Playwright tests passed. The three skin checks passed again after the final editor-size adjustment. Coverage included adding multiple skins, changing arms/capes, applying, reloading, deleting, both themes, and 960×680 layout. In still mode, frames 750 ms apart matched; dragging changed the view.
- `scripts/native-skins-smoke.mjs` passed with real WebView2 and Rust IPC without mocks: saving two skins and a local cape, applying a slim-arm appearance, editing its name, verifying PNG/JSON on disk, restarting, and applying another wide-arm appearance. Result: `.test-data/native-skins-1791928140111/result.json`. The test used a separate application identifier and data directory; the user's launcher was not stopped.
- Screenshots: `.test-data/screenshots/skins-light.png`, `skins-dark.png`, `skins-native.png`, `skin-editor-light.png`, and `skin-editor-dark.png`.

Selecting Microsoft-owned capes and rejecting arbitrary local capes for application were checked through UI/mocks. Real authenticated skin/cape mutations in Minecraft Services were not performed. Offline skins and local capes remain launcher previews.

Windows x64 installer: `target/skins-build/release/bundle/nsis/Aurum Launcher_0.3.0_x64-setup.exe`, 6,419,400 bytes. SHA256: `BAE3929E754F5550C8934CB16D7DAC4093EB9BE21723A074AB50730B4C24D407`. The isolated build avoids overwriting an executable locked by a running launcher.

## Update: Modrinth import — Aurum 0.2.1

On October 13, 2026, import was checked against legacy JSON, the classic SQLite `profiles` schema, and the current `instances`/`instance_content_sets` schema, including JSONB and a custom data directory. Modrinth source code was not copied; only storage-format field names and structure were used.

- Production TypeScript/Vite build and 3 Vitest tests passed.
- 28 Rust tests passed, including 9 new import tests: multiple profiles, worlds/settings/disabled mods/custom folders, unchanged source SQLite databases, cancellation, partial success, malformed metadata, path traversal, and an open world on Windows.
- `clippy --workspace --all-targets -- -D warnings` passed.
- All 7 UI Playwright checks passed. The dialog was checked in both themes and at 960×680; its title and buttons remained visible, selections survived filtering, and retries after errors included only failed profiles.
- `scripts/native-modrinth-smoke.mjs` checked real WebView2/IPC: automatic discovery, selecting two test instances, import, library entries, world/settings/disabled-mod files, and unchanged originals. It used a separate test application identifier and `.test-data/native-modrinth-1791924437433`; CDP port 9233 was closed afterward. Real user instances were not imported, and synthetic mods were not launched in-game.

Release code compiled, but the normal open launcher prevented replacement of `target/release/aurum.exe`. A separate NSIS bundle was created from the compiled Cargo artifact using `tauri bundle` with `CARGO_TARGET_DIR=target/modrinth-package`. Installer: `target/modrinth-package/release/bundle/nsis/Aurum Launcher_0.2.1_x64-setup.exe`, 5,637,802 bytes. SHA256: `21797A75BBF71F8FFFDFACB546FAE543F6EE4B4B47DDFD9183555A1000987EA7`.

## Original 0.1.0 verification environment

Date: October 13, 2026. Environment: Windows x64, WebView2, Node.js 22.21, local Rust GNU 1.99, and LLVM-MinGW. All real installations used `.test-data/live`, separate from user data, with the offline profile AurenTest. The implementation is independent; third-party launchers were neither run nor copied.

### Automated checks

| Check | Result |
| --- | --- |
| TypeScript + production Vite build | Passed |
| Vitest | 3 tests passed: compatibility and search keys |
| Rust core | 18 tests passed |
| Clippy workspace / all targets / deny warnings | No warnings |
| Playwright Chromium | 3 tests passed: navigation and theme persistence, dialogs and focus, 960×680 without horizontal overflow |
| npm audit, including development dependencies | 0 detected vulnerabilities at the time of this check |
| Windows Credential Manager | Real temporary write/read/delete passed; the test secret was removed |

Rust tests cover instance isolation and recoverable world deletion, offline UUIDs, local content management, archive traversal protection, import rollback, mrpack override precedence, checksums, corrupted databases without reset, cancellation, unique operation IDs, data copying that preserves the source, Maven classifiers/extensions, loader-library inheritance, argument rules, and token redaction in logs. These verify behavior with temporary files, not availability of external services.

### Real Minecraft installation and launch

`live_smoke` retrieves actual manifests, downloads files, installs the loader and Java, starts a Java process, and waits for an OpenAL, sound-engine, or texture-atlas initialization line in the game log. It then stops the process. This confirms client startup through initialization; world creation and extended gameplay were not tested.

| Minecraft | Loader | Java | Result |
| --- | --- | --- | --- |
| 1.21.1 | Vanilla | Temurin 21 | Installation, initialization, and stop passed |
| 1.21.1 | Fabric 0.19.5 + Sodium 0.8.13 | Temurin 21 | Installation of a real compatible Modrinth project and launch passed |
| 1.21.1 | Forge 52.1.19 | Temurin 21 | Official installer, libraries, and launch passed |
| 1.21.1 | NeoForge 21.1.259 | Temurin 21 | Official installer, libraries, and launch passed |
| 1.21.1 | Quilt 0.20.0-beta.9 | Temurin 21 | Installation, initialization, and stop passed |
| 26.3 — the Mojang manifest's current release on the verification date | Vanilla | Automatically installed Temurin 25 | Downloading 5,147 assets, initialization, and stop passed |

Checks exposed and helped fix loss of Forge client/universal classifiers during library inheritance and a NeoForge module conflict caused by the client JAR name. The regression test preserves both classifiers; the client JAR is published under the installed version's name. Quilt logs an unavailable telemetry-beacon warning, and the offline client logs Realms authentication warnings. Neither prevented initialization.

### Real desktop window

`scripts/native-smoke.mjs` passed on the final `target/release/auren.exe`. It controls Tauri WebView2 through local CDP and invokes real Rust commands, without mocked IPC or API responses. Checks covered:

- State and offline-account loading.
- Real Modrinth search for Sodium and project details.
- Instance creation through the UI.
- Minecraft 1.21.1 installation and launch through the interface.
- Stopping the game process through the UI.
- 3D canvas and the accounts screen.
- Persistence of light/dark theme settings.
- Deleting the test instance.
- No JavaScript errors in the checked scenario.

Results are written to `.test-data/native-smoke-result.json`. `.test-data/screenshots/native-*.png` were captured from the actual window using test profiles, not prefilled user data. `.test-data/screenshots/light.png`, `dark.png`, and `settings.png` show browser preview without a native backend.

`scripts/native-content-smoke.mjs` also passed on the release app: installing real Iris 1.8.8 with required Sodium in a clean instance, updating to the latest compatible version, disabling/enabling, removal, and rejecting a Fabric mod in Vanilla. Files were genuinely downloaded and SHA1-verified. This confirms content management; gameplay with Iris was not tested. Result: `.test-data/native-content-result.json`.

A separate Rust test verified uploading a PNG skin with the Alex model and retaining it after an Engine restart. Corrupted PNGs and invalid dimensions are rejected while preserving the previously saved skin.

### Release artifacts

Production Rust/Tauri build and NSIS generation succeeded. Installer: `target/release/bundle/nsis/Auren_0.1.0_x64-setup.exe` (approximately 4.05 MiB).

SHA256: `EAEDA8549612E0065B7DBC3DC3208D2F36E6ED90A2EA8CAE3A736BC806F0F6D6`.

After the initial window-position fix, the release was rebuilt and launched. Win32 checks measured a center offset from the monitor's work area of 0 px horizontally and 3.5 px vertically (window frame). `center: true` applies on every window creation regardless of its previous position.

The release executable ran with the normal system PATH, without Rust/MinGW directories. A second instance exited while the first continued; concurrent native instances are not permitted. The app and local CDP were closed after testing. Keep `WebView2Loader.dll` alongside the executable when distributing without an installer.

### Remaining verification

At this stage, Microsoft device flow, refresh, entitlement checks, and skin upload were implemented, but a complete successful flow required a registered OAuth Client ID with Minecraft Services access and an account owning the game. Those credentials were not supplied, and another application's Client ID was not used. The Windows vault check was separate and did not confirm Microsoft sign-in. Subsequent OAuth updates are recorded below.

CurseForge uses its official API and stores its key in the OS credential vault. Requests, installation, and dependencies with a real key were not verified because no key was supplied. A missing download URL is handled as a distribution restriction; URLs are not guessed.

Not verified: macOS/Linux, every historical Minecraft/loader version, complete real third-party mrpack/CurseForge modpacks, large sets of conflicting mods, extended gameplay, and multiplayer. mrpack import and ZIP safety used temporary local archives. Offline skins are previews only and are not automatically applied in Vanilla.

The release has no publisher signature. Generating an NSIS package does not verify installation/removal on a clean Windows machine; that requires a separate machine. The 3D preview bundle loads when opening accounts and produces Vite's chunk-size warning above 500 kB; the main app is separated from Three.js.

### Reproduction

Main commands are in the README. Additional checks:

```powershell
./scripts/cargo.ps1 -CargoArguments @('run','-p','auren-core','--example','live_smoke','--','vanilla','latest')
./scripts/cargo.ps1 -CargoArguments @('run','-p','auren-core','--example','vault_smoke')
```

Run real smoke tests using `.test-data/live` sequentially: the standalone core example does not share the native application's instance lock. Normal Auren permits one application instance. CDP is disabled during normal launch; close the test app and local port afterward.

## Microsoft sign-in — October 14, 2026

Device Code Flow was replaced with Authorization Code and PKCE, using an automatic localhost return from the system browser. The owner's Client ID was embedded in the build; player configuration fields and manual code entry were removed. The interface shares the home pattern and displays phases, cancellation, errors, retry, and successful connection.

Checks passed: 4 OAuth tests (the independent RFC 7636 PKCE vector, state/path/ambiguous-parameter validation, a real local HTTP callback rejecting unrelated sessions, cancellation and timeout), 19 existing core tests, 9 import tests, 3 frontend tests, `cargo check --workspace`, and `clippy --workspace --all-targets -- -D warnings`. Six Playwright tests cover success with automatic account selection, denial/cancellation, a fresh retry session, browser errors, no Client ID in settings, and the full dialog at 960×680 in both themes. Screenshots: `.test-data/screenshots/microsoft-*.png`.

Automated checks do not confirm real Microsoft sign-in or the registered application's Minecraft Services access. Entra needs a native `http://localhost` redirect, and an owner of Minecraft Java needs to sign in. See [MICROSOFT-LOGIN.md](MICROSOFT-LOGIN.md).

## Embedded Microsoft window — October 14, 2026

Sign-in now opens in an owned WebView2 window inside Aurum. The `http://localhost` native redirect and PKCE remain. A valid response closes the window; closing it manually cancels sign-in. Launcher RPC, external windows, and downloads are blocked for this remote window. Only Microsoft identity hosts and the current-port callback are allowed.

Allowed/spoofed-address unit checks, six UI scenarios, TypeScript, `cargo check`, and Clippy passed. A real isolated Tauri/WebView2 smoke confirmed creation, focus restoration, close/cancellation, and no added accounts. Credentials were not entered; complete Microsoft/Minecraft sign-in remains a separate manual check.

## Installation on creation and instance folders — October 14, 2026

Creating an instance through the UI now immediately installs Minecraft, the selected loader, and suitable Java. The instance is saved before downloading and remains available after an error or cancellation. **Folder** works during installation. The native command first creates a missing directory and normalizes its path for File Explorer. The import menu's Modrinth logo uses `currentColor` and the active theme.

Checks passed: 21 core tests, TypeScript, Clippy, five UI creation/error/cancellation/theme scenarios, and three Modrinth import scenarios. The isolated `scripts/native-profile-creation-smoke.mjs` on real WebView2 confirmed recreating an old empty instance's folder, opening a path containing spaces and Cyrillic, automatic UI-triggered installation, opening the folder during download, and retaining the instance after cancellation without launching the game. The full download was intentionally cancelled; the existing installer was unchanged for that check.

## Public build 0.3.1 — October 14, 2026

Before publication, the current source was built into the production application and NSIS installer with `scripts/desktop.ps1 -Mode build`. Checks passed:

- TypeScript and Vite production build.
- 6 frontend Vitest tests and 26 UI Playwright scenarios.
- 50 Rust workspace tests, including 3 process-restoration scenarios with `AURUM_PROCESS_TEST_JAVA` and `--include-ignored`. Java fixtures were isolated from user instances.
- `clippy --workspace --all-targets -- -D warnings`.
- README links, exclusion of local instructions/data/build output from Git's index, and a history check for common private-key and token formats.

Release `v0.3.1` artifact: `Aurum-Launcher_x64-setup.exe`, **6,462,111 bytes** (6.16 MiB). SHA256:

```text
03c8e98dbfb29227b340c67428c91de583e2957a1db5722879d9677865e6fcf3
```

The installer and `SHA256SUMS.txt` are published in GitHub Releases, separate from the source tree. There is no publisher signature. Successful build verification does not confirm clean-Windows installation/removal or complete Microsoft/Minecraft sign-in.

## Signed launcher updates — Aurum 0.3.2, October 14, 2026

The official Tauri updater is configured for GitHub Releases. Production clients check at startup and every six hours; Settings offers manual checks. Updates use a download-then-install sequence so failed native signature verification cannot start the installer. Running games and current operations block installation, and failed resources are discarded before retries.

Checks passed:

- Production TypeScript/Vite build and a local signed Windows NSIS build.
- 11 Vitest tests, including release-version consistency, signature-version binding, missing signatures, ambiguous installer selection, immutable manifest URLs, and checksums.
- All 30 Playwright UI checks. Four updater scenarios cover postponement, progress, restart options, network/signature failures and retry, current-version results, running-game blocking, and both themes at 960×680.
- All 50 Rust workspace tests, including the three isolated Java process-recovery fixtures, and workspace/all-target Clippy with `-D warnings`.
- `scripts/native-updater-smoke.mjs` through real WebView2 and native updater commands: ignoring the current version, downloading a valid signed installer, rejecting a modified installer, rejecting a manifest version that differs from the signed version, and observing the automatic startup check. The diagnostic client used a separate identifier, a test version of 0.3.1, an owned data directory, and a loopback manifest. It did **not** execute the installer or modify user game data. The diagnostic HTTP configuration stays in ignored `.test-data/`; production uses HTTPS.

The release workflow builds version tags, signs installers using a repository Actions secret, generates `latest.json`, and uploads all assets to a draft before publishing. Private signing material is excluded from Git. See [UPDATES.md](UPDATES.md) for publication and key-backup requirements.

Windows installer execution and clean-machine installation/removal remain separate checks. Updater signatures do not provide an Authenticode publisher certificate. Version 0.3.1 requires a one-time manual installation of the public 0.3.3 release to enable future updates.


## Public updater release 0.3.3 — October 14, 2026

The first public updater-enabled release is [v0.3.3](https://github.com/d3ede/aurum-launcher/releases/tag/v0.3.3). The 0.3.2 source tag was retained, but its release attempt stopped on stale npm metadata for `tinyglobby` and `@floating-ui/utils`. The corrected metadata has the same integrity hashes as the actual packages used locally. A fresh `npm ci` succeeded after correction.

[GitHub Actions](https://github.com/d3ede/aurum-launcher/actions/runs/38488520874) completed successfully: production frontend build, 11 Vitest checks, 47 regular Rust tests (the three JDK-dependent process fixtures are ignored in CI), Clippy, all 30 UI checks, signed NSIS packaging, manifest generation, and publication. Hosted Windows UI checks run sequentially with longer rendering timeouts; no assertions were removed. The application source is the immutable `v0.3.3` tag; subsequent main-branch changes only adjust CI and documentation.

Published assets: `Aurum-Launcher_x64-setup.exe`, `Aurum-Launcher_x64-setup.exe.sig`, `latest.json`, and `SHA256SUMS.txt`. Installer size: **6,767,872 bytes**. SHA256:

```text
8bf74bf56dc4197d8c3f4d673c9f656e82a40a58451b81a2cd87d285f7a1d6d2
```

Public downloads were compared against the GitHub asset digests and checksum file. The public manifest's version, immutable installer URL, and signature matched the release assets. A real WebView2/native updater client using the production HTTPS endpoint offered 0.3.3 and downloaded the public installer with successful signature verification. That diagnostic client had a separate identifier/data directory, simulated an older version, and explicitly lacked installation permission; the installer was not executed and user data was not modified.

## Encrypted session storage — October 17, 2026

Full credential records now use AES-256-GCM files under the local application data directory. The OS vault stores a fixed 96-character key/reference instead of the token JSON. Ten isolated tests cover large records, legacy migration, key rotation, deletion, failed writes, missing/corrupt files, wrong keys, account swaps and reference validation. Test files stay under `.test-data/`.

A separate real Windows Credential Manager test migrated a synthetic legacy record, saved and read a 23,552-byte synthetic session using a 96-character vault entry, replaced the session and deleted the temporary entry and encrypted files. This test passed outside the sandbox; Windows denies vault writes inside it (error 5). No real account credentials were used.

Checks passed: 89 regular Rust workspace tests, the separate native vault test, workspace/all-target Clippy with `-D warnings`, Rust formatting, 13 frontend tests, the TypeScript/Vite production build and formatting of the changed frontend files. Existing loopback HTTP/OAuth tests needed execution outside the sandbox because its socket policy returns Windows error 10013. Live catalog and Java recovery fixtures remained ignored. Complete Microsoft/Minecraft sign-in with a real account remains a manual check.

To repeat the native storage check:

```powershell
./scripts/cargo.ps1 -CargoArguments @('test','-p','auren-core','windows_vault_large_secret_round_trip','--lib','--','--ignored')
```

## Local Windows installer 0.4.2 — October 17, 2026

Built the production application with `scripts/desktop.ps1 -Mode build` and completed packaging with `-Mode bundle` after allowing the official NSIS tool download. The application and installer both report version 0.4.2. The release binary contains the new encrypted storage implementation and the NSIS bundle marker. The installer signature and its version-bound trusted comment were independently verified against the configured updater public key. All 13 frontend tests and both home-page Playwright checks passed, including Russian/English notes and both themes.

Local installer: `Aurum-Launcher-Setup.exe`, 7,106,370 bytes (6.78 MiB). SHA256: `9b332c61f99ad156229f96b060da7a7cae15d6cf0d093fe2063c05a5665178f6`.

The signed installer, signature, update manifest and checksums are also staged locally under `.release-local/v0.4.2/`. This build was not installed or published.

## Account heads and reused sign-in window — October 17, 2026

Account heads now composite the face and outer layer of the skin on an 8×8 canvas in the header, Home panel and account list. Microsoft skin textures use a local 24-hour cache; applying a skin updates the cache immediately. Bundled heads remain visible while loading or offline. Concurrent components sharing an account snapshot reuse the same request. Added pixel checks cover the outer layer, account changes, skin updates and fallback in both themes; Rust checks cover local skin changes, restart and cached Microsoft textures without credentials or network requests.

The Microsoft window is prepared hidden with `about:blank` after startup, then reused for fresh PKCE attempts. A real isolated WebView2 run confirmed focus restoration, native close and UI cancellation, a new operation on retry, reuse of the same window, zero added accounts and process exit when the main window closes. Retry reached the displayed-window waiting phase in 65 ms on this machine; this measures window opening, not Microsoft page download or completed authentication. Idle navigation and stale callback ports are rejected by unit tests.

Checks passed: 92 regular Rust workspace tests, workspace/all-target Clippy, 13 frontend tests, all 66 Playwright scenarios and the signed production NSIS build. The rebuilt 0.4.2 installer is 7,131,011 bytes; SHA256: `090f14c88c1a1d2088a86b72fbe0d74d69a3c57c25b664c1f69750be70c2e4b4`. Its updater signature and signed version comment were verified against the configured public key. The normal bundler restores its unpatched build executable after packaging; installed-payload verification accounts for the NSIS marker patch.

This build was installed over an existing registered 0.4.1 installation and restarted. The uninstall registry and installed executable both report 0.4.2, and the installed executable matches the expected packaged payload byte-for-byte.

### Head scaling and frames

Replaced fractional stretching of the 8×8 head into 33/45/60 CSS pixels with a consistent 32-pixel head, rendered to a backing canvas at the current display scale. Header frames are 36 pixels; Home and account-list frames are 40 pixels. Thin theme-aware borders, inset contrast, rounded corners and a soft shadow distinguish dark skins from the interface. Account refreshes retain the previous head until the replacement loads.

Pixel and geometry checks passed at display scales 100%, 125%, 150%, 175% and 200%, with screenshots in both themes. Nine targeted UI checks, 13 frontend tests, TypeScript, formatting and the signed production build passed. The refined installer is 7,131,069 bytes; SHA256: `2b4f0ae30ceb7c53f0529ff0be77f829f29f410a3143a37d65e9a1d5c4786e0f`. Its signature was verified, the user's installed 0.4.2 was refreshed and restarted, and its executable matched the packaged payload.

The Home card subsequently received a larger head targeting 40 CSS pixels inside a 48-pixel frame. Its backing size snaps to whole eight-pixel multiples at the current display scale. Header heads remain 32 pixels in 36-pixel frames; account-list sizes are unchanged. All nine targeted avatar/Home checks pass, including the five display scales and the minimum window size.

The rebuilt installer is 7,130,517 bytes; SHA256: `5a265864cec6c92a30a0aa5160bd820c28c6b297cea132be3b3031b5cc75400e`. Its signature was verified and it was installed over the user's existing 0.4.2, with payload verification and restart.

### Publication preflight

The final local release source, including the independently committed fixed skin preview controls, passed all 73 Playwright scenarios, 13 frontend unit tests, Rust formatting and Git whitespace checks. Earlier Rust, Clippy, native storage and WebView2 checks remain applicable to the unchanged backend. Publication uses the version-tag workflow to build, sign and publish the installer, updater manifest and checksums from the exact tagged source.

## Public release 0.4.2 — October 17, 2026

Release [v0.4.2](https://github.com/d3ede/aurum-launcher/releases/tag/v0.4.2) is published as the latest stable release from source commit `61abf23c77e63dbab16088b9d2ad93aa0b4e5775`. The [Windows release workflow](https://github.com/d3ede/aurum-launcher/actions/runs/39034213293) passed frontend/native checks, all 73 UI scenarios, the signed installer build and installer regression checks before publishing all four update assets.

The public latest-release URLs were downloaded and compared with GitHub asset digests and `SHA256SUMS.txt`. The update manifest reports 0.4.2, uses the immutable version-specific installer URL and matches the detached signature asset. Public installer size: 7,202,120 bytes. SHA256: `cbaeee16e6cb8ff5b8ee0852403831efebc6ee4d11d908fd2954522376570669`.

A separate real WebView2/native updater client, configured with an older application version and isolated test data, received 0.4.2 from the production HTTPS endpoint and downloaded its installer with successful native signature verification. Installation permission was denied in that diagnostic client; it did not execute the installer or modify user game data. The version tag remains on the application source; this publication verification is a subsequent documentation-only commit.

## Public release 0.4.3 — October 17, 2026

Release [v0.4.3](https://github.com/d3ede/aurum-launcher/releases/tag/v0.4.3) is published as the latest stable release from source commit `aa6e16a281d73f76cf4d394e15ac9e9f21a5f6fb`. The [Windows release workflow](https://github.com/d3ede/aurum-launcher/actions/runs/39056602623) passed frontend/native checks, all 97 UI scenarios, the signed installer build and installer regression checks before publishing all four update assets.

This release adds local hosting, one-card proxy networks, recent-server history and cached launch preparation. Velocity player tracking now parses the complete logger prefix before adding component labels. Backend transfers do not remove players from the network roster. Bounded partial-line buffering preserves split log events; the interface distinguishes an online count with unavailable names from zero online players.

Local checks passed: production frontend build, 15 frontend unit tests, regular Rust workspace tests, all-target Clippy, formatting, 20 targeted Home/Hosting UI scenarios, two isolated Java/PowerShell network-process fixtures, 17 installer-path cases, 16 installer-language cases, close-button rendering and eight shortcut cases. Process fixtures use only temporary `.test-data` servers, not the user's Minecraft server. No instant Minecraft or mod startup guarantee is made.

The public `releases/latest/download/` URLs were downloaded and checked against GitHub asset digests and `SHA256SUMS.txt`. The manifest reports 0.4.3, points to its immutable version-specific installer URL and matches the detached signature asset. Independent Ed25519/minisign verification passed for the installer and its trusted version comment using the production updater public key. The downloaded Windows installer also reports product version 0.4.3.

Public installer size: 8,251,490 bytes. SHA256: `ac5f7f41feb5ed2a8d349ea27a071897672cb7dc33a830b5ae37f19683288d55`.

The public installer was not executed during this publication check, and the installed launcher and real server processes were not changed. The local `Aurum-Launcher-Setup.exe` copy now contains the verified public installer. The version tag remains on the application source; this publication record is a subsequent documentation-only commit.

## Public release 0.4.4 — October 20, 2026

Release [v0.4.4](https://github.com/d3ede/aurum-launcher/releases/tag/v0.4.4) is published as the latest stable release from source commit `d8ba4248aec098cd7fdf9cb8bb3f6b40346ab562`. The [Windows release workflow](https://github.com/d3ede/aurum-launcher/actions/runs/39459937581) passed frontend/native checks, all 105 UI scenarios, the signed installer build and installer regression checks before publishing all four update assets.

This release includes persistent custom instance ordering, CurseForge imports that retain the instance when individual downloads require manual handling, named modpack installation progress and the Windows PowerShell installer separator fix. The four feature/fix commits and the release preparation commit are pushed to `main`; the version tag remains on the application source.

Local checks passed: production frontend build, 19 frontend unit tests, regular Rust workspace tests, all-target Clippy, formatting and 14 targeted Home, ordering, pack-catalog and manual-download UI scenarios. Installer checks passed 17 path cases, 16 language cases, close-button rendering and eight shortcut cases. Manual-download scenarios use fixtures; this does not claim compatibility with every third-party pack or remove the official CurseForge API-key requirement.

The public `releases/latest/download/` URLs were downloaded and verified against GitHub asset digests and `SHA256SUMS.txt`. The manifest reports 0.4.4, points to the immutable version-specific installer URL and matches the detached signature asset. Independent Ed25519/minisign verification passed for the installer and its version-bound trusted comment using the production updater public key. The downloaded installer also reports product version 0.4.4.

Public installer size: 8,267,978 bytes. SHA256: `1c78a785f540ddd059fa7b31eed7357cb4c176b0f80ebe656200b38636fe9c84`.

The public installer was not executed during publication verification. The installed launcher, real server processes and user game data were not changed. The ignored local `Aurum-Launcher-Setup.exe` copy contains the verified public installer. This publication record is a subsequent documentation-only commit.

## Public release 0.4.5 — October 20, 2026

Release [v0.4.5](https://github.com/d3ede/aurum-launcher/releases/tag/v0.4.5) is published as the latest stable release from source commit `2d84b2a356564745c83571b98f06cb866e63f516`. The [Windows release workflow](https://github.com/d3ede/aurum-launcher/actions/runs/39481250088) passed frontend/native checks, all 109 UI scenarios, the signed installer build and installer regression checks before publishing all four update assets.

This release includes compact horizontal instance cards, shared flowing background lines, animated pointer dragging, card action menus and locally bundled circular language icons. The eight accumulated UI commits and the release preparation commit are pushed to `main`; the version tag remains on the application source. Existing language-icon MIT licensing and attribution are retained.

Local checks passed: production frontend build, 19 frontend unit tests, regular Rust workspace tests, all-target Clippy, formatting and 10 targeted Home, language-picker and instance-library UI scenarios. Installer checks passed 17 path cases, 16 language cases, close-button rendering and eight shortcut cases. UI tests cover opening cards separately from launch/stop controls, custom ordering, keyboard controls, menu actions, delete confirmation, running-instance restrictions, both themes and continuous background geometry.

The public `releases/latest/download/` URLs were downloaded and checked against GitHub asset digests and `SHA256SUMS.txt`. The manifest reports 0.4.5, uses the immutable version-specific installer URL and matches the detached signature asset. Independent Ed25519/minisign verification passed for the installer and its version-bound trusted comment using the production updater public key. The downloaded installer also reports product version 0.4.5.

Public installer size: 8,280,763 bytes. SHA256: `1a565025628506cc07fe2539c3797a2fbd1c8a0ad838b6a8e5608ef8cc037757`.

The public installer was not executed during this publication check. The installed launcher, real server processes and user game data were not changed. The ignored local `Aurum-Launcher-Setup.exe` copy contains the verified public installer. This record is a subsequent documentation-only commit.
