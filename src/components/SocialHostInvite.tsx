import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Package, RefreshCw, Wifi } from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { t } from "../lib/i18n";
import type { SocialPerson } from "../lib/social";
import { useSocial } from "./SocialProvider";
import { SocialCheck } from "./SocialIdentity";
import { Modal, Field } from "./ui";
import { Select } from "./Select";
import { socialSize } from "../lib/social";

export function SocialHostInvite({
  friend,
  onClose,
}: {
  friend: SocialPerson;
  onClose: () => void;
}) {
  const { data, operation, busy, notify } = useApp();
  const { act, working, requestDisable } = useSocial();
  const profiles = data.profiles.filter(
    (p) => p.engine !== "horizon" && data.running.includes(p.id),
  );
  const [profileId, setProfileId] = useState(profiles[0]?.id || "");
  const [withPack, setWithPack] = useState(false);
  const [ports, setPorts] = useState<number[]>([]);
  const [port, setPort] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [configs, setConfigs] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [summary, setSummary] = useState<{
    files: number;
    bytes: number;
    excluded: string[];
    secrets: string[];
  } | null>(null);
  const scan = useRef(0);
  const inspect = async () => {
    const generation = ++scan.current;
    setPorts([]);
    setPort("");
    setError("");
    if (!profileId) return;
    setLoading(true);
    try {
      const values = await rpc("social.lanListeners", { profileId });
      if (generation !== scan.current) return;
      const found = [
        ...new Set(
          values.map((v) =>
            Number(v.address.slice(v.address.lastIndexOf(":") + 1)),
          ),
        ),
      ];
      setPorts(found);
      setPort(found.length === 1 ? String(found[0]) : "");
      if (!found.length) setError(t("@social.lan.hint"));
    } catch (e) {
      if (generation === scan.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation === scan.current) setLoading(false);
    }
  };
  useEffect(() => {
    void inspect();
    return () => {
      ++scan.current;
    };
  }, [profileId]);
  useEffect(() => setSummary(null), [profileId, configs, sensitive]);
  const unavailable = working || busy;
  return (
    <Modal
      title={t("@social.invite")}
      subtitle={friend.name || t("@social.unknown")}
      onClose={onClose}
      closeDisabled={unavailable}
      className="social-dialog"
    >
      <div className="social-mode">
        <button
          aria-pressed={!withPack}
          disabled={unavailable}
          onClick={() => setWithPack(false)}
        >
          <Wifi size={17} />
          {t("@social.mode.world")}
        </button>
        <button
          aria-pressed={withPack}
          disabled={unavailable}
          onClick={() => setWithPack(true)}
        >
          <Package size={17} />
          {t("@social.mode.pack")}
        </button>
      </div>
      {!profiles.length && <p role="status">{t("@social.lan.hint")}</p>}
      <Field label={t("@social.profile")}>
        <Select
          value={profileId}
          onValueChange={setProfileId}
          disabled={unavailable}
          aria-label={t("@social.profile")}
          options={profiles.map((p) => ({ value: p.id, label: p.name }))}
        />
      </Field>
      <div className="social-port-row">
        <Field label={t("@social.lan.port")}>
          <Select
            value={port}
            onValueChange={setPort}
            disabled={loading || unavailable}
            aria-label={t("@social.lan.port")}
            options={ports.map((p) => ({
              value: String(p),
              label: `LAN · ${p}`,
            }))}
          />
        </Field>
        <button
          className="icon-button"
          disabled={loading || !profileId || unavailable}
          aria-label={t("@social.retry")}
          onClick={() => void inspect()}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && <p role="status">{error}</p>}
      {withPack && (
        <>
          <SocialCheck
            checked={configs}
            disabled={unavailable}
            onChange={(value) => {
              setConfigs(value);
              if (!value) setSensitive(false);
            }}
          >
            {t("@social.configs")}
          </SocialCheck>
          {configs && (
            <SocialCheck
              checked={sensitive}
              disabled={unavailable}
              danger
              onChange={setSensitive}
            >
              {t("@social.sensitive")}
            </SocialCheck>
          )}
          <button
            className="button social-review-button"
            disabled={!profileId || unavailable}
            onClick={() =>
              void act(async () => {
                const r = await operation((operationId) =>
                  rpc("social.exportManifest", {
                    profileId,
                    configs,
                    sensitive,
                    operationId,
                  }),
                );
                if (r)
                  setSummary({
                    files: r.manifest.files.length,
                    bytes: r.manifest.files.reduce((n, f) => n + f.bytes, 0),
                    excluded: r.excluded,
                    secrets: r.potentialSecrets,
                  });
              })
            }
          >
            {t("@social.review")}
          </button>
          {summary && (
            <div className="social-export-summary">
              <p>
                {summary.files
                  ? t("@social.file.summary", {
                      count: summary.files,
                      size: socialSize(summary.bytes),
                    })
                  : t("@social.vanilla.contents")}
              </p>
              {!!summary.excluded.length && (
                <details>
                  <summary>
                    {t("@social.excluded")} ({summary.excluded.length})
                  </summary>
                  {summary.excluded.map((f) => (
                    <code key={f}>{f}</code>
                  ))}
                </details>
              )}
              {!!summary.secrets.length && (
                <p className="social-warning">
                  {t(
                    sensitive
                      ? "@social.secrets.included"
                      : "@social.secrets.omitted",
                  )}
                </p>
              )}
            </div>
          )}
        </>
      )}
      {sending && (
        <p role="status" className="social-delivery-state">
          <LoaderCircle size={16} />
          {t("@social.delivering")}
        </p>
      )}
      <div className="modal-actions">
        {unavailable && (
          <button className="button social-danger" onClick={requestDisable}>
            {t("@social.disable")}
          </button>
        )}
        <button className="button" disabled={unavailable} onClick={onClose}>
          {t("@social.cancel")}
        </button>
        <button
          className="button social-positive"
          disabled={unavailable || loading || !profileId || !port}
          onClick={() =>
            void act(async () => {
              setSending(true);
              try {
                const sent = await operation(async (operationId) => {
                  await rpc("social.invite", {
                    profileId,
                    friend: friend.id,
                    port: Number(port),
                    configs: withPack && configs,
                    sensitive: withPack && configs && sensitive,
                    withPack,
                    operationId,
                  });
                  return true;
                });
                if (sent) {
                  notify(t("@social.delivered"));
                  onClose();
                }
              } finally {
                setSending(false);
              }
            })
          }
        >
          {withPack ? <Package size={16} /> : <Wifi size={16} />}{" "}
          {t("@social.send.invite")}
        </button>
      </div>
    </Modal>
  );
}
