import {
  Server,
  Leaf,
  Gem,
  Box,
  Network,
  Flame,
  Layers3,
  Droplet,
  Send,
  Zap,
} from "lucide-react";
import paper from "../assets/hosting/paper.svg";
import folia from "../assets/hosting/folia.svg";
import velocity from "../assets/hosting/velocity-white.svg";
import purpur from "../assets/hosting/purpur.svg";
import spigot from "../assets/hosting/spigot.svg";
import type { HostingProfile } from "../lib/hosting";
import { hostingCores } from "../lib/hosting";

export const hostingSymbols = [
  { id: "core", Icon: Layers3, label: "Значок ядра" },
  { id: "paper", Icon: Send, label: "Paper" },
  { id: "spigot", Icon: Droplet, label: "Spigot" },
  { id: "folia", Icon: Leaf, label: "Folia" },
  { id: "velocity", Icon: Zap, label: "Velocity" },
  { id: "purpur", Icon: Gem, label: "Purpur" },
  { id: "fabric", Icon: Box, label: "Fabric" },
  { id: "vanilla", Icon: Box, label: "Vanilla" },
  { id: "server", Icon: Server, label: "Сервер" },
  { id: "leaf", Icon: Leaf, label: "Лист" },
  { id: "gem", Icon: Gem, label: "Кристалл" },
  { id: "box", Icon: Box, label: "Блок" },
  { id: "network", Icon: Network, label: "Сеть" },
  { id: "flame", Icon: Flame, label: "Пламя" },
];
const hostingBrands: Record<string, { source: string; mask?: boolean }> = {
  paper: { source: paper, mask: true },
  folia: { source: folia, mask: true },
  velocity: { source: velocity },
  purpur: { source: purpur, mask: true },
  spigot: { source: spigot, mask: true },
};
export const hasHostingBrand = (core: string) => !!hostingBrands[core];
export const canTintHostingIcon = (core: string) => core !== "velocity";
export function HostingIcon({
  profile,
  size = 48,
  variant = "tile",
}: {
  profile: Pick<HostingProfile, "icon" | "core">;
  size?: number;
  variant?: "tile" | "glyph";
}) {
  const iconCore =
    profile.icon.symbol === "core" ? profile.core : profile.icon.symbol;
  const brand = hostingBrands[iconCore];
  const coreSymbol =
    profile.core === "network"
      ? "network"
      : profile.core === "folia"
        ? "leaf"
        : profile.core === "purpur"
          ? "gem"
          : profile.core === "vanilla"
            ? "box"
            : "server";
  const Symbol =
    hostingSymbols.find(
      (symbol) =>
        symbol.id ===
        (profile.icon.symbol === "core" ? coreSymbol : profile.icon.symbol),
    )?.Icon || Server;
  return (
    <span
      className={`hosting-icon${variant === "glyph" ? " hosting-core-glyph" : ""}`}
      style={{
        width: size,
        height: size,
        color: profile.icon.color,
        background:
          variant === "glyph" ? "transparent" : profile.icon.background,
      }}
    >
      {brand?.mask ? (
        <span
          className="hosting-brand-mask"
          role="img"
          aria-label={hostingCores[iconCore]}
          style={{
            maskImage: `url("${brand.source}")`,
            WebkitMaskImage: `url("${brand.source}")`,
          }}
        />
      ) : brand ? (
        <img src={brand.source} alt={hostingCores[iconCore] || iconCore} />
      ) : (
        <Symbol size={size * 0.53} aria-hidden="true" />
      )}
    </span>
  );
}
