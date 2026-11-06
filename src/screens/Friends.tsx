import { useState } from "react";
import {
  Users,
  UserPlus,
  Copy,
  Link2,
  ShieldCheck,
  Power,
  Download,
  Upload,
  QrCode,
  RefreshCw,
  Package,
  Wifi,
} from "lucide-react";
import { useSocial } from "../components/SocialProvider";
import { useApp } from "../context";
import { rpc, native } from "../lib/api";
import { t } from "../lib/i18n";
import { Modal, Field, EmptyState, Loading } from "../components/ui";
import type { SocialPerson } from "../lib/social";
import {
  SocialHostInvite,
  SocialInvitationList,
  SocialRecovery,
} from "../components/SocialInvitations";
function Identicon({ id }: { id: string }) {
  let bits = 2166136261;
  for (const c of id) bits = Math.imul(bits ^ c.charCodeAt(0), 16777619);
  return (
    <svg
      className="social-identicon"
      viewBox="0 0 7 7"
      aria-hidden="true"
      style={{ color: `hsl(${Math.abs(bits) % 360} 38% 49%)` }}
    >
      <rect width="7" height="7" rx="1.5" fill="currentColor" opacity=".15" />
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
  );
}
export function Friends() {
  const { snapshot: s, act, working } = useSocial();
  const { notify } = useApp();
  const [dialog, setDialog] = useState<
    "enable" | "add" | "export" | "restore" | "qr" | null
  >(null);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [password, setPassword] = useState("");
  const [replace, setReplace] = useState(false);
  const [qr, setQr] = useState("");
  const [hostInvite, setHostInvite] = useState<{
    friend: SocialPerson;
    withPack: boolean;
  } | null>(null);
  const close = () => {
    setDialog(null);
    setPassword("");
    setAgree(false);
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(t("@social.copied"));
    } catch (e) {
      notify(String(e), true);
    }
  };
  const relationship = (p: SocialPerson, action: string) =>
    void act(() => rpc("social.relationship", { id: p.id, action }));
  const enable = async () => {
    if (
      await act(async () => {
        await rpc("social.configureFirewall", { accepted: agree });
        await rpc("social.enable", {
          accepted: agree,
          name: name.trim() || s?.name || "Player",
        });
      })
    )
      close();
  };
  const people = (state: SocialPerson["state"]) =>
    s?.people.filter((p) => p.state === state) || [];
  const rows = (state: SocialPerson["state"]) =>
    people(state).map((p) => (
      <article className="social-person" key={p.id}>
        <Identicon id={p.id} />
        <div className="social-person-details">
          <strong>{p.name || p.id.slice(0, 18)}</strong>
          <small>
            {state === "friend"
              ? s?.online.includes(p.id)
                ? t("@social.online")
                : t("@social.unreachable")
              : state === "outgoing"
                ? t("@social.pending")
                : t("@social.identity.hint")}
          </small>
          <code title={p.id}>{p.id}</code>
          {state === "friend" &&
            s?.online.includes(p.id) &&
            s.activity?.[p.id] && (
              <small>
                {s.activity[p.id].name} · Minecraft {s.activity[p.id].minecraft}{" "}
                · {s.activity[p.id].loader}
              </small>
            )}
        </div>
        <div className="social-person-actions">
          {state === "friend" && (
            <>
              <button
                className="button"
                disabled={!s?.enabled || working}
                onClick={() => setHostInvite({ friend: p, withPack: false })}
              >
                <Wifi size={15} />
                {t("@social.invite.world")}
              </button>
              <button
                className="button"
                disabled={!s?.enabled || working}
                onClick={() => setHostInvite({ friend: p, withPack: true })}
              >
                <Package size={15} />
                {t("@social.invite.pack")}
              </button>
            </>
          )}
          {state === "incoming" && (
            <>
              <button
                className="button primary"
                disabled={!s?.enabled || working}
                onClick={() => relationship(p, "accept")}
              >
                {t("@social.accept")}
              </button>
              <button
                className="button"
                disabled={!s?.enabled || working}
                onClick={() => relationship(p, "decline")}
              >
                {t("@social.decline")}
              </button>
            </>
          )}
          {state === "outgoing" && (
            <button
              className="button"
              disabled={!s?.enabled || working}
              onClick={() => relationship(p, "retry")}
            >
              <RefreshCw size={14} />
              {t("@social.retry")}
            </button>
          )}
          {state === "blocked" ? (
            <button
              className="button"
              disabled={!s?.enabled || working}
              onClick={() => relationship(p, "unblock")}
            >
              {t("@social.unblock")}
            </button>
          ) : (
            <button
              className="icon-button"
              disabled={!s?.enabled || working}
              title={t("@social.block")}
              aria-label={t("@social.block")}
              onClick={() => relationship(p, "block")}
            >
              <ShieldCheck size={17} />
            </button>
          )}
          {state === "friend" && (
            <button
              className="text-button"
              disabled={!s?.enabled || working}
              onClick={() => relationship(p, "remove")}
            >
              {t("@social.remove")}
            </button>
          )}
        </div>
      </article>
    ));
  return (
    <section className="friends-page">
      <header className="page-heading">
        <div>
          <h1>{t("@social.title")}</h1>
          <p>{t("@social.subtitle")}</p>
        </div>
        {s?.enabled && (
          <button
            className="button"
            onClick={() => void act(() => rpc("social.disable", {}))}
          >
            <Power size={16} />
            {t("@social.disable")}
          </button>
        )}
      </header>
      {!native ? (
        <div className="social-card">
          <Users size={32} />
          <h2>{t("@social.off.title")}</h2>
          <p>{t("@social.desktop")}</p>
        </div>
      ) : !s ? (
        <Loading label={t("@social.loading")} />
      ) : (
        <>
          {!s.enabled ? (
            <div className="social-card social-onboarding">
              <div className="social-hero-mark">
                <Users size={38} />
              </div>
              <h2>{t("@social.off.title")}</h2>
              <p>{t("@social.off.copy")}</p>
              {s.error && (
                <p className="error-text" role="alert">
                  {s.error}
                </p>
              )}
              <button
                className="button primary"
                onClick={() => {
                  setName(s.name);
                  setDialog("enable");
                }}
              >
                <Power size={16} />
                {t("@social.enable")}
              </button>
            </div>
          ) : (
            <div className="social-card social-identity">
              <Identicon id={s.id || s.name} />
              <div>
                <strong>{s.name}</strong>
                <small>
                  <i
                    className={`status-dot ${s.status === "online" ? "online" : ""}`}
                  />
                  {t(
                    s.status === "online"
                      ? "@social.ready"
                      : s.status === "connecting"
                        ? "@social.wait"
                        : "@social.unavailable",
                  )}
                </small>
                <code className="social-full-id">{s.id}</code>
              </div>
              <div className="social-identity-actions">
                <button
                  className="button"
                  disabled={!s.id}
                  onClick={() => void copy(s.id!)}
                >
                  <Copy size={15} />
                  {t("@social.copy.id")}
                </button>
                <button
                  className="button"
                  disabled={!s.contactLink}
                  onClick={() => void copy(s.contactLink!)}
                >
                  <Link2 size={15} />
                  {t("@social.copy.link")}
                </button>
                <button
                  className="icon-button"
                  aria-label={t("@social.qr")}
                  disabled={!s.id}
                  onClick={() =>
                    void act(async () => {
                      setQr(await rpc("social.qr", {}));
                      setDialog("qr");
                    })
                  }
                >
                  <QrCode size={19} />
                </button>
              </div>
              <p className="social-link-hint">{t("@social.link.hint")}</p>
            </div>
          )}
          {s.enabled && s.error && (
            <details className="social-card social-diagnostics">
              <summary>{t("@social.unavailable")}</summary>
              <p>{s.error}</p>
            </details>
          )}
          <div className="social-layout">
            <div>
              <SocialRecovery />
              {s.enabled && s.invitations?.length > 0 && (
                <section className="social-list-section">
                  <h3>{t("@social.invitations")}</h3>
                  <SocialInvitationList invitations={s.invitations} />
                </section>
              )}
              <div className="social-section-heading">
                <h2>{t("@social.title")}</h2>
                <button
                  className="button primary"
                  disabled={!s.enabled || working}
                  onClick={() => setDialog("add")}
                >
                  <UserPlus size={16} />
                  {t("@social.add")}
                </button>
              </div>
              {people("friend").length ? (
                rows("friend")
              ) : (
                <EmptyState
                  icon={<Users size={28} />}
                  title={t("@social.empty")}
                  text=""
                />
              )}
              {(["incoming", "outgoing", "blocked"] as const).map(
                (state) =>
                  people(state).length > 0 && (
                    <section className="social-list-section" key={state}>
                      <h3>{t(`@social.${state}`)}</h3>
                      {rows(state)}
                    </section>
                  ),
              )}
            </div>
            <aside className="social-card social-settings">
              <h3>{t("@social.privacy")}</h3>
              <label className="social-toggle">
                <input
                  type="checkbox"
                  checked={s.privacy.shareActivity}
                  disabled={working}
                  onChange={(e) =>
                    void act(() =>
                      rpc("social.privacy", {
                        privacy: {
                          ...s.privacy,
                          shareActivity: e.target.checked,
                        },
                      }),
                    )
                  }
                />
                {t("@social.activity")}
              </label>
              <label className="social-toggle">
                <input
                  type="checkbox"
                  checked={s.privacy.incomingRequests}
                  disabled={working}
                  onChange={(e) =>
                    void act(() =>
                      rpc("social.privacy", {
                        privacy: {
                          ...s.privacy,
                          incomingRequests: e.target.checked,
                        },
                      }),
                    )
                  }
                />
                {t("@social.requests")}
              </label>
              <label className="social-toggle">
                <input
                  type="checkbox"
                  checked={s.privacy.publicRelays}
                  disabled={s.enabled || working}
                  onChange={(e) =>
                    void act(() =>
                      rpc("social.privacy", {
                        privacy: {
                          ...s.privacy,
                          publicRelays: e.target.checked,
                        },
                      }),
                    )
                  }
                />
                {t("@social.relays")}
              </label>
              <small>{t("@social.relays.hint")}</small>
              <hr />
              <h3>{t("@social.backup")}</h3>
              <p>{t("@social.backup.hint")}</p>
              <button
                className="button"
                disabled={!s.id || working}
                onClick={() => setDialog("export")}
              >
                <Download size={15} />
                {t("@social.export")}
              </button>
              <button
                className="button"
                disabled={s.enabled || working}
                onClick={() => setDialog("restore")}
              >
                <Upload size={15} />
                {t("@social.restore")}
              </button>
            </aside>
          </div>
        </>
      )}
      {hostInvite && (
        <SocialHostInvite {...hostInvite} onClose={() => setHostInvite(null)} />
      )}
      {dialog === "enable" && (
        <Modal
          title={t("@social.consent")}
          onClose={close}
          closeDisabled={working}
        >
          <p>{t("@social.off.copy")}</p>
          <Field label={t("@social.name")}>
            <input
              maxLength={48}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <p>{t("@social.network.consent")}</p>
          <label className="social-toggle">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              disabled={working}
            />
            {t("@social.agree")}
          </label>
          <div className="modal-actions">
            <button className="button" disabled={working} onClick={close}>
              {t("@social.cancel")}
            </button>
            <button
              className="button primary"
              disabled={!agree || working}
              onClick={() => void enable()}
            >
              {t(working ? "@social.wait" : "@social.enable.confirm")}
            </button>
          </div>
        </Modal>
      )}
      {dialog === "add" && (
        <Modal title={t("@social.add")} onClose={close} closeDisabled={working}>
          <Field label={t("@social.input")}>
            <textarea
              value={input}
              maxLength={1800}
              rows={3}
              onChange={(e) => setInput(e.target.value)}
            />
          </Field>
          <p>{t("@social.link.hint")}</p>
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={!input.trim() || working}
              onClick={() =>
                void act(() => rpc("social.add", { input: input.trim() })).then(
                  (ok) => {
                    if (ok) {
                      setInput("");
                      close();
                    }
                  },
                )
              }
            >
              {t("@social.request")}
            </button>
          </div>
        </Modal>
      )}
      {(dialog === "export" || dialog === "restore") && (
        <Modal
          title={t(dialog === "export" ? "@social.export" : "@social.restore")}
          onClose={close}
          closeDisabled={working}
        >
          <p>
            {t(
              dialog === "export"
                ? "@social.backup.hint"
                : "@social.replace.hint",
            )}
          </p>
          <Field label={t("@social.password")}>
            <input
              type="password"
              value={password}
              maxLength={1024}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {dialog === "restore" && (
            <label className="social-toggle">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              {t("@social.replace")}
            </label>
          )}
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={
                working ||
                (dialog === "export"
                  ? password.length < 12
                  : !password || !replace)
              }
              onClick={() =>
                void act(() =>
                  dialog === "export"
                    ? rpc("social.exportIdentity", { password })
                    : rpc("social.restoreIdentity", { password, replace }),
                ).then((ok) => {
                  if (ok) close();
                })
              }
            >
              {t(dialog === "export" ? "@social.export" : "@social.restore")}
            </button>
          </div>
        </Modal>
      )}
      {dialog === "qr" && s?.id && (
        <Modal title={t("@social.qr")} onClose={close}>
          <img
            className="social-qr"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`}
            alt={s.id}
          />
          <code className="social-full-id">{s.id}</code>
        </Modal>
      )}
    </section>
  );
}
