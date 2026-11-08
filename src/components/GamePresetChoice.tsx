import { useApp } from "../context";
import { t } from "../lib/i18n";
import { Select } from "./Select";
import "../screens/game-settings.css";

export function GamePresetChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  disabled?: boolean;
}) {
  const { data } = useApp();
  const presets = data.gameSettingsProfiles ?? [];
  if (!presets.length) return null;
  return (
    <div className="game-preset-choice">
      <label>
        <input
          type="checkbox"
          checked={value !== undefined}
          disabled={disabled}
          onChange={(e) =>
            onChange(e.target.checked ? presets[0].id : undefined)
          }
        />
        <span>{t("@game.useMine")}</span>
      </label>
      {value !== undefined && (
        <Select
          aria-label={t("@game.choosePreset")}
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          options={[
            { value: "", label: t("@game.choosePreset") },
            ...presets.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      )}
      {value !== undefined && <p>{t("@game.installHint")}</p>}
    </div>
  );
}
