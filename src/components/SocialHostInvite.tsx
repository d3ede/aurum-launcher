import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Package, RefreshCw, Wifi } from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { t } from "../lib/i18n";
import type { SocialPerson } from "../lib/social";
import { useSocial } from "./SocialProvider";
import { SocialInviteHero } from "./SocialInviteHero";
import { SocialCheck } from "./SocialIdentity";
import { Modal, Field } from "./ui";
import { Select } from "./Select";

export function SocialHostInvite({
  friend,
  onClose,
}: {
  friend: SocialPerson;
  onClose: () => void;
}) {
  const { data, operation, busy, notify, progress } = useApp();
  const { act, working, chime } = useSocial();
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
  const unavailable = working || busy;
  return (
    <Modal
      title={t("@social.invite")}
      onClose={onClose}
      closeDisabled={unavailable}
      className="social-dialog social-invite-dialog"
    >
      <SocialInviteHero
        person={friend}
        world={profiles.find((p) => p.id === profileId)}
      />
      <div className="social-invite-body">
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
          </>
        )}
        {sending && (
          <p role="status" className="social-delivery-state">
            <LoaderCircle size={16} />
            {t("@social.delivering")}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="button secondary"
            onClick={() => {
              if (sending && progress)
                void rpc("cancel", { operationId: progress.id });
              else onClose();
            }}
          >
            {t("@social.cancel")}
          </button>
          <button
            className="button social-positive"
            disabled={unavailable || loading || !profileId || !port}
            onClick={() =>
              void act(async () => {
                setSending(true);
                chime("sent");
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
      </div>
    </Modal>
  );
}
