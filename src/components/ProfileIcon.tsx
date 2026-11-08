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
  randomIconStyle,
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

export function ColorControl({
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
  const [roll, setRoll] = useState(0);
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
        <button
          type="button"
          className="icon-randomizer"
          title={t("Случайный значок")}
          aria-label={t("Случайный значок")}
          disabled={busy}
          onClick={() => {
            setRoll((count) => count + 1);
            onChange({ ...value, icon: null, iconStyle: randomIconStyle() });
          }}
        >
          <svg
            key={roll}
            className={`randomizer-die${roll ? " is-rolling" : ""}`}
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
          >
            <g
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              <path d="M16 3 27.258 9.5v13L16 29 4.742 22.5v-13Z" />
              <path d="M4.742 9.5 16 16l11.258-6.5M16 16v13" />
            </g>
            <g fill="currentColor">
              {/* Project the pips on the same three planes as the cube edges. */}
              <g transform="matrix(.866 .5 -.866 .5 16 3)">
                <circle cx="6.5" cy="6.5" r="1.45" />
              </g>
              <g transform="matrix(.866 .5 0 1 4.742 9.5)">
                <circle cx="4.16" cy="4.16" r="1.45" />
                <circle cx="8.84" cy="8.84" r="1.45" />
              </g>
              <g transform="matrix(.866 -.5 0 1 16 16)">
                <circle cx="3.25" cy="3.25" r="1.45" />
                <circle cx="6.5" cy="6.5" r="1.45" />
                <circle cx="9.75" cy="9.75" r="1.45" />
              </g>
            </g>
          </svg>
        </button>
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
