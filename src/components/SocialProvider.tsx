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
import { getLocale, t } from "../lib/i18n";
import { useApp } from "../context";
import type { SocialSnapshot, SocialPerson } from "../lib/social";
import { Modal } from "./ui";
import { SocialInviteQueue } from "./SocialInvitations";
import { SocialAvatar, SocialId } from "./SocialIdentity";
import "../screens/friends.css";
interface SocialContextValue {
  snapshot: SocialSnapshot | null;
  refresh: () => Promise<void>;
  act: (job: () => Promise<unknown>) => Promise<boolean>;
  working: boolean;
  requestDisable: () => void;
  chime: (kind: "sent" | "received") => void;
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
  const pending = useRef(0);
  const [disabling, setDisabling] = useState(false);
  const alerted = useRef(new Set<string>());
  const audio = useRef<AudioContext | null>(null);
  const alive = useRef(true);
  const seen = useRef(new Set<string>());
  const [request, setRequest] = useState<SocialPerson | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const chime = useCallback(
    (kind: "sent" | "received") => {
      if (snapshot?.privacy.notifications === false) return;
      const context = audio.current;
      if (context?.state !== "running") return;
      const notes = kind === "sent" ? [523.25, 783.99] : [659.25, 880];
      for (const [i, frequency] of notes.entries()) {
        const note = context.createOscillator(),
          gain = context.createGain();
        note.type = "sine";
        note.frequency.value = frequency;
        note.connect(gain);
        gain.connect(context.destination);
        const start = context.currentTime + i * 0.14;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.065, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
        note.start(start);
        note.stop(start + 0.36);
        note.onended = () => {
          note.disconnect();
          gain.disconnect();
        };
      }
    },
    [snapshot?.privacy.notifications],
  );
  useEffect(() => {
    const unlock = () => {
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {});
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      void audio.current?.close().catch(() => {});
      audio.current = null;
    };
  }, []);
  useEffect(() => {
    if (!snapshot?.enabled) return;
    const arrivals = [
      ...snapshot.people
        .filter((p) => p.state === "incoming")
        .map((p) => ({
          key: `request:${p.id}:${p.updated}`,
          kind: "request" as const,
          id: p.id,
          name: p.name,
          title: "@social.new.request",
        })),
      ...snapshot.invitations
        .filter((i) => i.status !== "failed")
        .map((i) => ({
          key: `invite:${i.offer.id}`,
          kind: "invite" as const,
          id: i.offer.id,
          name:
            snapshot.people.find((p) => p.id === i.from)?.name ||
            t("@social.unknown"),
          title: "@social.received.world",
        })),
    ];
    for (const arrival of arrivals) {
      if (alerted.current.has(arrival.key)) continue;
      if (alerted.current.size >= 2048)
        alerted.current.delete(alerted.current.values().next().value!);
      alerted.current.add(arrival.key);
      if (snapshot.privacy.notifications === false) continue;
      notify(`${t(arrival.title)} · ${arrival.name}`);
      const context = audio.current;
      void rpc("social.notify", {
        kind: arrival.kind,
        id: arrival.id,
        russian: getLocale().startsWith("ru"),
        silent: context?.state === "running",
      }).catch(() => {});
      chime("received");
    }
  }, [snapshot, notify, chime]);
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
      ++pending.current;
      setWorking(true);
      try {
        await job();
        await refresh();
        return true;
      } catch (e) {
        notify(t(e instanceof Error ? e.message : String(e)), true);
        return false;
      } finally {
        setWorking(--pending.current > 0);
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
    <Context.Provider
      value={{
        snapshot,
        refresh,
        act,
        working,
        requestDisable: () => setDisabling(true),
        chime,
      }}
    >
      {children}
      {disabling && (
        <Modal
          title={t("@social.disable.confirm")}
          onClose={() => setDisabling(false)}
          className="social-dialog"
        >
          <p className="social-warning">{t("@social.disable.hint")}</p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDisabling(false)}>
              {t("@social.cancel")}
            </button>
            <button
              className="button social-danger"
              onClick={() =>
                void act(() => rpc("social.disable", {})).then((ok) => {
                  if (ok) setDisabling(false);
                })
              }
            >
              {t("@social.disable")}
            </button>
          </div>
        </Modal>
      )}
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
          className="social-dialog social-request"
        >
          <SocialAvatar id={request.id} avatar={request.avatar} />
          <SocialId id={request.id} />
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
              className="button social-positive"
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
