import { t } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  Download,
  FolderOpen,
  Layers3,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { progressAmount } from "../lib/progress";
import { ru } from "../lib/i18n";
import type { ModrinthImportResult, ModrinthScan } from "../types";
import { ErrorBox, Loading, Modal } from "./ui";
import { ProfileIcon } from "./ProfileIcon";
export function ModrinthImport({ onClose }: { onClose: () => void }) {
  const { operation, busy, progress } = useApp();
  const [scan, setScan] = useState<ModrinthScan | null>(null);
  const [directories, setDirectories] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ModrinthImportResult | null>(null);
  const [retry, setRetry] = useState(0);
  const importLock = useRef(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    rpc("scanModrinth", { directories })
      .then((data) => {
        if (!live) return;
        setScan(data);
        setSelected(
          (old) =>
            new Set(
              [...old].filter((id) =>
                data.profiles.some((p) => p.id === id && !p.issue),
              ),
            ),
        );
      })
      .catch((e: Error) => {
        if (live) {
          setError(e.message);
          setScan(null);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [directories, retry]);
  const chooseFolder = async () => {
    try {
      const path = await rpc("chooseModrinthDirectory", {});
      if (path) {
        setResult(null);
        setDirectories((old) => [...new Set([...old, path])]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const profiles =
    scan?.profiles.filter((p) =>
      p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) || [];
  const available = profiles.filter((p) => !p.issue);
  const allSelected =
    available.length > 0 && available.every((p) => selected.has(p.id));
  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const submit = async () => {
    if (importLock.current || !selected.size) return;
    importLock.current = true;
    setImporting(true);
    setResult(null);
    setError("");
    try {
      const response = await operation(async (operationId) => {
        try {
          return await rpc("importModrinth", {
            directories,
            selected: [...selected],
            operationId,
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          throw e;
        }
      });
      if (response) {
        setResult(response);
        // Keep failed and unprocessed rows selected so a retry never recopies successes.
        const imported = new Set(response.importedSources);
        setSelected(
          (old) => new Set([...old].filter((id) => !imported.has(id))),
        );
      }
    } finally {
      importLock.current = false;
      setImporting(false);
    }
  };
  return (
    <Modal
      title={t("Импорт из Modrinth")}
      subtitle={t("Выберите сборки, которые хотите добавить в Aurum.")}
      wide
      className="modrinth-import-modal"
      closeDisabled={importing}
      onClose={() => {
        if (!importLock.current) onClose();
      }}
    >
      <div className="modrinth-import-body">
        <div className="modrinth-transfer">
          <span className="transfer-symbol">
            <Layers3 size={22} />
          </span>
          <div>
            <b>{t("Ваши сборки \u2014 в Aurum")}</b>
            <p>
              {t("Моды, миры, ресурспаки и игровые настройки переедут вместе.")}
            </p>
          </div>
          <ArrowRight size={20} aria-hidden="true" />
        </div>
        <div className="import-source-toolbar">
          <span>
            {loading
              ? t("Ищем установленные сборки\u2026")
              : t("Найдено сборок: {{v1}}", { v1: scan?.profiles.length || 0 })}
          </span>
          <div>
            <button
              className="text-button"
              disabled={loading || busy}
              onClick={() => {
                setResult(null);
                setRetry((n) => n + 1);
              }}
            >
              <RefreshCw size={15} />
              {t(" Обновить")}
            </button>
            <button
              className="text-button"
              disabled={loading || busy}
              onClick={() => void chooseFolder()}
            >
              <FolderOpen size={15} />
              {t(" Указать папку")}
            </button>
          </div>
        </div>
        {error && (
          <ErrorBox
            error={error}
            retry={loading || busy ? undefined : () => setRetry((n) => n + 1)}
          />
        )}
        {loading ? (
          <Loading label={t("Находим профили Modrinth\u2026")} />
        ) : scan && scan.profiles.length > 0 ? (
          <>
            <div className="import-selection-toolbar">
              <div className="input-icon">
                <Search size={16} />
                <input
                  aria-label={t("Поиск профилей Modrinth")}
                  placeholder={t("Найти сборку")}
                  value={query}
                  disabled={importing}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <button
                className="text-button"
                disabled={busy || !available.length}
                onClick={() =>
                  setSelected((old) => {
                    const next = new Set(old);
                    available.forEach((p) => {
                      if (allSelected) next.delete(p.id);
                      else next.add(p.id);
                    });
                    return next;
                  })
                }
              >
                {allSelected ? <CheckCheck size={16} /> : <Square size={16} />}
                {allSelected
                  ? t("Снять выбор")
                  : query
                    ? t("Выбрать показанные")
                    : t("Выбрать все")}
              </button>
            </div>
            <div
              className="modrinth-profile-list"
              aria-label={t("Профили Modrinth")}
            >
              {profiles.map((p) => (
                <label
                  key={p.id}
                  className={`modrinth-profile-row ${selected.has(p.id) ? "selected" : ""} ${p.issue ? "unavailable" : ""}`}
                >
                  <input
                    type="checkbox"
                    aria-label={t("Импортировать {{v1}}", { v1: p.name })}
                    checked={selected.has(p.id)}
                    disabled={busy || !!p.issue}
                    onChange={() => {
                      setResult(null);
                      toggle(p.id);
                    }}
                  />
                  <ProfileIcon profile={{ cover: 1, icon: p.icon }} size={46} />
                  <span className="import-profile-description">
                    <b>{p.name}</b>
                    <span className="import-profile-details">
                      <span>Minecraft {p.minecraft || "—"}</span>
                      <span>
                        {ru.loaders[p.loader]}
                        {p.loaderVersion && ` ${p.loaderVersion}`}
                      </span>
                    </span>
                    <small>
                      {p.issue ||
                        t("{{v1}} модов \u00B7 {{v2}} миров", {
                          v1: p.mods,
                          v2: p.worlds,
                        })}
                    </small>
                    {p.warnings.map((w) => (
                      <small className="import-warning" key={w}>
                        {w}
                      </small>
                    ))}
                  </span>
                  {selected.has(p.id) && (
                    <Check
                      size={17}
                      className="import-selected-mark"
                      aria-hidden="true"
                    />
                  )}
                </label>
              ))}
              {!profiles.length && (
                <p className="import-empty-search">
                  {t("По этому названию сборок нет.")}
                </p>
              )}
            </div>
          </>
        ) : (
          scan && (
            <div className="modrinth-empty">
              <FolderOpen size={30} />
              <b>{t("Сборки пока не найдены")}</b>
              <p>
                {t(
                  "Если данные Modrinth лежат в другом месте, укажите его папку данных или папку profiles.",
                )}
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void chooseFolder()}
              >
                <FolderOpen size={16} />
                {t(" Выбрать папку Modrinth")}
              </button>
            </div>
          )
        )}
        {scan && (scan.directories.length > 0 || scan.warnings.length > 0) && (
          <details className="import-locations">
            <summary>{t("Папки и результаты поиска")}</summary>
            {scan.directories.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {scan.warnings.map((w) => (
              <p className="import-warning" key={w}>
                {w}
              </p>
            ))}
          </details>
        )}
        {result && (
          <div
            className={`import-result ${result.failed.length ? "has-errors" : ""}`}
            role="status"
          >
            <b>
              {result.cancelled ? t("Импорт остановлен") : t("Импорт завершён")}
              {t(" \u00B7 добавлено: ")}
              {result.imported.length}
            </b>
            {result.imported.map((p) => (
              <p key={p.id}>
                <Check size={14} /> {p.name}
              </p>
            ))}
            {result.failed.map((p, i) => (
              <p className="import-warning" key={`${p.name}-${i}`}>
                <X size={14} /> {p.name}: {p.message}
              </p>
            ))}
            {result.cancelled && (
              <p>
                {t(
                  "Уже перенесённые сборки сохранены. Остальные можно импортировать позже.",
                )}
              </p>
            )}
          </div>
        )}
        <div className="import-preservation">
          <ShieldCheck size={17} />
          <span>
            {t(
              "Создаём отдельные копии. Ваши сборки в Modrinth останутся на месте.",
            )}
          </span>
        </div>
      </div>
      <div className="modal-actions import-modal-actions">
        {importing && (
          <div className="import-live" role="status">
            <Loading label={progress?.message || t("Переносим сборки\u2026")} />
            {progress && progress.total > 0 && (
              <>
                <progress max={progress.total} value={progress.done} />
                <div className="progress-meta">
                  <span>{progressAmount(progress)}</span>
                  <span>{Math.round((progress.done / progress.total) * 100)}%</span>
                </div>
              </>
            )}
          </div>
        )}
        <span>
          {selected.size
            ? t("Выбрано: {{v1}}", { v1: selected.size })
            : t("Выберите одну или несколько сборок")}
        </span>
        {importing ? (
          <button
            className="button secondary"
            onClick={() => {
              if (progress)
                void rpc("cancel", { operationId: progress.id }).catch(
                  (e: Error) => setError(e.message),
                );
            }}
          >
            {t("Остановить импорт")}
          </button>
        ) : (
          <>
            <button className="button secondary" onClick={onClose}>
              {result ? t("К сборкам") : t("Отмена")}
            </button>
            {(!result || selected.size > 0) && (
              <button
                className="button primary"
                disabled={busy || loading || !selected.size}
                onClick={() => void submit()}
              >
                <Download size={16} />
                {t(" Импортировать")}
                {selected.size > 0 && ` · ${selected.size}`}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
