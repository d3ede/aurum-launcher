# Recent servers

Home shows up to five server/instance pairs used during the past seven days,
newest first. The full weekly list opens from **All servers** when more than five
entries are available. Entries from deleted instances are not shown.

Each row includes the server icon and name, the instance used to connect, a
relative timestamp (the exact local date is available on hover), and a fresh
server-list status with player counts. A server that does not answer is marked
unavailable, which does not prove it is offline. Counts are not fabricated when a
server omits them. Status requests are bounded, use a 30-second cache, and do not
change the last connection time. Refresh explicitly bypasses the cache.

## History and connection behavior

- Names and icons are read from each instance's `servers.dat`. Merely saving a
  server there does not add it to recent history.
- Existing `latest.log` and compressed logs can recover recent connection
  attempts. These logs cannot establish whether authentication completed.
- Supported modern Minecraft versions are launched with a per-session Quick Play
  log under `.aurum/quickplay` in the instance. This records actual world entries,
  including multiplayer servers selected inside Minecraft. Singleplayer worlds
  and Realms are excluded from this list.
- Launching a server from Home records that launch attempt. Modern versions use
  `--quickPlayMultiplayer`; older versions use `--server` and `--port`.
- The same address in different instances is a separate entry. Default ports,
  hostname case and IPv6 addresses are normalized.
- Removal only hides the history entry. It does not modify `servers.dat`, game
  files or an existing desktop shortcut. A newer connection can add the entry
  again; rereading an old log cannot undo removal.
- History lives in `recent-servers.json` alongside launcher state. Corrupt history
  is reported and preserved rather than silently reset.

The implementation uses Minecraft's documented [Quick Play arguments and log
fields](https://www.minecraft.net/en-us/article/minecraft-snapshot-23w14a), with
support for the current flattened JSON log schema as well as older nested logs.

## Row actions

**Play** launches the matching instance and connects to the server. The menu can
launch that instance without a server, open its page, refresh status, copy the
address, remove the history entry, or create a Windows desktop shortcut.

Shortcuts include only the instance ID and server address, never credentials.
They work on cold startup and forward to an already-open launcher. They remain
usable after the seven-day history entry expires. A currently running instance
must be stopped before another launch; Aurum does not inject commands into a
running game. Missing instances and accounts produce an error rather than
silently launching a different instance or account.

## Checks

Rust tests cover address validation, retention, per-instance deduplication,
removal tombstones, log/NBT import, malformed history, bounded status packets,
zero-player counts and refresh semantics. Manual Java fixture tests capture
modern and legacy launch arguments without connecting to external game servers.
An isolated Windows COM test creates and reads a `.lnk` inside `.test-data`, never
on the user's real desktop. Playwright covers all row actions, keyboard menus,
startup/reused-window dispatch, both themes, minimum window size and localization.
