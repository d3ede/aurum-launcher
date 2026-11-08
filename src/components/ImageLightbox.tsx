import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Download,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { t } from "../lib/i18n";
import "../image-lightbox.css";

type View = { scale: number; x: number; y: number };
const normal: View = { scale: 1, x: 0, y: 0 };
type Picture = { id: string; url: string; width: number; height: number };
type CachedPicture = Picture & { image: HTMLImageElement; bytes: number };
const CACHE_BYTES = 128 * 1024 * 1024;

export function ImageLightbox({
  images,
  initialIndex,
  onClose,
  resolveImage,
  initialPreview,
  onCopy,
  onSave,
}: {
  images: string[];
  initialIndex: number;
  onClose: () => void;
  resolveImage?: (id: string) => Promise<string>;
  initialPreview?: { url: string; width: number; height: number };
  onCopy?: (id: string) => Promise<unknown>;
  onSave?: (id: string) => Promise<unknown>;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [index, setIndex] = useState(
    Math.max(0, Math.min(initialIndex, images.length - 1)),
  );
  const [content, setContent] = useState<Picture>(() => ({
    id: images[index],
    url: initialPreview?.url || "",
    width: initialPreview?.width || 16,
    height: initialPreview?.height || 9,
  }));
  const [failure, setFailure] = useState({ id: "", error: "" });
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState<View>(normal);
  const [dragging, setDragging] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [direction, setDirection] = useState(1);
  const [previous, setPrevious] = useState<{
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const cache = useRef(new Map<string, CachedPicture>());
  const pending = useRef(new Map<string, Promise<CachedPicture>>());
  const requestedIndex = useRef(index);
  const requestedId = useRef(images[index]);
  const displayed = useRef({ ...content, width: 0, height: 0 });
  const nextDirection = useRef(1);
  const scaleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    origin: View;
  } | null>(null);
  const id = images[index];
  const url = content.url;
  const error = failure.id === id ? failure.error : "";
  const displayedIndex = Math.max(0, images.indexOf(content.id));
  const dismissMenu = () => {
    setMenu(null);
    closeButton.current?.focus();
  };
  const runAction = async (action: (id: string) => Promise<unknown>) => {
    if (busy) return;
    dismissMenu();
    setBusy(true);
    setActionError("");
    const actionId = content.id;
    try {
      await action(actionId);
      if (action === onCopy && displayed.current.id === actionId) {
        setCopied(true);
        clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1800);
      }
    } catch (reason) {
      setActionError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const fit = Math.min(
    size.width / content.width,
    size.height / content.height,
  );
  const width = content.width * fit,
    height = content.height * fit;
  displayed.current = { ...content, width, height };
  const trimCache = useCallback(() => {
    let bytes = [...cache.current.values()].reduce(
      (sum, entry) => sum + entry.bytes,
      0,
    );
    for (const [key, entry] of cache.current) {
      if (cache.current.size <= 4 && bytes <= CACHE_BYTES) break;
      if (key === requestedId.current || key === displayed.current.id) continue;
      cache.current.delete(key);
      bytes -= entry.bytes;
      entry.image.src = "";
    }
  }, []);
  const load = useCallback(
    (key: string): Promise<CachedPicture> => {
      const cached = cache.current.get(key);
      if (cached) {
        cache.current.delete(key);
        cache.current.set(key, cached);
        return Promise.resolve(cached);
      }
      const existing = pending.current.get(key);
      if (existing) return existing;
      const request = (async () => {
        const next = resolveImage ? await resolveImage(key) : key;
        const image = new Image();
        image.referrerPolicy = "no-referrer";
        image.decoding = "async";
        image.src = next;
        try {
          await image.decode();
        } catch {
          throw new Error(t("Не удалось загрузить изображение"));
        }
        const entry = {
          id: key,
          url: next,
          width: image.naturalWidth,
          height: image.naturalHeight,
          image,
          bytes: image.naturalWidth * image.naturalHeight * 4 + next.length * 2,
        };
        cache.current.set(key, entry);
        trimCache();
        return entry;
      })().finally(() => pending.current.delete(key));
      pending.current.set(key, request);
      return request;
    },
    [resolveImage, trimCache],
  );
  const clamp = useCallback(
    (next: View): View => {
      const limitX = Math.max(0, (width * next.scale - size.width) / 2);
      const limitY = Math.max(0, (height * next.scale - size.height) / 2);
      return {
        scale: next.scale,
        x: Math.max(-limitX, Math.min(limitX, next.x)),
        y: Math.max(-limitY, Math.min(limitY, next.y)),
      };
    },
    [width, height, size],
  );
  const flashScale = useCallback(() => {
    clearTimeout(scaleTimer.current);
    setShowScale(true);
    scaleTimer.current = setTimeout(() => setShowScale(false), 1500);
  }, []);
  const zoomAt = useCallback(
    (
      scale: number | ((value: number) => number),
      clientX?: number,
      clientY?: number,
    ) => {
      const bounds = stage.current?.getBoundingClientRect();
      const anchorX =
        bounds && clientX !== undefined
          ? clientX - bounds.left - bounds.width / 2
          : 0;
      const anchorY =
        bounds && clientY !== undefined
          ? clientY - bounds.top - bounds.height / 2
          : 0;
      setView((current) => {
        const next = Math.max(
          1,
          Math.min(
            50,
            typeof scale === "function" ? scale(current.scale) : scale,
          ),
        );
        if (next === 1) return normal;
        const ratio = next / current.scale;
        return clamp({
          scale: next,
          x: anchorX - (anchorX - current.x) * ratio,
          y: anchorY - (anchorY - current.y) * ratio,
        });
      });
      flashScale();
    },
    [clamp, flashScale],
  );
  const change = useCallback(
    (step: number) => {
      setMenu(null);
      setActionError("");
      setCopied(false);
      if (images.length < 2) return;
      const next =
        (requestedIndex.current + step + images.length) % images.length;
      requestedIndex.current = next;
      requestedId.current = images[next];
      nextDirection.current = step;
      setIndex(next);
      setView(normal);
      setShowScale(false);
      setDragging(false);
      drag.current = null;
    },
    [images],
  );

  useLayoutEffect(() => {
    if (!menu || !menuElement.current) return;
    const element = menuElement.current;
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - element.offsetHeight - 8))}px`;
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [menu]);
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, []);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const update = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setView((current) => clamp(current)), [clamp]);
  useEffect(() => {
    let alive = true;
    setFailure({ id, error: "" });
    void load(id)
      .then(async (next) => {
        if (!alive || requestedIndex.current !== index) return;
        const old = displayed.current;
        if (old.url && old.id !== id) {
          setPrevious({ url: old.url, width: old.width, height: old.height });
          setDirection(nextDirection.current);
          setView(normal);
        }
        setContent((current) =>
          current.id === id && current.url === next.url
            ? current
            : { id, url: next.url, width: next.width, height: next.height },
        );
        // Decode only a small neighbourhood, never the entire screenshot library.
        for (const offset of [1, -1, 2]) {
          if (!alive || images.length < 2) break;
          if (
            [...cache.current.values()].reduce(
              (sum, entry) => sum + entry.bytes,
              0,
            ) >= CACHE_BYTES
          )
            break;
          const neighbour =
            images[(index + offset + images.length) % images.length];
          if (neighbour === id) continue;
          try {
            await load(neighbour);
          } catch {
            /* Report a failed neighbour only when it is opened. */
          }
        }
      })
      .catch((reason) => {
        if (alive && requestedIndex.current === index)
          setFailure({ id, error: String(reason) });
      });
    return () => {
      alive = false;
    };
  }, [id, index, images, load]);
  useEffect(trimCache, [content, trimCache]);
  useEffect(() => {
    if (!previous) return;
    const timer = setTimeout(() => setPrevious(null), 300);
    return () => clearTimeout(timer);
  }, [previous]);
  useEffect(() => {
    const element = root.current!;
    const wheel = (event: WheelEvent) => {
      setMenu(null);
      event.preventDefault();
      event.stopPropagation();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      zoomAt(
        (value) => value * Math.exp(-delta * 0.002),
        event.clientX,
        event.clientY,
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoomAt, size.height]);
  const latest = useRef({ onClose, change, zoomAt, menu, dismissMenu });
  latest.current = { onClose, change, zoomAt, menu, dismissMenu };
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (latest.current.menu) {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          latest.current.dismissMenu();
          return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const buttons = [
            ...menuElement.current!.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (current +
                    (event.key === "ArrowUp" ? -1 : 1) +
                    buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        latest.current.onClose();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        latest.current.change(event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.ctrlKey && event.key === "0") {
        event.preventDefault();
        event.stopPropagation();
        latest.current.zoomAt(1);
      } else if (event.key === "Tab") {
        const buttons = [
          ...root.current!.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        const first = buttons[0],
          last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keys, true);
    return () => {
      document.removeEventListener("keydown", keys, true);
      clearTimeout(scaleTimer.current);
      clearTimeout(copiedTimer.current);
      focused?.focus();
    };
  }, []);

  return createPortal(
    <div
      ref={root}
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t("Просмотр изображения")}
      data-image-lightbox
      data-scale={view.scale}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if (
          menu &&
          !(event.target as HTMLElement).closest(".lightbox-context-menu")
        ) {
          dismissMenu();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (
          !(event.target as HTMLElement).closest(
            "[data-lightbox-picture], [data-lightbox-control]",
          )
        )
          onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="lightbox-toolbar">
        <span aria-live="polite">
          {t("Изображение {{v1}} из {{v2}}", {
            v1: displayedIndex + 1,
            v2: images.length,
          })}
        </span>
        <div>
          {onCopy && (
            <button
              type="button"
              data-lightbox-control
              aria-label={t("@shots.copy")}
              title={t(copied ? "@shots.copied" : "@shots.copy")}
              disabled={busy || !url}
              onClick={() => void runAction(onCopy)}
            >
              {copied ? <Check aria-label={t("@shots.copied")} /> : <Copy />}
            </button>
          )}
          <button
            type="button"
            data-lightbox-control
            aria-label={
              view.scale > 1
                ? t("@shots.zoom.reset")
                : t("Увеличить изображение")
            }
            onClick={() => zoomAt(view.scale > 1 ? 1 : 2)}
          >
            {view.scale > 1 ? <ZoomOut /> : <ZoomIn />}
          </button>
          <button
            ref={closeButton}
            type="button"
            data-lightbox-control
            aria-label={t("Закрыть изображение")}
            onClick={onClose}
          >
            <X />
          </button>
        </div>
      </div>
      <div
        ref={stage}
        className={`lightbox-stage ${view.scale > 1 ? "zoomed" : ""}`}
      >
        {previous && (
          <div
            className={`lightbox-slide leaving ${direction > 0 ? "forward" : "backward"}`}
            aria-hidden="true"
          >
            <img
              src={previous.url}
              alt=""
              referrerPolicy="no-referrer"
              style={{ width: previous.width, height: previous.height }}
            />
          </div>
        )}
        {url ? (
          <div
            key={content.id}
            className={`lightbox-slide entering ${direction > 0 ? "forward" : "backward"}`}
          >
            <button
              type="button"
              data-lightbox-picture
              className={`lightbox-image lightbox-picture ${view.scale > 1 ? "zoomed" : ""} ${dragging ? "dragging" : ""}`}
              aria-label={t("Просмотр изображения")}
              style={{
                width,
                height,
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (onCopy || onSave) {
                  setMenu({ x: event.clientX, y: event.clientY });
                }
              }}
              onPointerDown={(event) => {
                if (menu || event.button !== 0 || view.scale <= 1) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = {
                  id: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  origin: view,
                };
                setDragging(true);
              }}
              onPointerMove={(event) => {
                const start = drag.current;
                if (!start || start.id !== event.pointerId) return;
                setView(
                  clamp({
                    ...start.origin,
                    x: start.origin.x + event.clientX - start.x,
                    y: start.origin.y + event.clientY - start.y,
                  }),
                );
              }}
              onPointerUp={(event) => {
                if (drag.current?.id !== event.pointerId) return;
                drag.current = null;
                setDragging(false);
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onLostPointerCapture={() => {
                drag.current = null;
                setDragging(false);
              }}
            >
              <img
                src={url}
                draggable={false}
                referrerPolicy="no-referrer"
                alt={t("Изображение {{v1}} из {{v2}}", {
                  v1: displayedIndex + 1,
                  v2: images.length,
                })}
                onError={() =>
                  setFailure({
                    id: content.id,
                    error: t("Не удалось загрузить изображение"),
                  })
                }
              />
            </button>
          </div>
        ) : null}
        {error && (
          <div className="lightbox-message" role="status">
            {error}
          </div>
        )}
        {showScale && (
          <output className="lightbox-scale" aria-live="polite">
            ×{view.scale.toFixed(1)}
          </output>
        )}
      </div>
      {actionError && (
        <div className="lightbox-action-error" role="status">
          {actionError}
        </div>
      )}
      {menu && (
        <div
          ref={menuElement}
          className="lightbox-context-menu"
          role="menu"
          aria-label={t("@shots.actions")}
          data-lightbox-control
          style={{ left: menu.x, top: menu.y }}
        >
          {onCopy && (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void runAction(onCopy)}
            >
              <Copy size={18} />
              {t("@shots.copy")}
            </button>
          )}
          {onSave && (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void runAction(onSave)}
            >
              <Download size={18} />
              {t("@shots.save.as")}
            </button>
          )}
        </div>
      )}
      {images.length > 1 && (
        <>
          <button
            type="button"
            data-lightbox-control
            className="lightbox-arrow previous"
            aria-label={t("Предыдущее изображение")}
            onClick={() => change(-1)}
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            data-lightbox-control
            className="lightbox-arrow next"
            aria-label={t("Следующее изображение")}
            onClick={() => change(1)}
          >
            <ChevronRight />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
