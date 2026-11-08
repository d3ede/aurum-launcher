import { t } from "../lib/i18n";
import { Play, Square, ChevronRight } from "lucide-react";
import { useApp } from "../context";
import type { Profile } from "../types";
import { ru } from "../lib/i18n";
import { rpc } from "../lib/api";
import { ProfileIcon } from "./ProfileIcon";
import { ProfileActions } from "./ProfileActions";
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
  const action = running
    ? t("Стоп")
    : profile.installedVersion
      ? t("Играть")
      : t("Установить и играть");
  const launch = (
    <button
      className={`button launch-button ${running ? "stop" : "primary"}${layout === "row" ? " instance-card-play" : ""}`}
      aria-label={action}
      data-install-required={
        (!running && !profile.installedVersion) || undefined
      }
      title={`${action} · ${profile.name}`}
      disabled={busy}
      onClick={() =>
        running
          ? void run(() => rpc("stop", { id: profile.id }))
          : void play(profile)
      }
    >
      {running ? (
        <Square size={layout === "row" ? 18 : 16} />
      ) : (
        <Play size={layout === "row" ? 20 : 16} />
      )}
      <span className="instance-card-launch-label">{action}</span>
    </button>
  );
  if (layout === "row") {
    return (
      <article
        className="instance-card instance-card-row"
        onClick={(event) => {
          if (!(event.target as Element).closest("button")) onOpen();
        }}
      >
        <div className="instance-card-grip">{reorderHandle}</div>
        <button
          className="instance-card-open"
          onClick={onOpen}
          aria-label={t("Открыть {{v1}}", { v1: profile.name })}
        >
          <ProfileIcon profile={profile} size={52} />
          <div>
            <h3>{profile.name}</h3>
            <p>
              {profile.engine === "horizon"
                ? "Horizon"
                : ru.loaders[profile.loader]}{" "}
              · {profile.minecraft}
            </p>
            <span
              className={`instance-card-status ${running ? "is-running" : installing ? "is-installing" : profile.installedVersion ? "is-installed" : "is-pending"}`}
              title={status}
            >
              <i aria-hidden="true" />
              <span className="instance-card-status-label">{status}</span>
            </span>
          </div>
        </button>
        <div className="instance-card-launch">{launch}</div>
        <div className="instance-card-menu">
          <ProfileActions profile={profile} />
        </div>
        <ChevronRight
          className="instance-card-chevron"
          size={16}
          aria-hidden="true"
        />
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
            {profile.engine === "horizon"
              ? "Horizon"
              : ru.loaders[profile.loader]}{" "}
            · {profile.minecraft}
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
