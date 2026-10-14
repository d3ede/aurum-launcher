import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { t } from "../lib/i18n";

export function safeImageUrl(src: string | undefined) {
  if (!src) return null;
  try {
    const url = new URL(src.startsWith("//") ? `https:${src}` : src);
    if (
      url.hostname === "imgur.com" &&
      /\.(png|jpe?g|gif|webp)$/i.test(url.pathname)
    )
      url.hostname = "i.imgur.com";
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function MediaImage({
  src,
  alt,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? (
    <span className="media-unavailable">
      <ImageOff size={28} />
      <span>{t("Не удалось загрузить изображение")}</span>
    </span>
  ) : (
    <img {...props} src={src} alt={alt || ""} onError={() => setFailed(true)} />
  );
}

export function ProjectDescription({
  body,
  onImage,
  onLink,
}: {
  body: string;
  onImage: (src: string) => void;
  onLink: (href: string) => void;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a: ({ href, children }) => (
            <a
              className="inline-link"
              href={href?.startsWith("https://") ? href : undefined}
              onClick={(event) => {
                event.preventDefault();
                if (href?.startsWith("https://")) onLink(href);
              }}
            >
              {children}
            </a>
          ),
          img: ({ src, alt, width }) => {
            const url = safeImageUrl(src);
            if (!url) return null;
            const pixels = Number(width);
            if (pixels > 0 && pixels <= 100)
              return (
                <MediaImage
                  src={url}
                  alt={alt}
                  width={pixels}
                  className="markdown-badge"
                  loading="lazy"
                />
              );
            return (
              <button
                type="button"
                className="markdown-image"
                aria-label={t("Увеличить изображение")}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onImage(url);
                }}
              >
                <MediaImage src={url} alt={alt} loading="lazy" />
              </button>
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

export function ProjectGallery({
  images,
  title,
  onOpen,
}: {
  images: string[];
  title: string;
  onOpen: (index: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const touch = useRef<number | null>(null);
  const activeThumb = useRef<HTMLButtonElement>(null);
  const current = Math.min(index, Math.max(0, images.length - 1));
  const move = (step: number) =>
    setIndex((current + step + images.length) % images.length);
  useEffect(() => {
    activeThumb.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, [current]);
  if (!images.length)
    return <p className="gallery-empty">{t("Автор не добавил скриншоты.")}</p>;
  return (
    <div
      className="project-carousel"
      onTouchStart={(event) => {
        touch.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        if (touch.current !== null) {
          const delta = event.changedTouches[0].clientX - touch.current;
          if (Math.abs(delta) > 50) move(delta < 0 ? 1 : -1);
          touch.current = null;
        }
      }}
    >
      <div className="project-media-stage">
        <button
          type="button"
          className="project-media-open"
          aria-label={t("Открыть изображение {{v1}}", { v1: current + 1 })}
          onClick={() => onOpen(current)}
        >
          <MediaImage
            key={images[current]}
            src={images[current]}
            alt={t("Скриншот {{v1}}", { v1: title })}
          />
          <span className="media-zoom-hint">
            <ZoomIn size={17} />
          </span>
        </button>
        {images.length > 1 && (
          <>
            <button
              type="button"
              className="media-arrow previous"
              aria-label={t("Предыдущее изображение")}
              onClick={() => move(-1)}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              className="media-arrow next"
              aria-label={t("Следующее изображение")}
              onClick={() => move(1)}
            >
              <ChevronRight />
            </button>
          </>
        )}
        <span className="media-counter" aria-live="polite">
          {t("Изображение {{v1}} из {{v2}}", {
            v1: current + 1,
            v2: images.length,
          })}
        </span>
      </div>
      {images.length > 1 && (
        <div className="project-media-thumbnails">
          {images.map((src, i) => (
            <button
              key={src}
              ref={i === current ? activeThumb : undefined}
              type="button"
              className={i === current ? "selected" : ""}
              aria-label={t("Открыть изображение {{v1}}", { v1: i + 1 })}
              aria-pressed={i === current}
              onClick={() => setIndex(i)}
            >
              <MediaImage src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ImageLightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const change = (step: number) => {
    setIndex((value) => (value + step + images.length) % images.length);
    setZoom(false);
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        setIndex(
          (value) =>
            (value + (event.key === "ArrowLeft" ? -1 : 1) + images.length) %
            images.length,
        );
        setZoom(false);
      }
      if (event.key === "Tab") {
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
      previous?.focus();
    };
  }, [images.length, onClose]);
  return createPortal(
    <div
      ref={root}
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t("Просмотр изображения")}
      data-image-lightbox
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
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
            aria-label={
              zoom ? t("Уменьшить изображение") : t("Увеличить изображение")
            }
            onClick={() => setZoom((value) => !value)}
          >
            {zoom ? <ZoomOut /> : <ZoomIn />}
          </button>
          <button
            ref={closeButton}
            type="button"
            aria-label={t("Закрыть изображение")}
            onClick={onClose}
          >
            <X />
          </button>
        </div>
      </div>
      <div className={`lightbox-stage ${zoom ? "zoomed" : ""}`}>
        <button
          className="lightbox-image"
          type="button"
          aria-label={
            zoom ? t("Уменьшить изображение") : t("Увеличить изображение")
          }
          onClick={() => setZoom((value) => !value)}
        >
          <MediaImage
            key={images[index]}
            src={images[index]}
            alt={t("Изображение {{v1}} из {{v2}}", {
              v1: index + 1,
              v2: images.length,
            })}
          />
        </button>
      </div>
      {images.length > 1 && (
        <>
          <button
            type="button"
            className="media-arrow previous"
            aria-label={t("Предыдущее изображение")}
            onClick={() => change(-1)}
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            className="media-arrow next"
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
