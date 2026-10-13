import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { Upload, RotateCcw } from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import {
  defaultIconStyle,
  iconSymbols,
  iconColors,
  iconBackgrounds,
  validIconColor,
} from "../lib/profile-icons";
import type { Profile } from "../types";

type IconValue = Pick<Profile, "icon" | "cover" | "iconStyle">;

export function ProfileIcon({
  profile,
  size = 56,
}: {
  profile: IconValue;
  size?: number;
}) {
  const fallback = defaultIconStyle(profile.cover);
  const appearance = profile.iconStyle;
  const { Icon } =
    iconSymbols.find((s) => s.id === (appearance?.symbol || fallback.symbol)) ||
    iconSymbols[0];
  return (
    <span
      className={`profile-icon variant-${profile.cover % 4}`}
      style={{
        width: size,
        height: size,
        ...(appearance && {
          color: validIconColor(appearance.color)
            ? appearance.color
            : undefined,
          backgroundColor: validIconColor(appearance.background)
            ? appearance.background
            : undefined,
        }),
      }}
    >
      {profile.icon ? (
        <img src={profile.icon} alt="" />
      ) : (
        <Icon size={Math.round(size * 0.5)} aria-hidden="true" />
      )}
    </span>
  );
}

function ColorControl({
  label,
  value,
  palette,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  palette: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <fieldset className="icon-color-control" disabled={disabled}>
      <legend>{label}</legend>
      <div className="icon-color-swatches" role="group" aria-label={label}>
        {palette.map((color) => (
          <button
            type="button"
            key={color}
            aria-label={`${label} ${color}`}
            aria-pressed={value.toUpperCase() === color}
            className={value.toUpperCase() === color ? "selected" : ""}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
      <div className="icon-custom-color">
        <input
          type="color"
          value={value}
          aria-label={label}
          title={t("Свой цвет")}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <input
          type="text"
          value={hex}
          aria-label={`${label} HEX`}
          spellCheck={false}
          maxLength={7}
          pattern="#[0-9a-fA-F]{6}"
          aria-invalid={!validIconColor(hex)}
          onChange={(e) => {
            const next = e.target.value;
            setHex(next);
            if (validIconColor(next)) onChange(next.toUpperCase());
          }}
          onBlur={() => {
            if (!validIconColor(hex)) setHex(value);
          }}
        />
      </div>
    </fieldset>
  );
}

export function IconPicker({
  value,
  onChange,
}: {
  value: IconValue;
  onChange: (value: IconValue) => void;
}) {
  const { run, busy } = useApp();
  const appearance =
    value.iconStyle ||
    defaultIconStyle(
      value.cover,
      document.documentElement.dataset.theme === "dark",
    );
  return (
    <div className="icon-editor">
      <div className="icon-editor-heading">
        <div
          className="icon-editor-preview"
          aria-label={t("Предпросмотр значка")}
        >
          <ProfileIcon profile={value} size={64} />
        </div>
        <div className="icon-editor-actions">
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={async () => {
              const icon = await run(() => rpc("chooseProfileIcon", {}));
              if (icon) onChange({ ...value, icon });
            }}
          >
            <Upload size={16} />
            {t("Свой значок")}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              onChange({ cover: value.cover % 4, icon: null, iconStyle: null })
            }
          >
            <RotateCcw size={14} />
            {t("Сбросить значок")}
          </button>
        </div>
      </div>
      <div className="icon-symbols" role="group" aria-label={t("Символ")}>
        {iconSymbols.map(({ id, label, Icon }, index) => (
          <button
            type="button"
            key={id}
            title={t(label)}
            aria-label={t(label)}
            aria-pressed={!value.icon && appearance.symbol === id}
            disabled={busy}
            className={
              !value.icon && appearance.symbol === id ? "selected" : ""
            }
            onClick={() =>
              onChange({
                cover: index % 4,
                icon: null,
                iconStyle: { ...appearance, symbol: id },
              })
            }
          >
            <Icon size={21} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="icon-editor-colors">
        <ColorControl
          label={t("Цвет символа")}
          value={appearance.color}
          palette={iconColors}
          disabled={busy || !!value.icon}
          onChange={(color) =>
            onChange({ ...value, iconStyle: { ...appearance, color } })
          }
        />
        <ColorControl
          label={t("Цвет фона")}
          value={appearance.background}
          palette={iconBackgrounds}
          disabled={busy}
          onChange={(background) =>
            onChange({ ...value, iconStyle: { ...appearance, background } })
          }
        />
      </div>
      {value.icon && (
        <p className="icon-editor-hint">
          {t("У загруженной картинки можно изменить фон.")}
        </p>
      )}
    </div>
  );
}
