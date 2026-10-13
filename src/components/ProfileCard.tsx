import { Play, Square, ChevronRight } from "lucide-react";
import { useApp } from "../context";
import type { Profile } from "../types";
import { ru } from "../lib/i18n";
import { rpc } from "../lib/api";
import { ProfileIcon } from "./ProfileIcon";
export function ProfileCard({
  profile,
  onOpen,
}: {
  profile: Profile;
  onOpen: () => void;
}) {
  const { data, busy, play, run } = useApp();
  const running = data.running.includes(profile.id);
  return (
    <article className="instance-card">
      <button
        className="instance-card-open"
        onClick={onOpen}
        aria-label={`Открыть ${profile.name}`}
      >
        <ProfileIcon profile={profile} />
        <div>
          <h3>{profile.name}</h3>
          <p>
            {ru.loaders[profile.loader]} · {profile.minecraft}
          </p>
        </div>
        <ChevronRight size={18} />
      </button>
      <div className="instance-card-footer">
        <span>
          {running
            ? "Запущена"
            : profile.installedVersion
              ? "Установлена"
              : "Готова к установке"}
        </span>
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            running
              ? void run(() => rpc("stop", { id: profile.id }))
              : void play(profile)
          }
        >
          {running ? <Square size={16} /> : <Play size={16} />}
          {running ? "Стоп" : "Играть"}
        </button>
      </div>
    </article>
  );
}
