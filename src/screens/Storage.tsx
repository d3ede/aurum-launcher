import { useCallback, useEffect, useState } from "react";
import {
  HardDrive,
  RefreshCw,
  Trash2,
  RotateCcw,
  FolderOpen,
  Coffee,
  LoaderCircle,
  ArrowRight,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { t, getLocale } from "../lib/i18n";
import { Modal } from "../components/ui";
import { SettingsPageHeading } from "../components/SettingsPageHeading";
import "./storage.css";

export interface StorageEntry {
  id: string;
  name: string;
  bytes: number;
  kind: string;
  restorable: boolean;
  deletedAt: number;
  inUse: boolean;
}
export interface StorageSnapshot {
  totalBytes: number;
  cleanableBytes: number;
  gameDirectory: string;
  launcherDirectory: string;
  categories: { id: string; bytes: number; cleanable: boolean }[];
  profiles: StorageEntry[];
  installations: StorageEntry[];
  trash: StorageEntry[];
  browserCleanupPending: boolean;
}
const labels: Record<string, string> = {
  profiles: "Сборки и миры",
  minecraft: "Общие файлы Minecraft",
  java: "Java",
  horizon: "Horizon",
  hosting: "Локальные серверы",
  temporary: "Временные загрузки",
  trash: "Корзина",
  cache: "Кэш",
  logs: "Журналы",
  launcher: "Лаунчер",
  other: "Остальные файлы",
};
const hints: Record<string, string> = {
  minecraft: "Ресурсы и библиотеки используются сразу несколькими сборками.",
  java: "Нужная версия используется повторно. Новые загрузки содержат только среду запуска.",
  horizon: "Клиент и подготовленные ресурсы Horizon.",
  temporary: "Ненужные архивы установок и остатки прерванных загрузок.",
  cache: "Восстанавливаемые данные. Кэш интерфейса очищается при перезапуске.",
  logs: "Диагностика установок. Очистка не затрагивает миры и настройки.",
};
export function storageSize(bytes: number) {
  const units = ["Б", "КиБ", "МиБ", "ГиБ", "ТиБ"];
  const power =
    bytes > 0 ? Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: power > 1 ? 2 : 0 }).format(bytes / 1024 ** power)} ${t(units[power])}`;
}

export function StorageSettings() {
  const { openSettings, run, operation, busy, notify, data } = useApp();
  const [snapshot, setSnapshot] = useState<StorageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{
    title: string;
    text: string;
    apply: () => Promise<void>;
  } | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await rpc("storageSnapshot", {});
      if (!next) throw new Error(t("Не удалось прочитать хранилище"));
      setSnapshot(next);
      setSelected((old) =>
        old.filter((id) => next.trash.some((e) => e.id === id)),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const blocked =
    busy || loading || !!data.running.length || !!data.hostingRunning?.length;
  async function clean(category: string) {
    const result = await run(() => rpc("storageClean", { category }));
    if (result !== undefined)
      notify(t("Освобождено: {{v1}}", { v1: storageSize(result) }));
    await refresh();
  }
  async function trash(ids: string[], restore: boolean) {
    const result = await run(() => rpc("storageTrash", { ids, restore }));
    if (result !== undefined)
      notify(
        restore
          ? t("Файлы восстановлены")
          : t("Освобождено: {{v1}}", { v1: storageSize(result) }),
      );
    await refresh();
  }
  function empty(ids: string[]) {
    setConfirm({
      title: t("Удалить из корзины навсегда?"),
      text: t(
        "Выбранные файлы и миры будут удалены без возможности восстановления. Элементов: {{v1}}",
        { v1: ids.length },
      ),
      apply: () => trash(ids, false),
    });
  }
  return (
    <div className="settings-page storage-page" data-settings-page="storage">
      <SettingsPageHeading
        title="Хранилище"
        description="Всё, что занимает место: от миров до временных файлов."
        onBack={() => openSettings("general")}
      />
      <section className="storage-overview" aria-label={t("Занятое место")}>
        <div className="storage-overview-top">
          <div className="storage-total">
            <span>
              <HardDrive size={18} />
              {t("Занято Aurum")}
            </span>
            <strong>{snapshot ? storageSize(snapshot.totalBytes) : "—"}</strong>
          </div>
          <div className="storage-reclaim">
            <span>{t("Можно очистить")}</span>
            <strong>
              {snapshot ? storageSize(snapshot.cleanableBytes) : "—"}
            </strong>
            <small>{t("Кэш, загрузки, журналы и корзина")}</small>
          </div>
          <button
            className="icon-button"
            aria-label={t("Пересчитать размер")}
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            <RefreshCw
              size={18}
              className={loading ? "storage-spinning" : ""}
            />
          </button>
        </div>
        <div
          className="storage-meter"
          role="img"
          aria-label={t("Распределение занятого места")}
        >
          {snapshot?.categories
            .filter((c) => c.bytes > 0)
            .map((c) => (
              <span
                key={c.id}
                className={`storage-color-${c.id}`}
                style={{
                  width: `${(c.bytes / Math.max(1, snapshot.totalBytes)) * 100}%`,
                }}
                title={`${t(labels[c.id])}: ${storageSize(c.bytes)}`}
              />
            ))}
        </div>
        <div className="storage-legend">
          {snapshot?.categories
            .filter((c) => c.bytes > 0)
            .map((c) => (
              <span key={c.id}>
                <i className={`storage-color-${c.id}`} />
                {t(labels[c.id])}
                <b>{storageSize(c.bytes)}</b>
              </span>
            ))}
        </div>
      </section>
      {error && (
        <p className="dialog-note" role="alert">
          {error}
        </p>
      )}
      {!snapshot && loading && (
        <p className="storage-loading" role="status">
          <LoaderCircle size={19} className="storage-spinning" />
          {t("Считаем файлы…")}
        </p>
      )}
      {snapshot && (
        <>
          <section className="storage-section">
            <div className="storage-section-heading">
              <div>
                <h2>{t("Очистка")}</h2>
                <p>
                  {t("Освободите место, сохранив сборки, миры и аккаунты.")}
                </p>
              </div>
            </div>
            <div className="storage-cleanup-grid">
              {snapshot.categories
                .filter((c) => ["cache", "temporary", "logs"].includes(c.id))
                .map((c) => (
                  <article className="storage-cleanup-card" key={c.id}>
                    <span className={`storage-dot storage-color-${c.id}`} />
                    <h3>{t(labels[c.id])}</h3>
                    <strong>{storageSize(c.bytes)}</strong>
                    <p>{t(hints[c.id])}</p>
                    <button
                      className="button secondary"
                      disabled={blocked || !c.bytes}
                      onClick={() => void clean(c.id)}
                    >
                      <Trash2 size={15} />
                      {t("Очистить")}
                    </button>
                  </article>
                ))}
            </div>
            {snapshot.browserCleanupPending && (
              <div className="dialog-note storage-restart">
                <span>
                  {t(
                    "Очистка кэша интерфейса запланирована. Настройки и входы сохранятся.",
                  )}
                </span>
                <button
                  className="button secondary"
                  disabled={blocked}
                  onClick={() => void run(() => rpc("restart", {}))}
                >
                  {t("Перезапустить Aurum")}
                </button>
              </div>
            )}
            <div className="storage-java">
              <span className="settings-destination-icon">
                <Coffee size={24} />
              </span>
              <div>
                <h3>{t("Компактная Java")}</h3>
                <p>
                  {t(
                    "Замените полные JDK на среду запуска без инструментов разработчика. Нужные версии сохранятся.",
                  )}
                </p>
              </div>
              <button
                className="button secondary"
                disabled={blocked}
                onClick={() => {
                  setConfirm({
                    title: t("Оптимизировать Java?"),
                    text: t(
                      "Aurum скачает компактные среды запуска и проверит их перед заменой. Указанная вручную Java останется без изменений.",
                    ),
                    apply: async () => {
                      const result = await operation((operationId) =>
                        rpc("optimizeJava", { operationId }),
                      );
                      if (result !== undefined)
                        notify(
                          t("Освобождено: {{v1}}", { v1: storageSize(result) }),
                        );
                      await refresh();
                    },
                  });
                }}
              >
                {t("Оптимизировать Java")}
                <ArrowRight size={15} />
              </button>
            </div>
          </section>
          <section className="storage-section">
            <div className="storage-section-heading">
              <div>
                <h2>{t("Сборки и миры")}</h2>
                <p>{t("Удалённые сборки сначала попадают в корзину Aurum.")}</p>
              </div>
              <span className="storage-count">{snapshot.profiles.length}</span>
            </div>
            <div className="storage-list">
              {snapshot.profiles.map((p) => (
                <div className="storage-row" key={p.id}>
                  <span className="storage-row-icon">
                    <FolderOpen size={19} />
                  </span>
                  <div className="storage-row-name">
                    <b>{p.name}</b>
                    <small>{storageSize(p.bytes)}</small>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={t("Открыть папку {{v1}}", { v1: p.name })}
                    onClick={() =>
                      void run(() => rpc("openFolder", { id: p.id }))
                    }
                  >
                    <FolderOpen size={17} />
                  </button>
                  <button
                    className="button secondary"
                    disabled={blocked}
                    onClick={() =>
                      setConfirm({
                        title: t("Переместить сборку в корзину?"),
                        text: p.name,
                        apply: async () => {
                          await run(() => rpc("deleteProfile", { id: p.id }));
                          await refresh();
                        },
                      })
                    }
                  >
                    <Trash2 size={15} />
                    {t("В корзину")}
                  </button>
                </div>
              ))}
              {!snapshot.profiles.length && (
                <p className="storage-empty">{t("Сборок пока нет")}</p>
              )}
            </div>
          </section>
          <section className="storage-section">
            <div className="storage-section-heading">
              <div>
                <h2>{t("Установленные версии")}</h2>
                <p>
                  {t(
                    "Используемые версии защищены от удаления. Ненужные можно удалить отдельно.",
                  )}
                </p>
              </div>
            </div>
            <div className="storage-list">
              {snapshot.installations?.map((item) => (
                <div className="storage-row" key={item.id}>
                  <span className="storage-row-icon">
                    {item.kind === "java" ? (
                      <Coffee size={19} />
                    ) : (
                      <FolderOpen size={19} />
                    )}
                  </span>
                  <div className="storage-row-name">
                    <b>{item.name}</b>
                    <small>
                      {storageSize(item.bytes)} ·{" "}
                      {item.inUse ? t("Используется") : t("Не используется")}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={t("Удалить версию {{v1}}", { v1: item.name })}
                    disabled={blocked || item.inUse}
                    onClick={() =>
                      setConfirm({
                        title: t("Удалить неиспользуемую версию?"),
                        text: item.name,
                        apply: async () => {
                          await run(() =>
                            rpc("storageRemoveVersion", { id: item.id }),
                          );
                          await refresh();
                        },
                      })
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section className="storage-section storage-trash">
            <div className="storage-section-heading">
              <div>
                <h2>
                  <Trash2 size={20} />
                  {t("Корзина")}
                </h2>
                <p>
                  {t("Восстановите удалённое или освободите место навсегда.")}
                </p>
              </div>
              <span className="storage-count">
                {storageSize(snapshot.trash.reduce((s, e) => s + e.bytes, 0))}
              </span>
            </div>
            {snapshot.trash.length ? (
              <>
                <div className="storage-trash-toolbar">
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.length === snapshot.trash.length}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? snapshot.trash.map((p) => p.id)
                            : [],
                        )
                      }
                    />
                    {t("Выбрать всё")}
                  </label>
                  <span>{t("Выбрано: {{v1}}", { v1: selected.length })}</span>
                  <button
                    className="text-button"
                    disabled={
                      blocked ||
                      !selected.length ||
                      snapshot.trash.some(
                        (e) => selected.includes(e.id) && !e.restorable,
                      )
                    }
                    onClick={() => void trash(selected, true)}
                  >
                    <RotateCcw size={15} />
                    {t("Восстановить выбранное")}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t("Удалить выбранное навсегда")}
                    disabled={blocked || !selected.length}
                    onClick={() => empty(selected)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                <div className="storage-list">
                  {snapshot.trash.map((p) => (
                    <div className="storage-row" key={p.id}>
                      <input
                        type="checkbox"
                        aria-label={t("Выбрать {{v1}}", { v1: p.name })}
                        checked={selected.includes(p.id)}
                        onChange={(e) =>
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, p.id]
                              : old.filter((id) => id !== p.id),
                          )
                        }
                      />
                      <div className="storage-row-name">
                        <b>{p.name}</b>
                        <small>
                          {storageSize(p.bytes)}
                          {p.deletedAt
                            ? ` · ${new Date(p.deletedAt * 1000).toLocaleDateString(getLocale())}`
                            : ""}
                          {!p.restorable
                            ? ` · ${t("Старый элемент без данных восстановления")}`
                            : ""}
                        </small>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={t("Восстановить {{v1}}", { v1: p.name })}
                        disabled={blocked || !p.restorable}
                        onClick={() => void trash([p.id], true)}
                      >
                        <RotateCcw size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={t("Удалить {{v1}} навсегда", {
                          v1: p.name,
                        })}
                        disabled={blocked}
                        onClick={() => empty([p.id])}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="storage-trash-footer">
                  <button
                    className="button secondary"
                    disabled={
                      blocked || snapshot.trash.some((e) => !e.restorable)
                    }
                    onClick={() =>
                      void trash(
                        snapshot.trash.map((p) => p.id),
                        true,
                      )
                    }
                  >
                    <RotateCcw size={16} />
                    {t("Восстановить всё")}
                  </button>
                  <button
                    className="button secondary storage-danger"
                    disabled={blocked}
                    onClick={() => empty(snapshot.trash.map((p) => p.id))}
                  >
                    <Trash2 size={16} />
                    {t("Очистить корзину")}
                  </button>
                </div>
              </>
            ) : (
              <div className="storage-empty">
                <Trash2 size={27} />
                <b>{t("Корзина пуста")}</b>
                <p>
                  {t("Здесь появятся удалённые сборки, моды и ресурспаки.")}
                </p>
              </div>
            )}
          </section>
          <section className="storage-section storage-paths">
            <h2>{t("Где хранятся файлы")}</h2>
            <p>
              {t(
                "Лаунчер и игровые данные разделены. Общие ресурсы не дублируются для каждой сборки.",
              )}
            </p>
            <label>
              {t("Лаунчер")}
              <code>{snapshot.launcherDirectory}</code>
            </label>
            <label>
              {t("Игровые файлы")}
              <code>{snapshot.gameDirectory}</code>
            </label>
          </section>
        </>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p>{confirm.text}</p>
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setConfirm(null)}
            >
              {t("Отмена")}
            </button>
            <button
              className="button primary"
              onClick={() => {
                const apply = confirm.apply;
                setConfirm(null);
                void apply();
              }}
            >
              {t("Продолжить")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
