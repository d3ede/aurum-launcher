import { useEffect, useRef, type ReactNode } from "react";
import { X, AlertCircle, LoaderCircle, ArrowUpRight } from "lucide-react";
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand-mark ${small ? "small" : ""}`}>
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path
          d="M11 29 20 10 29 29M15 23h10"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M31 10h4m-2-2v4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current!;
    const focusables = () =>
      [
        ...root.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ].filter(
        (element) =>
          element.tabIndex >= 0 && element.getClientRects().length > 0,
      );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (
        document.querySelector('.select-menu[data-state="open"]') ||
        e.defaultPrevented
      )
        return;
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const list = focusables();
        const first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Закрыть диалог"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: string;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={20} />
      <div>
        <b>Не удалось выполнить действие</b>
        <p>{error}</p>
        {retry && (
          <button className="text-button" onClick={retry}>
            Попробовать снова <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
export function Loading({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="loading">
      <LoaderCircle size={22} className="spin" />
      <span>{label}</span>
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function EmptyState({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
