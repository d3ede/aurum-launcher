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
  layout = "tile",
}: {
  profile: Profile;
  onOpen: () => void;
  reorderHandle?: ReactNode;
  layout?: "tile" | "row";
}) {
  const { data, busy, play, run, progress } = useApp();
  const running = data.running.includes(profile.id);
  const installing =
    progress?.profileId === profile.id &&
    !profile.installedVersion &&
    !["complete", "error"].includes(progress.phase);
  const status = running
    ? t("Запущена")
    : installing
      ? t("Устанавливается")
      : profile.installedVersion
        ? t("Установлена")
        : t("Готова к установке");
  const action = running ? t("Стоп") : t("Играть");
  const launch = (
    <button
      className={`button ${running ? "stop" : "primary"}${layout === "row" ? " instance-card-play" : ""}`}
      aria-label={action}
      title={`${action} · ${profile.name}`}
      disabled={busy}
      onClick={() =>
        running
          ? void run(() => rpc("stop", { id: profile.id }))
          : void play(profile)
      }
    >
      {running ? (
        <Square size={layout === "row" ? 21 : 16} />
      ) : (
        <Play size={layout === "row" ? 24 : 16} />
      )}
      {layout === "tile" && action}
    </button>
  );
  if (layout === "row") {
    return (
      <article className="instance-card instance-card-row">
        <div className="instance-card-grip">{reorderHandle}</div>
        <button
          className="instance-card-open"
          onClick={onOpen}
          aria-label={t("Открыть {{v1}}", { v1: profile.name })}
        >
          <ProfileIcon profile={profile} size={72} />
          <div>
            <h3>{profile.name}</h3>
            <p>
              {ru.loaders[profile.loader]} · {profile.minecraft}
            </p>
            <span
              className={`instance-card-status ${running ? "is-running" : installing ? "is-installing" : profile.installedVersion ? "is-installed" : "is-pending"}`}
            >
              <i aria-hidden="true" />
              {status}
            </span>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
        <div className="instance-card-launch">{launch}</div>
      </article>
    );
  }
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
          {status}
        </span>
        {launch}
      </div>
    </article>
  );
}
