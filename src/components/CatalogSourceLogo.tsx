import modrinthLogo from "../assets/branding/modrinth.svg";
import curseforgeLogo from "../assets/branding/curseforge.svg";
import atlauncherLogo from "../assets/branding/atlauncher.svg";
import ftbLogo from "../assets/branding/ftb.svg";
import technicLogo from "../assets/branding/technic.png";
import { Layers } from "lucide-react";

const logos: Record<string, string> = {
  modrinth: modrinthLogo,
  curseforge: curseforgeLogo,
  atlauncher: atlauncherLogo,
  ftb: ftbLogo,
  technic: technicLogo,
};

export function CatalogSourceLogo({
  source,
  size = 24,
}: {
  source: string;
  size?: number;
}) {
  return (
    <span
      className="catalog-source-logo"
      data-source={source}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {source === "all" ? (
        <Layers size={size} />
      ) : (
        <img
          className="catalog-source-glyph"
          src={logos[source] || modrinthLogo}
          width={size}
          height={size}
          alt=""
        />
      )}
    </span>
  );
}
