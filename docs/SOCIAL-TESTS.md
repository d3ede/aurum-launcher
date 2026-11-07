# Aurum Social: factual test ledger

**2026-11-06 — NOT READY for general use.**

Version 0.6.0 packages Social as an optional experiment. Publishing the launcher
does not certify cross-network gameplay; the two-computer checks below remain
required. Earlier entries describe the unreleased builds tested at that time.

Host: Windows x64, kernel 10.0.26200.0. Native labs used separate test directories,
new identities and real Windows AppContainers. They did not use the user's
Minecraft worlds/accounts. Network tests ran outside the coding tool's restricted
network sandbox, as an ordinary desktop user; the Social worker itself retained
its AppContainer restrictions. UAC was used only for the explicit Firewall
lifecycle test. All game-payload checks below used a declared TCP echo fixture,
not a Minecraft world.

## Native observations

| Check | Observed result | What it does not prove |
| --- | --- | --- |
| Two isolated workers | PASS: different AppContainer SIDs, low integrity RID 4096, real iroh and game QUIC endpoints | Clean-machine/other Windows policy compatibility |
| Negative OS probes | PASS: broker-readable canary denied to worker; child process creation denied; parent process memory access denied | Absence of every possible sandbox escape |
| Real oversized IPC | PASS: declared 4,294,967,295-byte frame sent without a body; worker rejected it and exited | A sustained adversarial fuzz campaign |
| Maximum Social payload | PASS: 16,384 bytes of `0xff` survived real iroh and JSON IPC expansion; worker remained running | Internet delivery to another physical network |
| Local Social transport | PASS: root signatures verified between independent AppContainers, no loopback exemption installed | Two-computer internet connectivity |
| Game mutual TLS | PASS: an untrusted client certificate did not open a game stream after the server receipt was required | Remote NAT traversal |
| Direct game TCP/QUIC | PASS: 25 fixture bytes crossed real QUIC and a kernel PID/creation-time-validated TCP listener, with identical reply | Actual Minecraft protocol/gameplay |
| Live revocation | PASS: removing game trust closed the existing authenticated QUIC connection | All timing cases under a hostile remote flood |
| STUN | PASS: public mapping obtained on the exact game UDP socket | A usable peer-to-peer NAT route |
| STUN refresh | PASS: refresh after QUIC took receive ownership retained the same local UDP port; subsequent QUIC traffic worked | Symmetric NAT/CGNAT success |
| Public DHT | Final run PASS both ways: A published to 34 nodes, B to 32; B resolved A and A resolved B; 506-byte signed packets verified in broker | Reliability or independence of two external networks |
| Real broker friends | PASS: different root IDs, request, bilateral acceptance, signed invitation/fragmented manifest, consented game fixture, persistent block | Offline delivery or Minecraft gameplay |
| Activity privacy | PASS: absent before opt-in, received through signed messages after opt-in, withdrawn after opt-out | Every UI/network interruption case |
| Real provider install | PASS: actual 2,452,735-byte Fabric API file from Modrinth, provider integrity check, separate staged profile and one explicit manual file | Running that mod in Minecraft |
| Export boundary | PASS: source fixture world and flagged secret config excluded and unchanged | Complete detection of secrets in arbitrary config formats |
| Cancel/resume | PASS: intentional cancellation published no profile; journal retry reused verified cache; original world unchanged | Recovery from every possible power-loss/filesystem failure |
| Shutdown | PASS: both workers exited; independent broker service shutdown completed; no persistent privileged listener/helper | Emergency off during real remote gameplay |

Earlier public DHT runs were **not fully successful**: one run published a packet
but independent resolution failed; another resolved B from A while B could not
resolve A after three attempts. These failures remain part of the result. The
fresh signed contact-link fallback was exercised in the real broker tests. Do
not describe Mainline DHT as a reliable directory or guaranteed mailbox.

The additional client-certificate test initially exposed a premature readiness
condition: QUIC/TLS could complete on the client before the server finished client
authentication. A bounded application receipt is now required inside the mTLS
stream before reporting it to the broker. The negative certificate test and live
revocation test passed after this change. The receipt is consumed by the worker
and is never forwarded to Minecraft.

A second boundary issue was fixed: a 16 KiB opaque payload can exceed a 64 KiB
IPC frame after JSON byte-array encoding. IPC is now bounded at 96 KiB, including
metadata. Both the exact envelope test and a real maximum-byte-array transport
check pass. The limit is still checked before allocating the IPC body.

## Firewall and privilege observations

- The ordinary host account was not an administrator. Attempting lab rule
  installation without UAC returned access denied.
- The explicit `aurum-social-firewall.exe self-test-lab` run under one-shot UAC
  exited with code 0. It installed both named lab rules, checked exact executable
  path + AppContainer SID + inbound UDP 47631–47633, removed them and verified
  absence. The elevated helper exited. No service or privileged IPC was created.
- Lab rules were absent afterward. No global Java/TCP allow rule, router mapping,
  loopback exemption, scheduled task or always-running privileged helper was
  installed by these tests. Fresh production rules were not left enabled.
- User-declined UAC, clean-machine policy behavior and actual installed-app rule
  cleanup remain manual tests in the two-PC procedure. A successful local
  lifecycle test is not a claim that every Windows policy permits this rule.

## Automated and desktop checks

- `npm run build`: PASS, including TypeScript and production frontend bundling.
- `npm test`: PASS, **24 tests**. Includes Russian → English → Russian Friends
  navigation regression coverage.
- Full Playwright run: **131/131 PASS** serially. After adding the Russian menu
  regression, the six Social/language cases also passed. UI tests deliberately
  use contract fixtures and are **not network or isolation evidence**.
- `cargo test --workspace --all-features --offline`: PASS. Includes **21 Social
  tests**, real DPAPI round trips, actual kernel listener ownership, actual
  Windows junction rejection, parser properties, signature/impersonation/replay,
  checksum IDs, block canonicalization and manifest tampering. The worker's STUN
  parser test also passes. Existing opt-in tests requiring external game/account
  fixtures remain explicitly ignored; they were not converted into successes.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`: PASS.
  The local filesystem emits a Cargo hard-link-cache warning; it falls back to
  copying. A transitive proc-macro future-compatibility notice remains.
- Native release desktop and NSIS bundle: built locally without signing or
  publishing. The first attempt could not download NSIS from the coding sandbox;
  normal host networking completed the download with Tauri's hash validation.
  A protocol quote-escaping warning was fixed and the next bundle compiled
  without that warning. The final local rebuild also includes the Russian label.
- Read-only native WebView smoke: the app opened on a separate empty data root,
  Friends appeared above Hosting, the native Social screen loaded and remained
  disabled. The initial Russian navigation-label omission was reported and fixed;
  the native test did not automatically consent to Social or modify privacy.
  After rebuilding, the native accessibility tree confirmed “Друзья” directly
  above “Хостинг”. No further screen captures were needed for that check.
- Existing isolated NSIS regression scripts: PASS, 17 path cases, 16 language
  cases and eight shortcut cases. These do not replace a clean-machine install.
- The optimized worker/lab binaries used in the local QA archive passed the
  real AppContainer, STUN refresh, maximum-frame, certificate denial, direct
  TCP/QUIC, revocation, oversized IPC and shutdown checks. The interactive
  two-PC node also passed an immediate `on` → `off` → `quit` lifecycle check.

## Dependency security scan

`npm audit` reported **0 vulnerabilities**. RustSec cargo-audit 0.22.2, using the
public database at commit `d1d82c33f65871596a8b2a0a53b86e9b3a730951`, initially
reported 11 vulnerability entries. Reachable TLS dependencies were updated to
rustls-webpki 0.103.16 and root bundles 1.0.11; Tokio became 1.54.1. General ZIP
handling was upgraded to 9.4.1, with API adaptations and archive regression tests.
The updater's unused ZIP feature was removed: published update manifests already
point to signed EXE installers. No signature verification was disabled.

The final lockfile scan reported **0 vulnerability entries**, with seven
unmaintained-package notices and one GLib unsoundness notice in the existing
Linux dependency graph. These notices were not suppressed. Windows is the Social
v1 target; Linux support and those transitive maintenance issues are not certified.
See the upstream [TLS fix](https://github.com/rustls/webpki/pull/546) and
[ZIP advisory](https://github.com/zip-rs/zip2/security/advisories/GHSA-4v9h-p7m9-rh26).

## UI and delivery correction round (2026-11-06)

The compact Friends screen now uses hidden IDs, avatar/status badges, one green
Invite action, a friend menu, aligned consent controls and an off confirmation.
The home news preview uses short group titles; full descriptions stay in the
changes dialog. These changes remain unreleased.

Real local broker/worker tests passed after the session changes: three
block/unblock/re-add cycles; simultaneous requests; profile-name and JPEG-avatar updates;
Invisible withdrawing presence/activity; pack receipt after manifest assembly;
three Vanilla invitations with sender-side receipts; scoped cancellation without
discarding a sibling invitation; the consented TCP/direct-QUIC fixture; encrypted
restore while enabled; wrong-password preservation; clean independent shutdown.
Fresh challenges, delegated transport keys, signature/recipient checks and
monotonic sequences remain required. At most two retired sessions are accepted
for a fixed 30-second overlap, and blocking/removal discards them.

The native negative-probe lab also passed again: two AppContainers at integrity
RID 4096; canary/child/parent-memory denial; 16 KiB transport; rejection of an
untrusted game certificate; fixture payload/revocation; oversized IPC rejection.
These are **local** observations, not internet gameplay evidence. No Firewall
scope, process isolation or game-relay restriction was relaxed.

Frontend build and 27 unit tests passed. The full UI run had 144/145 passes with
one timeout during a live Vite reload. The affected personalization suite and
all final Social cases then passed together (19/19), including two new
undelivered-invite and cancelled-restore checks. Contract fixtures are only UI
evidence. The release-profile workspace Rust tests and all-target/all-feature
Clippy with warnings denied passed. The release profile avoided resources locked
by the user's open debug app. Existing ignored external-fixture tests remain
ignored. Native toast presentation and real two-network gameplay still require
the two-PC procedure; no such success is claimed here.
The added image-normalization test also passed against the real codecs: a PNG
becomes a bounded JPEG accepted by the peer validator; malformed and oversized
input is rejected. The final release worker/lab repeated all 13 friend-flow
checks and all 11 local isolation/transport checks successfully. The separate
two-network gate remained explicitly NOT TESTED.

## Invitation-flow correction (2026-11-06)

The worker previously shared four permits across discovery, incoming streams and
outgoing sends. A synchronous send-permit failure was labelled `command`, while
the broker released its in-flight slot only for `send`. That left the outgoing
queue stuck. Discovery, sends and accepts now have separate bounded pools;
failures preserve their operation type. Direct game connection attempts also
run as bounded asynchronous tasks, keeping control/shutdown responsive.

The native `--busy-discovery` run occupied all four discovery slots using real
Mainline resolutions. The fifth returned a typed `resolve` error, and real
bidirectional iroh control traffic still completed. All 13 checks in that lab
passed, including the OS isolation negatives, mutual-TLS denial, fixture bridge,
revocation and oversized-IPC rejection. This is local transport evidence during
real DHT work, not two-network gameplay proof.

The final release `--friends` run passed all 14 checks. Its manifest now spans
several 1 KiB fragments. Transfers request offsets, retry missing fragments and
accept only identical retransmits; parser tests reject changed duplicates.
Sender cancellation keeps an explicit receiver error. A scoped join cancellation
closed the bridge and returned the host to waiting with both Social services
still enabled. No isolated-network boundary or Firewall scope was loosened.

The receiver UI now combines player/instance choice, setup, connection and launch
in one guarded operation. It has a sender avatar, themed pattern, progress, retained
errors and no off/review button. New-instance preparations persist their chosen
profile ID for retries. The sender has a distinct chime and outgoing status cards.
Theme-surface and checkbox checks cover custom palette colors.

Build, 27 frontend unit tests, workspace all-feature Rust tests and all-target
Clippy with warnings denied passed. The targeted UI run passed 41/42, with the
restore-picker case interrupted by a live frontend reload; the final isolated
Social rerun passed 17/17. Catalog, Microsoft login and home cases passed in the
targeted run. UI fixtures do not count as network, actual Minecraft launch or
two-computer evidence. Remote gameplay and OS-toast presentation remain unverified.

## Native LAN login correction (2026-11-06)

The user reported Invalid Session through Social, then successful entry from the
same running client by selecting the Radmin-discovered LAN world. Inspection of
the installed Minecraft 26.3 bytecode confirmed that QuickPlay constructs
`ServerData.Type.OTHER`; `ClientHandshakePacketListenerImpl` handles authentication
failure differently when `ServerData.isLan()` is true. Saved server NBT does not
persist a LAN type, so writing a normal saved server cannot fix that distinction.

Social now launches Minecraft without ordinary-server QuickPlay arguments. The
approved loopback bridge announces itself only to 127.0.0.1 UDP 4445, and the user
selects `Aurum: world name` in the native LAN list. No game class, server mode,
session token, licensing check or remote address is changed. Announcements stop
when the guest bridge is dropped; no LAN broadcast or AppContainer exemption is
installed. Names cannot inject LAN packet delimiters.

`scripts/probe-minecraft-lan.ps1` compiled a small harness against the actual
installed 26.3 client and its existing libraries. Its real
`LanServerDetection.LanServerDetector` received the broker's localhost packet;
the actual `ServerData` constructed for that LAN entry returned `isLan() == true`.
The first harness run needed Minecraft's version bootstrap; after adding
`SharedConstants.tryDetectVersion()`, it passed. The concurrent real AppContainer
friend/fixture lab also passed. This proves native discovery and entry semantics,
not a completed remote Minecraft login or gameplay session.

The full all-feature workspace tests, warnings-denied Clippy, frontend build and
27 unit tests passed. All 17 Social UI cases passed, including the retained LAN
instructions after starting Minecraft. Retest actual login on both computers;
the status remains NOT READY.

## Automatic native LAN joining and recovery (2026-11-07)

The ignored `aurum-core/tests/lan_autojoin.rs` integration test launched actual
Minecraft clients in disposable `.test-data` directories with an offline test
player. Vanilla 26.3 and Fabric 1.21.11 (loader 0.19.5) automatically sent the
login handshake and Login Start to an owned loopback TCP fixture without menu
interaction. A separate probe against the actual 26.3 classes confirmed that the
agent-created `ServerData.isLan()` is true. These are real client tests, not a
world server, Internet traversal test or completed gameplay session.

Run with `--features social-lab --test lan_autojoin -- --ignored --nocapture`,
providing `AURUM_LAN_FIXTURE_CACHE`, `AURUM_LAN_FIXTURE_META`,
`AURUM_LAN_FIXTURE_CLIENT`, `AURUM_LAN_FIXTURE_JAVA` (JDK) and
`AURUM_LAN_FIXTURE_VERSION`. Only public game assets are copied; account tokens,
worlds and user mods are not copied. The fixture stops only its own game process.

The native `aurum-social-lab --friends` test passed abrupt isolated-worker
termination twice, recovery with the same ID/name/friend, and repair of the same
DPAPI key from the broker's live identity after deleting the fixture key file.
This exposed and fixed fresh-transport handshake tie-breaking and stale signed
outbox messages. Authenticated routes are retained only in broker memory;
new transports still require fresh signed delegation and challenge verification.
The friend, block/unblock, invisible/profile, invitation, manifest and local
TCP/QUIC bridge scenarios passed after recovery. This is local integration
coverage and does not establish cross-network reliability.

Final local checks passed: all-feature Rust workspace tests, all-target Clippy
with warnings denied, the production frontend build, 31 frontend unit tests and
28 Social/manual-download/home UI tests. The real isolation lab also passed
AppContainer/low-integrity checks, denied canary/child-process/parent-memory
access, mutual-TLS rejection, owned TCP/QUIC transport, revocation and shutdown.
Invitation and identity screenshots were inspected in both themes, including a
960-pixel window. None of these checks changes the NOT READY Internet status.

## Outstanding gates

Not run: two physical computers on separate networks; direct NAT traversal and
blocked-UDP/VPN fallback across those networks; an actual Minecraft LAN world;
all loader/provider combinations end to end; clean-machine install/uninstall and
UAC policy scenarios; a longer hostile-peer and fuzz/security review. No personal
chat, Horizon Social support, offline mailbox or public game relay is implemented.

Follow [SOCIAL-TWO-PC.md](SOCIAL-TWO-PC.md). Until those release gates are reviewed,
the correct status is **NOT READY**, even when the local labs pass.
