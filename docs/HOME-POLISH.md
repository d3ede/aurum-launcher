# Home screen: Aurum 0.3.1

Popular-project cards now display two complete lines of description. Previously, the text area was 27 px high with a 21 px line height, leaving only fragments of the second line visible. A height of `3em` fits both lines; longer descriptions end with an ellipsis.

A green **Import** button was added to the home screen, to the left of **New instance**. It offers the same three options as the library: Modrinth App, `.mrpack`/ZIP, and an existing game folder. Home and library share `ImportProfileButton`, including operation locking, outside-click dismissal, and Escape handling. Colors are configured separately for light and dark themes.

The built interface was checked with four long descriptions, exactly 42 px for two lines, no overlap with download counts, both themes, button placement/colors, and the Modrinth/folder dialogs. There is no horizontal overflow at the minimum width of 960 px. The existing three Modrinth import scenarios passed.

Real WebView2 and Rust IPC checks also passed: four projects from Modrinth, two complete description lines, correct button placement, and both dialogs opening. No JavaScript errors occurred. After verification, the normal launcher was opened with user data and its window centered.

![Corrected cards and import button in the dark theme](screenshots/home-polish-dark.png)

![Project cards in the desktop app](screenshots/home-descriptions-native.png)
