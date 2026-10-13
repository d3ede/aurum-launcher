import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Download, FolderOpen } from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { t } from "../lib/i18n";
import { ModrinthImport } from "./ModrinthImport";
import { ModrinthLogo } from "./ModrinthLogo";

export function ImportProfileButton({
  onFolderImport,
}: {
  onFolderImport: () => void;
}) {
  const { operation, busy } = useApp();
  const [open, setOpen] = useState(false);
  const [modrinth, setModrinth] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <>
      <div className="library-import-menu" ref={root}>
        <button
          ref={trigger}
          type="button"
          className="button import-button"
          disabled={busy}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          <Download size={16} />
          {t(" Импортировать ").trim()}
          <ChevronDown size={15} />
        </button>
        {open && (
          <div
            id={id}
            className="library-import-options"
            aria-label={t("Способы импорта")}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setModrinth(true);
              }}
            >
              <ModrinthLogo size={18} />
              <span>
                <b>{t("Из Modrinth")}</b>
                <small>{t("Найти и перенести ваши сборки")}</small>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void operation(
                  (id) => rpc("importPack", { operationId: id }),
                  t("Сборка импортирована"),
                );
              }}
            >
              <Download size={18} />
              <span>
                <b>{t("Из .mrpack / ZIP")}</b>
                <small>{t("Импортировать файл модпака")}</small>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onFolderImport();
              }}
            >
              <FolderOpen size={18} />
              <span>
                <b>{t("Из папки игры")}</b>
                <small>{t("Выбрать существующую папку")}</small>
              </span>
            </button>
          </div>
        )}
      </div>
      {modrinth && <ModrinthImport onClose={() => setModrinth(false)} />}
    </>
  );
}
