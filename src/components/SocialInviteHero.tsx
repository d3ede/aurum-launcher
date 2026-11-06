import { TerrainPattern } from "./TerrainPattern";
import { SocialAvatar } from "./SocialIdentity";
import type { SocialPerson, SocialWorld } from "../lib/social";
import { t } from "../lib/i18n";
import { useSocial } from "./SocialProvider";
export function SocialInviteHero({
  person,
  world,
}: {
  person?: Pick<SocialPerson, "id" | "name" | "avatar">;
  world?: Pick<SocialWorld, "name" | "minecraft" | "loader">;
}) {
  const { snapshot } = useSocial();
  return (
    <div className="social-invite-hero">
      <TerrainPattern />
      {person && (
        <SocialAvatar
          id={person.id}
          avatar={person.avatar}
          size={60}
          online={!!snapshot?.online.includes(person.id)}
        />
      )}
      <div>
        <strong>{person?.name || t("@social.unknown")}</strong>
        {world && (
          <>
            <h3>{world.name}</h3>
            <span>
              Minecraft {world.minecraft} ·{" "}
              {world.loader.charAt(0).toUpperCase() + world.loader.slice(1)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
