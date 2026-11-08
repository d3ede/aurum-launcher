import { t } from "../lib/i18n";
import { useEffect, useState, type CSSProperties } from "react";
import {
  UserRound,
  Plus,
  Check,
  Trash2,
  Shirt,
  Monitor,
  ArrowRight,
  ImagePlus,
  Search,
  Flag,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { EmptyState, Field, Modal } from "../components/ui";
import { TerrainPattern } from "../components/TerrainPattern";
import { AccountAvatar } from "../components/AccountAvatar";

function WardrobeButtonPattern() {
  return (
    <svg
      className="wardrobe-button-pattern"
      viewBox="0 0 360 64"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {Array.from({ length: 7 }, (_, index) => {
        const curve = `M ${142 + index * 15} -12 C ${111 + index * 14} 18, ${205 + index * 12} 20, ${206 + index * 15} 36 S ${285 + index * 12} 70, 380 ${30 + index * 6}`;
        return (
          <g
            key={index}
            style={{ "--trace-delay": `${index * 45}ms` } as CSSProperties}
          >
            <path className="wardrobe-button-trace" pathLength={1} d={curve} />
            <path className="wardrobe-button-glow" pathLength={1} d={curve} />
          </g>
        );
      })}
    </svg>
  );
}

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
        <h1>{t("Профили")}</h1>
        <p>{t("Выберите аккаунт для игры и настройте скин.")}</p>
      </div>
      <div className="accounts-layout">
        <section className="accounts-main">
          <div className="microsoft-account-card">
            <TerrainPattern />
            <h3>{t("Аккаунт Minecraft")}</h3>
            <p>
              {t("Войдите через Microsoft или добавьте локальный профиль.")}
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
              text={t("Добавьте Microsoft-аккаунт или локальный профиль.")}
            />
          )}
        </section>
        <section className="accounts-details">
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
        <section
          className="accounts-wardrobe-link"
          aria-labelledby="accounts-wardrobe-title"
        >
          <div className="accounts-wardrobe-heading">
            <h2 id="accounts-wardrobe-title">{t("Скины и плащи")}</h2>
            <span className="accounts-wardrobe-icon">
              <Shirt size={28} />
            </span>
          </div>
          <ul className="accounts-wardrobe-features">
            <li>
              <ImagePlus size={17} aria-hidden="true" />
              <span>{t("Загрузка PNG и библиотека")}</span>
            </li>
            <li>
              <Search size={17} aria-hidden="true" />
              <span>{t("Поиск по названию и нику")}</span>
            </li>
            <li>
              <Flag size={17} aria-hidden="true" />
              <span>{t("Плащи и 3D-просмотр")}</span>
            </li>
          </ul>
          <button
            className="accounts-wardrobe-action"
            onClick={() => navigate("skins")}
          >
            <WardrobeButtonPattern />
            <span>{t("Открыть скины")}</span>
            <ArrowRight size={18} />
          </button>
        </section>
      </div>
      {offline && (
        <Modal
          title={t("Локальный профиль")}
          subtitle={t("Для одиночной игры и серверов с офлайн-входом.")}
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
