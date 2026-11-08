# Minecraft settings profiles

Settings → Game settings stores up to five local presets. Importing from an
instance copies its UTF-8 `options.txt`; it does not link files or edit the source.
Close Minecraft before importing so that its latest settings have been written.

Each preset has six transfer categories: graphics, field of view, controls,
mouse, sounds, and interface/language. Category dialogs edit the saved copy.
Changes are committed with **Save profile**. Unfinished edits survive navigation
within the current launcher session. Deleting a preset does not change instances
that already used it.

New instances, catalog modpacks, favorites batches, archive imports, folder
imports and Modrinth imports offer **Use my settings** and one preset selector.
Only categories enabled in that preset are applied, once after installation or
import. Settings edited later in Minecraft remain local to that instance.
Existing instances can also apply a preset from Game settings.

## Compatibility and recovery

- Presets retain the source Minecraft version and full original options text.
  Application merges an allowlist of recognized vanilla options. It never
  copies the source `version`, resource-pack selection, server addresses, sound
  devices, renderer backend, or arbitrary mod options and key bindings.
- Release checks skip options unavailable in the target version. Named GLFW
  bindings and recognized LWJGL 2 codes are converted in either direction.
  Unrecognized keys and Forge/NeoForge modifier suffixes are skipped instead of
  silently assigning another key. The LWJGL scan codes follow the
  [LWJGL keyboard definitions](https://github.com/LWJGL/lwjgl/blob/master/src/java/org/lwjgl/input/Keyboard.java).
- New `options.txt` files use the installed client's `version.json` data version
  when available. Unversioned files use legacy key codes for Minecraft's own
  migration, avoiding a second conversion of already named keys.
- Graphics format changes, including
  [Minecraft 1.21.11 presets](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-11),
  are handled separately. Some cloud and ambient-occlusion formats cannot be
  translated without target evidence and are skipped. Snapshots and prereleases
  only accept a preset from the exact same version. This is a conservative
  compatibility policy, not a guarantee that every historical or future option
  is portable.
- The original existing `options.txt` is saved as `options.aurum-backup.txt`
  before its first application. Subsequent applications preserve this recovery
  point. **Restore original settings** consumes that backup. If there was no
  original file, there is no original-settings backup to restore.
- Application and restoration refuse running instances and conflicting
  operations. Updates publish the completed file through a temporary sibling.
  An application failure after a modpack has been published reports a warning
  without turning a successful import into a duplicate-producing retry.

Presets are part of the launcher's `state.json` database. There is no account
cloud synchronization and no shared or continuously overwritten instance file.
