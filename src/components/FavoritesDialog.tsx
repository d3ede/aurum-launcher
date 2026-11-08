import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  LoaderCircle,
  RotateCcw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "../context";
import { compatible, native, rpc } from "../lib/api";
import { catalogSources, packSource } from "../lib/catalog-sources";
import {
  favoriteKey,
  runFavoriteQueue,
  useFavorites,
  type Favorite,
  type FavoriteResult,
} from "../lib/favorites";
import { ru, t, tMessage } from "../lib/i18n";
import type { Profile, Project, ProjectVersion } from "../types";
import { Select } from "./Select";
import { EmptyState, Field, Modal } from "./ui";
import {
  PlatformPackOptions,
  type PackConfiguration,
} from "./PlatformPackOptions";
import { ProjectIcon } from "../screens/Catalog";
import { NativeModNotice } from "./NativeModNotice";
import { contentReloadHint, reloadableContent } from "../lib/content-runtime";

type Plan = {
  loading: boolean;
  versions: ProjectVersion[];
  versionId: string;
  error?: string;
};
type Result = FavoriteResult | { state: "installing" };
const matchesEngine = (project: Project, profile?: Profile) =>
  !!profile &&
  (project.source === "horizon") === (profile.engine === "horizon");

function PackSettings({
  project,
  versionId,
  disabled,
  onChange,
}: {
  project: Project;
  versionId: string;
  disabled: boolean;
  onChange: (key: string, config: PackConfiguration) => void;
}) {
  const key = favoriteKey(project);
  const change = useCallback(
    (config: PackConfiguration) => onChange(key, config),
    [key, onChange],
  );
  return (
    <details className="favorite-pack-options">
      <summary>{t("Параметры установки сборки")}</summary>
      <PlatformPackOptions
        project={project}
        versionId={versionId}
        disabled={disabled}
        onChange={change}
      />
    </details>
  );
}

export function FavoritesDialog({
  initialProfileId,
  onClose,
  onProject,
  onManualFiles,
}: {
  initialProfileId?: string;
  onClose: () => void;
  onProject: (project: Project) => void;
  onManualFiles?: (profileId: string) => void;
}) {
  const { data, busy, operation, cancelOperation, notify } = useApp();
  const { items, toggle, installed, removeSelected } = useFavorites(
    data.dataDir,
  );
  const [pendingRemoval, setPendingRemoval] = useState<string[] | null>(null);
  const [profileId, setProfileId] = useState(
    initialProfileId ||
      data.profiles.find((p) => p.engine !== "horizon")?.id ||
      data.profiles[0]?.id ||
      "",
  );
  const profile = data.profiles.find((p) => p.id === profileId);
  const signature = JSON.stringify(
    items.map((item) => favoriteKey(item.project)),
  );
  const [selected, setSelected] = useState(
    () => new Set(items.map((item) => favoriteKey(item.project))),
  );
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [configs, setConfigs] = useState<Record<string, PackConfiguration>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const [stopping, setStopping] = useState(false);
  const starting = useRef(false);
  const [summary, setSummary] = useState("");
  const changeConfig = useCallback(
    (key: string, config: PackConfiguration) =>
      setConfigs((old) => ({ ...old, [key]: config })),
    [],
  );
  useEffect(() => {
    setSelected(new Set(items.map((item) => favoriteKey(item.project))));
  }, [signature]);
  useEffect(() => {
    let active = true;
    const jobs = items.map((item) => item.project);
    const initial: Record<string, Plan> = {};
    for (const project of jobs) {
      const valid =
        project.kind === "modpack" || matchesEngine(project, profile);
      initial[favoriteKey(project)] = {
        loading: valid && native,
        versions: [],
        versionId: "",
        error: !native ? t("Поиск и установка доступны в Aurum.") : undefined,
      };
    }
    setPlans(initial);
    setResults({});
    setSummary("");
    let index = 0;
    const worker = async () => {
      while (active && index < jobs.length) {
        const project = jobs[index++];
        const key = favoriteKey(project);
        if (!initial[key].loading) continue;
        try {
          const detail = await rpc("project", {
            source: project.source,
            id: project.id,
            ...(project.kind !== "modpack" && profile
              ? {
                  minecraft: profile.minecraft,
                  ...(project.kind === "mod" ? { loader: profile.loader } : {}),
                }
              : {}),
          });
          const versions = detail.versions.filter(
            (version) =>
              project.kind === "modpack" ||
              (profile && compatible(version, profile, project.kind)),
          );
          if (active)
            setPlans((old) => ({
              ...old,
              [key]: {
                loading: false,
                versions,
                versionId: versions[0]?.id || "",
                error: versions.length
                  ? undefined
                  : t("Для этой сборки нет совместимой версии проекта"),
              },
            }));
        } catch (error) {
          if (active)
            setPlans((old) => ({
              ...old,
              [key]: {
                loading: false,
                versions: [],
                versionId: "",
                error: tMessage(
                  error instanceof Error ? error.message : String(error),
                ),
              },
            }));
        }
      }
    };
    // Keep catalog preflight bounded, especially for rate-limited sources.
    void Promise.all([worker(), worker(), worker()]);
    return () => {
      active = false;
    };
  }, [
    signature,
    profile?.id,
    profile?.minecraft,
    profile?.loader,
    profile?.engine,
    retry,
  ]);

  const isInstalled = (item: Favorite) =>
    item.project.kind === "modpack"
      ? !!item.installedProfileId &&
        data.profiles.some((p) => p.id === item.installedProfileId)
      : !!profile?.content.some(
          (content) =>
            content.source === item.project.source &&
            content.projectId === item.project.id,
        );
  const configuration = (item: Favorite) => {
    const key = favoriteKey(item.project);
    const value = configs[key];
    return value?.key ===
      `${item.project.source}:${item.project.id}:${plans[key]?.versionId}`
      ? value
      : undefined;
  };
  const ready = (item: Favorite) => {
    const key = favoriteKey(item.project),
      plan = plans[key];
    return (
      !isInstalled(item) &&
      results[key]?.state !== "installed" &&
      !!plan?.versionId &&
      !plan.loading &&
      !plan.error &&
      (item.project.kind === "modpack" ||
        (matchesEngine(item.project, profile) &&
          (!data.running.includes(profileId) ||
            reloadableContent(item.project.kind)))) &&
      (!packSource(item.project.source) || configuration(item)?.ready)
    );
  };
  const checking = items.some((item) => {
    const plan = plans[favoriteKey(item.project)];
    return (
      !plan ||
      plan.loading ||
      (packSource(item.project.source) &&
        !!plan.versionId &&
        (configuration(item)?.checking ?? true))
    );
  });
  const available = items.filter(ready);
  const chosen = available.filter((item) =>
    selected.has(favoriteKey(item.project)),
  );
  const blocked = busy || working;
  const remove = (project: Project) => {
    try {
      toggle(project);
    } catch {
      notify(t("Не удалось сохранить избранное."), true);
    }
  };
  const install = async (requested: Favorite[]) => {
    if (blocked || starting.current || !requested.length) return;
    starting.current = true;
    setWorking(true);
    setStopping(false);
    setSummary("");
    const tasks = requested.filter(ready).map((item) => ({
      item,
      version: plans[favoriteKey(item.project)].versions.find(
        (v) => v.id === plans[favoriteKey(item.project)].versionId,
      )!,
      config: configuration(item)?.options,
    }));
    let completed = 0,
      failed = 0;
    try {
      const outcome = await operation(async (operationId, signal) => {
        await runFavoriteQueue(
          tasks,
          signal,
          async ({ item, version, config }) => {
            const project = item.project;
            if (signal.aborted) throw new Error(t("Операция отменена"));
            if (project.kind === "modpack") {
              const id = await rpc("downloadPack", {
                source: project.source,
                projectId: project.id,
                versionId: version.id,
                operationId,
                ...(config ? { options: config } : {}),
              });
              try {
                installed(project, id);
              } catch {
                notify(
                  t(
                    "Сборка установлена, но не удалось сохранить отметку в избранном.",
                  ),
                  true,
                );
              }
            } else {
              const current = await rpc("snapshot", {});
              const target = current.profiles.find((p) => p.id === profileId);
              if (signal.aborted) throw new Error(t("Операция отменена"));
              if (
                !target ||
                !matchesEngine(project, target) ||
                !compatible(version, target, project.kind)
              )
                throw new Error(
                  t("Для этой сборки нет совместимой версии проекта"),
                );
              if (
                current.running.includes(target.id) &&
                !reloadableContent(project.kind)
              )
                throw new Error(t("Сначала остановите эту сборку"));
              // An earlier project may already have installed this dependency.
              if (
                !target.content.some(
                  (c) =>
                    c.source === project.source && c.projectId === project.id,
                )
              )
                await rpc("installContent", {
                  id: target.id,
                  source: project.source,
                  projectId: project.id,
                  versionId: version.id,
                  operationId,
                });
            }
          },
          ({ item }, result) => {
            setResults((old) => ({
              ...old,
              [favoriteKey(item.project)]: result,
            }));
            if (result.state === "installed") completed++;
            if (result.state === "failed") failed++;
          },
        );
        return signal.aborted;
      });
      if (outcome !== undefined)
        setSummary(
          t(
            outcome
              ? "Очередь остановлена. Установлено: {{installed}}. Ошибок: {{failed}}."
              : "Установлено: {{installed}}. Ошибок: {{failed}}.",
            { installed: completed, failed },
          ),
        );
    } finally {
      starting.current = false;
      setWorking(false);
      setStopping(false);
    }
  };
  return (
    <Modal
      title={t("Избранное")}
      subtitle={t(
        "Сохранённые проекты из всех источников. После установки они останутся здесь.",
      )}
      wide
      className="favorites-dialog"
      onClose={onClose}
      closeDisabled={working}
    >
      {!items.length ? (
        <EmptyState
          icon={<Star size={32} />}
          title={t("В избранном пока пусто")}
          text={t(
            "Нажмите звёздочку у мода, модпака, шейдера или ресурспака в каталоге.",
          )}
        />
      ) : (
        <>
          {items.some((item) => item.project.kind !== "modpack") && (
            <Field label={t("Установить в сборку")}>
              <Select
                aria-label={t("Установить в сборку")}
                value={profileId}
                disabled={blocked}
                onValueChange={setProfileId}
                options={[
                  { value: "", label: t("Выберите сборку") },
                  ...data.profiles.map((p) => ({
                    value: p.id,
                    label: `${p.name} · ${p.minecraft} / ${p.engine === "horizon" ? "Horizon" : ru.loaders[p.loader]}`,
                  })),
                ]}
              />
            </Field>
          )}
          {items.some((item) => item.project.source === "horizon") && (
            <NativeModNotice />
          )}
          <div className="favorites-selection">
            <label className="checkbox-label">
              <input
                type="checkbox"
                disabled={blocked}
                checked={
                  items.length > 0 &&
                  items.every((item) => selected.has(favoriteKey(item.project)))
                }
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? new Set(items.map((item) => favoriteKey(item.project)))
                      : new Set(),
                  )
                }
              />
              {t("Выбрать все")}
            </label>
            <span>
              {t("Готово к установке: {{count}}", { count: available.length })}
            </span>
            <div className="favorites-selection-actions">
              <button
                className="text-button danger"
                disabled={blocked || !selected.size}
                onClick={() => setPendingRemoval([...selected])}
              >
                <Trash2 size={15} />
                {t("Очистить избранное")}
              </button>
              <button
                className="text-button"
                disabled={blocked || checking}
                onClick={() => setRetry((v) => v + 1)}
              >
                <RotateCcw size={15} />
                {t("Проверить снова")}
              </button>
            </div>
          </div>
          <div className="favorites-list">
            {items.map((item) => {
              const project = item.project,
                key = favoriteKey(project),
                plan = plans[key],
                result = results[key];
              const done = result?.state === "installed" || isInstalled(item);
              const manualProfile =
                project.kind === "modpack" && item.installedProfileId
                  ? data.profiles.find(
                      (profile) =>
                        profile.id === item.installedProfileId &&
                        profile.manualDownloads?.length,
                    )
                  : undefined;
              const status =
                result?.state === "installing"
                  ? t("Установка…")
                  : done
                    ? t(
                        manualProfile
                          ? "Установлено. Остались файлы для ручной установки."
                          : "Установлено",
                      )
                    : result?.state === "failed"
                      ? tMessage(
                          result.message || "Не удалось выполнить действие",
                        )
                      : result?.state === "cancelled"
                        ? t("Операция отменена")
                        : plan?.loading
                          ? t("Проверяем совместимость…")
                          : project.kind !== "modpack" &&
                              !matchesEngine(project, profile)
                            ? ""
                            : plan?.error ||
                              (project.kind !== "modpack" &&
                              data.running.includes(profileId) &&
                              !reloadableContent(project.kind)
                                ? t("Сначала остановите эту сборку")
                                : packSource(project.source) &&
                                    !configuration(item)?.ready
                                  ? t(
                                      "Проверьте параметры модпака и выберите обязательные файлы.",
                                    )
                                  : data.running.includes(profileId) &&
                                      reloadableContent(project.kind)
                                    ? t(contentReloadHint)
                                    : t("Готово к установке"));
              return (
                <article
                  className="favorite-row"
                  key={key}
                  data-favorite-key={key}
                >
                  <div className="favorite-row-heading">
                    <input
                      type="checkbox"
                      aria-label={t("Выбрать {{name}}", {
                        name: project.title,
                      })}
                      disabled={blocked}
                      checked={selected.has(key)}
                      onChange={(event) =>
                        setSelected((old) => {
                          const next = new Set(old);
                          if (event.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        })
                      }
                    />
                    <ProjectIcon project={project} />
                    <div className="favorite-row-title">
                      <button
                        className="text-button"
                        disabled={blocked}
                        onClick={() => onProject(project)}
                      >
                        {project.title}
                      </button>
                      <small>
                        {ru.kinds[project.kind]} ·{" "}
                        {catalogSources[project.source]}
                      </small>
                    </div>
                    {manualProfile && onManualFiles ? (
                      <button
                        className="button secondary favorite-install"
                        disabled={blocked}
                        onClick={() => onManualFiles(manualProfile.id)}
                      >
                        {t("Показать файлы")}
                      </button>
                    ) : (
                      <button
                        className="button secondary favorite-install"
                        disabled={blocked || !ready(item)}
                        aria-label={t("Установить {{name}}", {
                          name: project.title,
                        })}
                        onClick={() => void install([item])}
                      >
                        <Download size={16} />
                        {t("Установить")}
                      </button>
                    )}
                    <button
                      className="icon-button danger"
                      disabled={blocked}
                      aria-label={t("Убрать {{name}} из избранного", {
                        name: project.title,
                      })}
                      onClick={() => remove(project)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {status && (
                    <div
                      className={`favorite-status ${result?.state === "failed" ? "has-error" : ""}`}
                      role="status"
                    >
                      {result?.state === "installing" || plan?.loading ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : done ? (
                        <Check size={14} />
                      ) : null}
                      {status}
                    </div>
                  )}
                  {!!plan?.versions.length && !done && (
                    <Select
                      aria-label={t("Версия {{name}}", { name: project.title })}
                      value={plan.versionId}
                      disabled={blocked}
                      onValueChange={(versionId) => {
                        setPlans((old) => ({
                          ...old,
                          [key]: { ...old[key], versionId },
                        }));
                        setResults((old) => {
                          const next = { ...old };
                          delete next[key];
                          return next;
                        });
                      }}
                      options={plan.versions.map((version) => ({
                        value: version.id,
                        label: `${version.name} · ${version.gameVersions.join(", ")}`,
                      }))}
                    />
                  )}
                  {packSource(project.source) && plan?.versionId && !done && (
                    <PackSettings
                      key={`${key}:${plan.versionId}`}
                      project={project}
                      versionId={plan.versionId}
                      disabled={blocked}
                      onChange={changeConfig}
                    />
                  )}
                </article>
              );
            })}
          </div>
          {summary && (
            <p className="favorites-summary" role="status">
              {summary}
            </p>
          )}
          <div className="favorites-actions">
            {working ? (
              <button
                className="button secondary"
                disabled={stopping}
                onClick={() => {
                  setStopping(true);
                  void cancelOperation();
                }}
              >
                <X size={16} />
                {t(stopping ? "Останавливаем очередь…" : "Остановить очередь")}
              </button>
            ) : (
              <button
                className="button primary"
                disabled={busy || checking || !chosen.length}
                onClick={() => void install(chosen)}
              >
                <Download size={16} />
                {t("Установить выбранное · {{count}}", {
                  count: chosen.length,
                })}
              </button>
            )}
          </div>
        </>
      )}
      {pendingRemoval && (
        <Modal
          title={t("Убрать выбранные проекты из избранного?")}
          onClose={() => setPendingRemoval(null)}
        >
          <p>
            {t(
              "Выбрано проектов: {{count}}. Установленные файлы останутся на месте.",
              { count: pendingRemoval.length },
            )}
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setPendingRemoval(null)}
            >
              {t("Отмена")}
            </button>
            <button
              className="button danger"
              onClick={() => {
                try {
                  removeSelected(new Set(pendingRemoval));
                  setPendingRemoval(null);
                } catch {
                  notify(t("Не удалось сохранить избранное."), true);
                }
              }}
            >
              {t("Очистить избранное")}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
