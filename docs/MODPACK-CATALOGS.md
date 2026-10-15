# Modpack catalogs (development build)

The project-source dropdown includes ATLauncher, FTB and Technic alongside
Modrinth and CurseForge. These three sources contain modpacks, so selecting one
switches to modpacks. Open a result, choose a public version, then create an
instance. Game files, the official loader and Java are installed by Aurum when
the instance is first launched. Installing a pack does not require a Minecraft
account; joining authenticated servers still does.

| Source | Browse and install | Available controls |
| --- | --- | --- |
| ATLauncher | Public v1 API plus official distribution manifests and files | Text search, Minecraft version, name/date sorting, pack versions, optional client mods and their dependencies |
| FTB | Public FTB Modpack API, including client files and target loaders | Text search, Minecraft version, installs/date sorting, pack versions |
| Technic | Public Platform API, single ZIP packs and author-hosted Solder APIs | Platform search or trending results, public builds with the recommended build first |

Search results and metadata are cached in memory for five minutes. FTB's catalog
is assembled from its public pack index with up to six requests at once; repeated
searches reuse it. Technic returns a bounded search/trending list rather than a
documented paginated total; Aurum paginates the returned list locally. Unsupported
filter controls are hidden rather than applied to incomplete metadata.

## Accounts and publisher restrictions

Public browsing, version selection and file downloads tested for these providers
do not require a service account or API key. Aurum therefore does not ask players
for ATLauncher/FTB/Technic passwords or add an unnecessary registration screen.
These APIs do not expose a common player sign-in flow for unlocking arbitrary
private packs. Private/unlisted packs, Solder administrator keys and publisher
accounts are outside this integration. A provider's HTTP 401/403 is reported as an
access error with the project website available; it is never treated as a request
for Microsoft credentials.

Some authors restrict files to browser downloads. The installation panel lists
those files, opens the publisher's download page and lets the player choose the
downloaded file. Its supplied checksum must match before it can be installed.
An existing CurseForge API key can resolve FTB files whose manifest supplies only
a CurseForge reference; otherwise the browser-file workflow is used. Aurum does
not manufacture download URLs to evade author restrictions.

## Installation and compatibility

Downloads use HTTPS and the SHA-256, SHA-1 or MD5 checksum supplied by the
provider. MD5 is needed for older ATLauncher/Solder manifests. Single-ZIP Technic
packs do not always publish a checksum; those downloads rely on HTTPS. ZIPs are
extracted only into an isolated staging folder, with traversal, symlink and size
checks. Cancellation or failure removes staging; the instance is published only
after all required files pass. Database-write failures roll back the instance.
No pack installation hooks or publisher-provided executables are run.

FTB target loaders and ATLauncher loader metadata use Aurum's existing loader
installation. Technic additionally reads `bin/version.json` or the version
metadata inside `bin/modpack.jar` to recognize Forge, NeoForge, Fabric and Quilt.
ATLauncher uses the author's defaults for optional mods, lets the player change
them, and includes required optional dependencies.

This is not a claim of compatibility with every historical pack. Legacy jar
patches, custom Java libraries and unsupported ATLauncher component/extraction
types fail explicitly rather than creating a silently incomplete instance.
Archives and old download hosts removed by their owners cannot be repaired by
signing in. Full game launches for every historical pack have not been verified.

## API identity and references

Requests identify the application as
`AurumLauncher/<package version> (+https://github.com/d3ede/aurum-launcher)`.
Technic requests also use the application's own `build=aurum` identifier. Aurum
does not impersonate Prism, the Technic launcher or another API client.

- [ATLauncher v1 public API](https://wiki.atlauncher.com/api-docs/v1/public/pack/)
- [ATLauncher public pack list](https://api.atlauncher.com/v1/packs/full/all)
- [FTB API policy and endpoint migration](https://feed-the-beast.com/blog/p/ftb-api)
- [Technic Platform API guidance](https://forums.technicpack.net/topic/125018-technic-api/)
- [Technic Solder read API](https://docs.solder.io/api/)
- [Prism's platform integrations](https://github.com/PrismLauncher/PrismLauncher/tree/develop/launcher/modplatform)

Prism's installed catalog layout and public protocol adapters were consulted as
behavioral references. Aurum's adapters are independently implemented; no Prism
source or binary is bundled. Provider names identify their services; Aurum is an
independent launcher.

## Verification

Rust fixtures cover public catalog filtering/pagination, optional dependencies,
manual checksums, server-only exclusion, target loaders, Solder extraction,
path rejection, unsupported legacy patches, cancellation and persistence
rollback. Headless UI scenarios cover source selection, anonymous installation,
version changes, optional/browser files and actionable unsupported-pack errors.

An opt-in network test exercises real searches, versions and installation plans
for All The Forge 6, FTB Evolution and The 1.12.2 Pack, then downloads and verifies
one small component per provider. It uses only `.test-data/` and no player account:

```powershell
.\scripts\cargo.ps1 -CargoArguments @('test','-p','auren-core','--test','pack_catalog_live','--','--ignored','--nocapture')
```

This live check does not download or launch all three complete modpacks.
