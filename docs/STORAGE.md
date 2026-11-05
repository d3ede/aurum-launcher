# Storage and removal

These storage and removal controls are included in Aurum 0.5.5.

## Disk usage

The launcher executable is only the application. Minecraft assets, libraries and
versions are shared between Aurum instances. Each instance has its own mods,
worlds, screenshots and mod-generated data. Java runtimes and game data may take
several gigabytes even when the executable is small.

Aurum first reuses its working managed Java for the requested major version.
If that runtime is absent, it checks JAVA_HOME, JDK_HOME, PATH and common Windows
Java installation directories. Automatic discovery requires the exact major and
matching architecture. A newer major is not treated as interchangeable. Explicit
Java settings continue to be respected. If no compatible runtime is available,
Aurum downloads its managed runtime.

After successful extraction and executable verification, the Java ZIP is removed.
Startup also removes leftover `runtimes/java-N.zip` archives only when the matching
extracted Java still works. Broken/incomplete runtime archives, game assets,
libraries and user content are retained. Cleanup does not require internet access.

## Import copies

Import creates a separate copy and keeps the original by default. The dialog
explains the additional disk use. An unchecked option allows sending the original
to the Windows Recycle Bin after a successful import and SHA-256 verification of
the copied content. Changed originals, failed copies and cancellation preserve the
source. Disposal errors are reported separately from an already completed import.
The original's space is reclaimed only after the user empties the Windows Recycle Bin.

When disposing a folder import's original, all of its files are copied, including
files outside the normal mods/worlds/settings selection. Originals containing
links require manual disposal. Modrinth's launcher metadata, session locks and logs
remain excluded from the imported instance.

## Uninstall

Use **Settings → Files and versions → Uninstall Aurum**, search for **Aurum Launcher
Uninstall** in Start, or use **Windows Settings → Apps → Installed apps → Aurum
Launcher → Uninstall**. Start links are installed unless `/NS` was requested.

The uninstaller uses the same presentation as setup. Its data-deletion checkbox is
unchecked. Removing only the application preserves instances, worlds and other
game data. Selecting the checkbox permanently deletes launcher-owned data in the
listed registered roots, including custom data locations used by this installation,
plus its application configuration and credentials. An update or silent uninstall
does not opt into data deletion.

Data ownership and directory boundaries are validated. Linked targets are rejected
and unrelated top-level files are retained. Original import sources and externally
hosted server folders are not claimed by the uninstaller.
