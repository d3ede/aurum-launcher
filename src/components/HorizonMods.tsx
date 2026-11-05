import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Code2,
  Compass,
  LoaderCircle,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { t } from "../lib/i18n";
import type { Profile } from "../types";
import type { HorizonModStatus } from "../lib/horizon-mods";
import { NativeModNotice } from "./NativeModNotice";
import { ErrorBox, Loading } from "./ui";

export function HorizonMods({
  profile,
  onFind,
}: {
  profile: Profile;
  onFind: () => void;
}) {
  const { data, busy, operation, run, progress } = useApp();
  const [status, setStatus] = useState<HorizonModStatus | null>(null);
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState("");
  const running = data.running.includes(profile.id);
  const building =
    busy &&
    progress?.profileId === profile.id &&
    progress.phase === "horizon-build";
  const refresh = useCallback(async () => {
    try {
      setStatus(await rpc("horizonModStatus", { id: profile.id }));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [profile.id]);
  const contentKey = JSON.stringify(
    profile.content.map((c) => [c.id, c.versionId, c.enabled]),
  );
  useEffect(() => {
    void refresh();
  }, [refresh, contentKey, profile.installedVersion, busy]);
  const readLog = useCallback(async () => {
    try {
      setLog(await rpc("horizonBuildLog", { id: profile.id }));
    } catch (e) {
      setError(String(e));
    }
  }, [profile.id]);
  useEffect(() => {
    if (!showLog) return;
    void readLog();
    if (!building) return;
    const timer = setInterval(() => void readLog(), 2000);
    return () => clearInterval(timer);
  }, [showLog, building, readLog]);
  const build = async () => {
    await operation(
      (operationId) =>
        rpc("buildHorizonMods", {
          id: profile.id,
          operationId,
          trustNativeCode: true,
        }),
      t("Моды скомпилированы"),
    );
    await refresh();
  };
  return (
    <section className="horizon-mods">
      <div className="native-mod-toolbar">
        <div>
          <h2>{t("Моды Horizon")}</h2>
        </div>
        <button className="button primary" onClick={onFind}>
          <Compass size={16} />
          {t("Найти моды Horizon")}
        </button>
      </div>
      <NativeModNotice />
      {error && <ErrorBox error={error} retry={() => void refresh()} />}
      {!status ? (
        !error && <Loading label={t("Проверяем моды…")} />
      ) : (
        <>
          <div
            className={`native-build-state ${status.needsBuild ? "pending" : "ready"}`}
            role="status"
          >
            {building ? (
              <LoaderCircle className="spin" size={22} />
            ) : status.needsBuild ? (
              <Code2 size={22} />
            ) : (
              <Check size={22} />
            )}
            <div>
              <b>
                {building
                  ? t("Компилируем моды…")
                  : !profile.installedVersion
                    ? t("Сначала установите Horizon")
                    : status.needsBuild
                      ? t("Изменения ещё не скомпилированы")
                      : status.enabled
                        ? t("Сборка модов готова")
                        : t("Пользовательские моды выключены")}
              </b>
              {building && <p>{progress?.message}</p>}
            </div>
            <button
              className="button primary"
              disabled={
                busy ||
                running ||
                !profile.installedVersion ||
                !status.enabled ||
                !!status.error
              }
              onClick={() => void build()}
            >
              <Code2 size={16} />
              {t("Скомпилировать")}
            </button>
          </div>
          {status.error && <ErrorBox error={status.error} />}
          <div className="native-mod-list">
            {status.mods.map((mod) => (
              <article className="native-mod-row" key={mod.id}>
                {mod.icon ? (
                  <img src={mod.icon} alt="" loading="lazy" />
                ) : (
                  <Code2 size={28} />
                )}
                <div>
                  <b>{mod.name}</b>
                  <small>
                    {mod.versionName || mod.versionId}
                    {mod.author ? ` · ${mod.author}` : ""}
                  </small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={mod.enabled}
                  aria-label={t("Включить мод {{name}}", { name: mod.name })}
                  className={`native-mod-switch ${mod.enabled ? "on" : ""}`}
                  disabled={busy || running}
                  onClick={() =>
                    void run(() =>
                      rpc("manageContent", {
                        id: profile.id,
                        contentId: mod.id,
                        action: "toggle",
                      }),
                    )
                  }
                >
                  <span />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={t("Удалить мод {{name}}", { name: mod.name })}
                  disabled={busy || running}
                  onClick={() =>
                    void run(() =>
                      rpc("manageContent", {
                        id: profile.id,
                        contentId: mod.id,
                        action: "remove",
                      }),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
            {!status.mods.length && (
              <div className="native-mod-empty">
                <Code2 size={30} />
                <p>
                  {t(
                    "Добавьте моды из каталога Horizon. После установки исходников они появятся здесь.",
                  )}
                </p>
              </div>
            )}
          </div>
        </>
      )}
      <button className="text-button" onClick={() => setShowLog((v) => !v)}>
        <Terminal size={16} />
        {t("Журнал компиляции")}
      </button>
      {showLog && (
        <>
          <button className="text-button" onClick={() => void readLog()}>
            <RefreshCw size={14} />
            {t("Обновить журнал")}
          </button>
          <pre className="game-log native-build-log">
            {log || t("Журнал появится после начала компиляции.")}
          </pre>
        </>
      )}
    </section>
  );
}
