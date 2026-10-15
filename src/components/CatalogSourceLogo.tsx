import modrinthLogo from "../assets/branding/modrinth.svg";
import curseforgeLogo from "../assets/branding/curseforge.svg";

export function CatalogSourceLogo({
  source,
  size = 22,
}: {
  source: string;
  size?: number;
}) {
  if (["atlauncher", "ftb", "technic"].includes(source))
    return (
      <span
        className={`catalog-source-logo catalog-source-monogram ${source}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {source === "atlauncher" ? "AT" : source === "ftb" ? "FTB" : "T"}
      </span>
    );
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
