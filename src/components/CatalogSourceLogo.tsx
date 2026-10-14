import modrinthLogo from "../assets/branding/modrinth.svg";
import curseforgeLogo from "../assets/branding/curseforge.svg";

export function CatalogSourceLogo({
  source,
  size = 22,
}: {
  source: string;
  size?: number;
}) {
  return (
    <img
      className="catalog-source-logo"
      src={source === "curseforge" ? curseforgeLogo : modrinthLogo}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}
