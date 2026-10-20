import { t } from "../lib/i18n";
import { Play, Square, ChevronRight } from "lucide-react";
import { useApp } from "../context";
import type { Profile } from "../types";
import { ru } from "../lib/i18n";
import { rpc } from "../lib/api";
import { ProfileIcon } from "./ProfileIcon";
import type { ReactNode } from "react";
export function ProfileCard({
  profile,
  onOpen,
  reorderHandle,
}: {
  profile: Profile;
  onOpen: () => void;
  reorderHandle?: ReactNode;
}) {
  const { data, busy, play, run, progress } = useApp();
  const running = data.running.includes(profile.id);
  const installing =
    progress?.profileId === profile.id &&
    !profile.installedVersion &&
    !["complete", "error"].includes(progress.phase);
  return (
    <article className="instance-card">
      <button
        className="instance-card-open"
        onClick={onOpen}
        aria-label={t("Открыть {{v1}}", { v1: profile.name })}
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
          {reorderHandle}
          {running
            ? t("Запущена")
            : installing
              ? t("Устанавливается")
              : profile.installedVersion
                ? t("Установлена")
                : t("Готова к установке")}
        </span>
        <button
          className={`button ${running ? "stop" : "primary"}`}
          disabled={busy}
          onClick={() =>
            running
              ? void run(() => rpc("stop", { id: profile.id }))
              : void play(profile)
          }
        >
          {running ? <Square size={16} /> : <Play size={16} />}
          {running ? t("Стоп") : t("Играть")}
        </button>
      </div>
    </article>
  );
}
