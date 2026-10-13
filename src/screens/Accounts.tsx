import { useEffect, useState } from "react";
import {
  UserRound,
  Plus,
  Check,
  Trash2,
  Upload,
  ShieldCheck,
  Monitor,
  ExternalLink,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { EmptyState, Field, Modal } from "../components/ui";
import { SkinPreview } from "../components/SkinPreview";
export function Accounts() {
  const { data, run, operation, busy, navigate } = useApp();
  const [offline, setOffline] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(
    data.selectedAccount || data.accounts[0]?.id || "",
  );
  const [bytes, setBytes] = useState<number[]>([]);
  const [model, setModel] = useState<"steve" | "alex">("steve");
  const [confirm, setConfirm] = useState(false);
  const [skinError, setSkinError] = useState("");
  const account = data.accounts.find((a) => a.id === selected);
  useEffect(() => {
    if (!data.accounts.some((a) => a.id === selected))
      setSelected(data.selectedAccount || data.accounts[0]?.id || "");
  }, [data.accounts, selected, data.selectedAccount]);
  useEffect(() => {
    setBytes([]);
    setSkinError("");
    if (!account) return;
    let live = true;
    setModel(account.skinModel);
    rpc("skin", { id: account.id })
      .then((b) => {
        if (live) {
          setBytes(b);
          setSkinError("");
        }
      })
      .catch((e) => {
        if (live) setSkinError(e.message);
      });
    return () => {
      live = false;
    };
  }, [account]);
  const login = () =>
    void operation(
      (operationId) => rpc("loginMicrosoft", { operationId }),
      "Microsoft-аккаунт добавлен",
    );
  return (
    <>
      <div className="page-heading">
        <h1>Аккаунты и скины</h1>
        <p>Выберите аккаунт для игры и настройте скин.</p>
      </div>
      <div className="accounts-layout">
        <section>
          <div className="account-add">
            <button className="button primary" disabled={busy} onClick={login}>
              <span className="microsoft-logo">
                <i />
                <i />
                <i />
                <i />
              </span>{" "}
              Войти с Microsoft
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setOffline(true)}
            >
              <Plus size={16} /> Локальный профиль
            </button>
          </div>
          {!data.settings.microsoftClientId && (
            <div className="credentials-note">
              <ShieldCheck size={19} />
              <div>
                <b>Настройте Microsoft-вход</b>
                <p>
                  Нужен Client ID вашего OAuth-приложения и разрешение Minecraft
                  Services.
                </p>
                <button
                  className="text-button"
                  onClick={() => navigate("settings")}
                >
                  Открыть настройки <ExternalLink size={14} />
                </button>
              </div>
            </div>
          )}
          {data.accounts.length ? (
            <div className="account-list">
              {data.accounts.map((a) => (
                <button
                  className={`account-card ${selected === a.id ? "selected" : ""}`}
                  key={a.id}
                  onClick={() => setSelected(a.id)}
                >
                  <div className={`account-avatar ${a.kind}`}>
                    <UserRound size={24} />
                  </div>
                  <div>
                    <b>{a.name}</b>
                    <small>
                      {a.kind === "microsoft"
                        ? "Microsoft · Minecraft Java"
                        : "Локальный офлайн-профиль"}
                    </small>
                  </div>
                  {data.selectedAccount === a.id && (
                    <span className="account-active">
                      <Check size={13} /> Активен
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<UserRound size={30} />}
              title="Нет аккаунтов"
              text="Добавьте Microsoft-аккаунт или локальный профиль для допустимых офлайн-сценариев."
            />
          )}
          {account && (
            <div className="account-actions">
              <button
                className="button secondary"
                disabled={busy || data.selectedAccount === account.id}
                onClick={() =>
                  void run(
                    () => rpc("selectAccount", { id: account.id }),
                    "Аккаунт выбран",
                  )
                }
              >
                <Check size={16} /> Использовать для игры
              </button>
              <button
                className="icon-button danger"
                aria-label="Удалить аккаунт"
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          )}
          <div className="offline-info">
            <Monitor size={19} />
            <div>
              <b>Об офлайн-профилях</b>
              <p>
                Они подходят для локальной игры и серверов, допускающих
                офлайн-вход. Официальные серверы требуют Microsoft-аккаунт с
                Minecraft.
              </p>
            </div>
          </div>
        </section>
        <section className="skin-panel">
          <div className="section-heading">
            <div>
              <h2>Ваш образ</h2>
              <p>{account ? account.name : "Предпросмотр модели"}</p>
            </div>
            <span className="quiet-pill">3D</span>
          </div>
          <SkinPreview bytes={bytes} model={model} />
          <div className="model-switch">
            {(["steve", "alex"] as const).map((v) => (
              <button
                key={v}
                className={model === v ? "active" : ""}
                onClick={() => setModel(v)}
              >
                {v === "steve" ? "Steve · обычные руки" : "Alex · тонкие руки"}
              </button>
            ))}
          </div>
          <button
            className="button secondary full-width"
            disabled={busy || !account}
            onClick={() => {
              if (account)
                void run(
                  () => rpc("setSkin", { id: account.id, model }),
                  "Скин загружен",
                );
            }}
          >
            <Upload size={16} /> Загрузить PNG-скин
          </button>
          <p className="skin-hint">
            64×64 или 64×32 · до 1 МБ
            {account?.kind === "microsoft"
              ? " · Скин отправляется в ваш Minecraft-профиль."
              : null}
          </p>
          {skinError && (
            <p role="alert" className="danger">
              {skinError}
            </p>
          )}
        </section>
      </div>
      {offline && (
        <Modal
          title="Локальный профиль"
          subtitle="Для игры без Microsoft-авторизации в допустимых офлайн-сценариях."
          onClose={() => setOffline(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => rpc("addOffline", { name }),
                "Локальный профиль добавлен",
              ).then((a) => {
                if (a) {
                  setSelected(a.id);
                  setOffline(false);
                  setName("");
                }
              });
            }}
          >
            <Field
              label="Ник игрока"
              hint="3–16 латинских букв, цифр или символов _"
            >
              <input
                required
                minLength={3}
                maxLength={16}
                pattern="[A-Za-z0-9_]{3,16}"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ваш ник"
              />
            </Field>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setOffline(false)}
              >
                Отмена
              </button>
              <button className="button primary" disabled={busy}>
                <Plus size={16} /> Добавить профиль
              </button>
            </div>
          </form>
        </Modal>
      )}
      {confirm && account && (
        <Modal
          title={`Удалить ${account.name}?`}
          subtitle="Будут удалены данные входа. Игровые сборки и миры сохранятся."
          onClose={() => setConfirm(false)}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setConfirm(false)}
            >
              Отмена
            </button>
            <button
              className="button destructive"
              disabled={busy}
              onClick={async () => {
                const ok = await run(async () => {
                  await rpc("deleteAccount", { id: account.id });
                  return true;
                }, "Аккаунт удалён");
                if (ok) setConfirm(false);
              }}
            >
              Удалить аккаунт
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
