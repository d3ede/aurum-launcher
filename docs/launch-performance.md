# Launch preparation performance

The launcher now avoids repeated work before starting Java:

- Java version probes are cached for the engine session, keyed by executable path,
  file size and modification time. Changes to the runtime's `release` file also
  invalidate the entry. The required Java major version is still enforced.
- Extracted native libraries are reused across launcher sessions when the source
  archives and extracted files are unchanged. Missing or modified files trigger
  extraction again. Failed extraction never produces a reusable cache marker.
- Microsoft launch credentials are read once, rather than independently for the
  token, client ID and XUID. Expired sessions still require normal refresh.
- Authentication and Java preparation can overlap.
- Argument substitution and log redaction compile their regular expressions once.
  Log messages are not discarded and token redaction remains enabled.

These changes do not bypass game installation, disable mods, change JVM memory
settings, or keep a hidden Minecraft process running. They do not make Minecraft's
own initialization, resource reloads or mod loading instantaneous.

## Reproduce the measurements

Use a JDK 21 or newer. The fixture compiles a tiny Java class and launches it with
an offline test account, an isolated client JAR, and a 4 MiB native-library fixture.
All fixture game data stays under `.test-data/launch-performance`; no real profile,
account credentials or worlds are used. The process is stopped after each sample.

```powershell
$env:AURUM_PROCESS_TEST_JAVA = 'C:\path\to\jdk\bin\java.exe'
.\scripts\cargo.ps1 -CargoArguments @('test','--release','-p','auren-core','--test','launch_performance','--','--ignored','--nocapture','--test-threads=1')
```

The launch timer measures the core `launch` call through process creation and
profile-state persistence, not time to Minecraft's main menu. The first sample is
reported separately and excluded from the warm median. No timing assertions run
in ordinary CI because host load and antivirus activity affect the results.

An initial local debug-profile A/B run measured a warm median of 77.16 ms before
the changes and 4.41 ms afterward. A subsequent optimized-profile run measured
4.76 ms warm preparation. In that optimized run, processing 2,000 synthetic log
lines took 708.76 ms with the original per-line regex compilation versus 2.19 ms
with the shared regex. The benchmark checks that both produce identical output.

These are local synthetic measurements, not a claim that a particular modpack
reaches its main menu that much faster. Measure the actual instance separately
before changing its mods, resource packs or JVM options.
