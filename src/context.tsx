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
interface AppState {
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
  const [data, setData] = useState<Snapshot>(browserSnapshot);
  const [loaded, setLoaded] = useState(!native);
  const [fatal, setFatal] = useState("");
  const [route, navigate] = useState<Route>("home");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [logs, setLogs] = useState<Progress[]>([]);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );
  const refresh = useCallback(async () => {
    if (native) setData(await rpc("snapshot", {}));
  }, []);
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
        notify("Дождитесь завершения текущего действия");
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
          message: "Подготовка…",
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
  const play = useCallback(
    async (p: Profile) => {
      if (!data.selectedAccount) {
        navigate("accounts");
        notify("Добавьте аккаунт для запуска игры");
        return;
      }
      await operation(async (operationId) => {
        if (!p.installedVersion)
          await rpc("install", { id: p.id, operationId });
        await rpc("launch", { id: p.id });
      }, "Minecraft запущен");
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
          Повторить загрузку
        </button>
      </div>
    );
  if (!loaded)
    return (
      <div className="boot-error">
        <h1>Aurum</h1>
        <p>Открываем ваши миры…</p>
      </div>
    );
  return (
    <Context.Provider
      value={{
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
            aria-label="Закрыть уведомление"
          >
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
