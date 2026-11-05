import { t } from "../lib/i18n";
export function ImportCopyNotice({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="dialog-note">
      <p>
        {t(
          "Импорт создаёт копию, а не переносит сборку. Оригинал останется на диске и продолжит занимать место.",
        )}
      </p>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          {t(
            "После успешной проверки копии отправить оригинал в корзину Windows",
          )}
        </span>
      </label>
      <p>
        {t(
          "Галочка выключена по умолчанию. При ошибке или отмене оригинал сохраняется. Место освободится после очистки корзины Windows.",
        )}
      </p>
    </div>
  );
}
