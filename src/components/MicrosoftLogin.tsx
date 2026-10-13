import { t, tMessage } from "../lib/i18n";
import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  ShieldCheck,
  LoaderCircle,
  AlertCircle,
  Monitor,
  ArrowRight,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { Modal } from "./ui";
import { TerrainPattern } from "./TerrainPattern";
export function MicrosoftLogo() {
  return (
    <span className="microsoft-logo" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
export function MicrosoftLogin() {
  const {
    microsoftLogin: login,
    startMicrosoftLogin,
    closeMicrosoftLogin,
    navigate,
    busy,
  } = useApp();
  const [reopening, setReopening] = useState(false);
  const [windowError, setWindowError] = useState("");
  if (!login) return null;
  const active = login.status === "active";
  const cancelling = login.status === "cancelling";
  const success = login.status === "success";
  const error = login.status === "error";
  const checking =
    active && ["auth-exchange", "auth-profile"].includes(login.phase);
  const waiting = active && login.phase === "auth-waiting";
  const title = success
    ? t("Вы в игре")
    : error
      ? t("Не удалось войти")
      : login.status === "cancelled"
        ? t("Вход отменён")
        : t("Вход с Microsoft");
  const reopen = async () => {
    setReopening(true);
    setWindowError("");
    try {
      await rpc("reopenMicrosoft", { operationId: login.id });
    } catch (e) {
      setWindowError(e instanceof Error ? e.message : String(e));
    } finally {
      setReopening(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={() => void closeMicrosoftLogin()}
      className="microsoft-dialog"
      closeDisabled={cancelling}
    >
      <div className="microsoft-hero">
        <TerrainPattern />
        <div className={`microsoft-emblem ${success ? "is-success" : ""}`}>
          {success ? <Check size={30} /> : <MicrosoftLogo />}
        </div>
        <span className="microsoft-eyebrow">
          {t("ВАШ АККАУНТ \u00B7 ВАШИ МИРЫ")}
        </span>
        <h3>
          {success
            ? t("Привет, {{v1}}!", { v1: login.name })
            : t("Один вход. Все ваши миры.")}
        </h3>
        <p>
          {success
            ? t("Аккаунт Minecraft Java подключён и выбран для игры.")
            : t(
                "Подтвердите вход в отдельном окне Microsoft. Aurum позаботится об остальном.",
              )}
        </p>
      </div>
      <div className="microsoft-body">
        <div
          className="microsoft-status"
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          <span className="microsoft-status-icon">
            {error ? (
              <AlertCircle size={22} />
            ) : success ? (
              <ShieldCheck size={22} />
            ) : active || cancelling ? (
              <LoaderCircle size={22} className="spin" />
            ) : (
              <Monitor size={22} />
            )}
          </span>
          <div>
            <b>
              {success
                ? t("Можно запускать Minecraft")
                : cancelling
                  ? t("Отменяем вход\u2026")
                  : error
                    ? t("Попробуйте ещё раз")
                    : login.status === "cancelled"
                      ? t("Можно вернуться к входу в любое время")
                      : checking
                        ? t("Завершаем вход")
                        : waiting
                          ? t("Ждём подтверждения в окне Microsoft")
                          : t("Открываем окно Microsoft")}
            </b>
            <p>
              {error
                ? tMessage(login.message || "")
                : success
                  ? t("При следующих запусках Aurum сохранит ваш вход.")
                  : cancelling
                    ? t("Закрываем ожидание ответа Microsoft.")
                    : login.status === "cancelled"
                      ? t("Аккаунт не был добавлен.")
                      : checking
                        ? t(
                            "Подключаем аккаунт и проверяем профиль Minecraft Java.",
                          )
                        : t(
                            "Выберите аккаунт в окне Microsoft и подтвердите вход. Это окно закроется автоматически.",
                          )}
            </p>
          </div>
        </div>
        {active && (
          <ol className="microsoft-steps" aria-label={t("Этапы входа")}>
            <li className={checking ? "done" : "current"}>
              <span>{checking ? <Check size={14} /> : "1"}</span>Microsoft
            </li>
            <li className={checking ? "current" : ""}>
              <span>2</span>Minecraft Java
            </li>
            <li>
              <span>3</span>
              {t("Готово")}
            </li>
          </ol>
        )}
        {windowError && (
          <p className="microsoft-browser-error" role="alert">
            {tMessage(windowError)}
          </p>
        )}
        <div className="microsoft-actions">
          {success ? (
            <button
              className="button primary"
              onClick={() => {
                void closeMicrosoftLogin();
                navigate("profiles");
              }}
            >
              {t("К моим сборкам ")}
              <ArrowRight size={17} />
            </button>
          ) : error || login.status === "cancelled" ? (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                setWindowError("");
                void startMicrosoftLogin();
              }}
            >
              <MicrosoftLogo />
              {t(" Попробовать снова")}
            </button>
          ) : waiting ? (
            <button
              className="button primary"
              disabled={reopening}
              onClick={() => void reopen()}
            >
              {t("Вернуться к окну Microsoft ")}
              <ArrowUpRight size={17} />
            </button>
          ) : null}
          <button
            className="button secondary"
            disabled={cancelling}
            onClick={() => void closeMicrosoftLogin()}
          >
            {active
              ? t("Отменить вход")
              : cancelling
                ? t("Отмена\u2026")
                : t("Закрыть")}
          </button>
        </div>
        <p className="microsoft-privacy">
          <ShieldCheck size={15} />
          {t(" Пароль вводится только на странице Microsoft.")}
        </p>
      </div>
    </Modal>
  );
}
