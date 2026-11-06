import { useEffect, useRef, useState } from "react";
import { Package, Play, RefreshCw } from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { t } from "../lib/i18n";
import { useSocial } from "./SocialProvider";
import { Modal } from "./ui";
import { SocialCheck } from "./SocialIdentity";
import { socialSize as size } from "../lib/social";
import type { SocialInvitation, SocialReview } from "../lib/social";
export { SocialHostInvite } from "./SocialHostInvite";
import { SocialIncomingInvite } from "./SocialIncomingInvite";
export { SocialIncomingInvite } from "./SocialIncomingInvite";
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
          className="social-dialog"
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
          <SocialCheck checked={accepted} onChange={setAccepted} danger>
            {t("@social.trust.code")}
          </SocialCheck>
          <div className="modal-actions">
            <button
              className="button social-positive"
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
