import { useState, type ReactNode } from "react";
import { Eye, EyeOff, Fingerprint } from "lucide-react";
import { t } from "../lib/i18n";
export function SocialAvatar({
  id,
  avatar,
  online = false,
  size = 52,
}: {
  id: string;
  avatar?: string | null;
  online?: boolean;
  size?: number;
}) {
  let bits = 2166136261;
  for (const c of id) bits = Math.imul(bits ^ c.charCodeAt(0), 16777619);
  return (
    <span className="social-avatar" style={{ width: size, height: size }}>
      {avatar?.startsWith("data:image/jpeg;base64,") ? (
        <img src={avatar} alt="" />
      ) : (
        <svg
          viewBox="0 0 7 7"
          aria-hidden="true"
          style={{ color: `hsl(${Math.abs(bits) % 360} 36% 48%)` }}
        >
          <rect
            width="7"
            height="7"
            rx="1.5"
            fill="currentColor"
            opacity=".14"
          />
          {Array.from({ length: 15 }, (_, i) =>
            bits & (1 << i)
              ? [...new Set([1 + (i % 3), 5 - (i % 3)])].map((x) => (
                  <rect
                    key={`${i}:${x}`}
                    x={x}
                    y={1 + Math.floor(i / 3)}
                    width="1"
                    height="1"
                    fill="currentColor"
                  />
                ))
              : null,
          )}
        </svg>
      )}
      <i
        className={`social-avatar-dot ${online ? "online" : "offline"}`}
        aria-label={t(online ? "@social.online" : "@social.offline")}
      />
    </span>
  );
}
export function SocialId({ id }: { id: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="social-id">
      <button
        className="social-id-toggle"
        onClick={() => setVisible(!visible)}
        aria-expanded={visible}
      >
        <Fingerprint size={16} />
        <span>{t(visible ? "@social.hide.id" : "@social.show.id")}</span>
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
      {visible && (
        <code className="social-id-value">
          {id.match(/.{1,8}/g)?.map((part, i) => (
            <span key={i}>{part}</span>
          ))}
        </code>
      )}
    </div>
  );
}
export function SocialCheck({
  checked,
  onChange,
  children,
  disabled = false,
  danger = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <label className={`social-check ${danger ? "danger" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
