# Catalog favorites

Use the star on a catalog result or project page to save a mod, modpack, shader
or resource pack. The star beside the catalog view controls opens the full list
and shows its size. Projects from different sources keep their original source
and do not overwrite each other. Up to 200 projects can be saved.

Favorites remain after installation. The list is local to the launcher webview
and scoped to the active data directory; it is not a cloud account feature.

Choose an instance for mods, shaders and resource packs. Aurum checks its
Minecraft version, loader and engine, and initially selects the latest compatible
project version. Each row also lets you choose another compatible version. A
running instance cannot be changed. Horizon mods install source code and still
need the existing explicit compilation step before playing.

Install one row, or check rows and use **Install selected**. All projects start
selected; incompatible projects are skipped. **Clear favorites**, beside
**Check again**, removes only checked projects after confirmation. Cancelling
keeps the list unchanged; clearing favorites leaves installed files in place.
Modpacks create separate instances. For platform packs,
expand the installation options to select optional mods and required files from
the publisher's website. Restrictions on automatic downloads are unchanged.
Incomplete pack imports keep their normal manual-file recovery flow, accessible
with **Show files** in favorites.

Installation runs sequentially. An earlier project's newly installed dependencies
are recognized before processing later rows. An individual failure stays visible
without preventing the remaining projects from installing. Stop the queue to
cancel the current operation and prevent the next item from starting; completed
installations remain. Installed content and pack receipts prevent duplicate
installation into the same existing targets when reopening favorites.
