import { Play, Square, ArrowUpRight, Package, Check } from "lucide-react";
import { useApp } from "../context";
import type { Profile } from "../types";
import { ru } from "../lib/i18n";
import { rpc } from "../lib/api";
import { Landscape } from "./Landscape";
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
    <article className="profile-card">
      <button
        className="profile-cover"
        onClick={onOpen}
        aria-label={`Открыть ${profile.name}`}
      >
        <Landscape variant={profile.cover} />
        <span className="cover-badge">{ru.loaders[profile.loader]}</span>
        <span className="cover-arrow">
          <ArrowUpRight size={16} />
        </span>
      </button>
      <div className="profile-info">
        <button className="profile-name" onClick={onOpen}>
          {profile.name}
        </button>
        <p>
          Minecraft {profile.minecraft} <span>·</span>{" "}
          {profile.installedVersion ? (
            <>
              <Check size={12} /> Установлена
            </>
          ) : (
            <>
              <Package size={12} /> Не установлена
            </>
          )}
        </p>
        <button
          className={`button ${running ? "secondary" : "play"}`}
          disabled={busy}
          onClick={() =>
            running
              ? void run(() => rpc("stop", { id: profile.id }))
              : void play(profile)
          }
        >
          {running ? <Square size={15} /> : <Play size={15} />}{" "}
          {running
            ? "Остановить"
            : profile.installedVersion
              ? "Играть"
              : "Установить и играть"}
        </button>
      </div>
    </article>
  );
}
