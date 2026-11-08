# Storage and sign-in

The default data home has two directories:

```text
Aurum Launcher/
  Launcher/
    aurum.exe
    data/        # profiles database, settings, Social identity, caches and logs
    webview/     # main interface profile, including existing preferences
  Game Files/
    instances/   # each instance's worlds, mods and game settings
    assets/
    libraries/
    versions/
    runtimes/
    horizon/
    hosting/
    trash/
```

Existing game data is moved using same-volume renames. Migration resumes after an interruption, rejects ambiguous destinations and preserves unknown files. An explicit Java path inside the previous data root follows the move. The application identifier is now `app.aurum.launcher`; upgrade migration reads the previous application-data and credential-vault namespaces so existing Microsoft accounts keep their credentials.

Settings → Files and versions → Storage shows disk usage, cache and download cleanup, installed versions and trash. Used versions cannot be removed. Deleting an instance or supported content creates recovery metadata; individual items or the whole trash can be restored. Restoring never replaces an existing file. Permanent deletion requires confirmation. Items from older versions without recovery metadata remain removable but cannot be restored automatically.

Managed downloads use drop guards so cancellation of a parallel future removes its partial file. Installation archives are discarded after use. Startup also removes abandoned managed downloads, retains the latest 20 installer logs and preserves import rollback backups and resumable Social installations. Main interface caches are cleared before WebView startup when requested; preference and sign-in storage are preserved.

Java selection reuses an exact-major runtime from managed installations, environment variables, known system vendors or known launcher stores. New ordinary installations download a verified Temurin JRE. Storage can replace managed JDKs with JREs or reuse a matching system installation; manually configured Java is preserved. Horizon preparation can use an existing JDK or a temporary verified JDK that is removed after preparation.

Microsoft sign-in opens the default browser using authorization code flow with PKCE and a loopback callback. No embedded Microsoft browser or separate sign-in profile is created. The browser callback does not claim that account verification is already complete, and reopening sign-in uses the current operation's URL. Tokens stay in the native credential store.
