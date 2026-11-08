# Loader identifying marks

The original color PNGs (`fabric`, `forge`, `neoforge`, `grass-block`)
come from the upstream [Horizon launcher assets](https://github.com/horizon-rust/horizon/tree/main/launcher/assets/logos),
downloaded on 2026-11-05. They identify the corresponding engine or loader and
do not imply endorsement of Aurum. These marks are excluded from Aurum's
PolyForm license; their respective owners retain their rights.

- Fabric: FabricMC's project mark, [fabricmc.net](https://fabricmc.net/).
  `fabric.svg` traces the original `fabric.png` palette regions with smoothed
  pixel corners, retaining the original fold, orientation and beige palette
  for small selectors.
- Forge: Minecraft Forge's anvil mark, [minecraftforge.net](https://minecraftforge.net/).
- NeoForge: the project mark by Ridanisaurus, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
  [NeoForged artwork](https://github.com/neoforged/.github/tree/main/art). The editable
  `neoforge-mask.svg` uses the original fox silhouette from `neoforge.png`,
  with smoothed pixel corners and no gray backing plate. Ears, eyes and nose
  are transparent cutouts in a solid, tintable mark; palette shading is omitted.
  Attribution and the adaptation are recorded here; see `NEOFORGE-LICENSE`.
- Quilt: QuiltMC's project mark, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/),
  [QuiltMC/art](https://github.com/QuiltMC/art/tree/master/brand/svg).
  `quilt.svg` is the upstream transparent logo; `quilt-mask.svg` is its upstream
  transparent white variant, unmodified. See `QUILT-LICENSE`.
- Vanilla: Minecraft's rendered grass-block identifying artwork belongs to
  Mojang/Microsoft. It is not licensed under MIT or PolyForm.
  `vanilla.svg` is an Aurum-drawn geometric grass block for small selectors,
  with equal-width cube faces and a full-height silhouette.
- Horizon: `horizon.svg` is the unmodified [upstream application icon](https://github.com/horizon-rust/horizon/blob/main/packaging/icons/hicolor/scalable/apps/horizon.svg),
  MIT, Copyright (c) 2026 Ludovic Marie and the Horizon contributors. The
  `horizon-mask.svg` monochrome adaptation retains its H and horizon-line motif.
  The license is preserved in `HORIZON-LICENSE`.

The color selector uses the original images, except for the smooth Fabric
roll and geometric Vanilla block. The instance icon editor offers
monochrome adaptations for user-selected colors. `forge-mask.png` removes the
original background using `scripts/loader-masks.ps1`. Fabric uses the opaque
palette regions from `fabric.svg` in `src/components/FabricGlyph.tsx`: shadows
mix the selected color with black and highlights mix it with white. Its fold,
cloth texture and shaded rim remain visible independently of the tile background;
brightness is not encoded as transparency. This textured rendering is shared by
hosting and the instance icon editor. NeoForge uses its monochrome SVG mask.
The Vanilla mask uses the original alpha channel. Colors and backgrounds
chosen for an instance are user customization, not replacement official logos.

Horizon executables are not bundled. They are downloaded from upstream GitHub
Releases only when a signed-in Java Edition owner installs a Horizon instance.
The complete upstream archive, including its LICENSE, is retained on installation.
Mojang game files and prepared resources are downloaded/prepared locally for the
owner and are never included in the Aurum installer.
