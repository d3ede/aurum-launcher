import { Box, Compass, Mountain, Trees, Upload, Check } from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import type { Profile } from "../types";
const symbols = [Box, Trees, Mountain, Compass];
export function ProfileIcon({
  profile,
  size = 56,
}: {
  profile: Pick<Profile, "icon" | "cover">;
  size?: number;
}) {
  const Icon = symbols[profile.cover % symbols.length] || Box;
  return (
    <span
      className={`profile-icon variant-${profile.cover % 4}`}
      style={{ width: size, height: size }}
    >
      {profile.icon ? (
        <img src={profile.icon} alt="" />
      ) : (
        <Icon size={Math.round(size * 0.5)} />
      )}
    </span>
  );
}
export function IconPicker({
  value,
  onChange,
}: {
  value: Pick<Profile, "icon" | "cover">;
  onChange: (value: Pick<Profile, "icon" | "cover">) => void;
}) {
  const { run, busy } = useApp();
  return (
    <div className="icon-picker">
      <ProfileIcon profile={value} size={64} />
      <div>
        <div className="icon-presets">
          {symbols.map((_, cover) => (
            <button
              type="button"
              key={cover}
              aria-label={`Значок ${cover + 1}`}
              aria-pressed={!value.icon && value.cover === cover}
              className={!value.icon && value.cover === cover ? "selected" : ""}
              onClick={() => onChange({ icon: null, cover })}
            >
              <ProfileIcon profile={{ cover, icon: null }} size={38} />
              {!value.icon && value.cover === cover && <Check size={12} />}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={async () => {
            const icon = await run(() => rpc("chooseProfileIcon", {}));
            if (icon) onChange({ ...value, icon });
          }}
        >
          <Upload size={16} /> Свой значок
        </button>
      </div>
    </div>
  );
}
