import { t } from "../lib/i18n";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";
import { native } from "../lib/api";
export function WindowControls({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!native) return;
    const window = getCurrentWindow();
    let live = true;
    let cleanup: (() => void) | undefined;
    const update = () =>
      void Promise.all([window.isMaximized(), window.isFullscreen()])
        .then(([isMaximized, isFullscreen]) => {
          if (live) {
            setMaximized(isMaximized);
            document.documentElement.dataset.windowExpanded = String(
              isMaximized || isFullscreen,
            );
          }
        })
        .catch((e) => onError(String(e)));
    update();
    void window.onResized(update).then((fn) => {
      if (live) cleanup = fn;
      else fn();
    });
    return () => {
      live = false;
      cleanup?.();
      delete document.documentElement.dataset.windowExpanded;
    };
  }, [onError]);
  const action = (name: "minimize" | "toggleMaximize" | "close") => {
    if (native)
      void getCurrentWindow()
        [name]()
        .catch((e) => onError(String(e)));
  };
  return (
    <div className="window-controls">
      <button
        disabled={!native}
        aria-label={t("Свернуть окно")}
        onClick={() => action("minimize")}
      >
        <Minus size={18} />
      </button>
      <button
        disabled={!native}
        aria-label={maximized ? t("Восстановить окно") : t("Развернуть окно")}
        onClick={() => action("toggleMaximize")}
      >
        {maximized ? <Copy size={16} /> : <Square size={16} />}
      </button>
      <button
        disabled={!native}
        className="window-close"
        aria-label={t("Закрыть Aurum")}
        onClick={() => action("close")}
      >
        <X size={20} />
      </button>
    </div>
  );
}
