import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Copy,
  ExternalLink,
  Eye,
  MoreVertical,
  Play,
  RefreshCw,
  Server,
  Signal,
  X,
} from "lucide-react";
import { useApp } from "../context";
import { native, rpc } from "../lib/api";
import { getFormatLocale, t } from "../lib/i18n";
import type { Profile, RecentServer, ServerStatus } from "../types";
import { Modal } from "./ui";

const WEEK = 7 * 24 * 60 * 60;

function ServerMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const close = useCallback(() => {
    setPosition(null);
    trigger.current?.focus();
  }, []);
  useEffect(() => {
    if (!position) return;
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setPosition(null);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      if (event.key === "Tab") close();
      const buttons = [
        ...(menu.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) || []),
      ];
      if (
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) &&
        buttons.length
      ) {
        event.preventDefault();
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next].focus();
      }
    };
    const scroll = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard, true);
    window.addEventListener("resize", scroll);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("resize", scroll);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [position, close]);
  return (
    <>
      <button
        ref={trigger}
        className="icon-button recent-server-more"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!position}
        onClick={() => {
          if (position) {
            close();
            return;
          }
          const bounds = trigger.current!.getBoundingClientRect();
          setPosition({
            top: Math.max(
              8,
              Math.min(bounds.bottom + 6, window.innerHeight - 266),
            ),
            left: Math.max(
              8,
              Math.min(bounds.right - 244, window.innerWidth - 252),
            ),
          });
        }}
      >
        <MoreVertical size={17} />
      </button>
      {position &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={label}
            className="recent-server-menu"
            style={position}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

function ServerIcon({ image }: { image: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  return (
    <span className="recent-server-icon">
      {image && !failed ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Server size={26} />
      )}
    </span>
  );
}

function relativeTime(timestamp: number, now: number) {
  const elapsed = Math.max(0, now - timestamp);
  const [value, unit] =
    elapsed < 60
      ? [0, "second"]
      : elapsed < 3600
        ? [-Math.floor(elapsed / 60), "minute"]
        : elapsed < 86400
          ? [-Math.floor(elapsed / 3600), "hour"]
          : [-Math.floor(elapsed / 86400), "day"];
  return new Intl.RelativeTimeFormat(getFormatLocale(), {
    numeric: "auto",
  }).format(value as number, unit as Intl.RelativeTimeFormatUnit);
}

export function RecentServers({
  onProfile,
}: {
  onProfile: (profile: Profile) => void;
}) {
  const { data, play, run, busy, notify } = useApp();
  const [servers, setServers] = useState<RecentServer[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({});
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const generation = useRef(0);
  const available = native && !!data.serverManager;
  const openProfile = (profile: Profile) => {
    setAll(false);
    onProfile(profile);
  };
  const load = useCallback(async () => {
    if (!available) return;
    const request = ++generation.current;
    try {
      const history = await rpc("recentServers", {});
      if (generation.current === request) {
        setServers(history);
        setError("");
      }
    } catch (error) {
      if (generation.current === request) setError(String(error));
    }
  }, [available]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
      if (!document.hidden) void load();
    }, 30000);
    return () => {
      ++generation.current;
      clearInterval(timer);
    };
  }, [load]);
  const check = useCallback(
    async (id: string, force: boolean) => {
      setChecking((previous) => new Set(previous).add(id));
      try {
        const status = await rpc("serverStatus", { id, force });
        setStatuses((previous) => ({ ...previous, [id]: status }));
      } catch (error) {
        if (force) notify(String(error), true);
      } finally {
        setChecking((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      }
    },
    [notify],
  );
  const recent = servers
    .filter(
      (server) =>
        server.lastPlayed >= now - WEEK &&
        data.profiles.some((profile) => profile.id === server.profileId),
    )
    .sort((first, second) => second.lastPlayed - first.lastPlayed);
  const visible = all ? recent : recent.slice(0, 5);
  const statusKey = visible.map((server) => server.id).join(";");
  useEffect(() => {
    if (!available) return;
    for (const id of statusKey.split(";").filter(Boolean))
      void check(id, false);
  }, [available, statusKey, check, servers]);
  const rows = (list: RecentServer[]) =>
    list.map((server) => {
      const profile = data.profiles.find(
        (profile) => profile.id === server.profileId,
      )!;
      const status = statuses[server.id];
      const running = data.running.includes(profile.id);
      const exactDate = new Date(server.lastPlayed * 1000);
      return (
        <article
          className="recent-server-row"
          key={server.id}
          aria-label={server.name}
        >
          <ServerIcon image={status?.icon || server.icon} />
          <div className="recent-server-identity">
            <div className="recent-server-title">
              <b title={`${server.name} · ${server.address}`}>{server.name}</b>
              <span
                className={`recent-server-status ${status?.online ? "online" : ""}`}
                title={
                  checking.has(server.id)
                    ? t("Проверяем сервер…")
                    : status
                      ? `${status.online ? t("В сети") : t("Ответ сервера не получен")} · ${new Date(status.checkedAt * 1000).toLocaleTimeString(getFormatLocale())}${status.latencyMs !== null ? ` · ${status.latencyMs} ms` : ""}`
                      : t("Ещё не проверен")
                }
              >
                {checking.has(server.id) ? (
                  <RefreshCw size={14} className="spin" aria-hidden="true" />
                ) : status?.online ? (
                  <Signal size={15} aria-hidden="true" />
                ) : null}
                <span>
                  {status?.online ? (
                    <>
                      {status.players ?? "—"}
                      <small>/{status.maxPlayers ?? "—"}</small>
                    </>
                  ) : status ? (
                    t("Недоступен")
                  ) : (
                    "—"
                  )}
                </span>
              </span>
            </div>
            <div className="recent-server-meta">
              <button
                className="recent-server-profile"
                title={`${profile.name} · ${profile.minecraft} · ${profile.loader}`}
                onClick={() => openProfile(profile)}
              >
                {profile.name}
                <span> · {profile.minecraft}</span>
              </button>
              <time
                className="recent-server-time"
                dateTime={exactDate.toISOString()}
                title={exactDate.toLocaleString(getFormatLocale())}
              >
                {relativeTime(server.lastPlayed, now)}
              </time>
            </div>
          </div>
          <button
            className="recent-server-play"
            aria-label={t("Играть на сервере {{name}}", { name: server.name })}
            title={
              running
                ? t("Сначала остановите эту сборку")
                : t("Подключиться к {{address}}", { address: server.address })
            }
            disabled={busy || running}
            onClick={() => void play(profile, server.address).then(load)}
          >
            <Play size={17} />
            <span>{t("Играть")}</span>
          </button>
          <ServerMenu
            label={t("Действия сервера {{name}}", { name: server.name })}
          >
            {(close) => (
              <>
                <button
                  role="menuitem"
                  disabled={busy || running}
                  onClick={() => {
                    close();
                    void play(profile);
                  }}
                >
                  <Play size={16} />
                  {t("Запустить сборку")}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    openProfile(profile);
                  }}
                >
                  <Eye size={16} />
                  {t("Посмотреть сборку")}
                </button>
                <button
                  role="menuitem"
                  disabled={checking.has(server.id)}
                  onClick={() => {
                    close();
                    void check(server.id, true);
                  }}
                >
                  <RefreshCw size={16} />
                  {t("Обновить")}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    void navigator.clipboard
                      .writeText(server.address)
                      .then(() => notify(t("Адрес сервера скопирован")))
                      .catch(() =>
                        notify(t("Не удалось скопировать адрес сервера"), true),
                      );
                  }}
                >
                  <Copy size={16} />
                  {t("Копировать адрес")}
                </button>
                <div role="separator" />
                <button
                  role="menuitem"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    close();
                    void run(async () => {
                      await rpc("removeRecentServer", { id: server.id });
                      await load();
                    });
                  }}
                >
                  <X size={16} />
                  {t("Убрать из списка")}
                </button>
                <button
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    close();
                    void run(
                      () => rpc("createServerShortcut", { id: server.id }),
                      t("Ярлык сервера создан на рабочем столе"),
                    );
                  }}
                >
                  <ExternalLink size={16} />
                  {t("Создать ярлык")}
                </button>
              </>
            )}
          </ServerMenu>
        </article>
      );
    });
  return (
    <>
      <section className="recent-servers" aria-label={t("Недавние серверы")}>
        <div className="recent-servers-heading">
          <h2>{t("Недавние серверы")}</h2>
          {recent.length > 5 && (
            <button className="text-button" onClick={() => setAll(true)}>
              {t("Все серверы")}
              <ArrowRight size={15} />
            </button>
          )}
        </div>
        {error ? (
          <div className="recent-servers-empty" role="status">
            <span>{t("Не удалось загрузить серверы")}</span>
            <button className="text-button" onClick={() => void load()}>
              {t("Повторить")}
            </button>
          </div>
        ) : recent.length ? (
          <div className="recent-server-list">{rows(recent.slice(0, 5))}</div>
        ) : (
          <div className="recent-servers-empty">
            <Server size={19} />
            <span>
              {t(
                "Здесь появятся серверы, к которым вы подключались за последнюю неделю.",
              )}
            </span>
          </div>
        )}
      </section>
      {all && (
        <Modal
          title={t("Серверы за последнюю неделю")}
          onClose={() => setAll(false)}
          wide
          className="recent-servers-dialog"
        >
          <div className="recent-server-list">{rows(recent)}</div>
        </Modal>
      )}
    </>
  );
}
