import { useEffect, useRef, useState } from "react";
import { Package, Play, RefreshCw, Wifi } from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { t } from "../lib/i18n";
import { useSocial } from "./SocialProvider";
import { Modal, Field } from "./ui";
import { Select } from "./Select";
import type {
  SocialInvitation,
  SocialPerson,
  SocialReview,
} from "../lib/social";
function size(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function SocialHostInvite({
  friend,
  withPack,
  onClose,
}: {
  friend: SocialPerson;
  withPack: boolean;
  onClose: () => void;
}) {
  const { data, operation, busy } = useApp();
  const { act, working } = useSocial();
  const profiles = data.profiles.filter(
    (p) => p.engine !== "horizon" && data.running.includes(p.id),
  );
  const [profileId, setProfileId] = useState(profiles[0]?.id || "");
  const [ports, setPorts] = useState<number[]>([]);
  const [port, setPort] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [configs, setConfigs] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [summary, setSummary] = useState<{
    files: number;
    bytes: number;
    excluded: string[];
    secrets: string[];
  } | null>(null);
  const inspect = async () => {
    if (!profileId) return;
    setLoading(true);
    setError("");
    try {
      const values = await rpc("social.lanListeners", { profileId });
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void inspect();
    setSummary(null);
  }, [profileId]);
  useEffect(() => setSummary(null), [configs, sensitive]);
  const review = () =>
    void act(async () => {
      const r = await operation((operationId) =>
        rpc("social.exportManifest", {
          profileId,
          configs,
          sensitive,
          operationId,
        }),
      );
      if (!r) return;
      setSummary({
        files: r.manifest.files.length,
        bytes: r.manifest.files.reduce((n, f) => n + f.bytes, 0),
        excluded: r.excluded,
        secrets: r.potentialSecrets,
      });
    });
  return (
    <Modal
      title={t(withPack ? "@social.invite.pack" : "@social.invite.world")}
      subtitle={friend.name || friend.id.slice(0, 16)}
      onClose={onClose}
      closeDisabled={working || busy}
    >
      <p>{t("@social.lan.hint")}</p>
      <Field label={t("@social.profile")}>
        <Select
          value={profileId}
          onValueChange={setProfileId}
          aria-label={t("@social.profile")}
          options={profiles.map((p) => ({ value: p.id, label: p.name }))}
        />
      </Field>
      <div className="social-port-row">
        <Field label={t("@social.lan.port")}>
          <Select
            value={port}
            onValueChange={setPort}
            disabled={loading}
            aria-label={t("@social.lan.port")}
            options={ports.map((p) => ({
              value: String(p),
              label: `LAN · ${p}`,
            }))}
          />
        </Field>
        <button
          className="icon-button"
          disabled={loading || !profileId}
          aria-label={t("@social.retry")}
          onClick={() => void inspect()}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && <p role="status">{error}</p>}
      {withPack && (
        <>
          <label className="social-toggle">
            <input
              type="checkbox"
              checked={configs}
              onChange={(e) => setConfigs(e.target.checked)}
            />
            {t("@social.configs")}
          </label>
          {configs && (
            <label className="social-toggle">
              <input
                type="checkbox"
                checked={sensitive}
                onChange={(e) => setSensitive(e.target.checked)}
              />
              {t("@social.sensitive")}
            </label>
          )}
          <p>{t("@social.scan.hint")}</p>
          <button
            className="button"
            disabled={!profileId || working}
            onClick={review}
          >
            {t("@social.review")}
          </button>
          {summary && (
            <div className="social-export-summary">
              <p>
                {summary.files} · {size(summary.bytes)}
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
                <p className="error-text">
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
      <div className="modal-actions">
        {(working || busy) && (
          <button
            className="button"
            onClick={() => void act(() => rpc("social.disable", {}))}
          >
            {t("@social.disable")}
          </button>
        )}
        <button className="button" disabled={working} onClick={onClose}>
          {t("@social.cancel")}
        </button>
        <button
          className="button primary"
          disabled={
            working || loading || !profileId || !port || (withPack && !summary)
          }
          onClick={() =>
            void act(async () => {
              const sent = await operation(async (operationId) => {
                await rpc("social.invite", {
                  profileId,
                  friend: friend.id,
                  port: Number(port),
                  configs,
                  sensitive,
                  withPack,
                  operationId,
                });
                return true;
              });
              if (sent) onClose();
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
export function SocialIncomingInvite({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { snapshot: s, act, working } = useSocial();
  const { data, operation, refresh, create, busy } = useApp();
  const invite = s?.invitations.find((i) => i.offer.id === id);
  const [review, setReview] = useState<SocialReview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [selected, setSelected] = useState("");
  const [installed, setInstalled] = useState<string | null>(null);
  const autoJoin = useRef(false);
  const compatible = data.profiles.filter(
    (p) =>
      p.engine !== "horizon" &&
      p.minecraft === invite?.offer.world.minecraft &&
      p.loader === invite?.offer.world.loader &&
      (p.loaderVersion ?? null) === (invite?.offer.world.loaderVersion ?? null),
  );
  const profile = selected || compatible[0]?.id || "";
  useEffect(() => {
    if (!invite) onClose();
  }, [invite, onClose]);
  const join = async (profileId: string) => {
    const done = await operation(async (operationId) => {
      await rpc("social.join", { id, profileId, operationId });
      return true;
    });
    if (done) onClose();
  };
  useEffect(() => {
    if (!installed || autoJoin.current) return;
    const p = data.profiles.find((p) => p.id === installed);
    if (p && !p.manualDownloads?.length) {
      autoJoin.current = true;
      void join(installed);
    }
  }, [installed, data.profiles]);
  if (!invite) return null;
  const friend = s?.people.find((p) => p.id === invite.from);
  const pack = !!invite.offer.manifestHash;
  return (
    <Modal
      title={t(pack ? "@social.received.pack" : "@social.received.world")}
      subtitle={friend?.name || invite.from.slice(0, 16)}
      onClose={onClose}
      closeDisabled={working || busy}
      wide={pack}
      className="social-invitation"
    >
      <h3>{invite.offer.world.name}</h3>
      <p>
        Minecraft {invite.offer.world.minecraft} · {invite.offer.world.loader}
        {invite.offer.world.loaderVersion
          ? ` ${invite.offer.world.loaderVersion}`
          : ""}
      </p>
      <code className="social-full-id">{invite.from}</code>
      {pack ? (
        <>
          <p>{t("@social.install.hint")}</p>
          {invite.status === "loading" ? (
            <p role="status">{t("@social.manifest.loading")}</p>
          ) : !review ? (
            <button
              className="button"
              disabled={working}
              onClick={() =>
                void act(async () => {
                  const r = await operation((operationId) =>
                    rpc("social.plan", { id, operationId }),
                  );
                  if (r) setReview(r);
                })
              }
            >
              {t("@social.review")}
            </button>
          ) : (
            <>
              <div className="social-plan-summary">
                {review.plan.items.length} ·{" "}
                {size(review.plan.items.reduce((n, f) => n + f.bytes, 0))}
              </div>
              <details open>
                <summary>{t("@social.files")}</summary>
                <div className="social-plan-files">
                  {review.plan.items.map((f) => (
                    <div key={f.path}>
                      <code>{f.path}</code>
                      <small>
                        {f.source?.provider ||
                          t(
                            f.config ? "@social.configs" : "@social.manual",
                          )}{" "}
                        · {size(f.bytes)}
                        {f.required ? ` · ${t("@social.dependency")}` : ""}
                      </small>
                    </div>
                  ))}
                </div>
              </details>
              {!!review.plan.warnings.length && (
                <details>
                  <summary>{t("@social.manual")}</summary>
                  {review.plan.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </details>
              )}
              <label className="social-toggle">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  disabled={working || !!installed}
                />
                {t("@social.trust.code")}
              </label>
            </>
          )}
          {installed && <p role="status">{t("@social.manual.hint")}</p>}
        </>
      ) : (
        <>
          <p>{t("@social.existing.hint")}</p>
          <Field label={t("@social.profile")}>
            <Select
              value={profile}
              onValueChange={setSelected}
              aria-label={t("@social.profile")}
              options={compatible.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>
          {!compatible.length && (
            <button className="button" onClick={create}>
              {t("@social.create.profile")}
            </button>
          )}
        </>
      )}
      <div className="modal-actions">
        {(working || busy) && (
          <button
            className="button"
            onClick={() => void act(() => rpc("social.disable", {}))}
          >
            {t("@social.disable")}
          </button>
        )}
        <button
          className="button"
          disabled={working}
          onClick={() =>
            void act(() => rpc("social.dismissInvite", { id })).then((ok) => {
              if (ok) onClose();
            })
          }
        >
          {t("@social.decline")}
        </button>
        {pack ? (
          <button
            className="button primary"
            disabled={working || !review || !accepted || !!installed}
            onClick={() =>
              void act(async () => {
                const installed = await operation((operationId) =>
                  rpc("social.install", {
                    planId: review!.id,
                    operationId,
                    accepted,
                  }),
                );
                if (installed) {
                  await refresh();
                  setInstalled(installed.profileId);
                }
              })
            }
          >
            <Package size={16} />
            {t("@social.install.join")}
          </button>
        ) : (
          <button
            className="button primary"
            disabled={working || !profile}
            onClick={() => void act(() => join(profile))}
          >
            <Play size={16} />
            {t("@social.join")}
          </button>
        )}
      </div>
    </Modal>
  );
}
export function SocialInviteQueue() {
  const { snapshot } = useSocial();
  const [id, setId] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!snapshot?.enabled) {
      setId(null);
      return;
    }
    if (id) return;
    const show = () => {
      if (
        document.querySelector(
          '[data-aurum-modal],[role="dialog"],.select-menu[data-state="open"]',
        )
      )
        return;
      const invite = snapshot.invitations
        .slice(0, 10)
        .find((i) => !seen.current.has(i.offer.id));
      if (invite) {
        if (seen.current.size >= 1024)
          seen.current.delete(seen.current.values().next().value!);
        seen.current.add(invite.offer.id);
        setId(invite.offer.id);
      }
    };
    const timer = setInterval(show, 500);
    return () => clearInterval(timer);
  }, [snapshot, id]);
  return id ? (
    <SocialIncomingInvite id={id} onClose={() => setId(null)} />
  ) : null;
}
export function SocialInvitationList({
  invitations,
}: {
  invitations: SocialInvitation[];
}) {
  const [id, setId] = useState<string | null>(null);
  return (
    <>
      {invitations.map((i) => (
        <button
          className="social-person social-invite-row"
          key={i.offer.id}
          onClick={() => setId(i.offer.id)}
        >
          <Package size={23} />
          <span>
            <strong>{i.offer.world.name}</strong>
            <small>
              Minecraft {i.offer.world.minecraft} · {i.offer.world.loader}
            </small>
          </span>
          <Play size={17} />
        </button>
      ))}
      {id && <SocialIncomingInvite id={id} onClose={() => setId(null)} />}
    </>
  );
}
export function SocialRecovery() {
  const { snapshot, act, working } = useSocial();
  const { operation, refresh, busy } = useApp();
  const [pending, setPending] = useState<SocialReview[]>([]);
  const [review, setReview] = useState<SocialReview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const load = () =>
    void rpc("social.pending", {})
      .then((value) => setPending(Array.isArray(value) ? value : []))
      .catch(() => {});
  useEffect(load, [snapshot?.enabled, busy]);
  if (!pending.length) return null;
  return (
    <section className="social-card">
      <h3>{t("@social.pending.installs")}</h3>
      {pending.map((r) => (
        <button
          key={r.id}
          className="social-person social-invite-row"
          disabled={!snapshot?.enabled || busy}
          onClick={() => {
            setReview(r);
            setAccepted(false);
          }}
        >
          <span>
            <strong>{r.plan.world.name}</strong>
            <small>{t("@social.resume")}</small>
          </span>
          <RefreshCw size={16} />
        </button>
      ))}
      {review && (
        <Modal
          title={t("@social.resume")}
          onClose={() => setReview(null)}
          closeDisabled={working || busy}
          wide
        >
          <p>{t("@social.resume.hint")}</p>
          <p>{t("@social.install.hint")}</p>
          <div className="social-plan-files">
            {review.plan.items.map((item) => (
              <div key={item.path}>
                <code>{item.path}</code>
                <small>
                  {item.source?.provider ||
                    t(item.config ? "@social.configs" : "@social.manual")}{" "}
                  · {size(item.bytes)}
                  {item.required ? ` · ${t("@social.dependency")}` : ""}
                </small>
              </div>
            ))}
          </div>
          <label className="social-toggle">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            {t("@social.trust.code")}
          </label>
          <div className="modal-actions">
            {busy && (
              <button
                className="button"
                onClick={() => void act(() => rpc("social.disable", {}))}
              >
                {t("@social.disable")}
              </button>
            )}
            <button
              className="button primary"
              disabled={!accepted || working || busy}
              onClick={() =>
                void act(async () => {
                  const result = await operation((operationId) =>
                    rpc("social.install", {
                      planId: review.id,
                      operationId,
                      accepted,
                    }),
                  );
                  if (result) {
                    setReview(null);
                    load();
                    await refresh();
                  }
                })
              }
            >
              {t("@social.resume")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
