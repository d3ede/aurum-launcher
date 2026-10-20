import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FolderOpen,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { t } from "../lib/i18n";
import type { Profile } from "../types";
import { Field, Modal } from "./ui";

export function ProfileActions({ profile }: { profile: Profile }) {
  const { data, busy, run, operation, notify } = useApp();
  const running = data.running.includes(profile.id);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [name, setName] = useState(profile.name);
  const label = t("Действия сборки {{name}}", { name: profile.name });
  const close = () => {
    setPosition(null);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!position) return;
    const buttons = () => [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) || []),
    ];
    buttons()[0]?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setPosition(null);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setPosition(null);
        trigger.current?.focus();
      }
      if (event.key === "Tab") setPosition(null);
      const items = buttons();
      if (
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) &&
        items.length
      ) {
        event.preventDefault();
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length;
        items[next].focus();
      }
    };
    const dismiss = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [position]);

  return (
    <>
      <button
        ref={trigger}
        className="icon-button profile-card-more"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!position}
        aria-controls={position ? menuId : undefined}
        onClick={() => {
          if (position) {
            close();
            return;
          }
          const bounds = trigger.current!.getBoundingClientRect();
          setPosition({
            top: Math.max(8, Math.min(bounds.bottom + 6, innerHeight - 180)),
            left: Math.max(8, Math.min(bounds.right - 224, innerWidth - 232)),
          });
        }}
      >
        <MoreVertical size={17} />
      </button>
      {position &&
        createPortal(
          <div
            id={menuId}
            ref={menu}
            className="profile-actions-menu"
            style={position}
            role="menu"
            aria-label={label}
          >
            <button
              role="menuitem"
              onClick={() => {
                close();
                void rpc("openFolder", { id: profile.id }).catch((error) =>
                  notify(String(error), true),
                );
              }}
            >
              <FolderOpen size={16} />
              {t("Открыть папку")}
            </button>
            <button
              role="menuitem"
              disabled={busy || running}
              onClick={() => {
                close();
                setName(profile.name);
                setDialog("rename");
              }}
            >
              <Pencil size={16} />
              {t("Переименовать")}
            </button>
            <button
              role="menuitem"
              disabled={busy || running}
              onClick={() => {
                close();
                void operation(
                  (operationId) =>
                    rpc("install", { id: profile.id, operationId }),
                  t("Установка проверена"),
                );
              }}
            >
              <RefreshCw size={16} />
              {t(" Проверить установку").trim()}
            </button>
            <div role="separator" />
            <button
              role="menuitem"
              className="danger"
              disabled={busy || running}
              onClick={() => {
                close();
                setDialog("delete");
              }}
            >
              <Trash2 size={16} />
              {t("Удалить сборку")}
            </button>
          </div>,
          document.body,
        )}
      {dialog &&
        createPortal(
          <Modal
            title={
              dialog === "rename"
                ? t("Переименовать сборку")
                : t("Удалить сборку")
            }
            subtitle={profile.name}
            closeDisabled={busy}
            onClose={() => {
              if (!busy) setDialog(null);
            }}
          >
            {dialog === "rename" ? (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!name.trim() || busy || running) return;
                  const ok = await run(async () => {
                    await rpc("updateProfile", {
                      profile: { ...profile, name: name.trim() },
                    });
                    return true;
                  }, t("Параметры сохранены"));
                  if (ok) setDialog(null);
                }}
              >
                <Field label={t("Название")}>
                  <input
                    autoFocus
                    required
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={busy || running}
                  />
                </Field>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setDialog(null)}
                  >
                    {t("Отмена")}
                  </button>
                  <button
                    className="button primary"
                    disabled={busy || running || !name.trim()}
                  >
                    {t("Сохранить")}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p>
                  {t("Папка сборки с мирами будет перемещена в корзину Aurum.")}
                </p>
                <div className="modal-actions">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setDialog(null)}
                  >
                    {t("Отмена")}
                  </button>
                  <button
                    className="button destructive"
                    disabled={busy || running}
                    onClick={async () => {
                      const ok = await run(async () => {
                        await rpc("deleteProfile", { id: profile.id });
                        return true;
                      }, t("Сборка перемещена в корзину"));
                      if (ok) setDialog(null);
                    }}
                  >
                    {t("Удалить сборку")}
                  </button>
                </div>
              </>
            )}
          </Modal>,
          document.body,
        )}
    </>
  );
}
