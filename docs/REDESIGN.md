# Aurum Launcher 0.2.0

Update dated October 13, 2026. The full product name is Aurum Launcher; the short interface name is Aurum.

## Changes

- Bundled Inter Variable, 15 px body text, tighter labels, and more legible secondary text.
- A shared application toolbar with custom window controls replaces the system title bar above a separate web page. Centering on every launch is retained.
- Marketing headlines, slogans, a decorative sidebar panel, and redundant badges were removed. Home contains quick launch, instances, and actual popular projects.
- The block-style SVG landscape was replaced with a quiet abstract contour-line pattern.
- Instances open on a dedicated screen with installed-file search, content types, update/disable/remove actions, and a separate **Find projects** button.
- An instance with default settings can be created in two clicks. Choose one of four icons or upload PNG/JPEG/WebP. The image is normalized to 128×128 PNG and saved with instance data, so the original image can be moved.
- Catalog filters include source, content type, game version, loader, category, and sorting. Categories and versions come from official APIs. Opening the catalog from an instance selects compatible filters. Search results offer one-click installation with required dependencies.
- Vanilla instances explain that mods need a loader and offer a route to resource packs.

## Data compatibility

The `app.auren.launcher` system identifier and Credential Manager service are intentionally preserved. Existing paths, settings, accounts, and instances require no migration. The new `icon` field is optional when reading older JSON. `AURUM_DATA_DIR` takes precedence; `AUREN_DATA_DIR` remains supported. The source directory and internal `auren-core` crate name did not change.

## Verified

- Production TypeScript/Vite and Windows x64 Tauri/NSIS builds.
- Clippy for the whole workspace and all targets with `-D warnings`.
- 19 Rust tests, including icon normalization/persistence, rejection of corrupted images, and loading older instances without the new field.
- 3 Vitest tests and 3 browser Playwright checks: navigation, themes, dialog focus, explicit unavailability of game features in browser preview, and 960×680 layout.
- Real release WebView2 and IPC with isolated `.test-data/`: maximize/restore/close, creating an instance without typing a name, choosing an icon, saving a custom PNG, the dedicated instance screen, carrying resource-pack type and game/loader filters into the catalog, official categories and sorting, one-click Sodium installation in Fabric 1.21.1, and no horizontal catalog overflow at 960 px.
- Installing and launching Minecraft 1.21.1 from the new UI, stopping its process, 3D previews, both themes, and deleting the test instance.
- Real Iris/Sodium: required dependency, version update, disabling, removal, and rejection in an incompatible Vanilla instance.
- Two consecutive launches: the main HWND was visible and responsive. The actual outer frame `[312,101,1608,930]` was centered in work area `[0,0,1920,1032]` within one pixel. `scripts/verify-window.ps1` waits for the main window and excludes the auxiliary single-instance window. Centering occurs after frame creation and before showing the interface.

Commands: `scripts/native-redesign.mjs`, `scripts/native-smoke.mjs`, and `scripts/native-content-smoke.mjs`. CDP is enabled only for the test instance on local port 9227. Normal launch uses the embedded interface and the user's data directory without CDP.

Screenshots: [home](screenshots/native-light.png), [dark theme](screenshots/native-dark.png), [catalog](screenshots/native-catalog.png), and [instance screen](screenshots/native-instance.png). Test account and instance names belong only to isolated verification.

Earlier checks of all five loaders and Microsoft/CurseForge limitations are in [VERIFICATION.md](VERIFICATION.md). Complete Microsoft sign-in and CurseForge with a real API key were not confirmed in this update. The native file picker is connected to icon normalization; automated checks cover normalization and IPC persistence, not control of the system dialog.

## Artifacts

- `target/release/aurum.exe` and `WebView2Loader.dll` for running without installation.
- `target/release/bundle/nsis/Aurum Launcher_0.2.0_x64-setup.exe`.

Installer SHA256: `825B81F57ABF3E8148FF8DE66849FB6377A4E488D974C18EE31AE734D608C526`.
