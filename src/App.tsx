import { t, tMessage } from "./lib/i18n";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
  Server,
  Users,
  Images,
} from "lucide-react";
import { Provider, useApp } from "./context";
import { native, rpc } from "./lib/api";
import { applyAppearance, applyFont, preferences } from "./lib/personalization";
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
const Hosting = lazy(() =>
  import("./screens/Hosting").then((module) => ({ default: module.Hosting })),
);
import { Settings } from "./screens/Settings";
import { UpdateProvider } from "./updater";
import { LauncherUpdateBanner } from "./components/LauncherUpdate";
import { APP_VERSION } from "./lib/version";
import { SidebarPattern } from "./components/TerrainPattern";
import { AccountAvatar } from "./components/AccountAvatar";
import { PackManualDownloads } from "./components/PackManualDownloads";
import { SocialProvider } from "./components/SocialProvider";
import {
  ScreenshotNotifications,
  ScreenshotsPage as Screenshots,
} from "./components/Screenshots";
const Friends = lazy(() =>
  import("./screens/Friends").then((module) => ({ default: module.Friends })),
);
const navigation = [
  ["home", HomeIcon],
  ["profiles", Layers3],
  ["catalog", Compass],
  ["screenshots", Images],
  ["accounts", UserRound],
  ["skins", Shirt],
  ["friends", Users],
  ["hosting", Server],
  ["settings", Settings2],
] as const;
function Shell({
  creating,
  setCreating,
}: {
  creating: boolean;
  setCreating: (v: boolean) => void;
}) {
  const {
    data,
    route,
    navigate,
    run,
    busy,
    progress,
    cancelOperation,
    logs,
    notify,
    saveSettings,
    openSettings,
  } = useApp();
  const appearance = preferences(data.settings).appearance;
  const savedThemeColors = JSON.stringify(appearance.themes);
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileSection, setProfileSection] = useState<"content" | "settings">(
    "content",
  );
  const [catalogTarget, setCatalogTarget] = useState<CatalogTarget>({
    profileId: "",
    kind: "mod",
  });
  const [project, setProject] = useState<Project | null>(null);
  const [importing, setImporting] = useState(false);
  const [activity, setActivity] = useState(false);
  const [manualProfileId, setManualProfileId] = useState<string | null>(null);
  // Existing incomplete imports belong in their instance, not in a startup modal.
  const shownManualProfiles = useRef(
    new Set(
      data.profiles.filter((p) => p.manualDownloads?.length).map((p) => p.id),
    ),
  );
  useEffect(() => {
    if (busy || project || importing || creating || manualProfileId) return;
    const pending = data.profiles.find(
      (p) =>
        p.manualDownloads?.length && !shownManualProfiles.current.has(p.id),
    );
    if (pending) {
      shownManualProfiles.current.add(pending.id);
      setManualProfileId(pending.id);
    }
  }, [data.profiles, busy, project, importing, creating, manualProfileId]);
  const manualProfile = data.profiles.find((p) => p.id === manualProfileId);
  const account = data.accounts.find((a) => a.id === data.selectedAccount);
  useEffect(() => {
    if (route !== "profiles") setProfile(null);
  }, [route]);
  const openProfile = (
    p: Profile,
    section: "content" | "settings" = "content",
  ) => {
    navigate("profiles");
    setProfileSection(section);
    setProfile(p);
  };
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      applyAppearance(data.settings);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [
    data.settings.theme,
    appearance.themeId,
    savedThemeColors,
    appearance.font,
    appearance.fontData,
  ]);
  useEffect(() => {
    void applyFont(appearance.fontData).catch(() =>
      notify(t("Не удалось загрузить шрифт"), true),
    );
  }, [appearance.fontData, notify]);
  const toggleTheme = () => {
    const theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    const personal = preferences(data.settings);
    personal.appearance.themeId = theme;
    void saveSettings({ ...data.settings, theme, personalization: personal });
  };
  const nav = (r: Route) => {
    setProfile(null);
    if (r === "settings") openSettings("general");
    else navigate(r);
    document.querySelector(".content-scroll")?.scrollTo(0, 0);
  };
  const findProjects = (p: Profile, kind: Kind) => {
    setCatalogTarget({ profileId: p.id, kind });
    setQuery("");
    nav("catalog");
  };
  return (
    <div className="app-shell">
      <ScreenshotNotifications />
      {manualProfile && (
        <PackManualDownloads
          profile={manualProfile}
          onClose={() => setManualProfileId(null)}
        />
      )}
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
              {account ? (
                <AccountAvatar account={account} />
              ) : (
                <UserRound size={18} />
              )}
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
        <SidebarPattern />
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
              Aurum <b>{APP_VERSION}</b>
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
        <LauncherUpdateBanner />
        <div className="content-scroll">
          <main
            className={`page-content${route === "home" && !profile ? " home-page" : ""}`}
            key={route}
          >
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
                initialTab={profileSection}
                onClose={() => {
                  setProfile(null);
                  navigate("profiles");
                }}
                onFindProjects={findProjects}
              />
            ) : (
              <>
                {route === "home" && (
                  <Home
                    onProfile={openProfile}
                    onProject={setProject}
                    onFolderImport={() => setImporting(true)}
                  />
                )}{" "}
                {route === "profiles" && (
                  <Profiles
                    onProfile={openProfile}
                    onFolderImport={() => setImporting(true)}
                  />
                )}{" "}
                {route === "catalog" && (
                  <Catalog
                    onManualFiles={setManualProfileId}
                    query={query}
                    setQuery={setQuery}
                    onProject={setProject}
                    target={catalogTarget}
                    setTarget={setCatalogTarget}
                  />
                )}{" "}
                {route === "screenshots" && <Screenshots />}
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
                {route === "friends" && (
                  <Suspense fallback={null}>
                    <Friends />
                  </Suspense>
                )}
                {route === "hosting" && (
                  <Suspense fallback={null}>
                    <Hosting />
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
              <b>
                {ru.phases[progress.phase] || t("Операция Aurum")}
                {progress.phase === "pack" && progress.packName
                  ? ` ${progress.packName}`
                  : ""}
              </b>
              <small>{tMessage(progress.message)}</small>
            </div>
            <button
              className="icon-button"
              aria-label={t("Отменить операцию")}
              onClick={() => void cancelOperation(progress.id)}
            >
              <X size={17} />
            </button>
          </div>
          {progress.total > 0 ? (
            <>
              <progress max={progress.total} value={progress.done} />
              <div className="progress-meta">
                <span>{progressAmount(progress)}</span>
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
      <UpdateProvider>
        <SocialProvider>
          <Shell creating={creating} setCreating={setCreating} />
        </SocialProvider>
      </UpdateProvider>
    </Provider>
  );
}
