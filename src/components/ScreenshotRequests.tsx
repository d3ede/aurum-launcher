import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Images, LoaderCircle, X } from "lucide-react";
import { native, rpc } from "../lib/api";
import { getLocale, t } from "../lib/i18n";
import type { ScreenshotTransfer } from "../lib/screenshots";
import { useApp } from "../context";
import { useSocial } from "./SocialProvider";
import { SocialAvatar } from "./SocialIdentity";

export function screenshotBatches(items: ScreenshotTransfer[]) {
  const groups = new Map<string, ScreenshotTransfer[]>();
  for (const item of items) {
    const key = `${item.direction}:${item.peer}:${item.batch}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return [...groups.values()];
}
function countLabel(items: ScreenshotTransfer[]) {
  const count = Math.min(10, Math.max(items.length, items[0]?.count || 1));
  const key = `@shots.count.${new Intl.PluralRules(getLocale()).select(count)}`;
  const label = t(key, { count });
  return label === key ? t("@shots.count.other", { count }) : label;
}
export function ScreenshotRequests({
  items,
  refresh,
}: {
  items: ScreenshotTransfer[];
  refresh: () => Promise<void>;
}) {
  const { snapshot } = useSocial();
  const { notify } = useApp();
  const [working, setWorking] = useState(new Set<string>());
  const decide = async (batch: string, accept: boolean) => {
    setWorking((current) => new Set(current).add(batch));
    try {
      await rpc("screenshots.decide", { batch, accept });
      await refresh();
    } catch (error) {
      notify(String(error), true);
    } finally {
      setWorking((current) => {
        const next = new Set(current);
        next.delete(batch);
        return next;
      });
    }
  };
  return screenshotBatches(
    items.filter(
      (item) => item.direction === "incoming" && item.status === "requested",
    ),
  ).map((batch) => {
    const item = batch[0],
      person = snapshot?.people.find((p) => p.id === item.peer);
    return (
      <article
        className="shot-request-card"
        key={item.batch}
        aria-label={t("@shots.request.title")}
      >
        <SocialAvatar id={item.peer} avatar={person?.avatar} size={44} />
        <div className="shot-request-copy">
          <strong>{person?.name || item.peer.slice(0, 12)}</strong>
          <p>{t("@shots.request.offer", { count: countLabel(batch) })}</p>
        </div>
        <div className="shot-request-actions">
          <button
            className="button secondary"
            disabled={working.has(item.batch)}
            onClick={() => void decide(item.batch, false)}
          >
            {t("@social.decline")}
          </button>
          <button
            className="button primary"
            disabled={working.has(item.batch)}
            onClick={() => void decide(item.batch, true)}
          >
            {working.has(item.batch) ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}
            {t("@social.accept")}
          </button>
        </div>
      </article>
    );
  });
}

interface Notice {
  key: string;
  title: string;
  text: string;
  received: boolean;
  negative: boolean;
  expires: number;
}
export function ScreenshotNotifications() {
  const { snapshot, chime } = useSocial();
  const { route, navigate } = useApp();
  const [state, setState] = useState<{
    owner: string | null;
    items: ScreenshotTransfer[];
  }>({ owner: null, items: [] });
  const owner = snapshot?.id || null;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const items = state.owner === owner ? state.items : [];
  const [notices, setNotices] = useState<Notice[]>([]);
  const seen = useRef(new Set<string>());
  const rememberedOwner = useRef<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const request = rpc("screenshots.transfers", {})
      .then((items) => {
        if (currentOwner.current === owner) setState({ owner, items });
      })
      .catch(() => {})
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = request;
    return request;
  }, [owner]);
  useEffect(() => {
    if (!native || !snapshot?.id) return;
    let disposed = false;
    const poll = () => {
      if (!disposed) void refresh();
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [snapshot?.id, refresh]);
  useEffect(() => {
    if (!snapshot?.id) return;
    const storageKey = `aurum:screenshot-notices:${snapshot.id}`;
    if (rememberedOwner.current !== snapshot.id) {
      rememberedOwner.current = snapshot.id;
      seen.current = new Set();
      setNotices([]);
      try {
        for (const key of JSON.parse(localStorage.getItem(storageKey) || "[]"))
          if (typeof key === "string") seen.current.add(key);
      } catch {
        /* Storage may be unavailable. */
      }
    }
    let remember = false;
    const enabled = snapshot.privacy.notifications !== false;
    const fresh: Notice[] = [];
    for (const batch of screenshotBatches(items)) {
      const item = batch[0],
        person = snapshot.people.find((p) => p.id === item.peer);
      const name = person?.name || item.peer.slice(0, 12),
        count = countLabel(batch);
      const request =
        item.direction === "incoming" &&
        batch.some((i) => i.status === "requested");
      const received =
        item.direction === "incoming" &&
        batch.length >= (item.count || 1) &&
        batch.every((i) => i.decision === true && i.status === "received");
      const accepted =
        item.direction === "outgoing" && batch.some((i) => i.decision === true);
      const rejected =
        item.direction === "outgoing" &&
        batch.some((i) => i.status === "rejected");
      const failed =
        item.direction === "outgoing" &&
        batch.some((i) => i.status === "failed");
      for (const [kind, applies] of [
        ["request", request],
        ["accepted", accepted],
        ["rejected", rejected],
        ["failed", failed],
        ["received", received],
      ] as const) {
        if (!applies) continue;
        const key = `${snapshot.id}:${item.batch}:${kind}`;
        if (seen.current.has(key)) continue;
        seen.current.add(key);
        remember = true;
        if (!enabled) continue;
        chime(
          kind === "request"
            ? "photo"
            : kind === "rejected" || kind === "failed"
              ? "photoDeclined"
              : "photoAccepted",
        );
        if (kind !== "request")
          fresh.push({
            key,
            title: t(`@shots.notice.${kind}`),
            text:
              kind === "received"
                ? t("@shots.destination")
                : `${name} · ${count}`,
            received: kind === "received",
            negative: kind === "rejected" || kind === "failed",
            expires: Date.now() + 9000,
          });
      }
    }
    if (seen.current.size > 16384)
      seen.current = new Set([...seen.current].slice(-16384));
    if (remember) {
      try {
        localStorage.setItem(storageKey, JSON.stringify([...seen.current]));
      } catch {
        /* Notifications still work for this session. */
      }
    }
    if (fresh.length) setNotices((current) => [...current, ...fresh].slice(-4));
  }, [items, snapshot, chime]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setNotices((current) =>
          current.some((n) => n.expires <= Date.now())
            ? current.filter((n) => n.expires > Date.now())
            : current,
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const openReceived = () => {
    sessionStorage.setItem("aurum:screenshot-tab", "received");
    navigate("screenshots");
    window.dispatchEvent(new Event("aurum:screenshots-received"));
  };
  const enabled = snapshot?.privacy.notifications !== false;
  const pending = screenshotBatches(
    items.filter((i) => i.direction === "incoming" && i.status === "requested"),
  )
    .slice(0, 3)
    .flat();
  const receiving = screenshotBatches(
    items.filter((i) => i.direction === "incoming" && i.decision === true),
  )
    .filter((batch) =>
      batch.some((i) => ["accepted", "receiving"].includes(i.status)),
    )
    .slice(0, 2);
  return (
    <aside
      className="shot-notifications"
      aria-label={t("@shots.notifications")}
      aria-live="polite"
    >
      {enabled && route !== "screenshots" && (
        <ScreenshotRequests items={pending} refresh={refresh} />
      )}
      {enabled &&
        receiving.map((batch) => (
          <article
            className="shot-notice"
            key={`receiving:${batch[0].batch}`}
            role="status"
          >
            <LoaderCircle size={21} className="spin" />
            <div>
              <strong>{t("@shots.receiving.batch")}</strong>
              <p>
                {countLabel(batch)} · {t("@shots.destination")}
              </p>
              <progress
                aria-label={t("@shots.receiving.batch")}
                value={batch.reduce(
                  (sum, i) =>
                    sum +
                    (i.status === "received" ? i.bytes + 16 : i.transferred),
                  0,
                )}
                max={batch.reduce((sum, i) => sum + i.bytes + 16, 0)}
              />
            </div>
          </article>
        ))}
      {notices.map((notice) => (
        <article
          className={`shot-notice ${notice.negative ? "negative" : ""}`}
          key={notice.key}
          role="status"
        >
          <span className="shot-notice-icon">
            {notice.negative ? (
              <X size={21} />
            ) : notice.received ? (
              <Images size={21} />
            ) : (
              <Check size={21} />
            )}
          </span>
          <div>
            <strong>{notice.title}</strong>
            <p>{notice.text}</p>
            {notice.received && (
              <button className="text-button" onClick={openReceived}>
                {t("@shots.open.received")}
              </button>
            )}
          </div>
          <button
            className="icon-button"
            aria-label={t("@shots.dismiss")}
            onClick={() =>
              setNotices((current) =>
                current.filter((n) => n.key !== notice.key),
              )
            }
          >
            <X size={16} />
          </button>
        </article>
      ))}
    </aside>
  );
}
