import { Package } from "lucide-react";
import { TerrainPattern } from "./TerrainPattern";
import { SocialAvatar } from "./SocialIdentity";
import type { SocialPerson, SocialWorld } from "../lib/social";
import { t } from "../lib/i18n";
import { useSocial } from "./SocialProvider";
export function SocialInviteHero({
  person,
  world,
  outgoing = false,
}: {
  person?: Pick<SocialPerson, "id" | "name" | "avatar">;
  world?: Pick<SocialWorld, "name" | "minecraft" | "loader">;
  outgoing?: boolean;
}) {
  const { snapshot } = useSocial();
  return (
    <div className="social-invite-hero">
      <TerrainPattern />
      <div className="social-invite-person">
        {person && (
          <SocialAvatar
            id={person.id}
            avatar={person.avatar}
            size={60}
            online={!!snapshot?.online.includes(person.id)}
          />
        )}
        <div>
          <span className="social-invite-eyebrow">
            {t(outgoing ? "@social.hero.to" : "@social.hero.from")}
          </span>
          <h3>{person?.name || t("@social.unknown")}</h3>
        </div>
      </div>
      {world && (
        <div className="social-invite-world">
          <Package size={22} />
          <div>
            <strong>{world.name}</strong>
            <span>
              Minecraft {world.minecraft} ·{" "}
              {world.loader.charAt(0).toUpperCase() + world.loader.slice(1)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
