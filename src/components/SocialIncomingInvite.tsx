import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, LoaderCircle, Play, Plus } from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { t } from "../lib/i18n";
import { socialSize, type SocialReview } from "../lib/social";
import { useSocial } from "./SocialProvider";
import { SocialCheck } from "./SocialIdentity";
import { SocialInviteHero } from "./SocialInviteHero";
import { Modal, Field } from "./ui";
import { Select } from "./Select";

export function SocialIncomingInvite({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { snapshot: s, act, working } = useSocial();
  const { data, operation, refresh, busy, progress, startMicrosoftLogin } =
    useApp();
  const invite = s?.invitations.find((i) => i.offer.id === id);
  const [review, setReview] = useState<SocialReview | null>(null),
    [accepted, setAccepted] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const [stage, setStage] = useState<
    "idle" | "planning" | "preparing" | "connecting" | "launching"
  >("idle");
  const [error, setError] = useState(""),
    [newName, setNewName] = useState("");
  const [lanReady, setLanReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const planned = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pack = !!invite?.offer.manifestHash;
  const compatible = data.profiles.filter(
    (p) =>
      p.engine !== "horizon" &&
      p.minecraft === invite?.offer.world.minecraft &&
      p.loader === invite?.offer.world.loader &&
      (p.loaderVersion ?? null) === (invite?.offer.world.loaderVersion ?? null),
  );
  const choice = selected ?? ((!pack && compatible[0]?.id) || "new");
  const profile = compatible.find((p) => p.id === choice);
  const needsPlan = pack && choice === "new";
  const account = data.selectedAccount || data.accounts[0]?.id || "";
  const active = stage !== "idle" && stage !== "planning";
  const pending = active || stage === "planning" || working;
  const failed =
    invite?.status === "failed" || invite?.status === "unreachable";
  const waiting = needsPlan && invite?.status === "loading";
  useEffect(() => {
    if (!invite) onClose();
  }, [invite, onClose]);
  useEffect(() => {
    if (
      !needsPlan ||
      !invite?.manifest ||
      review ||
      planned.current ||
      busy ||
      failed
    )
      return;
    planned.current = true;
    setStage("planning");
    void operation(async (operationId) => {
      try {
        const result = await rpc("social.plan", { id, operationId });
        if (mounted.current) setReview(result);
      } catch (e) {
        if (mounted.current)
          setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    }).finally(() => {
      if (mounted.current) setStage("idle");
    });
  }, [
    needsPlan,
    invite?.manifest,
    review,
    busy,
    failed,
    id,
    operation,
    attempt,
  ]);
  useEffect(() => {
    if (active && progress?.phase === "social-launch") setStage("launching");
  }, [active, progress?.phase]);
  if (!invite) return null;
  const friend = s?.people.find((p) => p.id === invite.from);
  const missing = !!profile?.manualDownloads?.length;
  const alreadyRunning = !!profile && data.running.includes(profile.id);
  const consentNeeded = needsPlan && !!review?.plan.items.length;
  const allowed =
    !!account &&
    !busy &&
    !pending &&
    !waiting &&
    !failed &&
    !missing &&
    !alreadyRunning &&
    (!needsPlan || !!review) &&
    (!consentNeeded || accepted);
  const phase = stage === "launching" ? 2 : stage === "connecting" ? 1 : 0;
  const label = t(
    stage === "planning"
      ? "@social.flow.plan"
      : waiting
        ? "@social.flow.receive"
        : stage === "connecting"
          ? "@social.flow.connect"
          : stage === "launching"
            ? "@social.flow.launch"
            : "@social.flow.download",
  );
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;
  const join = () =>
    void act(async () => {
      setError("");
      setStage("preparing");
      try {
        const done = await operation(async (operationId) => {
          try {
            await rpc("selectAccount", { id: account });
            let profileId = choice;
            if (needsPlan) {
              const installed = await rpc("social.install", {
                planId: review!.id,
                accepted: !consentNeeded || accepted,
                operationId,
              });
              profileId = installed.profileId;
              if (installed.missing) {
                await refresh();
                setSelected(profileId);
                setError(t("@social.flow.missing"));
                return false;
              }
            } else
              profileId = await rpc("social.prepare", {
                id,
                profileId: choice === "new" ? null : choice,
                operationId,
              });
            if (mounted.current) setStage("connecting");
            await rpc("social.join", { id, profileId, operationId });
            return true;
          } catch (e) {
            if (mounted.current)
              setError(e instanceof Error ? e.message : String(e));
            throw e;
          }
        });
        if (done) setLanReady(true);
      } finally {
        if (mounted.current) setStage("idle");
      }
    });
  return (
    <Modal
      title={t("@social.flow.title")}
      onClose={onClose}
      closeDisabled={pending}
      className="social-dialog social-invite-dialog"
    >
      <SocialInviteHero
        person={friend || { id: invite.from, name: t("@social.unknown") }}
        world={invite.offer.world}
      />
      <div className="social-invite-body">
        {lanReady ? (
          <>
            <div className="social-flow-status" role="status">
              <Check size={22} />
              <div>
                <strong>{t("@social.lan.open")}</strong>
                <span>
                  {t("@social.lan.pick", { name: invite.offer.world.name })}
                </span>
              </div>
            </div>
            <div className="modal-actions">
              <button className="button social-positive" onClick={onClose}>
                {t("@social.lan.done")}
              </button>
            </div>
          </>
        ) : (
          <>
            <Field label={t("@social.profile")}>
              <Select
                value={choice}
                disabled={pending || busy}
                onValueChange={(value) => {
                  setSelected(value);
                  setError("");
                }}
                aria-label={t("@social.profile")}
                options={[
                  ...compatible.map((p) => ({ value: p.id, label: p.name })),
                  { value: "new", label: t("@social.flow.new") },
                ]}
              />
            </Field>
            {data.accounts.length > 0 ? (
              <Field label={t("@social.flow.player")}>
                <Select
                  value={account}
                  disabled={pending || busy}
                  onValueChange={(id) =>
                    void act(() => rpc("selectAccount", { id }))
                  }
                  aria-label={t("@social.flow.player")}
                  options={data.accounts.map((a) => ({
                    value: a.id,
                    label: a.name,
                  }))}
                />
              </Field>
            ) : (
              <div className="social-player-add">
                <Field label={t("@social.flow.nickname")}>
                  <input
                    value={newName}
                    maxLength={16}
                    disabled={pending || busy}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </Field>
                <button
                  className="button secondary"
                  disabled={pending || busy || !newName.trim()}
                  onClick={() =>
                    void act(async () => {
                      const added = await rpc("addOffline", {
                        name: newName.trim(),
                      });
                      await rpc("selectAccount", { id: added.id });
                      await refresh();
                    })
                  }
                >
                  <Plus size={16} />
                  {t("@social.flow.add.player")}
                </button>
                <button
                  className="text-button"
                  disabled={pending || busy}
                  onClick={() => {
                    onClose();
                    void startMicrosoftLogin();
                  }}
                >
                  Microsoft
                </button>
              </div>
            )}
            {needsPlan && review && review.plan.items.length > 0 && (
              <>
                <details className="social-contents">
                  <summary>
                    {t("@social.flow.files", {
                      count: review.plan.items.length,
                      size: socialSize(
                        review.plan.items.reduce((n, f) => n + f.bytes, 0),
                      ),
                    })}
                  </summary>
                  <div className="social-plan-files">
                    {review.plan.items.map((f) => (
                      <div key={f.path}>
                        <code>{f.path}</code>
                        <small>
                          {f.source?.provider ||
                            t(f.config ? "@social.configs" : "@social.manual")}
                        </small>
                      </div>
                    ))}
                  </div>
                </details>
                <SocialCheck
                  checked={accepted}
                  disabled={pending || busy}
                  onChange={setAccepted}
                  danger
                >
                  {t("@social.flow.trust")}
                </SocialCheck>
              </>
            )}
            {needsPlan && review && !review.plan.items.length && (
              <p className="social-invite-note">{t("@social.flow.vanilla")}</p>
            )}
            {(waiting || pending || busy) && (
              <div className="social-flow-status" role="status">
                <LoaderCircle size={20} className="spin" />
                <div>
                  <strong>
                    {!pending && !waiting && busy
                      ? t("@social.flow.other")
                      : label}
                  </strong>
                  {waiting ? (
                    <span>
                      {socialSize(invite.receivedBytes || 0)} /{" "}
                      {socialSize(invite.offer.manifestBytes)}
                    </span>
                  ) : (
                    pct !== null && (
                      <>
                        <progress
                          value={progress!.done}
                          max={progress!.total}
                        />
                        <span>{pct}%</span>
                      </>
                    )
                  )}
                </div>
              </div>
            )}
            {active && (
              <ol className="social-flow-steps">
                {[
                  "@social.flow.step.prepare",
                  "@social.flow.step.connect",
                  "@social.flow.step.play",
                ].map((key, i) => (
                  <li
                    key={key}
                    className={
                      i < phase ? "done" : i === phase ? "current" : ""
                    }
                  >
                    <span>{i < phase ? <Check size={12} /> : i + 1}</span>
                    {t(key)}
                  </li>
                ))}
              </ol>
            )}
            {(error || failed || missing || alreadyRunning) && (
              <div className="social-flow-error" role="alert">
                <AlertCircle size={18} />
                <span>
                  {error ||
                    t(
                      invite.error ||
                        (failed
                          ? "@social.flow.failed"
                          : missing
                            ? "@social.flow.missing"
                            : "@social.flow.running"),
                    )}
                </span>
              </div>
            )}
            {error && needsPlan && !review && (
              <button
                className="text-button"
                disabled={busy || pending}
                onClick={() => {
                  planned.current = false;
                  setError("");
                  setAttempt((n) => n + 1);
                }}
              >
                {t("@social.retry")}
              </button>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={working && !active}
                onClick={() => {
                  if ((active || stage === "planning") && progress)
                    void rpc("cancel", { operationId: progress.id }).then(
                      () => {
                        if (stage === "planning") onClose();
                      },
                    );
                  else
                    void act(() => rpc("social.dismissInvite", { id })).then(
                      (ok) => {
                        if (ok) onClose();
                      },
                    );
                }}
              >
                {t(active ? "@social.cancel" : "@social.decline")}
              </button>
              <button
                className="button social-positive"
                disabled={!allowed}
                onClick={join}
              >
                <Play size={16} />
                {t(
                  active
                    ? "@social.flow.wait"
                    : choice === "new" || !profile?.installedVersion
                      ? "@social.flow.download.join"
                      : "@social.join",
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
