# Loader identifying marks

The original color PNGs (`fabric`, `forge`, `neoforge`, `grass-block`)
come from the upstream [Horizon launcher assets](https://github.com/horizon-rust/horizon/tree/main/launcher/assets/logos),
downloaded on 2026-11-05. They identify the corresponding engine or loader and
do not imply endorsement of Aurum. These marks are excluded from Aurum's
PolyForm license; their respective owners retain their rights.

- Fabric: FabricMC's project mark, [fabricmc.net](https://fabricmc.net/).
- Forge: Minecraft Forge's anvil mark, [minecraftforge.net](https://minecraftforge.net/).
- NeoForge: the project mark by Ridanisaurus, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
  [NeoForged artwork](https://github.com/neoforged/.github/tree/main/art). The editable
  `neoforge-mask.svg` is a monochrome pixel silhouette adapted from the fox in
  `neoforged_icon_16x16.png`, with the gray backing plate removed.
  Attribution and the adaptation are recorded here; see `NEOFORGE-LICENSE`.
- Quilt: QuiltMC's project mark, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/),
  [QuiltMC/art](https://github.com/QuiltMC/art/tree/master/brand/svg).
  `quilt.svg` is the upstream transparent logo; `quilt-mask.svg` is its upstream
  transparent white variant, unmodified. See `QUILT-LICENSE`.
- Vanilla: Minecraft's rendered grass-block identifying artwork belongs to
  Mojang/Microsoft. It is not licensed under MIT or PolyForm.
- Horizon: `horizon.svg` is the unmodified [upstream application icon](https://github.com/horizon-rust/horizon/blob/main/packaging/icons/hicolor/scalable/apps/horizon.svg),
  MIT, Copyright (c) 2026 Ludovic Marie and the Horizon contributors. The
  `horizon-mask.svg` monochrome adaptation retains its H and horizon-line motif.
  The license is preserved in `HORIZON-LICENSE`.

The color selector uses the original images. The instance icon editor offers
monochrome adaptations for user-selected colors. `forge-mask.png` removes the
original background using `scripts/loader-masks.ps1`; Fabric and Vanilla masks
use the original alpha channel. Colors and backgrounds
chosen for an instance are user customization, not replacement official logos.

Horizon executables are not bundled. They are downloaded from upstream GitHub
Releases only when a signed-in Java Edition owner installs a Horizon instance.
The complete upstream archive, including its LICENSE, is retained on installation.
Mojang game files and prepared resources are downloaded/prepared locally for the
owner and are never included in the Aurum installer.
