# Aurum Launcher 0.2.1 — controls and previews

Interface update dated October 13, 2026.

- The top search field fills the available toolbar width, up to 640 px, and is 44 px tall instead of 36 px. Hover and focus highlight the field. Its width adapts at the minimum window size.
- The Enter button is a fixed 26×26 px square that cannot shrink and keeps its symbol centered. Clicking it and pressing Enter submit the same search form; hover and pressed states were added. Release WebView2 checks confirmed the dimensions, a Sodium search by clicking, and an Iris search by keyboard using the real Modrinth API.
- Projects appear on the left and filters on the right. DOM order matches the visual layout. The selected instance's game/loader filters and one-click installation are retained.
- All dropdowns share styling through Radix Select: hover, selection, and open states; a checkmark for the active item; a rotating arrow; opening/closing transitions; viewport bounds; and scrolling for long lists.
- Keyboard navigation, type-ahead, Home/End, Enter, and Escape are supported, with focus returning to the trigger. Escape first closes an open dropdown while preserving its parent dialog. Clicking outside closes the menu.
- Buttons, tabs, cards, icons, and links have appropriate cursors and short hover/pressed feedback; dialogs animate into view. The system's reduced-motion preference is respected.
- The generated 64×64 placeholder was replaced with original Steve/Alex textures from official Minecraft 1.21.1. They are bundled locally and work without a network connection. Classic/slim models use matching textures; uploaded user skins take precedence. See [skin asset provenance](../src/assets/skins/README.md).
- The user-requested removal of the local offline-skin notice also removed the repeated explanation in the adjacent panel. The technical limitation remains in project documentation; in-game skin behavior did not change.

## Verification

Production TypeScript/Vite build, Vitest (3 tests), and Playwright (4 checks). The new check covers keyboard menus, focus restoration, outside-click dismissal, Escape within a parent dialog, right-side filters, 960×680 layout, and rendering both original models.

Real Tauri WebView2 checks cover instance creation, selecting Minecraft in the new dropdown, installing and launching the game, compatible filters, category/sort selection, and adding Sodium. Centering and existing user data are preserved.

Screenshots: [Steve](screenshots/steve.png), [Alex](screenshots/alex.png), [light dropdown](screenshots/dropdown-light.png), [dark dropdown](screenshots/dropdown-dark.png), and [desktop catalog](screenshots/native-catalog.png).

Installer: `target/release/bundle/nsis/Aurum Launcher_0.2.1_x64-setup.exe`.

SHA256: `A12C20957CA59160D419460B789DDFF1D318A572E291F69E2620966032E86DF5`.
