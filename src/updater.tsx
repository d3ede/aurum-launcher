import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useApp } from "./context";
import { native } from "./lib/api";

type Stage =
  "idle" | "checking" | "current" | "available" | "downloading" | "installing";
interface UpdaterState {
  stage: Stage;
  version: string | null;
  downloaded: number;
  total: number | null;
  error: "check" | "download" | null;
  blocked: boolean;
  dismissed: boolean;
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}
const Context = createContext<UpdaterState | null>(null);
export function useUpdater() {
  const context = useContext(Context);
  if (!context) throw new Error("Missing update provider");
  return context;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { busy, data, run } = useApp();
  const [stage, setStage] = useState<Stage>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<UpdaterState["error"]>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const resource = useRef<Update | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const blocked = busy || data.running.length > 0;

  const checkNow = useCallback(async () => {
    if (!native || inFlight.current) return;
    inFlight.current = true;
    setStage("checking");
    setError(null);
    try {
      const next = await check({ timeout: 15000 });
      if (!mounted.current) {
        await next?.close();
        return;
      }
      const previous = resource.current;
      resource.current = next;
      await previous?.close().catch(() => {});
      setVersion(next?.version ?? null);
      setStage(next ? "available" : "current");
    } catch (reason) {
      console.error("Launcher update check failed", reason);
      if (mounted.current) {
        setError("check");
        setStage(resource.current ? "available" : "idle");
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    if (!native || blocked || inFlight.current || !version) return;
    inFlight.current = true;
    try {
      await run(async () => {
        setError(null);
        setDownloaded(0);
        setTotal(null);
        setStage("downloading");
        let update: Update | null = null;
        try {
          update = resource.current ?? (await check({ timeout: 15000 }));
          resource.current = update;
          if (!update) {
            setVersion(null);
            setStage("current");
            return;
          }
          setVersion(update.version);
          // download() verifies the signature before it resolves. Never call
          // install() after a failed download or signature verification.
          await update.download(
            (event) => {
              if (event.event === "Started")
                setTotal(event.data.contentLength ?? null);
              if (event.event === "Progress")
                setDownloaded((value) => value + event.data.chunkLength);
            },
            { timeout: 120000 },
          );
          setStage("installing");
          await update.install({ restartAfterInstall: true });
        } catch (reason) {
          console.error("Launcher update download/install failed", reason);
          // The installer may have consumed its native byte resource before
          // failing. Close it and obtain a fresh resource on the next retry.
          await update?.close().catch(() => {});
          resource.current = null;
          setError("download");
          setStage("available");
        }
      });
    } finally {
      inFlight.current = false;
    }
  }, [blocked, run, version]);

  useEffect(() => {
    mounted.current = true;
    // Development/browser previews never make background release requests.
    const startup =
      native && import.meta.env.PROD
        ? setTimeout(() => void checkNow(), 10000)
        : undefined;
    const interval =
      native && import.meta.env.PROD
        ? setInterval(() => void checkNow(), 6 * 60 * 60 * 1000)
        : undefined;
    return () => {
      mounted.current = false;
      clearTimeout(startup);
      clearInterval(interval);
      void resource.current?.close().catch(() => {});
      resource.current = null;
    };
  }, [checkNow]);

  return (
    <Context.Provider
      value={{
        stage,
        version,
        downloaded,
        total,
        error,
        blocked,
        dismissed: version === dismissedVersion,
        checkNow,
        install,
        dismiss: () => setDismissedVersion(version),
      }}
    >
      {children}
    </Context.Provider>
  );
}
