import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Images,
  Search,
  RefreshCw,
  FolderOpen,
  ZoomIn,
  Check,
  Send,
  X,
  Download,
  Clock3,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { native, rpc } from "../lib/api";
import { getLocale, t } from "../lib/i18n";
import { useApp } from "../context";
import { socialSize, type SocialPerson } from "../lib/social";
import type { Screenshot, ScreenshotTransfer } from "../lib/screenshots";
import { Modal, Loading, EmptyState, ErrorBox } from "./ui";
import { Select } from "./Select";
import { ImageLightbox } from "./ProjectMedia";
import { useSocial } from "./SocialProvider";
import { ScreenshotRequests } from "./ScreenshotRequests";
export { ScreenshotNotifications } from "./ScreenshotRequests";
import "../screens/screenshots.css";

const thumbnails = new Map<string, string>();
function useScreenshotActions() {
  const { notify } = useApp();
  return {
    onCopy: async (id: string) => {
      await rpc("screenshots.copy", { id });
      notify(t("@shots.copied"));
    },
    onSave: async (id: string) => {
      if (await rpc("screenshots.save", { id })) notify(t("@shots.saved"));
    },
  };
}
function useTransfers() {
  const [items, setItems] = useState<ScreenshotTransfer[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!native) return;
    try {
      setItems(await rpc("screenshots.transfers", {}));
      setError("");
    } catch (error) {
      setError(String(error));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  return { items, error, refresh };
}
function Thumbnail({ shot }: { shot: Screenshot }) {
  const button = useRef<HTMLDivElement>(null);
  const key = `${shot.id}:${shot.createdAt}:${shot.bytes}`;
  const [url, setUrl] = useState(thumbnails.get(key) || "");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    if (thumbnails.has(key)) {
      setUrl(thumbnails.get(key)!);
      return;
    }
    setUrl("");
    setFailed(false);
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void rpc("screenshots.image", { id: shot.id, thumbnail: true })
          .then((url) => {
            if (thumbnails.size >= 128)
              thumbnails.delete(thumbnails.keys().next().value!);
            thumbnails.set(key, url);
            if (alive) setUrl(url);
          })
          .catch(() => {
            if (alive) setFailed(true);
          });
      },
      { rootMargin: "300px" },
    );
    if (button.current) observer.observe(button.current);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [key, shot.id]);
  return (
    <div className="shot-thumbnail" ref={button}>
      {url ? (
        <img src={url} alt={shot.name} draggable={false} />
      ) : (
        <span className={`shot-placeholder ${failed ? "failed" : ""}`}>
          <ImageIcon size={30} />
          {failed && <small>{t("@shots.load.failed")}</small>}
        </span>
      )}
    </div>
  );
}
function ScreenshotViewer({
  shots,
  initialIndex,
  onClose,
}: {
  shots: Screenshot[];
  initialIndex: number;
  onClose: () => void;
}) {
  const actions = useScreenshotActions();
  const images = useMemo(() => shots.map((shot) => shot.id), [shots]);
  const initial = shots[initialIndex];
  const preview =
    initial &&
    thumbnails.get(`${initial.id}:${initial.createdAt}:${initial.bytes}`);
  const resolveImage = useCallback(
    (id: string) => rpc("screenshots.image", { id, thumbnail: false }),
    [],
  );
  return (
    <ImageLightbox
      {...actions}
      images={images}
      initialIndex={initialIndex}
      resolveImage={resolveImage}
      initialPreview={
        preview
          ? { url: preview, width: initial.width, height: initial.height }
          : undefined
      }
      onClose={onClose}
    />
  );
}
export function ScreenshotLibrary({
  profileId,
  selection,
  onSelection,
  received,
}: {
  profileId?: string;
  selection?: Set<string>;
  onSelection?: (value: Set<string>, items: Screenshot[]) => void;
  received?: Screenshot[];
}) {
  const { data, notify } = useApp();
  const [items, setItems] = useState<Screenshot[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(profileId || "");
  const [sort, setSort] = useState("newest");
  const [group, setGroup] = useState("date");
  const [visibleCount, setVisibleCount] = useState(80);
  useEffect(() => setVisibleCount(80), [query, filter, sort, group]);
  const [view, setView] = useState<{
    shots: Screenshot[];
    initialIndex: number;
  } | null>(null);
  const [removing, setRemoving] = useState<Screenshot | null>(null);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (received) {
      setItems(received);
      setLoading(false);
      return;
    }
    const request = ++revision.current;
    try {
      const result = await rpc("screenshots.list", {
        profileId: profileId || null,
      });
      if (request === revision.current) {
        setItems(result.items);
        setWarnings(result.warnings);
        setError("");
      }
    } catch (error) {
      if (request === revision.current) setError(String(error));
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [profileId, received]);
  useEffect(() => {
    setLoading(true);
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => {
      revision.current++;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  const [groups, totalMatches, gallery] = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const filtered = items.filter(
      (shot) =>
        (!filter || shot.profileId === filter) &&
        (!search ||
          `${shot.name} ${shot.profileName}`
            .toLocaleLowerCase()
            .includes(search)),
    );
    filtered.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "oldest"
          ? a.createdAt - b.createdAt
          : b.createdAt - a.createdAt,
    );
    const result = new Map<string, Screenshot[]>();
    const month = new Intl.DateTimeFormat(getLocale(), {
      year: "numeric",
      month: "long",
    });
    for (const shot of filtered) {
      const key =
        group === "profile"
          ? shot.profileName
          : group === "date"
            ? month.format(new Date(shot.createdAt))
            : "";
      if (!result.has(key)) result.set(key, []);
      result.get(key)!.push(shot);
    }
    let remaining = visibleCount;
    const visible = [...result]
      .map(([key, shots]): [string, Screenshot[]] => {
        const batch = shots.slice(0, Math.max(0, remaining));
        remaining -= batch.length;
        return [key, batch];
      })
      .filter(([, shots]) => shots.length);
    return [visible, filtered.length, [...result.values()].flat()] as const;
  }, [items, filter, query, sort, group, visibleCount]);
  const openViewer = (shot: Screenshot) =>
    setView({
      shots: gallery,
      initialIndex: Math.max(
        0,
        gallery.findIndex((item) => item.id === shot.id),
      ),
    });
  const toggle = (shot: Screenshot) => {
    if (!selection || !onSelection) {
      openViewer(shot);
      return;
    }
    const next = new Set(selection);
    if (next.has(shot.id)) next.delete(shot.id);
    else if (next.size < 10) next.add(shot.id);
    else return;
    onSelection(next, items);
  };
  return (
    <section className="screenshot-library" aria-label={t("@shots.title")}>
      <div className="shot-toolbar">
        <label className="shot-search">
          <Search size={17} />
          <input
            aria-label={t("@shots.search")}
            placeholder={t("@shots.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="icon-button"
              aria-label={t("@shots.clear")}
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <button
          type="button"
          className="icon-button shot-refresh"
          aria-label={t("@shots.refresh")}
          onClick={() => void refresh()}
        >
          <RefreshCw size={18} />
        </button>
        {!profileId && !received && (
          <Select
            aria-label={t("@shots.profile")}
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "", label: t("@shots.all") },
              ...data.profiles.map((profile) => ({
                value: profile.id,
                label: profile.name,
              })),
            ]}
          />
        )}
        <Select
          aria-label={t("@shots.sort")}
          value={sort}
          onValueChange={setSort}
          options={[
            { value: "newest", label: t("@shots.newest") },
            { value: "oldest", label: t("@shots.oldest") },
            { value: "name", label: t("@shots.name") },
          ]}
        />
        <Select
          aria-label={t("@shots.group")}
          value={group}
          onValueChange={setGroup}
          options={[
            { value: "date", label: t("@shots.by.date") },
            { value: "profile", label: t("@shots.by.profile") },
            { value: "none", label: t("@shots.ungrouped") },
          ]}
        />
        {profileId && (
          <button
            type="button"
            className="icon-button"
            aria-label={t("@shots.folder")}
            onClick={() =>
              void rpc("screenshots.openFolder", { profileId }).catch((error) =>
                notify(String(error), true),
              )
            }
          >
            <FolderOpen size={18} />
          </button>
        )}
      </div>
      {!!warnings.length && (
        <p className="shot-warning" role="status">
          {t("@shots.warnings", { names: warnings.join(", ") })}
        </p>
      )}
      {error && <ErrorBox error={error} />}
      {loading ? (
        <Loading label={t("@shots.title")} />
      ) : !groups.length ? (
        <EmptyState
          icon={<Images size={30} />}
          title={t(
            items.length
              ? "@shots.no.results"
              : received
                ? "@shots.inbox.empty"
                : "@shots.empty",
          )}
          text={t(
            items.length
              ? "@shots.no.results.hint"
              : received
                ? "@shots.inbox.hint"
                : "@shots.empty.hint",
          )}
        />
      ) : (
        groups.map(([name, shots]) => (
          <section className="shot-group" key={name}>
            {name && (
              <h3>
                {name}
                <span>{shots.length}</span>
              </h3>
            )}
            <div className="screenshot-grid">
              {shots.map((shot) => {
                const selected = selection?.has(shot.id);
                return (
                  <article
                    className={`screenshot-card ${selected ? "selected" : ""}`}
                    key={shot.id}
                  >
                    <button
                      type="button"
                      className="shot-select"
                      aria-label={
                        selection
                          ? t("@shots.select", { name: shot.name })
                          : shot.name
                      }
                      aria-pressed={selection ? !!selected : undefined}
                      disabled={
                        !!selection && selection.size >= 10 && !selected
                      }
                      onClick={() => toggle(shot)}
                    >
                      <Thumbnail shot={shot} />
                      <span className="shot-caption">
                        <strong>{shot.profileName}</strong>
                        <small>{shot.name}</small>
                      </span>
                      {selected && (
                        <span className="shot-check">
                          <Check size={17} />
                          <b>{[...selection!].indexOf(shot.id) + 1}</b>
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="shot-inspect"
                      aria-label={`${t("@shots.preview")}: ${shot.name}`}
                      data-tooltip={t("@shots.preview")}
                      onClick={() => openViewer(shot)}
                    >
                      <ZoomIn size={19} />
                    </button>
                    {!selection && (
                      <button
                        type="button"
                        className="shot-save"
                        aria-label={`${t("@shots.save")}: ${shot.name}`}
                        onClick={() =>
                          void rpc("screenshots.save", { id: shot.id })
                            .then((saved) => {
                              if (saved) notify(t("@shots.saved"));
                            })
                            .catch((error) => notify(String(error), true))
                        }
                      >
                        <Download size={16} />
                      </button>
                    )}
                    {!selection && shot.source === "received" && (
                      <button
                        type="button"
                        className="shot-remove"
                        aria-label={`${t("@shots.remove")}: ${shot.name}`}
                        onClick={() => setRemoving(shot)}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
      {totalMatches > visibleCount && (
        <div className="shot-show-more">
          <span>
            {t("@shots.showing", { shown: visibleCount, total: totalMatches })}
          </span>
          <button
            type="button"
            className="button secondary"
            onClick={() => setVisibleCount((count) => count + 80)}
          >
            {t("@shots.more")}
          </button>
        </div>
      )}
      {view && (
        <ScreenshotViewer
          shots={view.shots}
          initialIndex={view.initialIndex}
          onClose={() => setView(null)}
        />
      )}
      {removing && (
        <Modal
          title={t("@shots.remove.confirm")}
          subtitle={removing.name}
          onClose={() => setRemoving(null)}
        >
          <div className="modal-actions">
            <button className="button" onClick={() => setRemoving(null)}>
              {t("@social.cancel")}
            </button>
            <button
              className="button"
              onClick={() =>
                void rpc("screenshots.removeReceived", {
                  id: removing.id.slice("received:".length),
                })
                  .then(() => {
                    setItems((items) =>
                      items.filter((item) => item.id !== removing.id),
                    );
                    setRemoving(null);
                    notify(t("@shots.removed"));
                  })
                  .catch((error) => notify(String(error), true))
              }
            >
              {t("@shots.remove")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
export function ScreenshotPicker({
  friend,
  onClose,
}: {
  friend: SocialPerson;
  onClose: () => void;
}) {
  const { notify } = useApp();
  const [selection, setSelection] = useState(new Set<string>());
  const [sending, setSending] = useState(false);
  return (
    <Modal
      wide
      title={t("@shots.picker", { name: friend.name })}
      onClose={onClose}
      closeDisabled={sending}
      className="screenshot-picker"
    >
      <p className="shot-queue-hint">{t("@shots.queue.hint")}</p>
      <div className="screenshot-picker-scroll">
        <ScreenshotLibrary
          selection={selection}
          onSelection={(value) => setSelection(value)}
        />
      </div>
      <div className="shot-picker-footer">
        <span role="status">
          {t("@shots.selected", { count: selection.size })}
        </span>
        <button
          type="button"
          className="text-button"
          disabled={!selection.size || sending}
          onClick={() => setSelection(new Set())}
        >
          {t("@shots.clear")}
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!selection.size || sending}
          onClick={() =>
            void (async () => {
              setSending(true);
              try {
                await rpc("screenshots.send", {
                  friend: friend.id,
                  ids: [...selection],
                });
                notify(t("@shots.queued"));
                onClose();
              } catch (error) {
                notify(String(error), true);
              } finally {
                setSending(false);
              }
            })()
          }
        >
          <Send size={16} />
          {sending
            ? t("@shots.preparing")
            : t("@shots.send", { count: selection.size })}
        </button>
      </div>
    </Modal>
  );
}
export function ScreenshotDeliveries({
  items,
  refresh,
}: {
  items: ScreenshotTransfer[];
  refresh: () => Promise<void>;
}) {
  const actions = useScreenshotActions();
  const { notify } = useApp();
  const { snapshot } = useSocial();
  const [view, setView] = useState<string | null>(null);
  const [local, setLocal] = useState<Screenshot[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void rpc("screenshots.list", { profileId: null })
        .then((library) => {
          if (alive) setLocal(library.items);
        })
        .catch(() => {});
    load();
    window.addEventListener("focus", load);
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);
  const action = async (item: ScreenshotTransfer, retry = false) => {
    try {
      await rpc(retry ? "screenshots.retry" : "screenshots.cancel", {
        id: item.id,
      });
      await refresh();
    } catch (error) {
      notify(String(error), true);
    }
  };
  if (!items.length)
    return (
      <EmptyState
        icon={<Send size={30} />}
        title={t("@shots.deliveries.empty")}
        text={t("@shots.queue.hint")}
      />
    );
  return (
    <div className="shot-deliveries">
      {items.map((item) => {
        const peer =
          snapshot?.people.find((person) => person.id === item.peer)?.name ||
          item.peer.slice(0, 12) + "…";
        const active = ["sending", "receiving", "connecting"].includes(
          item.status,
        );
        const matches = local.filter(
          (shot) =>
            item.direction === "outgoing" &&
            (item.sourceId
              ? shot.id === item.sourceId
              : shot.name === item.name &&
                shot.profileName === item.profileName),
        );
        const original = matches.length === 1 ? matches[0] : null;
        const preview =
          original ||
          (item.direction === "incoming" && item.status === "received"
            ? {
                ...item,
                id: `received:${item.id}`,
                profileId: "",
                source: "received" as const,
                from: item.peer,
              }
            : null);
        return (
          <article key={item.id} className={`shot-delivery ${item.status}`}>
            <span className="shot-delivery-icon">
              {["failed", "cancelled", "rejected"].includes(item.status) ? (
                <X size={22} />
              ) : item.decision === true ||
                ["received", "delivered"].includes(item.status) ? (
                <CheckCircle2 size={22} />
              ) : (
                <Clock3 size={22} />
              )}
            </span>
            {preview && (
              <button
                type="button"
                className="shot-delivery-preview"
                aria-label={`${t("@shots.preview")}: ${item.name}`}
                onClick={() => setView(preview.id)}
              >
                <Thumbnail shot={preview} />
              </button>
            )}
            <div>
              <strong>{item.name}</strong>
              <small>
                {item.profileName} ·{" "}
                {t(
                  item.direction === "incoming"
                    ? "@shots.sent.by"
                    : "@shots.sent.to",
                  { name: peer },
                )}
              </small>
              <span>
                {t(
                  `@shots.status.${item.status === "delivered" && item.decision === true ? "approved" : item.status}`,
                )}{" "}
                · {socialSize(item.bytes)}
              </span>
              {item.error && item.status === "failed" && (
                <small className="muted">{t("@shots.failed.hint")}</small>
              )}
              {active && (
                <progress
                  aria-label={t(`@shots.status.${item.status}`)}
                  value={item.transferred}
                  max={item.bytes + 16}
                />
              )}
            </div>
            {item.direction === "outgoing" &&
              [
                "queued",
                "awaiting",
                "connecting",
                "sending",
                "failed",
              ].includes(item.status) && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("@shots.cancel")}
                  onClick={() => void action(item)}
                >
                  <X size={17} />
                </button>
              )}
            {item.status === "failed" && (
              <button
                type="button"
                className="icon-button"
                aria-label={t("@shots.retry")}
                onClick={() => void action(item, true)}
              >
                <RefreshCw size={17} />
              </button>
            )}
          </article>
        );
      })}
      {view && (
        <ImageLightbox
          {...actions}
          images={[view]}
          initialIndex={0}
          resolveImage={(id) =>
            rpc("screenshots.image", { id, thumbnail: false })
          }
          onClose={() => setView(null)}
        />
      )}
    </div>
  );
}
export function ScreenshotsPage() {
  const { snapshot } = useSocial();
  const { items, error, refresh } = useTransfers();
  const [tab, setTab] = useState(() =>
    sessionStorage.getItem("aurum:screenshot-tab") === "received"
      ? "received"
      : "local",
  );
  useEffect(() => {
    sessionStorage.removeItem("aurum:screenshot-tab");
    const open = () => {
      setTab("received");
      sessionStorage.removeItem("aurum:screenshot-tab");
      void refresh();
    };
    window.addEventListener("aurum:screenshots-received", open);
    return () => window.removeEventListener("aurum:screenshots-received", open);
  }, [refresh]);
  const received = useMemo(
    () =>
      items
        .filter(
          (item) => item.direction === "incoming" && item.status === "received",
        )
        .map((item) => ({
          id: `received:${item.id}`,
          name: item.name,
          profileId: "",
          profileName: `${snapshot?.people.find((person) => person.id === item.peer)?.name || item.peer.slice(0, 12)} · ${item.profileName}`,
          createdAt: item.createdAt,
          bytes: item.bytes,
          width: item.width,
          height: item.height,
          source: "received" as const,
          from: item.peer,
        })),
    [items, snapshot?.people],
  );
  return (
    <section className="screenshots-page">
      <div className="page-heading">
        <div>
          <h1>{t("@shots.title")}</h1>
          <p>{t("@shots.subtitle")}</p>
        </div>
      </div>
      <div className="tabs shot-source-tabs">
        {["local", "received", "transfers"].map((value) => (
          <button
            type="button"
            key={value}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {t(`@shots.${value}`)}
            {value === "received" && !!received.length && (
              <small>{received.length}</small>
            )}
          </button>
        ))}
      </div>
      {error && <ErrorBox error={error} />}
      <div className="shot-page-requests">
        <ScreenshotRequests items={items} refresh={refresh} />
      </div>
      {tab === "local" ? (
        <ScreenshotLibrary key="local" />
      ) : tab === "received" ? (
        <ScreenshotLibrary key="received" received={received} />
      ) : (
        <ScreenshotDeliveries
          items={items.filter(
            (item) =>
              item.direction === "outgoing" || item.status !== "received",
          )}
          refresh={refresh}
        />
      )}
    </section>
  );
}
