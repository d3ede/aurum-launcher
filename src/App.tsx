import { t, tMessage } from "./lib/i18n";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  Home as HomeIcon,
  Layers3,
  Compass,
  UserRound,
  Shirt,
  Settings2,
  Search,
  Moon,
  Sun,
  Activity,
  ChevronRight,
  X,
  Download,
  LoaderCircle,
  Monitor,
} from "lucide-react";
import { Provider, useApp } from "./context";
import { native, rpc } from "./lib/api";
import { progressAmount } from "./lib/progress";
import { WindowControls } from "./components/WindowControls";
import { ru } from "./lib/i18n";
import type { Profile, Project, Route, CatalogTarget, Kind } from "./types";
import { MicrosoftLogin } from "./components/MicrosoftLogin";
import { Logo, Modal } from "./components/ui";
import { CreateProfile, ProfileDialog } from "./components/ProfileDialog";
import { Home } from "./screens/Home";
import { Profiles } from "./screens/Profiles";
import { ProjectDialog } from "./screens/Catalog";
import { Catalog } from "./screens/CatalogBrowser";
const Accounts = lazy(() =>
  import("./screens/Accounts").then((module) => ({ default: module.Accounts })),
);
const Skins = lazy(() =>
  import("./screens/Skins").then((module) => ({ default: module.Skins })),
);
import { Settings } from "./screens/Settings";
const navigation = [
  ["home", HomeIcon],
  ["profiles", Layers3],
  ["catalog", Compass],
  ["accounts", UserRound],
  ["skins", Shirt],
  ["settings", Settings2],
] as const;
function Shell({
  creating,
  setCreating,
}: {
  creating: boolean;
  setCreating: (v: boolean) => void;
}) {
  const { data, route, navigate, run, progress, logs, notify } = useApp();
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [catalogTarget, setCatalogTarget] = useState<CatalogTarget>({
    profileId: "",
    kind: "mod",
  });
  const [project, setProject] = useState<Project | null>(null);
  const [importing, setImporting] = useState(false);
  const [activity, setActivity] = useState(false);
  const account = data.accounts.find((a) => a.id === data.selectedAccount);
  useEffect(() => {
    if (route !== "profiles") setProfile(null);
  }, [route]);
  const openProfile = (p: Profile) => {
    navigate("profiles");
    setProfile(p);
  };
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const theme = native
        ? data.settings.theme
        : localStorage.getItem("auren:theme") || data.settings.theme;
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [data.settings.theme]);
  const toggleTheme = () => {
    const theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    if (native)
      void run(() =>
        rpc("saveSettings", { settings: { ...data.settings, theme } }),
      );
    else {
      localStorage.setItem("auren:theme", theme);
      document.documentElement.dataset.theme = theme;
    }
  };
  const nav = (r: Route) => {
    setProfile(null);
    navigate(r);
    document.querySelector(".content-scroll")?.scrollTo(0, 0);
  };
  const findProjects = (p: Profile, kind: Kind) => {
    setCatalogTarget({ profileId: p.id, kind });
    setQuery("");
    nav("catalog");
  };
  return (
    <div className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <button
          className="titlebar-brand"
          onClick={() => nav("home")}
          aria-label={t("Aurum \u2014 главная")}
        >
          <Logo small />
          <b>Aurum</b>
        </button>
        <div className="window-title" data-tauri-drag-region>
          {profile?.name || ru.routes[route]}
        </div>
        <div className="topbar-actions">
          <form
            className="header-search"
            onSubmit={(e) => {
              e.preventDefault();
              nav("catalog");
            }}
          >
            <Search size={17} />
            <input
              aria-label={t("Быстрый поиск в каталоге")}
              placeholder={t("Поиск проектов")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              className="search-submit"
              aria-label={t("Запустить поиск")}
              title={t("Найти проекты (Enter)")}
            >
              <span aria-hidden="true">↵</span>
            </button>
          </form>
          <button
            className="icon-button theme-toggle"
            aria-label={t("Переключить тему")}
            onClick={toggleTheme}
          >
            <Sun size={19} className="sun-icon" />
            <Moon size={19} className="moon-icon" />
          </button>
          <button
            className="icon-button"
            aria-label={t("Журнал операций")}
            onClick={() => setActivity(true)}
          >
            <Activity size={19} />
            {data.running.length > 0 && <i className="activity-dot" />}
          </button>
          <span className="topbar-divider" />
          <button className="user-button" onClick={() => nav("accounts")}>
            <div className="mini-avatar">
              <UserRound size={18} />
            </div>
            <span>
              <b>{account?.name || t("Ваш профиль")}</b>
              <small>
                <i
                  className={`status-dot ${account?.kind === "microsoft" ? "online" : ""}`}
                />
                {account
                  ? account.kind === "microsoft"
                    ? "Microsoft"
                    : t("Локальный")
                  : t("Добавить аккаунт")}
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>
        <WindowControls onError={notify} />
      </header>
      <aside className="sidebar">
        <nav>
          {navigation.map(([id, Icon]) => (
            <button
              key={id}
              className={`nav-item ${route === id ? "active" : ""}`}
              aria-current={route === id ? "page" : undefined}
              aria-label={ru.routes[id]}
              onClick={() => nav(id)}
            >
              <Icon size={19} />
              <span>{ru.routes[id]}</span>
              {id === "profiles" && data.profiles.length > 0 && (
                <small>{data.profiles.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-version">
            <span>
              Aurum <b>0.3.1</b>
            </span>
            <button
              aria-label={t("Настройки Aurum")}
              onClick={() => nav("settings")}
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <div className="content-scroll">
          <main className="page-content" key={route}>
            {!native && (
              <div className="preview-notice">
                <Monitor size={15} />
                <span>
                  {t(
                    "Просмотр интерфейса в браузере. Игровые функции доступны в desktop-приложении Aurum.",
                  )}
                </span>
              </div>
            )}
            {profile ? (
              <ProfileDialog
                key={profile.id}
                initial={profile}
                onClose={() => {
                  setProfile(null);
                  navigate("profiles");
                }}
                onFindProjects={findProjects}
              />
            ) : (
              <>
                {route === "home" && (
                  <Home onProfile={openProfile} onProject={setProject} onFolderImport={() => setImporting(true)} />
                )}{" "}
                {route === "profiles" && (
                  <Profiles
                    onProfile={openProfile}
                    onFolderImport={() => setImporting(true)}
                  />
                )}{" "}
                {route === "catalog" && (
                  <Catalog
                    query={query}
                    setQuery={setQuery}
                    onProject={setProject}
                    target={catalogTarget}
                    setTarget={setCatalogTarget}
                  />
                )}{" "}
                {route === "accounts" && (
                  <Suspense
                    fallback={
                      <div className="loading">
                        {t("Открываем аккаунты\u2026")}
                      </div>
                    }
                  >
                    <Accounts />
                  </Suspense>
                )}{" "}
                {route === "skins" && (
                  <Suspense
                    fallback={
                      <div className="loading">{t("Открываем скины…")}</div>
                    }
                  >
                    <Skins />
                  </Suspense>
                )}
                {route === "settings" && <Settings />}
              </>
            )}
          </main>
        </div>
        <footer className="statusbar">
          <span>
            <i className={`status-dot ${native ? "online" : ""}`} />
            {data.running.length
              ? t("Игра запущена \u00B7 {{v1}}", { v1: data.running.length })
              : native
                ? t("Готов")
                : t("Просмотр интерфейса")}
          </span>
          <button onClick={() => setActivity(true)}>
            <Activity size={13} />
            {t(" Журнал")}
          </button>
        </footer>
      </div>
      {creating && (
        <CreateProfile
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setProfile(p);
            navigate("profiles");
          }}
        />
      )}{" "}
      {importing && (
        <CreateProfile folderImport onClose={() => setImporting(false)} />
      )}{" "}
      {project && (
        <ProjectDialog
          project={project}
          initialProfileId={catalogTarget.profileId}
          onClose={() => setProject(null)}
        />
      )}{" "}
      {activity && (
        <Modal
          title={t("Журнал операций")}
          subtitle={t("События установки и запуска в этой сессии")}
          wide
          onClose={() => setActivity(false)}
        >
          <pre className="game-log">
            {logs.length
              ? logs.map((l, i) => (
                  <span key={i}>
                    {l.phase}: {l.message}
                    {"\n"}
                  </span>
                ))
              : t("События появятся после установки или запуска Minecraft.")}
          </pre>
        </Modal>
      )}
      <MicrosoftLogin />
      {progress && (
        <section className="operation-panel" aria-live="polite">
          <div className="operation-header">
            <div className="operation-symbol">
              <Download size={19} />
            </div>
            <div>
              <b>{ru.phases[progress.phase] || t("Операция Aurum")}</b>
              <small>{tMessage(progress.message)}</small>
            </div>
            <button
              className="icon-button"
              aria-label={t("Отменить операцию")}
              onClick={() =>
                void rpc("cancel", { operationId: progress.id }).catch((e) =>
                  notify(e.message, true),
                )
              }
            >
              <X size={17} />
            </button>
          </div>
          {progress.total > 0 ? (
            <>
              <progress max={progress.total} value={progress.done} />
              <div className="progress-meta">
                <span>
                  {progressAmount(progress)}
                </span>
                <span>
                  {Math.round((progress.done / progress.total) * 100)}%
                </span>
              </div>
            </>
          ) : (
            <div className="indeterminate-progress" />
          )}
        </section>
      )}
    </div>
  );
}
export default function App() {
  const [creating, setCreating] = useState(false);
  return (
    <Provider onCreate={() => setCreating(true)}>
      <Shell creating={creating} setCreating={setCreating} />
    </Provider>
  );
}
