# Aurum Social: two-computer verification

This procedure is still **NOT RUN**. A same-PC connection, a successful STUN
mapping or a UI fixture does not satisfy it. Keep evidence from both physical
computers, which must use different independent internet connections.

## Prepare

1. Use Windows x64 on both computers. Prefer a home connection and a phone
   hotspot using cellular data. Disable the hotspot phone's Wi-Fi so both are
   not using the same router. Initially disable any VPN on both computers.
2. Build the same source revision. Do not publish a release:

   ```powershell
   ./scripts/build-social.ps1 -DebugBuild
   ./scripts/cargo.ps1 build --package aurum-social-worker --bins --locked
   ./scripts/cargo.ps1 build --package auren-core --features social-lab --bin aurum-social-core-lab --locked
   ```

   The test node needs `aurum-social-lab.exe`, `aurum-social-worker.exe` and
   `aurum-social-firewall.exe` beside each other. A local portable QA bundle may
   contain these files; verify its SHA256SUMS before copying it. Each computer
   generates its own identity. **Do not copy the node data directory or DPAPI
   identity from computer A to B.**
   In the local QA ZIP these tools are in `lab/`; run `start-test.ps1` from the
   archive root for the desktop app with a separate test-data directory.
3. Turn off Social in every other Aurum process before starting a node. It uses
   the production Client AppContainer SID and UDP 47631–47633; two instances on
   one host cannot share those ports. Test data must stay separate from real
   launcher data. Record OS version, revision, rule status, network type and
   whether the address is public/CGNAT; redact public IPs before sharing logs.

## Direct fixture and discovery

On **each** computer, from its own copy:

```powershell
./aurum-social-lab.exe --node --data .test-data/node-A
# On B use a different local directory, e.g. .test-data/node-B.
```

The node prints its command list. Enter `firewall` to request the exact one-shot
UAC rule, then `on`. It does not install a service or modify router settings.
Wait several seconds and enter `status`, then `id`. Compare the entire IDs
through a trusted channel. They must be different.

1. On A enter `add <B's full ID>`; on B inspect `status`. Test the reverse
   direction in a new pair of test directories as well. Record lookup failures
   and latency rather than hiding unsuccessful attempts.
2. If DHT lookup fails, enter `contact` on B and paste that **fresh five-minute
   contact link** into `add <link>` on A. This tests the documented fallback,
   not successful DHT discovery. On B enter `accept <A's ID>`.
3. Confirm `friend` on both sides. On A enter `invite <B's ID>`. On B inspect
   `status`, copy the invitation's 32-hex ID and enter `join <invitation ID>`.
   Poll `status` until `readyToLaunch` or `unreachable`. No local action on B
   should mean no guest TCP listener/bridge.
4. On B enter `probe <invitation ID>`. It sends a fresh random 32-byte payload
   through a broker-owned localhost TCP listener, direct game QUIC and A's
   kernel-validated echo fixture. Only an identical reply prints PASS.
   This is **not a Minecraft world**. Confirm with Wireshark or equivalent
   that game UDP goes to the other computer's mapped game endpoint, and is not
   carried by a public relay. Public Social relay traffic may coexist.
5. Repeat after at least two minutes so NAT refresh is exercised. Repeat with
   the roles reversed, router restart/address change, UDP blocked, and one
   connection behind CGNAT where available. A failed direct route must say
   unreachable; it must not fall back to sending game bytes over Social.
6. If direct traversal fails, enable a compatible IPv4 VPN on both computers,
   exchange fresh contact links, recreate the invitation and repeat. Record
   this separately as **VPN PASS**, never as direct internet/NAT PASS. Aurum
   does not deploy a relay or install the VPN.
7. During an active fixture, test `block <peer ID>` and `off`. The bridge must
   close, workers must exit, and no privileged configurator may remain running.
   Restart the node to check persistent contacts/blocks and fresh endpoint
   delegation. `quit` stops the node and its test fixture.

## Real launcher / Minecraft

Build the local desktop app without publishing it (`scripts/desktop.ps1 -Mode
build -NoSign`), or use a matching local QA artifact. Launch each app with a
separate `AURUM_DATA_DIR` under its `.test-data` directory. Add legitimate accounts
and compatible Java instances; authentication and game ownership remain normal
Minecraft requirements. The echo node must be stopped before enabling Social.

- Enable Social explicitly on both sides; verify full IDs and complete the
  friend request. First test with empty Java Vanilla instances.
- A starts a real world and opens it to LAN. Invite B from Friends. Verify the
  displayed live LAN port, join with a compatible instance, play/move/chat in
  Minecraft itself, leave and reconnect. Keep records from both computers.
- Test invite-with-instance using Fabric and a small known Modrinth mod, then
  the approved Forge/NeoForge/Quilt paths and one permitted CurseForge file.
  Verify source/version/hash, dependency review, disabled config sharing,
  flagged-secret exclusion, separate directories and unchanged host worlds.
- Include a file not in a catalog. It must be a manual requirement, with no
  peer binary download. A wrong file must fail hash verification. Add the exact
  trusted copy and resume. Repeat cancellation and a launcher restart halfway
  through installation; review must be required again and cache reused.
- Decline/dismiss/revoke invitations, remove/block friends, kill the worker,
  disconnect the network and expire the invitation. No case should launch Java
  without local consent, retain a revoked target or edit another instance.
- While playing, turn Social off and close the launcher after its warning.
  Remote players disconnect, but Minecraft remains running. Unrelated downloads
  and local Hosting must remain unaffected by the Social emergency switch.
- On a clean standard-user Windows installation, decline UAC, then accept the
  fixed scoped setup. Inspect path + SID + protocol + ports; check absence of
  Java/TCP/router/loopback exceptions and any always-running elevated helper.
  Test uninstall cleanup, including declined removal consent.

## Evidence and decision

Record each test with revision, computer labels, different-network confirmation,
direct/VPN route, outcome, elapsed time, exact error and redacted evidence.
Do not record backup passphrases, root seeds, Minecraft tokens or private worlds.
Keep UI fixture results separate from native security/network observations.

Until actual gameplay, isolation/negative tests, clean-machine privilege checks
and both-network evidence have been reviewed, the status stays **NOT READY**.
Successful fixture probes alone cannot change it to READY.
