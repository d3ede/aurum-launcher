import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { native, rpc } from "../lib/api";
import { t } from "../lib/i18n";
import { useApp } from "../context";
import type { SocialSnapshot, SocialPerson } from "../lib/social";
import { Modal } from "./ui";
import { SocialInviteQueue } from "./SocialInvitations";
import "../screens/friends.css";
interface SocialContextValue {
  snapshot: SocialSnapshot | null;
  refresh: () => Promise<void>;
  act: (job: () => Promise<unknown>) => Promise<boolean>;
  working: boolean;
}
const Context = createContext<SocialContextValue | null>(null);
export function useSocial() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing Social provider");
  return value;
}
export function SocialProvider({ children }: { children: ReactNode }) {
  const { notify } = useApp();
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [working, setWorking] = useState(false);
  const alive = useRef(true);
  const seen = useRef(new Set<string>());
  const [request, setRequest] = useState<SocialPerson | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const take = () =>
      void rpc("social.takeLink", {})
        .then((value) => {
          if (
            !disposed &&
            typeof value === "string" &&
            value.startsWith("aurum://") &&
            value.length <= 1800
          )
            setLink(value);
        })
        .catch(() => {});
    take();
    for (const [event, callback] of [
      ["social:link", take],
      ["social:closeRequested", () => setClosing(true)],
    ] as const) {
      void listen(event, callback).then((fn) => {
        if (disposed) fn();
        else cleanups.push(fn);
      });
    }
    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!native) return;
    try {
      const state = await rpc("social.snapshot", {});
      if (alive.current) setSnapshot(state);
    } catch {
      /* A transient snapshot error must not open repeated global dialogs. */
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    let cleanup: (() => void) | undefined;
    let disposed = false;
    if (native)
      void listen("social:event", () => void refresh()).then((fn) => {
        if (disposed) fn();
        else cleanup = fn;
      });
    return () => {
      disposed = true;
      alive.current = false;
      cleanup?.();
    };
  }, [refresh]);
  useEffect(() => {
    if (!snapshot?.enabled) return;
    const interval = setInterval(() => void refresh(), 2000);
    return () => clearInterval(interval);
  }, [snapshot?.enabled, refresh]);
  const act = useCallback(
    async (job: () => Promise<unknown>) => {
      setWorking(true);
      try {
        await job();
        await refresh();
        return true;
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), true);
        return false;
      } finally {
        setWorking(false);
      }
    },
    [refresh, notify],
  );
  useEffect(() => {
    if (!snapshot?.enabled) {
      setRequest(null);
      return;
    }
    if (
      request &&
      !snapshot.people.some(
        (p) => p.id === request.id && p.state === "incoming",
      )
    ) {
      setRequest(null);
      return;
    }
    if (request) return;
    const show = () => {
      if (
        document.querySelector(
          '[data-aurum-modal],[role="dialog"],.select-menu[data-state="open"]',
        )
      )
        return;
      const next = snapshot.people
        .filter((p) => p.state === "incoming")
        .slice(0, 10)
        .find((p) => !seen.current.has(`${p.id}:${p.updated}`));
      if (next) {
        if (seen.current.size >= 2048)
          seen.current.delete(seen.current.values().next().value!);
        seen.current.add(`${next.id}:${next.updated}`);
        setRequest(next);
      }
    };
    show();
    const timer = setInterval(show, 500);
    return () => clearInterval(timer);
  }, [snapshot, request]);
  const relationship = async (action: string) => {
    const handled = request?.id;
    if (
      request &&
      (await act(() => rpc("social.relationship", { id: request.id, action })))
    )
      setRequest((current) => (current?.id === handled ? null : current));
  };
  return (
    <Context.Provider value={{ snapshot, refresh, act, working }}>
      {children}
      {closing && (
        <Modal
          title={t("@social.close.title")}
          onClose={() => setClosing(false)}
          closeDisabled={working}
        >
          <p>{t("@social.close.hint")}</p>
          <div className="modal-actions">
            <button className="button" onClick={() => setClosing(false)}>
              {t("@social.cancel")}
            </button>
            <button
              className="button primary"
              disabled={working}
              onClick={() => void act(() => rpc("social.close", {}))}
            >
              {t("@social.close.confirm")}
            </button>
          </div>
        </Modal>
      )}
      {link && !request && !closing && (
        <Modal
          title={t("@social.add")}
          onClose={() => setLink(null)}
          closeDisabled={working}
        >
          <p>{t("@social.identity.hint")}</p>
          <code className="social-full-id">{link}</code>
          <p>
            {t(
              !snapshot?.enabled
                ? "@social.link.disabled"
                : "@social.link.confirm",
            )}
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setLink(null)}>
              {t("@social.cancel")}
            </button>
            <button
              className="button primary"
              disabled={working || !snapshot?.enabled}
              onClick={() =>
                void act(() => rpc("social.add", { input: link })).then(
                  (ok) => {
                    if (ok) setLink(null);
                  },
                )
              }
            >
              {t("@social.request")}
            </button>
          </div>
        </Modal>
      )}
      {request && (
        <Modal
          title={t("@social.new.request")}
          subtitle={request.name || request.id.slice(0, 16)}
          onClose={() => setRequest(null)}
          closeDisabled={working}
          className="social-request"
        >
          <p>{t("@social.identity.hint")}</p>
          <code className="social-full-id">{request.id}</code>
          <div className="modal-actions">
            <button
              className="text-button"
              disabled={working}
              onClick={() => void relationship("block")}
            >
              {t("@social.block")}
            </button>
            <button
              className="button"
              disabled={working}
              onClick={() => void relationship("decline")}
            >
              {t("@social.decline")}
            </button>
            <button
              className="button primary"
              disabled={working}
              onClick={() => void relationship("accept")}
            >
              {t("@social.accept")}
            </button>
          </div>
        </Modal>
      )}
      <SocialInviteQueue />
    </Context.Provider>
  );
}
