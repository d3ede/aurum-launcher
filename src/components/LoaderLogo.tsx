import type { CSSProperties } from "react";
import fabric from "../assets/loaders/fabric.png";
import forge from "../assets/loaders/forge.png";
import neoforge from "../assets/loaders/neoforge.png";
import quilt from "../assets/loaders/quilt.svg";
import vanilla from "../assets/loaders/vanilla.svg";
import vanillaMask from "../assets/loaders/grass-block.png";
import fabricMask from "../assets/loaders/fabric-mask.svg";
import horizon from "../assets/loaders/horizon.svg";
import forgeMask from "../assets/loaders/forge-mask.png";
import quiltMask from "../assets/loaders/quilt-mask.svg";
import neoforgeMask from "../assets/loaders/neoforge-mask.svg";
import horizonMask from "../assets/loaders/horizon-mask.svg";

export const loaderBrands = {
  vanilla: { name: "Vanilla", source: vanilla, mask: vanillaMask },
  fabric: { name: "Fabric", source: fabric, mask: fabricMask },
  forge: { name: "Forge", source: forge, mask: forgeMask },
  neoforge: { name: "NeoForge", source: neoforge, mask: neoforgeMask },
  quilt: { name: "Quilt", source: quilt, mask: quiltMask },
  horizon: { name: "Horizon", source: horizon, mask: horizonMask },
};
export type LoaderBrand = keyof typeof loaderBrands;

export function LoaderLogo({
  brand,
  size = 22,
}: {
  brand: LoaderBrand;
  size?: number;
}) {
  return (
    <img
      className="loader-logo"
      src={loaderBrands[brand].source}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}

const glyph = (brand: LoaderBrand) =>
  function BrandGlyph({
    size = 24,
  }: {
    size?: string | number;
    "aria-hidden"?: boolean | "true" | "false";
  }) {
    return (
      <span
        className="loader-glyph"
        aria-hidden="true"
        style={
          {
            width: size,
            height: size,
            maskImage: `url("${loaderBrands[brand].mask}")`,
            WebkitMaskImage: `url("${loaderBrands[brand].mask}")`,
          } as CSSProperties
        }
      />
    );
  };
export const FabricGlyph = glyph("fabric");
export const ForgeGlyph = glyph("forge");
export const NeoForgeGlyph = glyph("neoforge");
export const QuiltGlyph = glyph("quilt");
export const VanillaGlyph = glyph("vanilla");
export const HorizonGlyph = glyph("horizon");
