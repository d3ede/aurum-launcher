import { lazy, Suspense, useEffect, useState } from "react";
import {
  Home as HomeIcon,
  Layers3,
  Compass,
  UserRound,
  Settings2,
  Search,
  Moon,
  Sun,
  Activity,
  ChevronRight,
  ArrowUpRight,
  X,
  Download,
  LoaderCircle,
  Monitor,
} from "lucide-react";
import { Provider, useApp } from "./context";
import { native, rpc } from "./lib/api";
import { ru } from "./lib/i18n";
import type { Profile, Project, Route } from "./types";
import { Logo, Modal } from "./components/ui";
import { CreateProfile, ProfileDialog } from "./components/ProfileDialog";
import { Home } from "./screens/Home";
import { Profiles } from "./screens/Profiles";
import { Catalog, ProjectDialog } from "./screens/Catalog";
const Accounts = lazy(() =>
  import("./screens/Accounts").then((module) => ({ default: module.Accounts })),
);
import { Settings } from "./screens/Settings";

const navigation = [
  ["home", HomeIcon],
  ["profiles", Layers3],
  ["catalog", Compass],
  ["accounts", UserRound],
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
  const [project, setProject] = useState<Project | null>(null);
  const [importing, setImporting] = useState(false);
  const [activity, setActivity] = useState(false);
  const account = data.accounts.find((a) => a.id === data.selectedAccount);
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
    navigate(r);
    document.querySelector(".content-scroll")?.scrollTo(0, 0);
  };
  let auth: { code: string; url: string } | null = null;
  if (progress?.phase === "auth-code") {
    try {
      auth = JSON.parse(progress.message);
    } catch {
      /* malformed auth event remains visible as text */
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => nav("home")}
          aria-label="Auren — главная"
        >
          <Logo />
          <div>
            <b>Auren</b>
            <small>Твои миры рядом</small>
          </div>
        </button>
        <div className="nav-label">ПРОСТРАНСТВО</div>
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
          <div className="sidebar-illustration">
            <span />
            <span />
            <span />
            <span />
          </div>
          <h3>
            Каждый мир
            <br />
            начинается с тебя.
          </h3>
          <p>
            Исследуй. Создавай.
            <br />
            Играй по-своему.
          </p>
          <div className="sidebar-version">
            <span>
              Auren <b>0.1.0</b>
            </span>
            <button
              aria-label="Настройки Auren"
              onClick={() => nav("settings")}
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Auren <ChevronRight size={14} /> <b>{ru.routes[route]}</b>
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
                aria-label="Быстрый поиск в каталоге"
                placeholder="Поиск проектов"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>↵</kbd>
            </form>
            <button
              className="icon-button theme-toggle"
              aria-label="Переключить тему"
              onClick={toggleTheme}
            >
              <Sun size={19} className="sun-icon" />
              <Moon size={19} className="moon-icon" />
            </button>
            <button
              className="icon-button"
              aria-label="Журнал операций"
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
                <b>{account?.name || "Ваш профиль"}</b>
                <small>
                  <i
                    className={`status-dot ${account?.kind === "microsoft" ? "online" : ""}`}
                  />
                  {account
                    ? account.kind === "microsoft"
                      ? "Microsoft"
                      : "Локальный"
                    : "Добавить аккаунт"}
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
          </div>
        </header>
        <div className="content-scroll">
          <main className="page-content" key={route}>
            {!native && (
              <div className="preview-notice">
                <Monitor size={15} />
                <span>
                  Просмотр интерфейса в браузере. Игровые функции доступны в
                  desktop-приложении Auren.
                </span>
              </div>
            )}
            {route === "home" && (
              <Home onProfile={setProfile} onProject={setProject} />
            )}{" "}
            {route === "profiles" && (
              <Profiles
                onProfile={setProfile}
                onFolderImport={() => setImporting(true)}
              />
            )}{" "}
            {route === "catalog" && (
              <Catalog
                query={query}
                setQuery={setQuery}
                onProject={setProject}
              />
            )}{" "}
            {route === "accounts" && (
              <Suspense
                fallback={<div className="loading">Открываем аккаунты…</div>}
              >
                <Accounts />
              </Suspense>
            )}{" "}
            {route === "settings" && <Settings />}
          </main>
        </div>
        <footer className="statusbar">
          <span>
            <i className={`status-dot ${native ? "online" : ""}`} />
            {data.running.length
              ? `Игра запущена · ${data.running.length}`
              : native
                ? "Готов к приключениям"
                : "Просмотр интерфейса"}
          </span>
          <button onClick={() => setActivity(true)}>
            <Activity size={13} /> Журнал
          </button>
          <span className="statusbar-right">
            Сделано для ваших миров <span>✦</span>
          </span>
        </footer>
      </div>
      {creating && <CreateProfile onClose={() => setCreating(false)} />}{" "}
      {importing && (
        <CreateProfile folderImport onClose={() => setImporting(false)} />
      )}{" "}
      {profile && (
        <ProfileDialog initial={profile} onClose={() => setProfile(null)} />
      )}{" "}
      {project && (
        <ProjectDialog project={project} onClose={() => setProject(null)} />
      )}{" "}
      {activity && (
        <Modal
          title="Журнал операций"
          subtitle="События установки и запуска в этой сессии"
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
              : "События появятся после установки или запуска Minecraft."}
          </pre>
        </Modal>
      )}
      {progress && (
        <section
          className={`operation-panel ${auth ? "auth-panel" : ""}`}
          aria-live="polite"
        >
          <div className="operation-header">
            <div className="operation-symbol">
              <Download size={19} />
            </div>
            <div>
              <b>{ru.phases[progress.phase] || "Операция Auren"}</b>
              <small>
                {auth ? "Подтвердите вход в браузере" : progress.message}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Отменить операцию"
              onClick={() =>
                void rpc("cancel", { operationId: progress.id }).catch((e) =>
                  notify(e.message, true),
                )
              }
            >
              <X size={17} />
            </button>
          </div>
          {auth ? (
            <div className="auth-code">
              <code>{auth.code}</code>
              <button
                className="button primary"
                onClick={() =>
                  void rpc("openUrl", { url: auth!.url }).catch((e) =>
                    notify(e.message, true),
                  )
                }
              >
                Открыть Microsoft <ArrowUpRight size={16} />
              </button>
            </div>
          ) : progress.total > 0 ? (
            <>
              <progress max={progress.total} value={progress.done} />
              <div className="progress-meta">
                <span>
                  {progress.done} / {progress.total}
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
