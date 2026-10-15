import { Check, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { t } from "../lib/i18n";

export type CatalogActionState =
  "available" | "installed" | "installing" | "removing";

export function CatalogInstallButton({
  state,
  title,
  disabled,
  onClick,
}: {
  state: CatalogActionState;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const working = state === "installing" || state === "removing";
  const installed = state === "installed";
  const label =
    state === "installing"
      ? t("Установка…")
      : state === "removing"
        ? t("Удаление…")
        : installed
          ? t("Установлено")
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
