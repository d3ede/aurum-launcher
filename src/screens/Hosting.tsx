import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  Clock3,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Download,
  FolderOpen,
  FileText,
  Info,
  Network,
  Palette,
  Pencil,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Server,
  Settings2,
  Square,
  TerminalSquare,
  Trash2,
  Users,
  MoreHorizontal,
  MemoryStick,
  X,
} from "lucide-react";
import { useApp } from "../context";
import { rpc, native } from "../lib/api";
import { t, getFormatLocale } from "../lib/i18n";
import {
  activeHost,
  hostingCores,
  hostingStatuses,
  isProxy,
  formatHostingPath,
  hostingMotdText,
  type HostingConsole,
  type HostingInspection,
  type HostingInstall,
  type HostingLine,
  type HostingLive,
  type HostingProfile,
  type HostingSettings,
  type HostingUpdate,
} from "../lib/hosting";
import {
  HostingIcon,
  hostingSymbols,
  hasHostingBrand,
  canTintHostingIcon,
} from "../components/HostingIcon";
import { ColorControl } from "../components/ProfileIcon";
import { Select } from "../components/Select";
import { iconColors } from "../lib/profile-icons";
import { EmptyState, ErrorBox, Field, Loading, Modal } from "../components/ui";
import { HomePattern } from "../components/TerrainPattern";
import "../hosting.css";

type Tab = "info" | "console" | "players" | "files" | "actions" | "settings";
const tabs = [
  ["info", "Информация", Info],
  ["console", "Консоль", TerminalSquare],
  ["players", "Игроки", Users],
  ["files", "Файлы", FolderOpen],
  ["actions", "Действия", Network],
  ["settings", "Настройки", Settings2],
] as const;
const stopped: HostingLive = {
  status: "stopped",
  pid: null,
  startedAt: null,
  cpu: null,
  memoryBytes: null,
  players: [],
  playerCount: null,
  maxPlayers: null,
  exitCode: null,
};
const hostingBackgrounds = [
  "#66532F",
  "#315B40",
  "#314E70",
  "#6B4436",
  "#593C75",
  "#753E54",
  "#F3CC69",
  "#F1EEE7",
];
function hostingCoreLabel(profile: HostingProfile, profiles: HostingProfile[]) {
  if (!profile.network) return t(hostingCores[profile.core] || profile.core);
  return [
    ...new Set(
      profiles
        .filter((member) => profile.network?.components.includes(member.id))
        .map((member) => hostingCores[member.core] || member.core),
    ),
  ].join(" · ");
}
function uptime(started: number | null) {
  if (!started) return "—";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - started);
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function Status({ live }: { live: HostingLive }) {
  return (
    <span className={`hosting-status status-${live.status}`}>
      <i />
      {t(hostingStatuses[live.status] || "Остановлен")}
    </span>
  );
}

function emptyPlayersLabel(live: HostingLive) {
  return t(
    live.playerCount === 0
      ? "Нет игроков онлайн"
      : "Имена игроков пока недоступны",
  );
}

export function Hosting() {
  const { data, refresh, notify, busy, operation } = useApp();
  const [profiles, setProfiles] = useState<HostingProfile[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dialog, setDialog] = useState<"import" | "install" | null>(null);
  const [pending, setPending] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, HostingLive>>({});
  const rememberLive = useCallback(
    (id: string, live: HostingLive) =>
      setStatuses((old) => ({ ...old, [id]: live })),
    [],
  );
  const load = useCallback(async () => {
    if (!data.hostingSupport) {
      setLoaded(true);
      return;
    }
    try {
      const result = await rpc("hostingProfiles", {});
      setProfiles(result);
      setSelected(
        (value) =>
          result.find((profile) => profile.network?.components.includes(value))
            ?.id ||
          (result.some((profile) => profile.id === value)
            ? value
            : result.find((profile) => profile.network)?.id ||
              result[0]?.id ||
              ""),
      );
      setError("");
    } catch (error) {
      setError(String(error));
    } finally {
      setLoaded(true);
    }
  }, [data.hostingSupport]);
  useEffect(() => {
    void load();
  }, [load]);
  const execute = async (action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      await load();
      await refresh();
    } catch (error) {
      notify(String(error), true);
    } finally {
      setPending(false);
    }
  };
  const profile = profiles.find((profile) => profile.id === selected);
  const childIds = new Set(
    profiles.flatMap((profile) => profile.network?.components || []),
  );
  const visibleProfiles = profiles.filter(
    (profile) => !childIds.has(profile.id),
  );
  return (
    <div className="hosting-page">
      <header className="hosting-heading">
        <div>
          <h1>{t("Хостинг")}</h1>
          <p>{t("Локальные Minecraft-серверы")}</p>
        </div>
        <div className="hosting-toolbar">
          <button
            className="button primary"
            disabled={busy || pending || !data.hostingSupport}
            onClick={() => setDialog("import")}
          >
            <Plus size={18} />
            {t("Добавить сервер")}
          </button>
          <button
            className="button"
            disabled={busy || pending || !data.hostingSupport}
            onClick={() => setDialog("install")}
          >
            <Download size={18} />
            {t("Установить сервер")}
          </button>
        </div>
      </header>
      {!data.hostingSupport && (
        <p className="hosting-notice">
          {t(
            native
              ? "Обновите лаунчер для локального хостинга"
              : "Локальный хостинг доступен в настольном Aurum",
          )}
        </p>
      )}
      {error && <ErrorBox error={error} retry={() => void load()} />}
      {!loaded ? (
        <Loading />
      ) : !profiles.length ? (
        <EmptyState
          icon={<Server size={36} />}
          title={t("Ваш сервер — под рукой")}
          text={t(
            "Импортируйте готовую папку или установите чистое официальное ядро. Миры и плагины остаются у вас.",
          )}
        />
      ) : (
        <div className="hosting-layout">
          <aside className="hosting-list" aria-label={t("Локальные серверы")}>
            {visibleProfiles.map((item) => (
              <button
                key={item.id}
                className={`hosting-list-item${selected === item.id ? " selected" : ""}`}
                aria-pressed={selected === item.id}
                onClick={() => setSelected(item.id)}
              >
                <HostingIcon profile={item} size={48} />
                <span>
                  <b>{item.name}</b>
                  <small title={hostingCoreLabel(item, profiles)}>
                    {hostingCoreLabel(item, profiles)}{" "}
                    {item.network || item.version === "—" ? "" : item.version}
                  </small>
                </span>
                <span className="hosting-list-state">
                  <Status
                    live={
                      statuses[item.id] || {
                        ...stopped,
                        status: data.hostingRunning?.includes(item.id)
                          ? "running"
                          : "stopped",
                      }
                    }
                  />
                  <small>
                    <Users size={13} />
                    {statuses[item.id]?.playerCount ?? "—"}
                    {statuses[item.id]?.maxPlayers != null
                      ? ` / ${statuses[item.id].maxPlayers}`
                      : ""}
                  </small>
                </span>
              </button>
            ))}
            <button
              className="button hosting-list-add"
              disabled={busy || pending}
              onClick={() => setDialog("import")}
            >
              <Plus size={17} />
              {t("Добавить сервер")}
            </button>
            <button
              aria-label={t("Установка из списка серверов")}
              className="button hosting-list-import"
              disabled={busy || pending}
              onClick={() => setDialog("install")}
            >
              <Download size={16} />
              {t("Установить сервер")}
            </button>
          </aside>
          {profile && (
            <ServerDetail
              key={profile.id}
              profile={profile}
              members={profiles.filter((item) =>
                profile.network?.components.includes(item.id),
              )}
              onLive={rememberLive}
              locked={pending || busy}
              execute={execute}
              changed={load}
              operation={operation}
            />
          )}
        </div>
      )}
      {dialog === "import" && (
        <ImportServer
          close={() => setDialog(null)}
          done={async (imported) => {
            setDialog(null);
            await load();
            setSelected(
              imported.find((profile) => profile.network)?.id ||
                imported[0]?.id ||
                selected,
            );
          }}
        />
      )}
      {dialog === "install" && (
        <InstallServer
          onImport={() => setDialog("import")}
          close={() => setDialog(null)}
          done={async (installed) => {
            setDialog(null);
            await load();
            setSelected(installed.id);
          }}
        />
      )}
    </div>
  );
}

function ServerDetail({
  profile,
  members,
  onLive,
  locked,
  execute,
  changed,
  operation,
}: {
  profile: HostingProfile;
  members: HostingProfile[];
  onLive: (id: string, live: HostingLive) => void;
  locked: boolean;
  execute: (action: () => Promise<unknown>) => Promise<void>;
  changed: () => Promise<void>;
  operation: ReturnType<typeof useApp>["operation"];
}) {
  const { notify, refresh } = useApp();
  const [tab, setTab] = useState<Tab>("info");
  const [settings, setSettings] = useState<HostingSettings | null>(null);
  const [live, setLive] = useState(stopped);
  const [lines, setLines] = useState<HostingLine[]>([]);
  const [pollError, setPollError] = useState("");
  const [player, setPlayer] = useState("");
  const [playerAction, setPlayerAction] = useState("kick");
  const [backend, setBackend] = useState("lobby");
  const [confirm, setConfirm] = useState<{
    title: string;
    text: string;
    action: () => Promise<unknown>;
  } | null>(null);
  const [eula, setEula] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    rpc("hostingSettings", { id: profile.id })
      .then((settings) => {
        if (active) setSettings(settings);
      })
      .catch((error) => {
        if (active) setPollError(String(error));
      });
    const poll = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const result: HostingConsole = await rpc("hostingConsole", {
          id: profile.id,
          after: sequence.current,
        });
        if (!active) return;
        if (result.latest < sequence.current) setLines(result.lines);
        else if (result.lines.length)
          setLines((old) => [...old, ...result.lines].slice(-2000));
        sequence.current = result.latest;
        setLive(result.live);
        onLive(profile.id, result.live);
        setPollError("");
      } catch (error) {
        if (active) setPollError(String(error));
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [profile.id, onLive]);
  const active = activeHost(live);
  const scripted = !!profile.network?.startupScript;
  const gateway = isProxy(profile.core) || !!profile.network;
  const writable = active && live.status !== "stopping" && !scripted;
  const external = live.status === "external";
  const command = async (command: string) => {
    await rpc("hostingControl", { id: profile.id, action: "command", command });
  };
  const launch = async () => {
    await operation((operationId) =>
      rpc("hostingStart", { id: profile.id, operationId }),
    );
  };
  const start = () =>
    execute(async () => {
      if (scripted) {
        const trust = await rpc("hostingScriptTrust", { id: profile.id });
        if (!trust.trusted) {
          setConfirm({
            title: t("Разрешить запуск скрипта?"),
            text: `${trust.path}\n${t("Запускайте только доверенные файлы: скрипт выполняется с вашими правами.")}`,
            action: async () => {
              await rpc("hostingTrustScript", {
                id: profile.id,
                hash: trust.hash,
              });
              await launch();
            },
          });
          return;
        }
      }
      await launch();
    });
  const forceStop = () =>
    setConfirm({
      title: t("Завершить всю сеть?"),
      text: t(
        "Будут принудительно завершены только процессы этой сети, запущенные Aurum. Несохранённые изменения могут быть потеряны.",
      ),
      action: async () => {
        await rpc("hostingControl", { id: profile.id, action: "kill" });
      },
    });
  const addressHost =
    settings?.bind && !["0.0.0.0", "::"].includes(settings.bind)
      ? settings.bind
      : "127.0.0.1";
  const address = `${addressHost.includes(":") ? `[${addressHost}]` : addressHost}:${settings?.port || (isProxy(profile.core) ? 25577 : 25565)}`;
  const copy = () =>
    execute(async () => {
      await navigator.clipboard.writeText(address);
      notify(t("Адрес сервера скопирован"));
    });
  const coreSummary = profile.network
    ? [
        ...new Set(
          members.map((member) => hostingCores[member.core] || member.core),
        ),
      ].join(" + ")
    : hostingCores[profile.core] || profile.core;
  const kernel = profile.network
    ? members.find((member) => !isProxy(member.core)) || members[0] || profile
    : profile;
  const kernelLabel = `${hostingCores[kernel.core] || kernel.core}${kernel.version === "—" ? "" : ` ${kernel.version}`}`;
  const requestPlayerAction = () => {
    if (!player) return;
    const action = gateway ? "send" : playerAction;
    setConfirm({
      title: `${t("Действие с игроком")}: ${player}`,
      text: `${action}${action === "send" ? ` → ${backend}` : ""}`,
      action: () =>
        rpc("hostingPlayerAction", {
          id: profile.id,
          player,
          action,
          target: backend,
        }),
    });
  };
  return (
    <>
      <main className="hosting-detail">
        <section className="hosting-summary" data-status={live.status}>
          <HomePattern />
          <div className="hosting-server-title">
            <HostingIcon profile={profile} size={80} />
            <div>
              <div className="hosting-title-line">
                <h2>{profile.name}</h2>
                <button
                  className="icon-button"
                  aria-label={t("Редактировать сервер")}
                  onClick={() => {
                    setTab("info");
                    requestAnimationFrame(() =>
                      document.getElementById("hosting-overview-name")?.focus(),
                    );
                  }}
                >
                  <Pencil size={15} />
                </button>
              </div>
              <p title={formatHostingPath(profile.root, profile.directory)}>
                <FolderOpen size={13} />
                <span>
                  {formatHostingPath(profile.root, profile.directory)}
                </span>
              </p>
              <Status live={live} />
            </div>
          </div>
          <div className="hosting-launch-controls">
            <HostingMenu
              label={t("Дополнительные действия сервера")}
              className={active ? "danger" : "primary"}
              disabled={locked || external}
              primaryDisabled={live.status === "stopping"}
              button={
                <>
                  {active ? <Square size={17} /> : <Play size={17} />}
                  {t(active ? "Остановить" : "Запустить")}
                </>
              }
              primaryAction={() =>
                active
                  ? void execute(() =>
                      rpc("hostingControl", { id: profile.id, action: "stop" }),
                    )
                  : void start()
              }
            >
              {(close) => (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      close();
                      setTab("settings");
                    }}
                  >
                    <Settings2 size={16} />
                    {t("Настройки сервера")}
                  </button>
                  <button
                    role="menuitem"
                    className="hosting-menu-danger"
                    disabled={!active}
                    onClick={() => {
                      close();
                      forceStop();
                    }}
                  >
                    <X size={16} />
                    {t("Принудительно завершить")}
                  </button>
                </>
              )}
            </HostingMenu>
            <button
              className="button"
              disabled={locked || !active || live.status === "stopping"}
              onClick={() =>
                void execute(async () => {
                  await operation((operationId) =>
                    rpc("hostingRestart", { id: profile.id, operationId }),
                  );
                })
              }
            >
              <RefreshCw size={16} />
              {t("Перезапустить")}
            </button>
          </div>
          <div className="hosting-metrics">
            <div>
              <HostingIcon
                profile={{
                  core: kernel.core,
                  icon: {
                    symbol: "core",
                    color: "var(--secondary)",
                    background: "transparent",
                  },
                }}
                variant="glyph"
                size={22}
              />
              <span>
                <small>{t("Ядро")}</small>
                <b title={kernelLabel}>
                  {hostingCores[kernel.core] || kernel.core}
                  {kernel.version !== "—" && (
                    <span className="hosting-kernel-version">
                      {" "}
                      {kernel.version}
                    </span>
                  )}
                </b>
              </span>
            </div>
            <div>
              <Users size={20} />
              <span>
                <small>{t("Игроков")}</small>
                <b>
                  {live.playerCount ?? "—"} /{" "}
                  {live.maxPlayers ?? settings?.maxPlayers ?? "—"}
                </b>
              </span>
            </div>
            <div>
              <Cpu size={20} />
              <span>
                <small>CPU</small>
                <b>{live.cpu == null ? "—" : `${live.cpu.toFixed(1)}%`}</b>
              </span>
            </div>
            <div
              title={
                scripted
                  ? t("Вся сеть")
                  : `${t("Лимит")}: ${(profile.ramMb / 1024).toFixed(1)} GB`
              }
            >
              <MemoryStick size={20} />
              <span>
                <small>RAM</small>
                <b>
                  {live.memoryBytes == null
                    ? "—"
                    : `${(live.memoryBytes / 1073741824).toFixed(2)} GB`}
                </b>
              </span>
            </div>
            <div>
              <Clock3 size={20} />
              <span>
                <small>{t("Время работы")}</small>
                <b>{uptime(live.startedAt)}</b>
              </span>
            </div>
          </div>
        </section>
        {external && (
          <div className="hosting-notice">
            <AlertTriangle size={18} />
            <span>
              {t(
                "Сервер запущен вне Aurum. Остановите его обычным способом и запустите здесь для доступа к консоли и действиям.",
              )}
            </span>
          </div>
        )}
        {pollError && <ErrorBox error={pollError} />}
        <div
          className="hosting-tabs"
          role="tablist"
          aria-label={t("Управление сервером")}
        >
          {tabs.map(([id, label, Icon], index) => (
            <button
              key={id}
              id={`hosting-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`hosting-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : -1;
                if (next >= 0) {
                  event.preventDefault();
                  setTab(tabs[next][0]);
                  document
                    .getElementById(`hosting-tab-${tabs[next][0]}`)
                    ?.focus();
                }
              }}
            >
              <Icon size={17} />
              {t(label)}
            </button>
          ))}
        </div>
        <section
          className={`hosting-panel hosting-panel-${tab}`}
          id={`hosting-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`hosting-tab-${tab}`}
        >
          {tab === "info" && (
            <>
              {settings && (
                <ServerOverview
                  profile={profile}
                  settings={settings}
                  live={live}
                  coreSummary={coreSummary}
                  address={address}
                  disabled={active || external || locked}
                  copy={copy}
                  save={(update) =>
                    execute(async () => {
                      await rpc("hostingUpdate", { id: profile.id, update });
                      await changed();
                      notify(t("Настройки сохранены"));
                    })
                  }
                />
              )}
              {profile.network && (
                <NetworkComponents
                  members={members}
                  lines={lines}
                  script={profile.network.startupScript}
                />
              )}
            </>
          )}
          {tab === "console" && (
            <Console
              lines={lines}
              writable={writable && !locked}
              readOnlyReason={
                scripted
                  ? t("Консоль управляется стартовым скриптом")
                  : undefined
              }
              send={command}
              notify={notify}
            />
          )}
          {tab === "files" && <ServerFiles profile={profile} />}
          {tab === "players" && (
            <div className="hosting-players-layout">
              <div>
                <h3>
                  {t("Игроки онлайн")}{" "}
                  <span className="hosting-count">
                    {live.playerCount ?? (live.players.length || "—")}
                  </span>
                </h3>
                {!live.players.length && (
                  <p className="hosting-empty-inline">
                    {emptyPlayersLabel(live)}
                  </p>
                )}
                <div className="hosting-player-list">
                  {live.players.map((name) => (
                    <button
                      key={name}
                      aria-pressed={player === name}
                      className={player === name ? "selected" : ""}
                      onClick={() => setPlayer(name)}
                    >
                      <span className="hosting-player-avatar">
                        <Users size={18} />
                      </span>
                      <b>{name}</b>
                      <span className="hosting-dot hosting-online" />
                      {player === name && <Check size={16} />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="hosting-card hosting-player-actions">
                <h3>{t("Действие с игроком")}</h3>
                <Field label={t("Игрок")}>
                  <input
                    value={player}
                    maxLength={32}
                    placeholder="Player"
                    onChange={(event) => setPlayer(event.target.value)}
                  />
                </Field>
                {gateway ? (
                  <>
                    <p>
                      {t(
                        "В Velocity доступен перевод на бэкенд. Права, бан и другие действия зависят от установленных плагинов.",
                      )}
                    </p>
                    <Field label={t("Бэкенд")}>
                      <input
                        value={backend}
                        onChange={(event) => setBackend(event.target.value)}
                      />
                    </Field>
                  </>
                ) : (
                  <Field label={t("Действие")}>
                    <Select
                      aria-label={t("Действие")}
                      value={playerAction}
                      onValueChange={setPlayerAction}
                      options={[
                        ["kick", "Отключить"],
                        ["ban", "Заблокировать"],
                        ["pardon", "Разблокировать"],
                        ["whitelist", "Добавить в белый список"],
                        ["op", "Выдать OP"],
                        ["deop", "Забрать OP"],
                        ["survival", "Выживание"],
                        ["creative", "Творческий"],
                        ["spectator", "Наблюдатель"],
                      ].map(([value, label]) => ({ value, label: t(label) }))}
                    />
                  </Field>
                )}
                <button
                  className="button primary"
                  disabled={
                    !writable ||
                    locked ||
                    !/^[A-Za-z0-9_.-]{1,32}$/.test(player)
                  }
                  onClick={requestPlayerAction}
                >
                  <Send size={16} />
                  {t("Выполнить")}
                </button>
              </div>
            </div>
          )}
          {tab === "actions" && (
            <div className="hosting-action-grid">
              <div className="hosting-card">
                <h3>{t("Серверные команды")}</h3>
                <p>
                  {t(
                    "Команды отправляются в консоль выбранного компонента, без выполнения команд Windows.",
                  )}
                </p>
                {(gateway
                  ? [
                      ["glist", "Список игроков сети"],
                      ["velocity info", "Информация о прокси"],
                    ]
                  : [
                      ["list", "Список игроков"],
                      ["save-all", "Сохранить мир"],
                      ["whitelist list", "Белый список"],
                    ]
                ).map(([value, label]) => (
                  <button
                    className="button"
                    key={value}
                    disabled={!writable || locked}
                    onClick={() => void execute(() => command(value))}
                  >
                    <TerminalSquare size={16} />
                    {t(label)}
                  </button>
                ))}
              </div>
              <div className="hosting-card">
                <h3>{t("Управление процессом")}</h3>
                <p>
                  {t(
                    scripted
                      ? "Остановка отправляет команду стартовому скрипту. Принудительное завершение доступно отдельно."
                      : "Обычная остановка сохраняет мир. Принудительное завершение может повредить данные — используйте только при зависании.",
                  )}
                </p>
                <button
                  className="button danger"
                  disabled={!active || locked}
                  onClick={() =>
                    setConfirm({
                      title: t("Принудительно завершить сервер?"),
                      text: t(
                        "Несохранённые изменения мира могут быть потеряны.",
                      ),
                      action: () =>
                        rpc("hostingControl", {
                          id: profile.id,
                          action: "kill",
                        }),
                    })
                  }
                >
                  <X size={16} />
                  {t("Принудительно завершить")}
                </button>
              </div>
            </div>
          )}
          {tab === "settings" && settings && (
            <ServerSettings
              key={profile.id}
              profile={profile}
              settings={settings}
              disabled={active || external || locked}
              save={(update) =>
                execute(async () => {
                  await rpc("hostingUpdate", { id: profile.id, update });
                  setSettings(update.settings);
                  await changed();
                  notify(t("Настройки сохранены"));
                })
              }
            />
          )}
          {tab === "settings" && !isProxy(profile.core) && !profile.network && (
            <div className="hosting-eula">
              <label>
                <input
                  type="checkbox"
                  checked={eula}
                  onChange={(event) => setEula(event.target.checked)}
                  disabled={active || external || locked}
                />
                {t("Я прочитал и принимаю")}{" "}
                <a
                  href="https://www.minecraft.net/eula"
                  target="_blank"
                  rel="noreferrer"
                >
                  Minecraft EULA
                </a>
              </label>
              <button
                className="button"
                disabled={!eula || active || external || locked}
                onClick={() =>
                  void execute(async () => {
                    await rpc("hostingAcceptEula", {
                      id: profile.id,
                      accepted: true,
                    });
                    notify(t("EULA сохранена"));
                    setEula(false);
                  })
                }
              >
                {t("Сохранить согласие EULA")}
              </button>
            </div>
          )}
        </section>
      </main>
      <aside className="hosting-aside">
        <section className="hosting-card">
          <h3>{t("Быстрые действия")}</h3>
          <button className="button" onClick={() => setTab("files")}>
            <FolderOpen size={17} />
            {t("Открыть папку")}
          </button>
          <button
            className="button"
            onClick={() =>
              void execute(() =>
                rpc("hostingOpen", { id: profile.id, logs: false }),
              )
            }
          >
            <FolderOpen size={17} />
            {t("Открыть в проводнике")}
          </button>
          <button className="button" onClick={() => void copy()}>
            <Copy size={17} />
            {t("Копировать IP")}
          </button>
          <button
            className="button"
            onClick={() =>
              void execute(() =>
                rpc("hostingOpen", { id: profile.id, logs: true }),
              )
            }
          >
            <FileText size={17} />
            {t("Открыть логи")}
          </button>
          <button className="button" onClick={() => setTab("settings")}>
            <Settings2 size={17} />
            {t("Настройки сервера")}
          </button>
          <button
            className="button danger"
            disabled={active || locked}
            onClick={() =>
              setConfirm({
                title: t("Убрать профиль сервера?"),
                text: t("Папка, миры и плагины не удаляются."),
                action: async () => {
                  await rpc("hostingRemove", { id: profile.id });
                  await changed();
                },
              })
            }
          >
            <Trash2 size={17} />
            {t("Убрать профиль")}
          </button>
        </section>
        <section className="hosting-card">
          <h3>
            {t("Игроки онлайн")}{" "}
            <span className="hosting-count">{live.playerCount ?? "—"}</span>
          </h3>
          {live.players.slice(0, 8).map((name) => (
            <button
              key={name}
              className="hosting-player-short"
              onClick={() => {
                setPlayer(name);
                setTab("players");
              }}
            >
              <span className="hosting-player-avatar">
                <Users size={16} />
              </span>
              <span className="hosting-player-name">{name}</span>
              <MoreHorizontal size={16} />
            </button>
          ))}
          {!live.players.length && (
            <p className="hosting-empty-inline">{emptyPlayersLabel(live)}</p>
          )}
        </section>
        <p className="hosting-footnote">
          {t(
            "Пока сервер работает, Aurum нужно оставить открытым. Для закрытия сначала остановите сервер.",
          )}
        </p>
      </aside>
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <div className="hosting-dialog-body">
            <p>{confirm.text}</p>
            <div className="hosting-dialog-footer">
              <button className="button" onClick={() => setConfirm(null)}>
                {t("Отмена")}
              </button>
              <button
                className="button danger"
                onClick={() => {
                  const action = confirm.action;
                  setConfirm(null);
                  void execute(async () => {
                    await action();
                    await refresh();
                  });
                }}
              >
                {t("Подтвердить")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function HostingMenu({
  label,
  button,
  children,
  primaryAction,
  disabled,
  primaryDisabled,
  className = "",
}: {
  label: string;
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  primaryAction: () => void;
  disabled?: boolean;
  primaryDisabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
      if (event.key === "Tab") setOpen(false);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const buttons = [
          ...(root.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not(:disabled)',
          ) || []),
        ];
        if (!buttons.length) return;
        event.preventDefault();
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next].focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [open]);
  return (
    <div className={`hosting-split-button ${className}`} ref={root}>
      <button
        className={`button ${className}`}
        type="button"
        disabled={disabled || primaryDisabled}
        onClick={primaryAction}
      >
        {button}
      </button>
      <button
        className={`button ${className}`}
        type="button"
        ref={trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={15} />
      </button>
      {open && (
        <div
          id={id}
          className="hosting-button-menu"
          role="menu"
          aria-label={label}
        >
          {children(() => {
            setOpen(false);
            trigger.current?.focus();
          })}
        </div>
      )}
    </div>
  );
}

function ServerOverview({
  profile,
  settings,
  live,
  coreSummary,
  address,
  disabled,
  copy,
  save,
}: {
  profile: HostingProfile;
  settings: HostingSettings;
  live: HostingLive;
  coreSummary: string;
  address: string;
  disabled: boolean;
  copy: () => Promise<void>;
  save: (update: HostingUpdate) => Promise<void>;
}) {
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description);
  const [network, setNetwork] = useState(settings);
  const changed =
    name !== profile.name ||
    description !== profile.description ||
    network.port !== settings.port ||
    network.onlineMode !== settings.onlineMode;
  const cpu = live.cpu == null ? "—" : `${live.cpu.toFixed(1)}%`;
  const memory =
    live.memoryBytes == null
      ? "—"
      : `${(live.memoryBytes / 1073741824).toFixed(2)} GB`;
  const memoryLimit = profile.network?.startupScript
    ? null
    : profile.ramMb * 1048576;
  return (
    <div className="hosting-overview">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save({
            name,
            description,
            javaMajor: profile.javaMajor,
            javaPath: profile.javaPath,
            ramMb: profile.ramMb,
            jvmArgs: profile.jvmArgs,
            icon: profile.icon,
            settings: network,
          });
        }}
      >
        <div className="hosting-overview-top">
          <div className="hosting-server-art" aria-hidden="true">
            <HomePattern />
            <HostingIcon profile={profile} size={72} />
          </div>
          <div className="hosting-overview-fields">
            <Field label={t("Название сервера")}>
              <input
                id="hosting-overview-name"
                required
                maxLength={120}
                value={name}
                disabled={disabled}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label={t("Описание")}>
              <textarea
                maxLength={500}
                rows={3}
                value={description}
                disabled={disabled}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <div className="hosting-description-footer">
              <small>{description.length} / 500</small>
              <button
                className="icon-button"
                type="submit"
                aria-label={t("Сохранить информацию")}
                title={t("Сохранить информацию")}
                disabled={disabled || !changed}
              >
                <Save size={16} />
              </button>
            </div>
          </div>
        </div>
        <div className="hosting-overview-config">
          <Field label={t("Ядро")}>
            <div className="hosting-readonly" title={coreSummary}>
              {coreSummary}
              {profile.version !== "—" && !profile.network
                ? ` ${profile.version}`
                : ""}
            </div>
          </Field>
          <Field label={t("Порт")}>
            <div className="hosting-port-field">
              <input
                aria-label={t("Порт")}
                type="number"
                min={1}
                max={65535}
                value={network.port}
                disabled={disabled || !!profile.network}
                onChange={(event) =>
                  setNetwork({ ...network, port: Number(event.target.value) })
                }
              />
              <button
                type="button"
                className="icon-button"
                title={address}
                aria-label={t("Копировать IP")}
                onClick={() => void copy()}
              >
                <Copy size={14} />
              </button>
            </div>
          </Field>
          <Field label={t("Онлайн-режим")}>
            <div className="hosting-toggle">
              <input
                type="checkbox"
                aria-label={t("Проверка аккаунтов")}
                checked={network.onlineMode}
                disabled={disabled || !!profile.network}
                onChange={(event) =>
                  setNetwork({ ...network, onlineMode: event.target.checked })
                }
              />
              <span aria-hidden="true" />
              <small>{t(network.onlineMode ? "Включён" : "Выключен")}</small>
            </div>
          </Field>
          <Field label="MOTD">
            <div
              className="hosting-readonly hosting-motd"
              title={hostingMotdText(settings.motd)}
            >
              {hostingMotdText(settings.motd) || "—"}
            </div>
          </Field>
        </div>
      </form>
      <div className="hosting-overview-bottom">
        <section className="hosting-card">
          <h3>{t("Ресурсы")}</h3>
          <div className="hosting-resource">
            <Cpu size={19} />
            <span>CPU</span>
            <div className="hosting-resource-track">
              {live.cpu != null && (
                <i
                  style={{ width: `${Math.min(100, Math.max(0, live.cpu))}%` }}
                />
              )}
            </div>
            <b>{cpu}</b>
          </div>
          <div className="hosting-resource">
            <MemoryStick size={19} />
            <span>RAM</span>
            <div className="hosting-resource-track">
              {memoryLimit && live.memoryBytes != null ? (
                <i
                  style={{
                    width: `${Math.min(100, (live.memoryBytes / memoryLimit) * 100)}%`,
                  }}
                />
              ) : null}
            </div>
            <b>
              {memory}
              {memoryLimit && live.memoryBytes != null
                ? ` / ${(profile.ramMb / 1024).toFixed(1)} GB`
                : ""}
            </b>
          </div>
          <dl className="hosting-resource-details">
            <dt>Java</dt>
            <dd>
              {profile.network?.startupScript
                ? t("Из скрипта")
                : profile.javaMajor}
            </dd>
            <dt>PID</dt>
            <dd>{live.pid || "—"}</dd>
          </dl>
        </section>
        <section className="hosting-card">
          <h3>{t("Статистика")}</h3>
          <dl>
            <dt>{t("Игроков сейчас")}</dt>
            <dd>
              {live.playerCount ?? "—"}
              {live.maxPlayers != null ? ` / ${live.maxPlayers}` : ""}
            </dd>
            <dt>{t("Время работы")}</dt>
            <dd>{activeHost(live) ? uptime(live.startedAt) : "—"}</dd>
            <dt>{t("Запусков через Aurum")}</dt>
            <dd>{profile.launches}</dd>
            <dt>{t("Последний запуск")}</dt>
            <dd>
              {profile.lastStarted
                ? new Date(profile.lastStarted * 1000).toLocaleString(
                    getFormatLocale(),
                    {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )
                : "—"}
            </dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

function ServerFiles({ profile }: { profile: HostingProfile }) {
  const [path, setPath] = useState(".");
  const [result, setResult] = useState<{
    entries: { name: string; directory: boolean; bytes: number }[];
    truncated: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null);
    setError("");
    rpc("hostingFiles", { id: profile.id, path })
      .then((result) => {
        if (active) setResult(result);
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [profile.id, path, revision]);
  return (
    <div className="hosting-files">
      <div className="hosting-files-toolbar">
        <button
          className="icon-button"
          aria-label={t("На уровень выше")}
          disabled={path === "."}
          onClick={() => setPath(path.split("/").slice(0, -1).join("/") || ".")}
        >
          <ChevronUp size={17} />
        </button>
        <span
          title={formatHostingPath(
            profile.root,
            profile.directory === "."
              ? path
              : `${profile.directory}/${path === "." ? "" : path}`,
          )}
        >
          {path === "." ? profile.name : path}
        </span>
        <button
          className="icon-button"
          aria-label={t("Обновить файлы")}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {error && <ErrorBox error={error} />}
      {!error && !result && <Loading />}
      {result && (
        <div className="hosting-file-list">
          {result.entries.map((entry) =>
            entry.directory ? (
              <button
                key={entry.name}
                className="hosting-file-row"
                onClick={() =>
                  setPath(path === "." ? entry.name : `${path}/${entry.name}`)
                }
              >
                <FolderOpen size={18} />
                <span>{entry.name}</span>
              </button>
            ) : (
              <div key={entry.name} className="hosting-file-row">
                <FileText size={18} />
                <span>{entry.name}</span>
                <small>
                  {entry.bytes < 1024
                    ? `${entry.bytes} B`
                    : entry.bytes < 1048576
                      ? `${(entry.bytes / 1024).toFixed(1)} KB`
                      : `${(entry.bytes / 1048576).toFixed(1)} MB`}
                </small>
              </div>
            ),
          )}
          {!result.entries.length && (
            <p className="hosting-empty-inline">{t("Папка пуста")}</p>
          )}
          {result.truncated && (
            <p className="hosting-footnote">
              {t("Показаны первые 500 файлов")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NetworkComponents({
  members,
  lines,
  script,
}: {
  members: HostingProfile[];
  lines: HostingLine[];
  script: string | null;
}) {
  return (
    <div className="hosting-network-overview">
      <details className="hosting-network-members">
        <summary>
          {t("Компоненты")} · {members.length}{" "}
          <small className="hosting-script-label">
            {script || t("Компоненты по очереди")}
          </small>
        </summary>
        <div className="hosting-network-tiles">
          {members.map((member) => (
            <details key={member.id} className="hosting-card">
              <summary>
                <HostingIcon profile={member} size={34} />
                <span>
                  <b>{member.name}</b>
                  <small>{hostingCores[member.core] || member.core}</small>
                </span>
              </summary>
              <pre>
                {lines
                  .filter((line) =>
                    line.message.startsWith(`[${member.name}] `),
                  )
                  .slice(-50)
                  .map((line) => line.message.slice(member.name.length + 3))
                  .join("\n") || t("Вывод появится после запуска")}
              </pre>
            </details>
          ))}
        </div>
      </details>
    </div>
  );
}

function Console({
  lines,
  writable,
  readOnlyReason,
  send,
  notify,
}: {
  lines: HostingLine[];
  writable: boolean;
  readOnlyReason?: string;
  send: (command: string) => Promise<void>;
  notify: ReturnType<typeof useApp>["notify"];
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [paused, setPaused] = useState(false);
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const [cleared, setCleared] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(0);
  const visible = lines.filter(
    (line) =>
      line.sequence > cleared &&
      (level === "all" || line.level === level) &&
      line.message.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    if (!paused && follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [lines, query, level, paused]);
  const submit = async () => {
    if (!command.trim() || sending) return;
    setSending(true);
    try {
      await send(command);
      history.current = [
        ...history.current.filter((item) => item !== command),
        command,
      ].slice(-50);
      historyIndex.current = history.current.length;
      setCommand("");
    } catch (error) {
      notify(String(error), true);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="hosting-console">
      <div className="hosting-console-toolbar">
        <label className="hosting-console-search">
          <Search size={15} />
          <input
            aria-label={t("Поиск в консоли")}
            placeholder={t("Поиск в консоли")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Select
          aria-label={t("Уровень журнала")}
          value={level}
          onValueChange={setLevel}
          options={[
            ["all", "Все сообщения"],
            ["info", "Информация"],
            ["warn", "Предупреждения"],
            ["error", "Ошибки"],
            ["command", "Команды"],
          ].map(([value, label]) => ({ value, label: t(label) }))}
        />
        <button
          className={`icon-button${paused ? " selected" : ""}`}
          aria-label={t(
            paused ? "Включить автопрокрутку" : "Приостановить автопрокрутку",
          )}
          title={t("Автопрокрутка")}
          aria-pressed={!paused}
          onClick={() => {
            setPaused(!paused);
            follow.current = true;
          }}
        >
          {paused ? <ArrowDown size={17} /> : <Pause size={17} />}
        </button>
        <button
          className="icon-button"
          aria-label={t("Скопировать консоль")}
          onClick={() =>
            void navigator.clipboard
              .writeText(visible.map((line) => line.message).join("\n"))
              .then(() => notify(t("Скопировано")))
              .catch((error) => notify(String(error), true))
          }
        >
          <Copy size={17} />
        </button>
        <button
          className="icon-button"
          aria-label={t("Очистить вид консоли")}
          onClick={() => setCleared(lines.at(-1)?.sequence || 0)}
        >
          <Trash2 size={17} />
        </button>
      </div>
      <div
        className="hosting-console-output"
        ref={viewport}
        role="log"
        aria-label={t("Консоль сервера")}
        aria-live="off"
        tabIndex={0}
        onScroll={() => {
          const box = viewport.current;
          if (box)
            follow.current =
              box.scrollHeight - box.scrollTop - box.clientHeight < 50;
        }}
      >
        {!visible.length && (
          <p className="hosting-console-placeholder">
            {t("Здесь появится вывод сервера после запуска через Aurum")}
          </p>
        )}
        {visible.map((line) => (
          <div
            key={line.sequence}
            className={`hosting-log-line level-${line.level}`}
          >
            <time>
              {new Date(line.time * 1000).toLocaleTimeString(
                getFormatLocale(),
                { hour12: false },
              )}
            </time>
            <span>{line.message}</span>
          </div>
        ))}
      </div>
      <form
        className="hosting-command"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <span>&gt;</span>
        <input
          aria-label={t("Команда сервера")}
          placeholder={
            readOnlyReason ||
            t(
              writable
                ? "Введите команду без / и нажмите Enter"
                : "Запустите сервер через Aurum для ввода команд",
            )
          }
          value={command}
          disabled={!writable || sending}
          maxLength={1024}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              historyIndex.current = Math.max(
                0,
                Math.min(
                  history.current.length,
                  historyIndex.current + (event.key === "ArrowUp" ? -1 : 1),
                ),
              );
              setCommand(history.current[historyIndex.current] || "");
            }
          }}
        />
        <button
          className="icon-button"
          aria-label={t("Отправить команду")}
          disabled={!writable || sending || !command.trim()}
        >
          <Send size={17} />
        </button>
      </form>
      <small className="hosting-footnote">
        {t(
          "Последние 2000 строк · ↑ / ↓ история команд · секреты скрываются по возможности",
        )}
      </small>
    </div>
  );
}

function ServerSettings({
  profile,
  settings,
  disabled,
  save,
}: {
  profile: HostingProfile;
  settings: HostingSettings;
  disabled: boolean;
  save: (update: HostingUpdate) => Promise<void>;
}) {
  const { notify } = useApp();
  const [draft, setDraft] = useState<HostingUpdate>({
    name: profile.name,
    description: profile.description,
    javaMajor: profile.javaMajor,
    javaPath: profile.javaPath,
    ramMb: profile.ramMb,
    jvmArgs: profile.jvmArgs,
    icon: profile.icon,
    settings,
  });
  const [script, setScript] = useState(profile.network?.startupScript || "");
  const [stopCommand, setStopCommand] = useState(
    profile.network?.stopCommand ?? "stop",
  );
  const set = <Key extends keyof HostingUpdate>(
    key: Key,
    value: HostingUpdate[Key],
  ) => setDraft((old) => ({ ...old, [key]: value }));
  const network = <Key extends keyof HostingSettings>(
    key: Key,
    value: HostingSettings[Key],
  ) => set("settings", { ...draft.settings, [key]: value });
  const tintable = canTintHostingIcon(
    draft.icon.symbol === "core" ? profile.core : draft.icon.symbol,
  );
  return (
    <form
      className="hosting-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void (async () => {
          if (
            profile.network &&
            script !== (profile.network.startupScript || "")
          ) {
            await rpc("hostingNetworkScript", {
              id: profile.id,
              script: script.trim() || null,
            });
          }
          if (
            profile.network &&
            stopCommand !== (profile.network.stopCommand ?? "stop")
          ) {
            await rpc("hostingNetworkStopCommand", {
              id: profile.id,
              command: stopCommand,
            });
          }
          await save(draft);
        })().catch((error) => notify(String(error), true));
      }}
    >
      <fieldset disabled={disabled}>
        {disabled && (
          <p className="hosting-notice">
            {t("Остановите сервер, чтобы изменить настройки")}
          </p>
        )}
        <div className="hosting-form-grid">
          <Field label={t("Название сервера")}>
            <input
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </Field>
          <Field label={t("Описание")}>
            <input
              maxLength={500}
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </Field>
        </div>
        <h3>
          <Palette size={18} />
          {t("Значок сервера")}
        </h3>
        <div className="hosting-icon-editor">
          <HostingIcon
            profile={{ core: profile.core, icon: draft.icon }}
            size={72}
          />
          <div className="hosting-symbols">
            {hostingSymbols.map(({ id, Icon, label }) => (
              <button
                type="button"
                key={id}
                aria-label={t(label)}
                title={t(label)}
                aria-pressed={draft.icon.symbol === id}
                className={`icon-button${draft.icon.symbol === id ? " selected" : ""}`}
                onClick={() => set("icon", { ...draft.icon, symbol: id })}
              >
                {hasHostingBrand(id) ? (
                  <HostingIcon
                    size={28}
                    variant="glyph"
                    profile={{
                      core: id,
                      icon: {
                        symbol: "core",
                        color: "#edf0f3",
                        background: "#252b2c",
                      },
                    }}
                  />
                ) : (
                  <Icon size={22} />
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="hosting-form-grid">
          {tintable ? (
            <ColorControl
              label={t("Цвет значка")}
              value={draft.icon.color}
              palette={iconColors}
              onChange={(color) => set("icon", { ...draft.icon, color })}
            />
          ) : (
            <div
              className="hosting-original-color"
              title={t("Velocity сохраняет оригинальный белый цвет логотипа.")}
            >
              <span>{t("Цвет значка")}</span>
              <b>
                <i />
                {t("Оригинальный цвет")}
              </b>
            </div>
          )}
          <ColorControl
            label={t("Цвет фона")}
            value={draft.icon.background}
            palette={hostingBackgrounds}
            onChange={(background) =>
              set("icon", { ...draft.icon, background })
            }
          />
        </div>
        {profile.network && (
          <div className="hosting-form-grid">
            <Field
              label={t("Файл запуска")}
              hint={t(
                "Путь внутри папки сети. Пусто — запуск JAR-компонентов.",
              )}
            >
              <input
                aria-label={t("Файл запуска")}
                value={script}
                placeholder="start.bat"
                onChange={(event) => setScript(event.target.value)}
              />
            </Field>
            <Field label={t("Команда остановки")}>
              <input
                aria-label={t("Команда остановки")}
                value={stopCommand}
                maxLength={1024}
                placeholder="stop"
                onChange={(event) => setStopCommand(event.target.value)}
              />
            </Field>
          </div>
        )}
        {!profile.network && (
          <>
            <h3>
              <Cpu size={18} />
              {t("Ресурсы и Java")}
            </h3>
            <div className="hosting-form-grid">
              <Field label="RAM (MB)">
                <input
                  type="number"
                  min={512}
                  max={65536}
                  step={256}
                  value={draft.ramMb}
                  onChange={(event) => set("ramMb", Number(event.target.value))}
                />
              </Field>
              <Field label={t("Версия Java")}>
                <input
                  type="number"
                  min={8}
                  max={30}
                  value={draft.javaMajor}
                  onChange={(event) =>
                    set("javaMajor", Number(event.target.value))
                  }
                />
              </Field>
              <Field label={t("Путь к Java (необязательно)")}>
                <input
                  value={draft.javaPath}
                  placeholder={t("Автоматически — Eclipse Temurin")}
                  onChange={(event) => set("javaPath", event.target.value)}
                />
              </Field>
              <Field
                label={t("JVM-аргументы")}
                hint={t("Только JVM-флаги. Память задаётся отдельно.")}
              >
                <input
                  value={draft.jvmArgs}
                  placeholder="-XX:+UseG1GC"
                  onChange={(event) => set("jvmArgs", event.target.value)}
                />
              </Field>
            </div>
            <h3>
              <Network size={18} />
              {t("Сеть")}
            </h3>
            <div className="hosting-form-grid">
              <Field label={t("Порт")}>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.settings.port}
                  onChange={(event) =>
                    network("port", Number(event.target.value))
                  }
                />
              </Field>
              <Field
                label={t("IP привязки")}
                hint={t(
                  "127.0.0.1 — только этот ПК; пусто / 0.0.0.0 — все интерфейсы.",
                )}
              >
                <input
                  value={draft.settings.bind}
                  onChange={(event) => network("bind", event.target.value)}
                />
              </Field>
              <Field label={t("Максимум игроков")}>
                <input
                  type="number"
                  min={0}
                  max={100000}
                  value={draft.settings.maxPlayers}
                  onChange={(event) =>
                    network("maxPlayers", Number(event.target.value))
                  }
                />
              </Field>
              <Field label="MOTD">
                <input
                  maxLength={500}
                  value={draft.settings.motd}
                  onChange={(event) => network("motd", event.target.value)}
                />
              </Field>
            </div>
            <label className="hosting-check">
              <input
                type="checkbox"
                checked={draft.settings.onlineMode}
                onChange={(event) =>
                  network("onlineMode", event.target.checked)
                }
              />
              {t("Онлайн-режим: проверка аккаунтов Minecraft")}
            </label>
            {!draft.settings.onlineMode && (
              <p className="hosting-notice">
                {t(
                  "Без проверки аккаунтов игроки могут входить под чужими именами. Для бэкенда прокси настройте forwarding и ограничьте доступ.",
                )}
              </p>
            )}
            <p className="hosting-footnote">
              {t(
                "Другие параметры и секреты не меняются. Перед первым сохранением создаётся резервная копия конфигурации.",
              )}
            </p>
          </>
        )}
        <button className="button primary" type="submit">
          <Save size={17} />
          {t("Сохранить настройки")}
        </button>
      </fieldset>
    </form>
  );
}

function ImportCandidate({
  candidate,
  checked,
  toggle,
}: {
  candidate: HostingInspection["candidates"][number];
  checked: boolean;
  toggle: () => void;
}) {
  return (
    <label
      className="hosting-import-candidate"
      title={`${candidate.directory} → ${candidate.entrypoint}`}
    >
      <input type="checkbox" checked={checked} onChange={toggle} />
      <HostingIcon
        profile={{
          core: candidate.core,
          icon: { symbol: "core", color: "#edf0f3", background: "#252b2c" },
        }}
        size={36}
      />
      <span>
        <b>{candidate.name}</b>
        <small>
          {hostingCores[candidate.core] || candidate.core}
          {candidate.version !== "—" && ` ${candidate.version}`}
        </small>
      </span>
      {isProxy(candidate.core) && (
        <small className="hosting-component-role">{t("Вход в сеть")}</small>
      )}
    </label>
  );
}

function ImportServer({
  close,
  done,
}: {
  close: () => void;
  done: (profiles: HostingProfile[]) => Promise<void>;
}) {
  const [root, setRoot] = useState("");
  const [inspection, setInspection] = useState<HostingInspection | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inspect = async (path: string) => {
    setPending(true);
    setError("");
    setInspection(null);
    try {
      const result = await rpc("hostingInspect", { root: path });
      setInspection(result);
      setSelected([]);
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(false);
    }
  };
  const otherCandidates =
    inspection?.candidates.filter(
      (candidate) =>
        !inspection.networks?.some((network) =>
          network.componentIds.includes(candidate.id),
        ),
    ) || [];
  return (
    <Modal
      title={t("Добавить локальный сервер")}
      wide
      onClose={() => {
        if (!pending) close();
      }}
      closeDisabled={pending}
    >
      <div className="hosting-dialog-body">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void inspect(root);
          }}
        >
          <Field label={t("Папка сервера")}>
            <div className="hosting-path-input">
              <input
                required
                value={root}
                disabled={pending}
                onChange={(event) => {
                  setRoot(event.target.value);
                  setInspection(null);
                }}
                placeholder="X:\Servers\MyServer"
              />
              <button
                className="button"
                type="button"
                disabled={pending}
                onClick={() => {
                  setPending(true);
                  void rpc("hostingChooseFolder", {})
                    .then((path) => {
                      if (path) {
                        setRoot(path);
                        void inspect(path);
                      } else setPending(false);
                    })
                    .catch((error) => {
                      setError(String(error));
                      setPending(false);
                    });
                }}
              >
                <FolderOpen size={17} />
                {t("Обзор")}
              </button>
              <button className="button" disabled={pending || !root.trim()}>
                <Search size={17} />
                {t("Найти")}
              </button>
            </div>
          </Field>
        </form>
        {pending && <Loading />}
        {error && <ErrorBox error={error} />}
        {inspection && (
          <>
            {!!inspection.startupScripts?.length && (
              <details className="hosting-script-hint">
                <summary>
                  <TerminalSquare size={15} />
                  <span>{inspection.startupScripts.join(", ")}</span>
                  <Info size={14} />
                </summary>
                <p>
                  {t(
                    "Импорт ничего не запускает. При запуске сети Aurum использует выбранный скрипт после вашего подтверждения.",
                  )}
                </p>
              </details>
            )}
            <div className="hosting-import-candidates">
              {(inspection.networks || []).map((network) => (
                <section
                  className="hosting-import-network"
                  key={network.directory}
                  aria-label={t("Сеть серверов")}
                >
                  <label
                    className="hosting-network-select"
                    title={network.directory}
                  >
                    <input
                      type="checkbox"
                      aria-label={t("Выбрать сеть")}
                      checked={network.componentIds.every((id) =>
                        selected.includes(id),
                      )}
                      onChange={(event) =>
                        setSelected((old) =>
                          event.target.checked
                            ? [...new Set([...old, ...network.componentIds])]
                            : old.filter(
                                (id) => !network.componentIds.includes(id),
                              ),
                        )
                      }
                    />
                    <Network size={20} />
                    <span>
                      <b>{t("Сеть серверов")}</b>
                      <small>
                        {t("Компоненты: {{count}}", {
                          count: network.componentIds.length,
                        })}
                      </small>
                    </span>
                  </label>
                  <details className="hosting-network-members">
                    <summary>
                      {t("Компоненты")} · {network.componentIds.length}
                    </summary>
                    {inspection.candidates
                      .filter((candidate) =>
                        network.componentIds.includes(candidate.id),
                      )
                      .sort(
                        (left, right) =>
                          Number(isProxy(right.core)) -
                          Number(isProxy(left.core)),
                      )
                      .map((candidate) => (
                        <ImportCandidate
                          key={candidate.id}
                          candidate={candidate}
                          checked={selected.includes(candidate.id)}
                          toggle={() =>
                            setSelected((old) =>
                              old.includes(candidate.id)
                                ? old.filter((id) => id !== candidate.id)
                                : [...old, candidate.id],
                            )
                          }
                        />
                      ))}
                  </details>
                </section>
              ))}
              {!!inspection.networks?.length
                ? !!otherCandidates.length && (
                    <details className="hosting-other-folders">
                      <summary>
                        {t("Другие папки")} · {otherCandidates.length}
                      </summary>
                      {otherCandidates.map((candidate) => (
                        <ImportCandidate
                          key={candidate.id}
                          candidate={candidate}
                          checked={selected.includes(candidate.id)}
                          toggle={() =>
                            setSelected((old) =>
                              old.includes(candidate.id)
                                ? old.filter((id) => id !== candidate.id)
                                : [...old, candidate.id],
                            )
                          }
                        />
                      ))}
                    </details>
                  )
                : inspection.candidates.map((candidate) => (
                    <ImportCandidate
                      key={candidate.id}
                      candidate={candidate}
                      checked={selected.includes(candidate.id)}
                      toggle={() =>
                        setSelected((old) =>
                          old.includes(candidate.id)
                            ? old.filter((id) => id !== candidate.id)
                            : [...old, candidate.id],
                        )
                      }
                    />
                  ))}
            </div>
            {!inspection.candidates.length && (
              <p>{t("Подходящие серверы не найдены")}</p>
            )}
            <details className="hosting-footnote">
              <summary>{t("Подробнее")}</summary>
              <p>
                {t("Импорт не меняет файлы сервера и ничего не запускает.")}
              </p>
              {inspection.warnings.map((warning) => (
                <p key={warning}>{t(warning)}</p>
              ))}
            </details>
          </>
        )}
        <div className="hosting-dialog-footer">
          <button className="button" disabled={pending} onClick={close}>
            {t("Отмена")}
          </button>
          <button
            className="button primary"
            disabled={pending || !inspection || !selected.length}
            onClick={() => {
              if (!inspection) return;
              setPending(true);
              void rpc("hostingImport", { root: inspection.root, selected })
                .then(done)
                .catch((error) => setError(String(error)))
                .finally(() => setPending(false));
            }}
          >
            <Plus size={17} />
            {t("Добавить выбранные")}
            {selected.length
              ? ` · ${otherCandidates.filter((candidate) => selected.includes(candidate.id)).length + (inspection?.networks || []).filter((network) => network.componentIds.some((id) => selected.includes(id))).length || selected.length}`
              : ""}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function InstallServer({
  close,
  done,
  onImport,
}: {
  close: () => void;
  done: (profile: HostingProfile) => Promise<void>;
  onImport: () => void;
}) {
  const { operation, progress } = useApp();
  const [request, setRequest] = useState<HostingInstall>({
    name: "",
    core: "paper",
    version: "",
    acceptEula: false,
    experimental: false,
    ramMb: 4096,
  });
  const [versions, setVersions] = useState<{ version: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setVersions([]);
    if (request.core === "spigot") {
      setLoading(false);
      return;
    }
    rpc("hostingVersions", { core: request.core })
      .then((versions) => {
        if (active) {
          setVersions(versions);
          setRequest((old) => ({
            ...old,
            version: versions[0]?.version || "",
          }));
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request.core]);
  const set = <Key extends keyof HostingInstall>(
    key: Key,
    value: HostingInstall[Key],
  ) => setRequest((old) => ({ ...old, [key]: value }));
  const manual = request.core === "spigot";
  const hints: Record<string, string> = {
    paper: "Плагины Bukkit / Spigot / Paper",
    purpur: "Paper с дополнительными настройками",
    spigot: "Сборка через официальный BuildTools",
    folia: "Многопоточность; нужны совместимые плагины",
    vanilla: "Обычный Minecraft без модов и плагинов",
    velocity: "Общий вход и переходы между серверами",
  };
  return (
    <Modal
      title={t("Установить сервер")}
      className="hosting-install-modal"
      wide
      onClose={() => {
        if (!pending) close();
      }}
      closeDisabled={pending}
    >
      <form
        className="hosting-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (manual) return;
          setPending(true);
          setError("");
          void operation((operationId) =>
            rpc("hostingInstall", { operationId, request }),
          )
            .then((result) => {
              if (result) return done(result);
            })
            .finally(() => setPending(false));
        }}
      >
        <fieldset disabled={pending} className="hosting-install-fields">
          {!manual && (
            <Field label={t("Название сервера")}>
              <input
                required
                maxLength={120}
                value={request.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder="My server"
              />
            </Field>
          )}
          {[
            {
              label: "Игровые серверы",
              cores: ["paper", "purpur", "spigot", "folia", "vanilla"],
            },
            { label: "Прокси", cores: ["velocity"] },
          ].map((group) => (
            <section className="hosting-core-group" key={group.label}>
              <h3>{t(group.label)}</h3>
              <div
                className={`hosting-core-picker${group.cores.length === 1 ? " hosting-proxy-picker" : ""}`}
              >
                {group.cores.map((core) => (
                  <button
                    type="button"
                    key={core}
                    aria-pressed={request.core === core}
                    aria-label={hostingCores[core]}
                    className={request.core === core ? "selected" : ""}
                    title={t(hints[core])}
                    onClick={() => {
                      set("core", core);
                      set("version", "");
                    }}
                  >
                    <HostingIcon
                      size={34}
                      profile={{
                        core,
                        icon: {
                          symbol: "core",
                          color: "#edf0f3",
                          background: "#252b2c",
                        },
                      }}
                    />
                    <b>{hostingCores[core]}</b>
                    {request.core === core && (
                      <Check size={13} className="hosting-core-check" />
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
          {manual ? (
            <div className="hosting-spigot-source">
              <a
                className="button"
                href="https://www.spigotmc.org/wiki/buildtools/"
                target="_blank"
                rel="noreferrer"
              >
                BuildTools ↗
              </a>
            </div>
          ) : (
            <>
              <div className="hosting-form-grid">
                <Field label={t("Версия")}>
                  <Select
                    aria-label={t("Версия")}
                    disabled={loading || !versions.length || pending}
                    value={request.version}
                    onValueChange={(value) => set("version", value)}
                    placeholder={t(loading ? "Загрузка…" : "Выберите версию")}
                    options={versions.map(({ version }) => ({
                      value: version,
                      label: version,
                    }))}
                  />
                </Field>
                <Field label="RAM (MB)">
                  <input
                    type="number"
                    min={512}
                    max={65536}
                    step={256}
                    value={request.ramMb}
                    onChange={(event) =>
                      set("ramMb", Number(event.target.value))
                    }
                  />
                </Field>
              </div>
              {request.core === "folia" && (
                <p
                  className="hosting-core-note"
                  title={t(
                    "Folia не заменяет Paper напрямую: большинство обычных плагинов несовместимо. Выбирайте только плагины с поддержкой Folia.",
                  )}
                >
                  <Info size={14} />
                  {t("Нужны плагины с поддержкой Folia")}
                </p>
              )}
              {request.core === "velocity" && (
                <p
                  className="hosting-core-note"
                  title={t(
                    "Velocity — прокси, а не игровой сервер. После установки настройте адреса бэкендов. По умолчанию lobby: 127.0.0.1:25566, порт прокси: 25577.",
                  )}
                >
                  <Info size={14} />
                  {t("Общий вход в сеть серверов")}
                </p>
              )}
              {["paper", "folia", "velocity"].includes(request.core) && (
                <label className="hosting-check">
                  <input
                    type="checkbox"
                    checked={request.experimental}
                    onChange={(event) =>
                      set("experimental", event.target.checked)
                    }
                  />
                  {t("Разрешить экспериментальные сборки")}
                </label>
              )}
              {!isProxy(request.core) && (
                <label className="hosting-check">
                  <input
                    type="checkbox"
                    required
                    checked={request.acceptEula}
                    onChange={(event) =>
                      set("acceptEula", event.target.checked)
                    }
                  />
                  {t("Я прочитал и принимаю")}{" "}
                  <a
                    href="https://www.minecraft.net/eula"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Minecraft EULA
                  </a>
                </label>
              )}
            </>
          )}
          {error && <ErrorBox error={error} />}
          {pending && (
            <p className="hosting-notice">
              {t(progress?.message || "Устанавливаем сервер…")}
            </p>
          )}
          <div className="hosting-dialog-footer">
            <button type="button" className="button" onClick={close}>
              {t("Отмена")}
            </button>
            {manual ? (
              <button
                type="button"
                className="button primary"
                onClick={onImport}
              >
                <FolderOpen size={17} />
                {t("Импортировать готовый сервер")}
              </button>
            ) : (
              <button
                className="button primary"
                disabled={
                  loading ||
                  !request.version ||
                  (!isProxy(request.core) && !request.acceptEula)
                }
              >
                <Download size={17} />
                {t("Установить сервер")}
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
