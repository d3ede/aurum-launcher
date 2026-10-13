import { t, tMessage, useLocale, setLanguagePreference } from "./lib/i18n";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { browserSnapshot, events, native, rpc } from "./lib/api";
import type { Snapshot, Progress, Profile, Route } from "./types";
export interface MicrosoftLoginState {
  id: string;
  status: "active" | "cancelling" | "success" | "error" | "cancelled";
  phase: string;
  message?: string;
  name?: string;
}
interface AppState {
  microsoftLogin: MicrosoftLoginState | null;
  startMicrosoftLogin: () => Promise<void>;
  closeMicrosoftLogin: () => Promise<void>;
  data: Snapshot;
  refresh: () => Promise<void>;
  busy: boolean;
  progress: Progress | null;
  logs: Progress[];
  run: <T>(
    action: () => Promise<T>,
    success?: string,
  ) => Promise<T | undefined>;
  operation: <T>(
    action: (id: string) => Promise<T>,
    success?: string,
  ) => Promise<T | undefined>;
  play: (p: Profile) => Promise<void>;
  route: Route;
  navigate: (route: Route) => void;
  create: () => void;
  notify: (message: string, error?: boolean) => void;
}
const Context = createContext<AppState | null>(null);
export const useApp = () => {
  const value = useContext(Context);
  if (!value) throw new Error("Missing App provider");
  return value;
};
export function Provider({
  children,
  onCreate,
}: {
  children: ReactNode;
  onCreate: () => void;
}) {
  useLocale();
  const [data, setData] = useState<Snapshot>(browserSnapshot);
  const [loaded, setLoaded] = useState(!native);
  const [fatal, setFatal] = useState("");
  const [route, navigate] = useState<Route>("home");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [microsoftLogin, setMicrosoftLogin] =
    useState<MicrosoftLoginState | null>(null);
  const loginIds = useRef(new Set<string>());
  const loginId = useRef("");
  const loginCancelled = useRef(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [logs, setLogs] = useState<Progress[]>([]);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const notify = useCallback(
    (message: string, error = false) =>
      setToast({ message: tMessage(message), error }),
    [],
  );
  useEffect(() => {
    if (native && loaded)
      void setLanguagePreference(data.settings.language || "ru").catch(
        (error) => notify(String(error), true),
      );
  }, [data.settings.language, loaded, notify]);
  const refresh = useCallback(async () => {
    if (native) setData(await rpc("snapshot", {}));
  }, []);
  useEffect(() => {
    if (!native || !data.running.length) return;
    let active = true;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      rpc("snapshot", {})
        .then(snapshot => { if (active) setData(snapshot); })
        .catch(() => {})
        .finally(() => { pending = false; });
    }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [data.running.length]);
  useEffect(() => {
    let live = true;
    let unsubscribe: (() => void) | undefined;
    refresh()
      .then(() => {
        if (live) {
          setLoaded(true);
          setFatal("");
        }
      })
      .catch((e) => {
        if (live) setFatal(e.message);
      });
    events((event) => {
      if (loginIds.current.has(event.id)) {
        if (event.id === loginId.current && event.phase.startsWith("auth-")) {
          if (loginCancelled.current)
            void rpc("cancel", { operationId: event.id }).catch(() => {});
          setMicrosoftLogin((old) =>
            old?.status === "active" ? { ...old, phase: event.phase } : old,
          );
        }
        return;
      }
      if (["log", "loader", "error", "exited", "crashed"].includes(event.phase))
        setLogs((old) => [...old.slice(-499), event]);
      if (
        event.phase === "running" ||
        event.phase === "exited" ||
        event.phase === "crashed"
      ) {
        void refresh().catch((e) => notify(e.message, true));
        if (event.phase === "crashed") notify(event.message, true);
      } else if (event.phase !== "log") setProgress(event);
    }).then((fn) => {
      if (live) unsubscribe = fn;
      else fn();
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [refresh, notify]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 10000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const run = useCallback(
    async <T,>(
      action: () => Promise<T>,
      success?: string,
    ): Promise<T | undefined> => {
      if (lock.current) {
        notify(t("Дождитесь завершения текущего действия"));
        return;
      }
      lock.current = true;
      setBusy(true);
      try {
        const value = await action();
        await refresh();
        if (success) notify(success);
        return value;
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), true);
        return;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [refresh, notify],
  );
  const operation = useCallback(
    async <T,>(action: (id: string) => Promise<T>, success?: string) =>
      run(async () => {
        const id = crypto.randomUUID();
        setProgress({
          id,
          profileId: null,
          phase: "metadata",
          message: t("Подготовка\u2026"),
          done: 0,
          total: 0,
        });
        try {
          return await action(id);
        } finally {
          setProgress(null);
        }
      }, success),
    [run],
  );
  const startMicrosoftLogin = useCallback(async () => {
    if (lock.current) {
      notify(t("Дождитесь завершения текущего действия"));
      return;
    }
    lock.current = true;
    setBusy(true);
    const id = crypto.randomUUID();
    loginId.current = id;
    loginIds.current.add(id);
    loginCancelled.current = false;
    setMicrosoftLogin({ id, status: "active", phase: "auth-opening" });
    try {
      const account = await rpc("loginMicrosoft", { operationId: id });
      // A late cancellation must still show an account that was already persisted.
      setData((old) => ({
        ...old,
        accounts: [...old.accounts.filter((a) => a.id !== account.id), account],
        selectedAccount: account.id,
      }));
      setMicrosoftLogin({
        id,
        status: "success",
        phase: "complete",
        name: account.name,
      });
      await refresh().catch(() => {});
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const cancelled =
        loginCancelled.current ||
        message.includes("отменён") ||
        message.includes("отменена");
      setMicrosoftLogin({
        id,
        status: cancelled ? "cancelled" : "error",
        phase: "error",
        message,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [notify, refresh]);
  const closeMicrosoftLogin = useCallback(async () => {
    if (!microsoftLogin || microsoftLogin.status === "cancelling") return;
    if (microsoftLogin.status !== "active") {
      setMicrosoftLogin(null);
      return;
    }
    loginCancelled.current = true;
    setMicrosoftLogin({ ...microsoftLogin, status: "cancelling" });
    // Early Escape can precede registration in Rust. The first auth event retries cancellation.
    try {
      await rpc("cancel", { operationId: microsoftLogin.id });
    } catch {
      /* If registration is pending, the first auth event retries; completed results win. */
    }
  }, [microsoftLogin]);
  const play = useCallback(
    async (p: Profile) => {
      if (!data.selectedAccount) {
        navigate("accounts");
        notify(t("Добавьте аккаунт для запуска игры"));
        return;
      }
      await operation(async (operationId) => {
        if (!p.installedVersion)
          await rpc("install", { id: p.id, operationId });
        await rpc("launch", { id: p.id });
      }, t("Minecraft запущен"));
    },
    [data.selectedAccount, operation, notify],
  );
  if (fatal)
    return (
      <div className="boot-error">
        <h1>Aurum</h1>
        <p role="alert">{fatal}</p>
        <button
          className="button primary"
          onClick={() => {
            void refresh()
              .then(() => {
                setLoaded(true);
                setFatal("");
              })
              .catch((e) => setFatal(e.message));
          }}
        >
          {t("Повторить загрузку")}
        </button>
      </div>
    );
  if (!loaded)
    return (
      <div className="boot-error">
        <h1>Aurum</h1>
        <p>{t("Открываем ваши миры\u2026")}</p>
      </div>
    );
  return (
    <Context.Provider
      value={{
        microsoftLogin,
        startMicrosoftLogin,
        closeMicrosoftLogin,
        data,
        refresh,
        busy,
        progress,
        logs,
        run,
        operation,
        play,
        route,
        navigate,
        create: onCreate,
        notify,
      }}
    >
      {children}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            aria-label={t("Закрыть уведомление")}
          >
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
