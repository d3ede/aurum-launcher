import { t } from "../lib/i18n";
import {
  Plus,
  ArrowRight,
  Compass,
  Download,
  Play,
  Square,
  Settings2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../context";
import { native, rpc } from "../lib/api";
import { formatNumber, ru } from "../lib/i18n";
import type { Profile, Project } from "../types";
import { ProfileCard } from "../components/ProfileCard";
import { ProfileIcon } from "../components/ProfileIcon";
import { ErrorBox, Loading } from "../components/ui";
import { HomePattern } from "../components/TerrainPattern";
import { ImportProfileButton } from "../components/ImportProfileButton";
import { HomeSidebar } from "../components/HomeSidebar";
import { RecentServers } from "../components/RecentServers";
export function Home({
  onProfile,
  onProject,
  onFolderImport,
}: {
  onProfile: (p: Profile, section?: "settings") => void;
  onProject: (p: Project) => void;
  onFolderImport: () => void;
}) {
  const { data, navigate, create, play, run, busy } = useApp();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(native);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!native) return;
    let live = true;
    setLoading(true);
    rpc("search", {
      query: {
        query: "",
        source: "modrinth",
        kind: "mod",
        minecraft: null,
        loader: null,
        offset: 0,
      },
    })
      .then((r) => {
        if (live) {
          setProjects(r.projects.slice(0, 4));
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [retry]);
  const ordered = [...data.profiles].sort(
    (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0),
  );
  const last = ordered[0];
  const recent = ordered.slice(1, 4);
  const running = last && data.running.includes(last.id);
  return (
    <div className="home-layout">
      <div className="home-primary">
        <div className="page-heading heading-row home-heading">
          <h1>{t("Главная")}</h1>
          <div className="button-row">
            <ImportProfileButton onFolderImport={onFolderImport} />
            <button className="button secondary" onClick={create}>
              <Plus size={18} />
              {t(" Новая сборка")}
            </button>
          </div>
        </div>
        <section className="quick-launch">
          <HomePattern />
          {last ? (
            <>
              <ProfileIcon profile={last} size={84} />
              <div className="quick-launch-info">
                <span>{t("Быстрый запуск")}</span>
                <button onClick={() => onProfile(last)}>{last.name}</button>
                <p>
                  Minecraft {last.minecraft} · {ru.loaders[last.loader]}
                </p>
                <div className="home-launch-meta">
                  <span
                    className={`home-profile-status ${running ? "running" : ""}`}
                  >
                    <i aria-hidden="true" />
                    {running
                      ? t("Запущена")
                      : last.installedVersion
                        ? t("Установлена")
                        : t("Готова к установке")}
                  </span>
                  <button
                    className="home-profile-settings"
                    onClick={() => onProfile(last, "settings")}
                    aria-label={t("Настройки сборки {{name}}", {
                      name: last.name,
                    })}
                  >
                    <Settings2 size={14} />
                    {t("Настройки")}
                  </button>
                </div>
              </div>
              <button
                className={`button ${running ? "stop" : "primary"}`}
                disabled={busy}
                onClick={() =>
                  running
                    ? void run(() => rpc("stop", { id: last.id }))
                    : void play(last)
                }
              >
                {running ? <Square size={18} /> : <Play size={18} />}
                {running ? t("Остановить") : t("Играть")}
              </button>
            </>
          ) : (
            <>
              <div className="quick-launch-info">
                <h2>{t("Создайте первую сборку")}</h2>
                <p>{t("Выберите версию Minecraft и загрузчик.")}</p>
              </div>
              <button className="button primary" onClick={create}>
                <Plus size={18} />
                {t(" Создать сборку")}
              </button>
            </>
          )}
        </section>
        <RecentServers onProfile={onProfile} />
        {recent.length > 0 && (
          <section className="section">
            <div className="section-heading">
              <h2>{t("Недавние сборки")}</h2>
              <button
                className="text-button"
                onClick={() => navigate("profiles")}
              >
                {t("Все сборки ")}
                <ArrowRight size={18} />
              </button>
            </div>
            <div className="profile-grid">
              {recent.map((p) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  onOpen={() => onProfile(p)}
                />
              ))}
            </div>
          </section>
        )}
        <section className="section recommendations">
          <div className="section-heading">
            <h2>{t("Популярное в Modrinth")}</h2>
            <button className="text-button" onClick={() => navigate("catalog")}>
              {t("Найти проекты ")}
              <ArrowRight size={18} />
            </button>
          </div>
          {loading ? (
            <Loading label={t("Получаем проекты\u2026")} />
          ) : error ? (
            <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
          ) : projects.length ? (
            <div className="recommended-list">
              {projects.map((p) => (
                <button
                  className="recommended-project"
                  key={p.id}
                  onClick={() => onProject(p)}
                >
                  {p.icon ? (
                    <img src={p.icon} alt="" loading="lazy" />
                  ) : (
                    <Compass size={28} />
                  )}
                  <div>
                    <b>{p.title}</b>
                    <p>{p.description}</p>
                    <small>
                      <Download size={14} /> {formatNumber(p.downloads)}
                    </small>
                  </div>
                  <ArrowRight size={18} />
                </button>
              ))}
            </div>
          ) : (
            <div className="catalog-placeholder">
              <Compass size={26} />
              <p>
                {native
                  ? t("Проекты не найдены")
                  : t("Каталог доступен в desktop-приложении")}
              </p>
            </div>
          )}
        </section>
      </div>
      <HomeSidebar />
    </div>
  );
}
