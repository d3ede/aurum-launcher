import { Check, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { t } from "../lib/i18n";
import { beginButtonHover } from "../lib/button-hover";

export type CatalogActionState =
  "available" | "installed" | "installing" | "removing";

export function CatalogInstallButton({
  state,
  title,
  disabled,
  onClick,
  nativeSource = false,
}: {
  state: CatalogActionState;
  title: string;
  disabled: boolean;
  onClick: () => void;
  nativeSource?: boolean;
}) {
  const working = state === "installing" || state === "removing";
  const installed = state === "installed";
  const label =
    state === "installing"
      ? t("Установка…")
      : state === "removing"
        ? t("Удаление…")
        : installed
          ? nativeSource
            ? t("Исходники скачаны")
            : t("Установлено")
          : nativeSource
            ? t("Скачать исходники")
            : t("Установить");
  return (
    <button
      type="button"
      className={`catalog-install-button is-${state}`}
      disabled={disabled || working}
      aria-busy={working}
      aria-label={
        installed
          ? t("Установлено: {{name}}. Удалить из сборки", { name: title })
          : `${label} · ${title}`
      }
      onClick={onClick}
      onPointerEnter={state === "available" ? beginButtonHover : undefined}
      onPointerMove={state === "available" ? beginButtonHover : undefined}
    >
      <span className="catalog-action-label" aria-hidden="true">
        {working ? (
          <LoaderCircle className="catalog-action-spinner" size={16} />
        ) : installed ? (
          <Check size={16} />
        ) : (
          <Plus size={16} />
        )}
        {label}
      </span>
      {installed && (
        <span className="catalog-action-remove" aria-hidden="true">
          <Trash2 size={16} />
          {t("Удалить")}
        </span>
      )}
    </button>
  );
}
