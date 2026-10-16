import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownAZ,
  ChevronDown,
  Compass,
  Download,
  ExternalLink,
  FileInput,
  ListFilter,
  LoaderCircle,
  Package,
  Puzzle,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { contentVersion } from "../lib/content-version";
import { t, ru } from "../lib/i18n";
import type { Content, ContentUpdate, Kind, Profile, Project } from "../types";
import { ProjectDialog } from "../screens/Catalog";
import { EmptyState, ErrorBox, Loading } from "./ui";
import { Select } from "./Select";

function ContentIcon({ item }: { item: Content }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.icon]);
  const src =
    item.icon?.startsWith("https://") ||
    /^data:image\/(png|jpeg|webp);base64,/.test(item.icon || "")
      ? item.icon
      : null;
  return (
    <span className="installed-project-icon">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : item.kind === "mod" ? (
        <Puzzle size={23} />
      ) : (
        <Package size={23} />
      )}
    </span>
  );
}

export function InstanceContent({
  profile,
  onFindProjects,
}: {
  profile: Profile;
  onFindProjects: (profile: Profile, kind: Kind) => void;
}) {
  const { busy, run, operation, notify, data } = useApp();
  const [content, setContent] = useState<Content[]>([]);
  const [updates, setUpdates] = useState<ContentUpdate[]>([]);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [author, setAuthor] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedKey, setLoadedKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [checkTick, setCheckTick] = useState(0);
  const [project, setProject] = useState<Project | null>(null);
  const running = data.running.includes(profile.id);
  const filterCount = [status, source, author].filter(
    (v) => v !== "all",
  ).length;
  const updateMap = useMemo(
    () => new Map(updates.map((u) => [u.contentId, u])),
    [updates],
  );
  const authors = useMemo(
    () =>
      [...new Set(content.map((c) => c.author || "").filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [content],
  );
  const visible = useMemo(
    () =>
      content
        .filter(
          (c) =>
            (kind === "all" || c.kind === kind) &&
            `${c.name} ${c.filename} ${c.author || ""} ${c.versionName || ""}`
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()) &&
            (source === "all" || c.source === source) &&
            (author === "all" || c.author === author) &&
            (status === "all" ||
              (status === "enabled" && c.enabled) ||
              (status === "disabled" && !c.enabled) ||
              (status === "updates" && updateMap.has(c.id))),
        )
        .sort((a, b) =>
          sort === "newest"
            ? (b.modifiedAt || 0) - (a.modifiedAt || 0) ||
              a.name.localeCompare(b.name)
            : sort === "oldest"
              ? (a.modifiedAt || 0) - (b.modifiedAt || 0) ||
                a.name.localeCompare(b.name)
              : sort === "reverse"
                ? b.name.localeCompare(a.name)
                : a.name.localeCompare(b.name),
        ),
    [content, kind, search, sort, source, author, status, updateMap],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    rpc("content", { id: profile.id })
      .then((items) => {
        if (live) {
          setContent(items);
          setLoadedKey(`${profile.id}:${revision}`);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [profile.id, revision]);

  useEffect(() => {
    if (loading || busy || loadedKey !== `${profile.id}:${revision}`) return;
    let live = true;
    setChecking(true);
    rpc("inspectContent", { id: profile.id })
      .then((result) => {
        if (live) {
          setContent(result.content);
          setUpdates(result.updates);
          setWarnings(result.warnings);
        }
      })
      .catch((e) => {
        if (live) {
          setUpdates([]);
          setWarnings([e.message]);
        }
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
      setChecking(false);
    };
  }, [
    profile.id,
    profile.minecraft,
    profile.loader,
    loading,
    loadedKey,
    busy,
    revision,
    checkTick,
  ]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setCheckTick((v) => v + 1),
      5 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [profile.id]);

  const manage = async (item: Content, action: "toggle" | "remove") => {
    setActionError("");
    await run(
      () =>
        rpc("manageContent", { id: profile.id, contentId: item.id, action }),
      action === "remove" ? t("Файл перемещён в корзину") : undefined,
    );
    setRevision((v) => v + 1);
  };
  const updateOne = async (item: Content) => {
    setActionError("");
    await operation(
      (operationId) =>
        rpc("updateContent", {
          id: profile.id,
          contentId: item.id,
          operationId,
        }),
      t("Контент обновлён"),
    );
    setRevision((v) => v + 1);
  };
  const updateAll = async () => {
    setActionError("");
    const result = await operation((operationId) =>
      rpc("updateAllContent", {
        id: profile.id,
        contentIds: updates.map((u) => u.contentId),
        operationId,
      }),
    );
    if (result) {
      notify(
        result.cancelled
          ? t("Обновление отменено · обновлено: {{v1}}", { v1: result.updated })
          : t("Обновлено проектов: {{v1}}", { v1: result.updated }),
      );
      setActionError(
        result.failed.map((f) => `${f.name}: ${f.message}`).join("\n"),
      );
    }
    setRevision((v) => v + 1);
  };
  const openProject = (item: Content) =>
    setProject({
      id: item.projectId,
      source: item.source as Project["source"],
      title: item.name,
      description: "",
      author: item.author || "",
      icon: item.icon || null,
      downloads: 0,
      kind: item.kind,
    });
  const clearFilters = () => {
    setStatus("all");
    setSource("all");
    setAuthor("all");
    setSearch("");
    setKind("all");
  };

  return (
    <div className="instance-content-manager">
      <div className="installed-content-searchbar">
        <div className="input-icon">
          <Compass size={17} />
          <input
            aria-label={t("Поиск в сборке")}
            placeholder={t("Найти мод, автора или файл")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="installed-sort">
          <ArrowDownAZ size={16} />
          <Select
            value={sort}
            onValueChange={setSort}
            aria-label={t("Сортировка контента")}
            options={[
              { value: "name", label: t("Название (А–Я)") },
              { value: "reverse", label: t("Название (Я–А)") },
              { value: "newest", label: t("Сначала новые") },
              { value: "oldest", label: t("Сначала старые") },
            ]}
          />
        </div>
        <button
          className={`button secondary content-filter-button ${filterCount ? "has-filters" : ""}`}
          aria-expanded={filtersOpen}
          aria-controls="installed-content-filters"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <ListFilter size={17} />
          {t("Фильтр")}
          {filterCount > 0 && <span>{filterCount}</span>}
          <ChevronDown size={14} />
        </button>
        <button
          className="button primary content-find-button"
          onClick={() => onFindProjects(profile, kind === "all" ? "mod" : kind)}
        >
          <Compass size={17} />
          {t("Найти проекты")}
        </button>
      </div>
      {filtersOpen && (
        <div
          className="installed-content-filters"
          id="installed-content-filters"
        >
          <label>
            <span>{t("Состояние")}</span>
            <Select
              value={status}
              onValueChange={setStatus}
              aria-label={t("Состояние контента")}
              options={[
                { value: "all", label: t("Любое состояние") },
                { value: "enabled", label: t("Включённые") },
                { value: "disabled", label: t("Отключённые") },
                { value: "updates", label: t("С обновлениями") },
              ]}
            />
          </label>
          <label>
            <span>{t("Источник")}</span>
            <Select
              value={source}
              onValueChange={setSource}
              aria-label={t("Источник контента")}
              options={[
                { value: "all", label: t("Все источники") },
                { value: "modrinth", label: "Modrinth" },
                { value: "curseforge", label: "CurseForge" },
                { value: "local", label: t("Локальные файлы") },
              ]}
            />
          </label>
          <label>
            <span>{t("Автор")}</span>
            <Select
              value={author}
              onValueChange={setAuthor}
              aria-label={t("Автор контента")}
              options={[
                { value: "all", label: t("Все авторы") },
                ...authors.map((name) => ({ value: name, label: name })),
              ]}
            />
          </label>
          <button className="text-button" onClick={clearFilters}>
            <X size={15} />
            {t("Сбросить")}
          </button>
        </div>
      )}
      <div className="installed-content-toolbar">
        <div className="chips">
          {(["all", "mod", "shader", "resourcepack"] as const).map((k) => (
            <button
              key={k}
              className={kind === k ? "active" : ""}
              onClick={() => setKind(k)}
            >
              {k === "all" ? t("Всё") : ru.kinds[k]}
            </button>
          ))}
        </div>
        <div className="installed-toolbar-actions">
          <button
            className={`button secondary content-update-all ${updates.length ? "available" : ""}`}
            disabled={busy || running || checking || !updates.length}
            onClick={() => void updateAll()}
          >
            <Download size={16} />
            {t("Обновить всё")}
            {updates.length > 0 && (
              <span className="content-update-count">{updates.length}</span>
            )}
          </button>
          <button
            className="icon-button content-recheck"
            title={t("Проверить обновления")}
            aria-label={t("Проверить обновления")}
            disabled={busy || checking}
            onClick={() => setCheckTick((v) => v + 1)}
          >
            <RefreshCw size={17} className={checking ? "spin" : ""} />
          </button>
          <button
            className="text-button"
            disabled={busy || running}
            onClick={async () => {
              await run(() =>
                rpc("importContent", {
                  id: profile.id,
                  kind: kind === "all" ? "mod" : kind,
                }),
              );
              setRevision((v) => v + 1);
            }}
          >
            <FileInput size={16} />
            {t("Добавить файл")}
          </button>
        </div>
      </div>
      <div className="installed-content-summary" role="status">
        <span>
          {t("Показано {{v1}} из {{v2}}", {
            v1: visible.length,
            v2: content.length,
          })}
        </span>
        <span
          className={warnings.length ? "content-check-warning" : ""}
          title={warnings.join("\n")}
        >
          {checking ? (
            <>
              <LoaderCircle size={13} className="spin" />
              {t("Проверяем обновления…")}
            </>
          ) : warnings.length ? (
            t("Обновления проверены не полностью")
          ) : updates.length ? (
            t("Доступно обновлений: {{v1}}", { v1: updates.length })
          ) : content.some((c) => c.source !== "local") ? (
            t("Совместимых обновлений нет")
          ) : (
            t("Локальные файлы")
          )}
        </span>
      </div>
      {loading && !loadedKey.startsWith(`${profile.id}:`) ? (
        <Loading />
      ) : visible.length ? (
        <div
          className="installed-content-table"
          role="table"
          aria-label={t("Установленный контент")}
        >
          <div className="installed-content-head" role="row">
            <span role="columnheader">{t("Проект")}</span>
            <span role="columnheader">{t("Версия")}</span>
            <span role="columnheader">{t("Действия")}</span>
          </div>
          {visible.map((item) => {
            const update = updateMap.get(item.id);
            const linked = item.source !== "local" && !!item.projectId;
            return (
              <div
                className={`installed-content-row ${item.enabled ? "" : "is-disabled"}`}
                role="row"
                key={item.id}
              >
                <div className="installed-content-project" role="cell">
                  <ContentIcon item={item} />
                  <div>
                    {linked ? (
                      <button
                        className="installed-project-name"
                        onClick={() => openProject(item)}
                        title={t("Открыть страницу {{v1}}", { v1: item.name })}
                      >
                        {item.name}
                        <ExternalLink size={12} />
                      </button>
                    ) : (
                      <b className="installed-project-name" title={item.name}>
                        {item.name}
                      </b>
                    )}
                    <small>
                      {item.author ||
                        (linked
                          ? item.source === "modrinth"
                            ? "Modrinth"
                            : "CurseForge"
                          : t("Локальный файл"))}
                      {!item.enabled && (
                        <span className="content-disabled-label">
                          {" "}
                          · {t("Отключён")}
                        </span>
                      )}
                    </small>
                  </div>
                </div>
                <div
                  className="installed-content-version"
                  role="cell"
                  title={`${item.versionName || t("Версия неизвестна")}\n${item.filename}`}
                >
                  <div className="installed-version-values">
                    <b>
                      {contentVersion(item.versionName, profile.minecraft) ||
                        t("Версия неизвестна")}
                    </b>
                    {update && (
                      <button
                        className="content-version-update"
                        disabled={busy || running}
                        onClick={() => void updateOne(item)}
                        title={t("Обновить до {{v1}}", {
                          v1: update.versionName,
                        })}
                      >
                        <span aria-hidden="true">→</span>
                        {contentVersion(update.versionName, profile.minecraft)}
                      </button>
                    )}
                  </div>
                </div>
                <div className="installed-content-actions" role="cell">
                  <span className="content-update-slot">
                    {update && (
                      <button
                        className="icon-button content-update-one"
                        aria-label={t("Обновить {{v1}}", { v1: item.name })}
                        title={t("Обновить до {{v1}}", {
                          v1: update.versionName,
                        })}
                        disabled={busy || running}
                        onClick={() => void updateOne(item)}
                      >
                        <Download size={19} />
                      </button>
                    )}
                  </span>
                  <button
                    className="content-enabled-switch"
                    role="switch"
                    aria-checked={item.enabled}
                    aria-label={`${item.enabled ? t("Отключить") : t("Включить")} ${item.name}`}
                    title={item.enabled ? t("Отключить") : t("Включить")}
                    disabled={busy || running}
                    onClick={() => void manage(item, "toggle")}
                  >
                    <span />
                  </button>
                  <button
                    className="icon-button content-delete"
                    aria-label={t("Удалить {{v1}}", { v1: item.name })}
                    title={t("Переместить в корзину")}
                    disabled={busy || running}
                    onClick={() => void manage(item, "remove")}
                  >
                    <Trash2 size={19} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Puzzle size={27} />}
          title={
            content.length
              ? t("Ничего не найдено")
              : t("Нет установленных проектов")
          }
          text={
            content.length
              ? t("Измените поиск или фильтры.")
              : t("Добавьте моды, шейдеры или ресурспаки.")
          }
        >
          {content.length > 0 && (
            <button className="button secondary" onClick={clearFilters}>
              {t("Сбросить фильтры")}
            </button>
          )}
        </EmptyState>
      )}
      {content.some((c) => c.source === "local") && (
        <p className="installed-content-note">
          {t(
            "Файлы без страницы проекта можно включать и удалять. Для автоматических обновлений нужен проект в каталоге.",
          )}
        </p>
      )}
      {(error || actionError) && <ErrorBox error={error || actionError} />}
      {project && (
        <ProjectDialog
          project={project}
          initialProfileId={profile.id}
          onClose={() => setProject(null)}
          onInstalled={(profileId) => {
            if (profileId === profile.id) setRevision((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
