# Aurum architecture

The native application permits one running instance using Tauri's [Single Instance plugin](https://v2.tauri.app/plugin/single-instance/), so separate windows cannot overwrite the same in-memory database. Standalone core examples are developer utilities and must run sequentially against a shared test root. Data relocation copies into a separate empty directory, retains the source, and selects the destination only after successful completion and restart.

Independent implementation. No third-party launcher code or artwork is used.

`src/`: Russian React UI, typed IPC, theme tokens, catalog, profiles, accounts, settings.
`crates/auren-core/`: platform-independent service library. Persistence, verified transfers, Minecraft metadata, loader installers, Java runtime, process supervision, OAuth, OS credential vault, catalog adapters and archive import.
`src-tauri/`: small native bridge. Dialogs return paths to Rust; the webview has no general filesystem or shell permissions.

Game data defaults to the OS application data directory. Shared assets/libraries/runtime cache are separate from UUID-named isolated instances. Metadata and profile changes are persisted atomically. Credentials are stored in the OS vault, never in profile JSON. One mutating network task at a time prevents shared-cache races. Installation publishes a completed manifest only after every required download succeeds. Cancellation preserves verified cache entries, removes partial files, and never marks a partial installation ready.

Native operations emit progress/log events. The UI never fabricates catalog entries, profiles, installation progress or launch success. Browser mode only persists appearance preferences and provides an explicitly labelled native-runtime unavailable state.

Public specifications used: Tauri 2 configuration and commands (https://v2.tauri.app/), Mojang version metadata (https://piston-meta.mojang.com/mc/game/version_manifest_v2.json), Fabric Meta (https://meta.fabricmc.net/), Quilt Meta (https://meta.quiltmc.org/), Forge/NeoForge Maven installer artifacts, Modrinth API (https://docs.modrinth.com/api/), CurseForge API (https://docs.curseforge.com/rest-api/), Microsoft device OAuth (https://learn.microsoft.com/entra/identity-platform/v2-oauth2-device-code), Eclipse Adoptium API (https://api.adoptium.net/).

No final project license has been selected. Dependency and downloaded-content licenses remain applicable. User skins stay local for offline accounts. A Minecraft account token is required for authenticated multiplayer; offline identities do not bypass server authentication.
