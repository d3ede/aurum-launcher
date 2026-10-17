import { t } from "../lib/i18n";
import { useEffect, useState } from "react";
import {
  UserRound,
  Plus,
  Check,
  Trash2,
  Shirt,
  Monitor,
  ArrowRight,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { EmptyState, Field, Modal } from "../components/ui";
import { TerrainPattern } from "../components/TerrainPattern";
import { AccountAvatar } from "../components/AccountAvatar";
export function Accounts() {
  const { data, run, startMicrosoftLogin, busy, navigate } = useApp();
  const [offline, setOffline] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(
    data.selectedAccount || data.accounts[0]?.id || "",
  );
  const [confirm, setConfirm] = useState(false);
  const account = data.accounts.find((a) => a.id === selected);
  useEffect(() => {
    if (!data.accounts.some((a) => a.id === selected))
      setSelected(data.selectedAccount || data.accounts[0]?.id || "");
  }, [data.accounts, selected, data.selectedAccount]);
  return (
    <>
      <div className="page-heading">
        <h1>{t("Аккаунты и скины")}</h1>
        <p>{t("Выберите аккаунт для игры и настройте скин.")}</p>
      </div>
      <div className="accounts-layout">
        <section>
          <div className="microsoft-account-card">
            <TerrainPattern />
            <h3>{t("Ваш Minecraft начинается здесь")}</h3>
            <p>
              {t(
                "Войдите с Microsoft — и ваши скины, серверы и миры будут под рукой. Всё остальное Aurum сделает сам.",
              )}
            </p>
          </div>
          <div className="account-add">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void startMicrosoftLogin()}
            >
              <span className="microsoft-logo">
                <i />
                <i />
                <i />
                <i />
              </span>{" "}
              {t("Войти с Microsoft")}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setOffline(true)}
            >
              <Plus size={16} />
              {t(" Локальный профиль")}
            </button>
          </div>
          {data.accounts.length ? (
            <div className="account-list">
              {data.accounts.map((a) => (
                <button
                  className={`account-card ${selected === a.id ? "selected" : ""}`}
                  key={a.id}
                  onClick={() => setSelected(a.id)}
                >
                  <div className={`account-avatar ${a.kind}`}>
                    <AccountAvatar account={a} />
                  </div>
                  <div>
                    <b>{a.name}</b>
                    <small>
                      {a.kind === "microsoft"
                        ? "Microsoft · Minecraft Java"
                        : t("Локальный офлайн-профиль")}
                    </small>
                  </div>
                  {data.selectedAccount === a.id && (
                    <span className="account-active">
                      <Check size={13} />
                      {t(" Активен")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<UserRound size={30} />}
              title={t("Нет аккаунтов")}
              text={t(
                "Добавьте Microsoft-аккаунт или локальный профиль для допустимых офлайн-сценариев.",
              )}
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
                    t("Аккаунт выбран"),
                  )
                }
              >
                <Check size={16} />
                {t(" Использовать для игры")}
              </button>
              <button
                className="icon-button danger"
                aria-label={t("Удалить аккаунт")}
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
              <b>{t("Об офлайн-профилях")}</b>
              <p>
                {t(
                  "Они подходят для локальной игры и серверов, допускающих офлайн-вход. Официальные серверы требуют Microsoft-аккаунт с Minecraft.",
                )}
              </p>
            </div>
          </div>
        </section>
        <section className="skin-panel accounts-wardrobe-link">
          <div className="section-heading">
            <div>
              <h2>{t("Скины и плащи")}</h2>
              <p>{t("Отдельная библиотека ваших образов")}</p>
            </div>
            <Shirt size={24} />
          </div>
          <p>
            {t(
              "Стандартные персонажи, сохранённые скины, анимации и настройки плащей — в разделе образов.",
            )}
          </p>
          <button
            className="button secondary full-width"
            onClick={() => navigate("skins")}
          >
            {t("Открыть скины")}
            <ArrowRight size={16} />
          </button>
        </section>
      </div>
      {offline && (
        <Modal
          title={t("Локальный профиль")}
          subtitle={t(
            "Для игры без Microsoft-авторизации в допустимых офлайн-сценариях.",
          )}
          onClose={() => setOffline(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => rpc("addOffline", { name }),
                t("Локальный профиль добавлен"),
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
              label={t("Ник игрока")}
              hint={t("3\u201316 латинских букв, цифр или символов _")}
            >
              <input
                required
                minLength={3}
                maxLength={16}
                pattern="[A-Za-z0-9_]{3,16}"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("Ваш ник")}
              />
            </Field>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setOffline(false)}
              >
                {t("Отмена")}
              </button>
              <button className="button primary" disabled={busy}>
                <Plus size={16} />
                {t(" Добавить профиль")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {confirm && account && (
        <Modal
          title={t("Удалить {{v1}}?", { v1: account.name })}
          subtitle={t(
            "Будут удалены данные входа. Игровые сборки и миры сохранятся.",
          )}
          onClose={() => setConfirm(false)}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setConfirm(false)}
            >
              {t("Отмена")}
            </button>
            <button
              className="button destructive"
              disabled={busy}
              onClick={async () => {
                const ok = await run(async () => {
                  await rpc("deleteAccount", { id: account.id });
                  return true;
                }, t("Аккаунт удалён"));
                if (ok) setConfirm(false);
              }}
            >
              {t("Удалить аккаунт")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
