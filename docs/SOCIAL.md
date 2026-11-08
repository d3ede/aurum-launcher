# Aurum Social — experimental Windows feature

**Status: NOT READY for general use.** Included as an opt-in experiment in 0.6.0.
Two computers on different networks and an actual Minecraft world have not yet
been verified after the latest fixes. See the
[test ledger](SOCIAL-TESTS.md) and [two-computer procedure](SOCIAL-TWO-PC.md).

## Using it

The screenshot library and encrypted friend-sharing queue are described
in [Screenshot library and sharing](SCREENSHOTS.md).

Friends is immediately above Hosting. Social starts disabled on a fresh data
directory. Enabling it requires P2P consent and an explicit, scoped Windows
Firewall setup. A previously enabled installation resumes only if its scoped
rule still matches the verified worker. Turning Social off persists that choice.
Turning it off requires confirmation and disconnects Social tunnels without
stopping Minecraft. The control is below the identity-backup actions.

In the 0.7.0 release, the installer no longer bundles the Social executables.
The first explicit activation downloads the worker and Firewall helper from the
same GitHub release as the launcher. The dialog shows download progress and
allows cancellation before Firewall configuration. Both compressed downloads
and executable files are verified against SHA-256 hashes embedded in the
launcher; a remote manifest cannot select another executable. Failed or
cancelled downloads do not activate Social and can be retried.

Verified files are cached in
`%LOCALAPPDATA%\app.aurum.launcher\social-runtime\<content hash>`. The cache is
independent of relocated game data. Matching components work offline without
another download; changed components require setup again. Contacts and identity
are preserved. Obsolete cached executable revisions are removed after a new
component installs successfully. Uninstall removes the component cache and
owned Firewall rule independently of the optional game-data removal choice.

For development, run `scripts/build-social.ps1 -DebugBuild` before native checks
or `tauri dev`. Desktop release builds run it automatically in release mode.
The build generates an ignored `src-tauri/social-runtime/manifest.json` plus two
`.exe.gz` assets; `prepare-release.mjs` validates and publishes them with the
installer. Release publication must include all of those assets. Offline QA
packages may place the exact pinned executables in a sibling `social` directory.

Local `npm run tauri build` and `scripts/desktop.ps1 -Mode build` installers
include those exact executables for offline use. A local build can contain a
new runtime that does not exist in its version's published GitHub release;
requesting that asset would return 404. The release workflow sets `RELEASE_TAG`
and builds the smaller download-on-activation installer, publishing its pinned
runtime assets in the same release. `build-social.ps1` also stages a matching
`social` directory beside the directly runnable build output. Local installers
are therefore larger than the on-demand release installer.

Your ID starts hidden; reveal it to compare the full key. Choose an avatar by
clicking your picture, or change between Online and Invisible with the status
selector. Invisible withdraws your online presence and shared activity from
friends; it is not anonymity from network peers. Avatars are re-encoded as
bounded JPEG thumbnails and sent in authenticated control messages, never fetched
from a peer-provided URL. Friend actions are in the three-dot menu.

Compare the **complete Aurum ID** with your friend through a trusted channel.
Names and identicons are display aids, not identity verification. Paste an ID or
open an `aurum://social/add/…` link to review a request. Opening a link does not
enable Social or send a request automatically. Requests are delivered while
both peers are reachable; there is no guaranteed offline mailbox.

If ID lookup fails, exchange a fresh contact link. It carries a root-signed
endpoint description, expires after five minutes and can reveal network
addresses. A saved friend may also need a fresh link after restarting if DHT
lookup fails. “Offline or unreachable” deliberately does not claim to distinguish
a switched-off computer from a blocked route.

To invite someone, start a **Java** instance and open its world to LAN. Aurum
checks current kernel TCP listeners, their owning Java process and its creation
time, then performs a Minecraft status ping. A log line is never sufficient.
Select the current LAN port if there is more than one valid listener.
The green Invite button offers **World only** or **With instance**, without a
separate outgoing review button. An empty Vanilla
manifest means no additional files, not a zero-byte game: Minecraft and the
loader install separately. Send waits up to 45 seconds (180 with an instance) for the receiver's signed
receipt, including the complete manifest for a shared instance. A timeout is
reported as undelivered instead of reporting a queued packet as success. This
receipt confirms that the other launcher received the offer, not that the friend
accepted it or that the game connection works. Both computers need this updated
test build; earlier prototypes do not support these new message fields.
The sender's page keeps an outgoing card with delivery, waiting, connecting,
connected or declined state. A connected bridge is not proof that a player has
finished entering the Minecraft world.

The invitation shows the sender's avatar, a matching-instance selector, player
selection and progress. A new matching instance or local player can be created
there. Minecraft setup, content installation, direct connection and launch run
as one guarded action; Join is disabled during another download. Microsoft
sign-in can be opened while the invitation remains in the invitation list.
Downloads can finish before the direct route is tested: this is preparation,
not evidence that NAT traversal succeeded. A failed route leaves a visible
error and can be retried; it does not claim that Minecraft was launched.

Supported Java clients join automatically through Minecraft's native LAN
connector. A small bundled Java agent waits for the title screen and schedules
the connection on the client thread, constructing a native LAN entry rather
than ordinary-server Quick Play. It accepts only the approved loopback bridge.
It does not transform game bytecode, change account tokens, authentication
services or server mode. Actual automatic LAN login requests were checked on
Vanilla 26.3 and Fabric 1.21.11; this is not a completed remote gameplay test.
Unsupported older clients retain **Multiplayer → Aurum: world name** as fallback.
Keep Aurum running. LAN announcements stay on 127.0.0.1:4445.

A worker failure triggers bounded reconnect attempts inside the same
AppContainer. The trusted broker keeps the same protected identity and saved
friends. A missing key at startup requires its backup; it never silently creates
a replacement ID beside old contacts. Restoring the same ID retains its profile;
explicitly replacing it with a different ID clears the previous profile and
contacts. Turning Social off preserves the identity for later reconnection.

Manifest fragments are requested by offset and retried. Identical retransmits
are idempotent; changed bytes, metadata or hashes are rejected. After 45 seconds
without progress the receiver keeps an explicit failure state. Cancellation by
the sender also leaves an error instead of silently deleting the open dialog.
Discovery, control sends and incoming connections have independent bounded
permit pools. Busy/errors retain their operation type, and game connection
attempts run asynchronously so they do not stop control delivery or shutdown.

The receiver chooses an existing compatible instance or reviews a shared
instance's complete file and dependency plan. Installation creates a separate
profile; it does not merge into an existing instance. Mods are executable code.
Hashes prove that bytes match the plan, not that the code is safe. Missing or
restricted files use the launcher's manual-file workflow with exact hashes.
An interrupted installation can be reviewed again under Interrupted installations.
It reuses verified cache and staging; reopening Aurum never silently resumes it.

Invitations prefer an already running instance with the same Minecraft and loader
versions. The receiver can choose another compatible instance explicitly. New
Java launches include a dormant, launcher-owned file inbox, so accepting an
invitation can invoke Minecraft's native LAN connector inside that JVM. Requests
are session-specific, loopback-only and consumed once; the inbox stays available
for later invitations. The game uses its current player and normal disconnect/save
path before switching worlds. If the mapped connector or disconnect method is
unavailable, Aurum offers the native LAN list or asks the player to return to the
title screen. A compatible game started by an older Aurum build is reused via LAN
discovery without launching a second client. A different Minecraft/loader version
still needs a separate compatible instance. Existing instances' mod sets are not
silently replaced by a friend's shared pack.

Config sharing is off by default. When enabled, a heuristic excludes likely
secrets unless the sender separately opts in to include flagged files. This is
not a complete secret detector. Worlds, account databases, logs, credentials,
absolute paths, launch arguments and scripts are not part of the Social format.

Activity sharing is a separate opt-in. It publishes only the current Java
profile's display name, Minecraft version and loader to accepted friends.
No local directory, account token or world contents are published.

Keep Aurum open while using its game tunnel. Closing it warns before disconnecting
friends. Emergency off cancels Social operations and kills its isolated worker
if graceful shutdown stalls. It does not stop Minecraft, local Hosting servers
or unrelated launcher operations.

## Network and infrastructure

No Aurum Social server, VPS, Worker, tunnel account, paid API or hosted database
is deployed. The existing CurseForge gateway is unchanged and is used only when
the user reviews or downloads CurseForge content.

| Mechanism | Purpose | Failure behavior |
| --- | --- | --- |
| [PKARR/Mainline DHT](https://docs.rs/pkarr/8.1.0/pkarr/) | Find the root-signed short-lived contact for a full Ed25519 key | Bounded lookup fails honestly; exchange a signed contact link |
| [iroh 1.4.1](https://github.com/n0-computer/iroh/releases/tag/v1.4.1) | Authenticated Social control messages and manifest fragments | Direct routes or optional public n0 relays; no offline delivery guarantee |
| [Public STUN](https://developers.cloudflare.com/realtime/turn/faq/) | Discover the NAT mapping of the actual game UDP socket | Keep LAN/VPN candidates; report unreachable when no route works |
| Direct noq QUIC with pinned mutual TLS | Minecraft TCP bridge | **No public game relay**; use a compatible IPv4 LAN/VPN route if direct NAT traversal fails |
| Modrinth / existing CurseForge gateway and CDNs | Resolve catalog identities and download approved files | Exact missing file remains a manual requirement |

Public relays are optional third-party infrastructure, not a production SLA or
an anonymity service. Their operators can observe connection metadata. The
[n0 public relay limits](https://docs.iroh.computer/relays/rate-limiting) apply.
Mainline bootstrap hosts are supplied by the dependency; DHT data is public and
availability is best effort. There is no automatic UPnP, port prediction, router
configuration, TURN fallback or game-over-Social-relay mode.

The game endpoint is IPv4 in this version. NAT traversal uses the same UDP socket
for STUN, refreshes, bounded send-only punching and QUIC. A socket adapter gives
QUIC a single receive owner and dispatches only the expected STUN transaction.
It does not race a separate `recv_from` against QUIC. A symmetric NAT, blocked UDP
or incompatible VPN can still prevent a connection. Users configure any VPN
themselves; Aurum does not install or operate one.

## Security boundary

The launcher broker owns the persistent Ed25519 root seed, contacts, local
decisions and filesystem operations. Its seed uses Windows user-scope DPAPI.
Encrypted age backups need a separate passphrase; losing the seed and backup
loses that ID. DPAPI does not protect against malware already running with the
user's unrestricted privileges.
Restore is available while Social is enabled: the selected backup is decrypted
first, then operations and the isolated runtime stop before atomic replacement.
A wrong password or cancelled file picker leaves the active identity unchanged.

Incoming requests and world invitations produce an in-app notification and a
short chime. The preference disables both. The launcher also attempts a Windows
toast and taskbar attention when appropriate; Windows policy, Focus Assist and
unregistered portable builds can suppress the OS toast. The in-app notification
and invitation queue remain available. Peer names are escaped as XML text.

The worker runs in a real Windows AppContainer with low integrity, Internet and
private-network capabilities, sanitized environment, two inherited pipe handles,
no child processes and a kill-on-close Job. Its limits are one process, 256 MiB
of job memory and a 20% CPU cap. It receives neither the root seed nor launcher
credentials. It has explicit RX access only to its runtime directory/image;
Windows and files deliberately readable by AppContainers remain OS-controlled.
Failure to create or verify the sandbox disables Social; there is no unsandboxed
fallback or installed loopback exemption.

The root signs a short-lived delegation to an ephemeral iroh identity. The broker
independently verifies full root keys, signatures, recipients, fresh challenges,
monotonic sequences and expiry. Authenticated friends remain untrusted input.
Worker messages cannot call launcher RPC, select a Java executable, launch a
shell or choose an arbitrary TCP target. A game bridge requires local consent
and an exact kernel-owned listener, revalidated throughout the session.
Removing/blocking a friend revokes game trust and closes their bridges.

IPC has a 96 KiB frame bound checked before allocating the body (including JSON
byte-array expansion and metadata); Social wire
messages are at most 16 KiB. Queues, connections, stream buffers, incoming
requests, contact caches, manifest assemblies and aggregate manifest memory are
bounded. The broker rate-limits unknown greetings and raw incoming messages.
This limits resource use; it is not a proof against all denial-of-service attacks.

Manifests use a strict, versioned allowlist. They allow only content and optional
config roots; reject traversal, ADS, device names, duplicate/colliding paths,
links and reparse points; check per-file and total sizes; and verify SHA-256.
Catalog dependencies are resolved before review. Download URLs come from provider
metadata, not the peer; HTTPS CDN hosts are allowlisted, redirects and proxies
are disabled, public DNS results are pinned, and byte counts and hashes are
verified before publication. No peer JAR transfer or arbitrary archive extraction
is implemented. General provider JSON bodies are capped at 32 MiB.

The Firewall configurator is a fixed one-shot UAC executable. Its inbound rule
requires the exact worker path, AppContainer SID, UDP and local ports
47631–47633. It does not open Java or TCP, run a service, expose privileged IPC
or remain running. Re-enabling an already correctly scoped installation does not
request UAC again. The uninstaller attempts owned-rule removal before deleting
the helper. If removal is declined, the unused scoped rule can remain; remove
it explicitly with the fixed helper's `remove` operation under UAC.

## Building and limits

Use the checkout's isolated `scripts/cargo.ps1` and `scripts/desktop.ps1` when
present. Building Windows binaries also requires a JDK 17+ (`JAVA_HOME`, PATH or
`AURUM_JAVAC`); the LAN agent is compiled to Java 8 bytecode and bundled into the
launcher. Installed users need no separate compiler or agent download.
`scripts/build-social.ps1 -DebugBuild` prepares debug sidecar resources
before raw workspace checks. Desktop production builds prepare release sidecars
through `scripts/build-desktop-assets.ps1`. The worker is a Windows-subsystem PE;
its inherited IPC pipes still work. This avoids a real AppContainer console
initialization failure encountered on the test host.

The local GNU scripts disable implicit MinGW exports while retaining Rust's
explicit exports. Otherwise iroh's companion cdylib can exceed the PE export
limit. This does not weaken AppContainer isolation.

Horizon, native Horizon mods and personal chat are outside the approved Windows
Java v1 scope. Reliable offline delivery, guaranteed DHT reachability, guaranteed
NAT traversal and game relaying are not implemented. Actual cross-network
Minecraft gameplay, clean-machine installation/UAC behavior and a longer hostile
peer/fuzz review remain release gates. Do not describe this build as READY.
