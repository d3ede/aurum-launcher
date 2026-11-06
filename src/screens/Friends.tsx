import { useState } from "react";
import {
  Users,
  UserPlus,
  Copy,
  Link2,
  Power,
  Download,
  Upload,
  QrCode,
  RefreshCw,
  Camera,
  UserRound,
  ShieldOff,
  Trash2,
  Fingerprint,
} from "lucide-react";
import { useSocial } from "../components/SocialProvider";
import { useApp } from "../context";
import { rpc, native } from "../lib/api";
import { t } from "../lib/i18n";
import { Modal, Field, EmptyState, Loading } from "../components/ui";
import { Select } from "../components/Select";
import { ServerMenu } from "../components/RecentServers";
import {
  SocialAvatar,
  SocialCheck,
  SocialId,
} from "../components/SocialIdentity";
import type { SocialPerson } from "../lib/social";
import {
  SocialHostInvite,
  SocialInvitationList,
  SocialRecovery,
} from "../components/SocialInvitations";
export function Friends() {
  const { snapshot: s, act, working, requestDisable } = useSocial();
  const { notify } = useApp();
  const [dialog, setDialog] = useState<
    "enable" | "add" | "export" | "restore" | "qr" | "rename" | null
  >(null);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [password, setPassword] = useState("");
  const [qr, setQr] = useState("");
  const [invite, setInvite] = useState<SocialPerson | null>(null);
  const [verify, setVerify] = useState<SocialPerson | null>(null);
  const [confirm, setConfirm] = useState<{
    person: SocialPerson;
    action: "block" | "remove";
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
  const people = (state: SocialPerson["state"]) =>
    s?.people.filter((p) => p.state === state) || [];
  const action = (p: SocialPerson, action: string) =>
    void act(() => rpc("social.relationship", { id: p.id, action }));
  const online = !!(
    s?.enabled &&
    s.status === "online" &&
    !s.privacy.invisible
  );
  const rows = (state: SocialPerson["state"]) =>
    people(state).map((p) => {
      const active = !!(s?.enabled && s.online.includes(p.id));
      return (
        <article className="social-person" key={p.id}>
          <SocialAvatar
            id={p.id}
            avatar={p.avatar}
            online={state === "friend" && active}
          />
          <div className="social-person-details">
            <strong>{p.name || t("@social.unknown")}</strong>
            <small>
              {t(
                state === "friend"
                  ? active
                    ? "@social.online"
                    : "@social.offline"
                  : state === "outgoing"
                    ? "@social.pending"
                    : state === "blocked"
                      ? "@social.blocked"
                      : "@social.new.request",
              )}
            </small>
          </div>
          <div className="social-person-actions">
            {state === "friend" && (
              <button
                className="button social-positive"
                disabled={!s?.enabled || working}
                onClick={() => setInvite(p)}
              >
                <UserPlus size={16} />
                {t("@social.invite")}
              </button>
            )}
            {state === "incoming" && (
              <>
                <button
                  className="button social-positive"
                  disabled={!s?.enabled || working}
                  onClick={() => action(p, "accept")}
                >
                  {t("@social.accept")}
                </button>
                <button
                  className="button"
                  disabled={working}
                  onClick={() => action(p, "decline")}
                >
                  {t("@social.decline")}
                </button>
              </>
            )}
            {state === "outgoing" && (
              <button
                className="button"
                disabled={!s?.enabled || working}
                onClick={() => action(p, "retry")}
              >
                <RefreshCw size={15} />
                {t("@social.retry")}
              </button>
            )}
            {state === "blocked" ? (
              <button
                className="button"
                disabled={working}
                onClick={() => action(p, "unblock")}
              >
                {t("@social.unblock")}
              </button>
            ) : (
              <ServerMenu
                label={t("@social.friend.actions", {
                  name: p.name || t("@social.unknown"),
                })}
              >
                {(closeMenu) => (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => {
                        closeMenu();
                        setVerify(p);
                      }}
                    >
                      <Fingerprint size={16} />
                      {t("@social.verify.id")}
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        closeMenu();
                        setConfirm({ person: p, action: "block" });
                      }}
                    >
                      <ShieldOff size={16} />
                      {t("@social.block")}
                    </button>
                    <button
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        closeMenu();
                        setConfirm({ person: p, action: "remove" });
                      }}
                    >
                      <Trash2 size={16} />
                      {t("@social.remove")}
                    </button>
                  </>
                )}
              </ServerMenu>
            )}
          </div>
        </article>
      );
    });
  return (
    <section className="friends-page">
      <header className="page-heading">
        <h1>{t("@social.title")}</h1>
        <button
          className="button primary"
          disabled={!s?.enabled || working}
          onClick={() => setDialog("add")}
        >
          <UserPlus size={16} />
          {t("@social.add")}
        </button>
      </header>
      {!native ? (
        <div className="social-card">
          <p>{t("@social.desktop")}</p>
        </div>
      ) : !s ? (
        <Loading label={t("@social.loading")} />
      ) : (
        <>
          {s.id && (
            <div className="social-card social-identity">
              <button
                className="social-avatar-edit"
                aria-label={t("@social.avatar.choose")}
                disabled={working}
                onClick={() => void act(() => rpc("social.chooseAvatar", {}))}
              >
                <SocialAvatar
                  id={s.id}
                  avatar={s.avatar}
                  online={online}
                  size={72}
                />
                <span>
                  <Camera size={15} />
                </span>
              </button>
              <div className="social-identity-info">
                <button
                  className="social-name-button"
                  onClick={() => {
                    setName(s.name);
                    setDialog("rename");
                  }}
                >
                  <strong>{s.name}</strong>
                </button>
                <Select
                  value={
                    !s.enabled
                      ? "offline"
                      : s.privacy.invisible
                        ? "invisible"
                        : "online"
                  }
                  disabled={!s.enabled || working}
                  aria-label={t("@social.status")}
                  onValueChange={(value) =>
                    void act(() =>
                      rpc("social.privacy", {
                        privacy: {
                          ...s.privacy,
                          invisible: value === "invisible",
                        },
                      }),
                    )
                  }
                  options={[
                    ...(!s.enabled
                      ? [{ value: "offline", label: t("@social.offline") }]
                      : []),
                    { value: "online", label: t("@social.online") },
                    { value: "invisible", label: t("@social.invisible") },
                  ]}
                />
              </div>
              <div className="social-identity-actions">
                <button className="button" onClick={() => void copy(s.id!)}>
                  <Copy size={16} />
                  {t("@social.copy.id")}
                </button>
                <button
                  className="button"
                  disabled={!s.contactLink}
                  onClick={() => void copy(s.contactLink!)}
                >
                  <Link2 size={16} />
                  {t("@social.copy.link")}
                </button>
                <button
                  className="icon-button"
                  aria-label={t("@social.qr")}
                  onClick={() =>
                    void act(async () => {
                      setQr(await rpc("social.qr", {}));
                      setDialog("qr");
                    })
                  }
                >
                  <QrCode size={20} />
                </button>
              </div>
              <SocialId id={s.id} />
            </div>
          )}
          {!s.enabled && (
            <div className="social-card social-onboarding">
              <Users size={30} />
              <div>
                <h2>{t("@social.off.title")}</h2>
                <p>
                  {t(
                    s.status === "unavailable"
                      ? "@social.off.failed"
                      : "@social.off.short",
                  )}
                </p>
              </div>
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
          )}
          <div className="social-layout">
            <div className="social-friends-list">
              <SocialRecovery />
              {!!s.outgoing?.length && (
                <section className="social-list-section">
                  <h3>{t("@social.sent.title")}</h3>
                  {s.outgoing.map((i) => (
                    <article className="social-person" key={i.id}>
                      <SocialAvatar
                        id={i.friend}
                        avatar={s.people.find((p) => p.id === i.friend)?.avatar}
                      />
                      <div className="social-person-details">
                        <strong>
                          {s.people.find((p) => p.id === i.friend)?.name ||
                            t("@social.unknown")}
                        </strong>
                        <small>
                          {i.world.name} · {t(`@social.sent.${i.status}`)}
                        </small>
                      </div>
                    </article>
                  ))}
                </section>
              )}
              {s.enabled && s.invitations?.length > 0 && (
                <section className="social-list-section">
                  <h3>{t("@social.invitations")}</h3>
                  <SocialInvitationList invitations={s.invitations} />
                </section>
              )}
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
              <SocialCheck
                checked={s.privacy.shareActivity}
                disabled={working}
                onChange={(shareActivity) =>
                  void act(() =>
                    rpc("social.privacy", {
                      privacy: { ...s.privacy, shareActivity },
                    }),
                  )
                }
              >
                {t("@social.activity")}
              </SocialCheck>
              <SocialCheck
                checked={s.privacy.incomingRequests}
                disabled={working}
                onChange={(incomingRequests) =>
                  void act(() =>
                    rpc("social.privacy", {
                      privacy: { ...s.privacy, incomingRequests },
                    }),
                  )
                }
              >
                {t("@social.requests")}
              </SocialCheck>
              <SocialCheck
                checked={s.privacy.notifications !== false}
                disabled={working}
                onChange={(notifications) =>
                  void act(() =>
                    rpc("social.privacy", {
                      privacy: { ...s.privacy, notifications },
                    }),
                  )
                }
              >
                {t("@social.notifications")}
              </SocialCheck>
              <details className="social-network">
                <summary>{t("@social.network")}</summary>
                <SocialCheck
                  checked={s.privacy.publicRelays}
                  disabled={s.enabled || working}
                  onChange={(publicRelays) =>
                    void act(() =>
                      rpc("social.privacy", {
                        privacy: { ...s.privacy, publicRelays },
                      }),
                    )
                  }
                >
                  {t("@social.relays")}
                </SocialCheck>
              </details>
              <hr />
              <h3>{t("@social.backup.short")}</h3>
              <button
                className="button"
                disabled={!s.id || working}
                onClick={() => setDialog("export")}
              >
                <Download size={16} />
                {t("@social.export.short")}
              </button>
              <button
                className="button"
                disabled={working}
                onClick={() => setDialog("restore")}
              >
                <Upload size={16} />
                {t("@social.restore")}
              </button>
              {s.enabled && (
                <>
                  <hr />
                  <button
                    className="button social-danger social-off-button"
                    onClick={requestDisable}
                  >
                    <Power size={16} />
                    {t("@social.disable")}
                  </button>
                </>
              )}
            </aside>
          </div>
        </>
      )}
      {s?.enabled && invite && (
        <SocialHostInvite friend={invite} onClose={() => setInvite(null)} />
      )}
      {verify && (
        <Modal
          title={t("@social.verify.id")}
          subtitle={verify.name}
          className="social-dialog"
          onClose={() => setVerify(null)}
        >
          <p>{t("@social.identity.short")}</p>
          <SocialId id={verify.id} />
        </Modal>
      )}
      {confirm && (
        <Modal
          title={t(
            confirm.action === "block"
              ? "@social.block.confirm"
              : "@social.remove.confirm",
          )}
          subtitle={confirm.person.name}
          className="social-dialog"
          onClose={() => setConfirm(null)}
          closeDisabled={working}
        >
          <div className="modal-actions">
            <button className="button" onClick={() => setConfirm(null)}>
              {t("@social.cancel")}
            </button>
            <button
              className="button social-danger"
              disabled={working}
              onClick={() =>
                void act(() =>
                  rpc("social.relationship", {
                    id: confirm.person.id,
                    action: confirm.action,
                  }),
                ).then((ok) => {
                  if (ok) setConfirm(null);
                })
              }
            >
              {t(
                confirm.action === "block" ? "@social.block" : "@social.remove",
              )}
            </button>
          </div>
        </Modal>
      )}
      {dialog === "enable" && (
        <Modal
          title={t("@social.consent")}
          onClose={close}
          closeDisabled={working}
          className="social-dialog"
        >
          <p className="social-warning">{t("@social.consent.short")}</p>
          <Field label={t("@social.name")}>
            <input
              maxLength={48}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <SocialCheck
            checked={agree}
            disabled={working}
            danger
            onChange={setAgree}
          >
            {t("@social.agree.short")}
          </SocialCheck>
          <div className="modal-actions">
            <button className="button" disabled={working} onClick={close}>
              {t("@social.cancel")}
            </button>
            <button
              className="button primary"
              disabled={!agree || working}
              onClick={() =>
                void act(async () => {
                  await rpc("social.configureFirewall", { accepted: agree });
                  await rpc("social.enable", {
                    accepted: agree,
                    name: name.trim() || s?.name || "Player",
                  });
                }).then((ok) => {
                  if (ok) close();
                })
              }
            >
              {t(working ? "@social.wait" : "@social.enable")}
            </button>
          </div>
        </Modal>
      )}
      {dialog === "rename" && (
        <Modal
          title={t("@social.name")}
          onClose={close}
          className="social-dialog"
        >
          <Field label={t("@social.name")}>
            <input
              maxLength={48}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={working || !name.trim()}
              onClick={() =>
                void act(() =>
                  rpc("social.rename", { name: name.trim() }),
                ).then((ok) => {
                  if (ok) close();
                })
              }
            >
              {t("@social.save")}
            </button>
          </div>
        </Modal>
      )}
      {dialog === "add" && (
        <Modal
          title={t("@social.add")}
          onClose={close}
          closeDisabled={working}
          className="social-dialog"
        >
          <Field label={t("@social.input")}>
            <textarea
              value={input}
              maxLength={1800}
              rows={3}
              onChange={(e) => setInput(e.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <button
              className="button social-positive"
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
          title={t(
            dialog === "export" ? "@social.export.short" : "@social.restore",
          )}
          onClose={close}
          closeDisabled={working}
          className="social-dialog"
        >
          {dialog === "restore" && (
            <p className="social-warning">{t("@social.restore.short")}</p>
          )}
          <Field
            label={t(
              dialog === "export"
                ? "@social.backup.password"
                : "@social.password",
            )}
          >
            <input
              type="password"
              value={password}
              maxLength={1024}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <button className="button" disabled={working} onClick={close}>
              {t("@social.cancel")}
            </button>
            <button
              className="button primary"
              disabled={
                working ||
                (dialog === "export" ? password.length < 12 : !password)
              }
              onClick={() =>
                void act(async () => {
                  const saved =
                    dialog === "export"
                      ? await rpc("social.exportIdentity", { password })
                      : await rpc("social.restoreIdentity", {
                          password,
                          replace: true,
                        });
                  if (saved) close();
                })
              }
            >
              {t(
                dialog === "export"
                  ? "@social.export.short"
                  : "@social.restore.choose",
              )}
            </button>
          </div>
        </Modal>
      )}
      {dialog === "qr" && s?.id && (
        <Modal
          title={t("@social.qr")}
          onClose={close}
          className="social-dialog"
        >
          <img
            className="social-qr"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`}
            alt="Aurum ID"
          />
        </Modal>
      )}
    </section>
  );
}
