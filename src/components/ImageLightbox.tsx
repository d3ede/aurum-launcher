import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import { t } from "../lib/i18n";
import "../image-lightbox.css";

type View = { scale: number; x: number; y: number };
const normal: View = { scale: 1, x: 0, y: 0 };

export function ImageLightbox({
  images,
  initialIndex,
  onClose,
  resolveImage,
}: {
  images: string[];
  initialIndex: number;
  onClose: () => void;
  resolveImage?: (id: string) => Promise<string>;
}) {
  const [index, setIndex] = useState(
    Math.max(0, Math.min(initialIndex, images.length - 1)),
  );
  const [content, setContent] = useState({ id: "", url: "", error: "" });
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [natural, setNatural] = useState({ width: 16, height: 9 });
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
  const cache = useRef(new Map<string, string>());
  const scaleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    origin: View;
  } | null>(null);
  const id = images[index];
  const url = content.id === id ? content.url : "";
  const error = content.id === id ? content.error : "";
  const fit = Math.min(
    size.width / natural.width,
    size.height / natural.height,
  );
  const width = natural.width * fit,
    height = natural.height * fit;
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
        // A generous numerical ceiling keeps transforms finite without limiting inspection to a few zoom steps.
        const next = Math.max(
          1,
          Math.min(
            1_000_000,
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
      if (images.length < 2) return;
      setPrevious(url ? { url, width, height } : null);
      setDirection(step);
      setIndex((current) => (current + step + images.length) % images.length);
      setView(normal);
      setNatural({ width: 16, height: 9 });
      setShowScale(false);
      setDragging(false);
      drag.current = null;
    },
    [images.length, url, width, height],
  );

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
    const cached = cache.current.get(id);
    if (!resolveImage || cached) {
      setContent({ id, url: cached || id, error: "" });
      return;
    }
    setContent({ id, url: "", error: "" });
    void resolveImage(id)
      .then((next) => {
        if (!alive) return;
        if (cache.current.size >= 2)
          cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(id, next);
        setContent({ id, url: next, error: "" });
      })
      .catch((reason) => {
        if (alive) setContent({ id, url: "", error: String(reason) });
      });
    return () => {
      alive = false;
    };
  }, [id, resolveImage]);
  useEffect(() => {
    if (!previous) return;
    const timer = setTimeout(() => setPrevious(null), 300);
    return () => clearTimeout(timer);
  }, [previous]);
  useEffect(() => {
    const element = root.current!;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
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
  const latest = useRef({ onClose, change, zoomAt });
  latest.current = { onClose, change, zoomAt };
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const keys = (event: KeyboardEvent) => {
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
            v1: index + 1,
            v2: images.length,
          })}
        </span>
        <div>
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
            key={id}
            className={`lightbox-slide entering ${direction > 0 ? "forward" : "backward"}`}
          >
            <button
              type="button"
              data-lightbox-picture
              className={`lightbox-image lightbox-picture ${view.scale > 1 ? "zoomed" : ""} ${dragging ? "dragging" : ""}`}
              aria-label={t("Увеличить изображение")}
              style={{
                width,
                height,
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                zoomAt(view.scale > 1 ? 1 : 2, event.clientX, event.clientY);
              }}
              onClick={() => {
                if (view.scale === 1) zoomAt(2);
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || view.scale <= 1) return;
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
                  v1: index + 1,
                  v2: images.length,
                })}
                onLoad={(event) =>
                  setNatural({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                onError={() =>
                  setContent({
                    id,
                    url: "",
                    error: t("Не удалось загрузить изображение"),
                  })
                }
              />
            </button>
          </div>
        ) : (
          <div className="lightbox-message" role="status">
            {error || t("@shots.loading")}
          </div>
        )}
      </div>
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
      {showScale && (
        <output className="lightbox-scale" aria-live="polite">
          {Math.round(view.scale * 100).toLocaleString()}%
        </output>
      )}
    </div>,
    document.body,
  );
}
