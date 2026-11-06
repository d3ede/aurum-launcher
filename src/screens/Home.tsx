import { t } from "../lib/i18n";
import {
  Plus,
  ArrowRight,
  Compass,
  Download,
  Play,
  Square,
  Settings2,
  Settings,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../context";
import { native, rpc } from "../lib/api";
import { formatNumber, ru } from "../lib/i18n";
import type { Profile, Project, RecentServer } from "../types";
import { ProfileCard } from "../components/ProfileCard";
import { ProfileIcon } from "../components/ProfileIcon";
import { ErrorBox, Loading } from "../components/ui";
import { HomePattern } from "../components/TerrainPattern";
import { ImportProfileButton } from "../components/ImportProfileButton";
import { HomeSidebar } from "../components/HomeSidebar";
import { RecentServers } from "../components/RecentServers";
import { preferences } from "../lib/personalization";
export function Home({
  onProfile,
  onProject,
  onFolderImport,
}: {
  onProfile: (p: Profile, section?: "settings") => void;
  onProject: (p: Project) => void;
  onFolderImport: () => void;
}) {
  const { data, navigate, create, play, run, busy, openSettings } = useApp();
  const home = preferences(data.settings).home;
  const [lastServer, setLastServer] = useState<RecentServer | null>(null);
  const [serverError, setServerError] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(native);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!native || home.discovery === "hidden") return;
    let live = true;
    setLoading(true);
    setProjects([]);
    setError("");
    rpc("search", {
      query: {
        query: "",
        source: home.discovery === "curseforge" ? "curseforge" : "modrinth",
        kind: home.discovery === "modpacks" ? "modpack" : "mod",
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
  }, [retry, home.discovery]);
  useEffect(() => {
    if (!native || home.launch !== "last-server" || !data.serverManager) return;
    let live = true;
    const load = () =>
      rpc("recentServers", {})
        .then((servers) => {
          if (!live) return;
          setLastServer(
            servers
              .filter((s) => data.profiles.some((p) => p.id === s.profileId))
              .sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || null,
          );
          setServerError(false);
        })
        .catch(() => {
          if (live) setServerError(true);
        });
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [home.launch, data.serverManager, data.profiles, retry]);
  const ordered = [...data.profiles].sort(
    (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0),
  );
  const last =
    home.launch === "profile"
      ? data.profiles.find((p) => p.id === home.profileId)
      : home.launch === "last-server"
        ? data.profiles.find((p) => p.id === lastServer?.profileId)
        : ordered[0];
  const recent = ordered
    .filter(
      (p) =>
        home.repeatProfile || home.launch === "hidden" || p.id !== last?.id,
    )
    .slice(0, home.profileCount);
  const running = last && data.running.includes(last.id);
  const sections = {
    launch:
      home.launch !== "hidden" ? (
        <section
          className={
            "quick-launch" +
            (home.background && home.backgroundTarget === "launch"
              ? " custom-launch-background"
              : "")
          }
          style={
            home.background && home.backgroundTarget === "launch"
              ? {
                  backgroundImage:
                    "linear-gradient(var(--surface-translucent), var(--surface-translucent)), url(" +
                    JSON.stringify(home.background) +
                    ")",
                }
              : undefined
          }
        >
          {!(home.background && home.backgroundTarget === "launch") && (
            <HomePattern />
          )}
          {last ? (
            <>
              <ProfileIcon profile={last} size={84} />
              <div className="quick-launch-info">
                <span>
                  {home.launch === "last-server"
                    ? t("Последний сервер")
                    : t("Быстрый запуск")}
                </span>
                <button onClick={() => onProfile(last)}>
                  {home.launch === "last-server" ? lastServer?.name : last.name}
                </button>
                <p>
                  {home.launch === "last-server" && (
                    <>
                      {lastServer?.address} · {last.name} ·{" "}
                    </>
                  )}
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
                className={`button launch-button ${running ? "stop" : "primary"}`}
                disabled={busy}
                onClick={() =>
                  running
                    ? void run(() => rpc("stop", { id: last.id }))
                    : void play(
                        last,
                        home.launch === "last-server"
                          ? lastServer?.address
                          : undefined,
                      )
                }
              >
                {running ? <Square size={18} /> : <Play size={18} />}
                {running ? t("Остановить") : t("Играть")}
              </button>
            </>
          ) : (
            <>
              <div className="quick-launch-info">
                <h2>
                  {home.launch === "last-server"
                    ? t(
                        serverError
                          ? "Не удалось загрузить серверы"
                          : "Пока нет недавних серверов",
                      )
                    : home.launch === "profile" && data.profiles.length
                      ? t("Выберите сборку для быстрого запуска")
                      : t("Создайте первую сборку")}
                </h2>
                <p>
                  {home.launch === "last-server"
                    ? t("Сервер появится здесь после первого подключения.")
                    : t("Выберите версию Minecraft и загрузчик.")}
                </p>
              </div>
              <button
                className="button primary"
                onClick={() =>
                  home.launch === "last-server" && serverError
                    ? setRetry((v) => v + 1)
                    : data.profiles.length
                      ? openSettings("home")
                      : create()
                }
              >
                <Plus size={18} />
                {home.launch === "last-server" && serverError
                  ? t("Повторить")
                  : data.profiles.length
                    ? t("Настроить главную")
                    : t(" Создать сборку")}
              </button>
            </>
          )}
        </section>
      ) : null,
    servers:
      home.serverCount > 0 ? (
        <RecentServers onProfile={onProfile} limit={home.serverCount} />
      ) : null,
    profiles: recent.length > 0 && (
      <section className="section">
        <div className="section-heading">
          <h2>{t("Недавние сборки")}</h2>
          <button className="text-button" onClick={() => navigate("profiles")}>
            {t("Все сборки ")}
            <ArrowRight size={18} />
          </button>
        </div>
        <div className="profile-grid">
          {recent.map((p) => (
            <ProfileCard key={p.id} profile={p} onOpen={() => onProfile(p)} />
          ))}
        </div>
      </section>
    ),
    discover:
      home.discovery !== "hidden" ? (
        <section className="section recommendations">
          <div className="section-heading">
            <h2>
              {t(
                home.discovery === "curseforge"
                  ? "Популярное в CurseForge"
                  : home.discovery === "modpacks"
                    ? "Сборки из Modrinth"
                    : "Популярное в Modrinth",
              )}
            </h2>
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
      ) : null,
  };
  return (
    <div
      className={
        "home-layout" +
        (home.sidebar ? "" : " no-home-sidebar") +
        (home.background && home.backgroundTarget === "page"
          ? " custom-home-background"
          : "")
      }
      style={
        home.background && home.backgroundTarget === "page"
          ? {
              backgroundImage:
                "linear-gradient(var(--surface-translucent), var(--surface-translucent)), url(" +
                JSON.stringify(home.background) +
                ")",
            }
          : undefined
      }
    >
      <div className="home-primary">
        <div className="page-heading heading-row home-heading">
          <h1>{t("Главная")}</h1>
          <div className="button-row">
            <button
              className="button secondary home-customize"
              aria-label={t("Настроить главную")}
              title={t("Настроить главную")}
              onClick={() => openSettings("home")}
            >
              <Settings size={18} />
            </button>
            <ImportProfileButton onFolderImport={onFolderImport} />
            <button className="button secondary" onClick={create}>
              <Plus size={18} />
              {t(" Новая сборка")}
            </button>
          </div>
        </div>
        {home.order.map((id) => (
          <div className="home-block-slot" key={id} data-home-block={id}>
            {sections[id]}
          </div>
        ))}
      </div>
      {home.sidebar && <HomeSidebar />}
    </div>
  );
}
