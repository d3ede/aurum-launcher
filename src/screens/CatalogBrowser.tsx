import { t, formatCount } from "../lib/i18n";
import { useEffect, useState } from "react";
import {
  Search,
  Download,
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  Compass,
  LayoutGrid,
  List,
} from "lucide-react";
import { useApp } from "../context";
import { native, rpc } from "../lib/api";
import { ru, formatNumber } from "../lib/i18n";
import type {
  CatalogSource,
  CatalogTarget,
  Kind,
  Project,
  SearchQuery,
} from "../types";
import {
  searchAllSources,
  type CatalogSearchSource,
} from "../lib/catalog-search";
import { catalogSources, packSource } from "../lib/catalog-sources";
import { ProjectIcon } from "./Catalog";
import { Select } from "../components/Select";
import { EmptyState, ErrorBox, Loading } from "../components/ui";
import { CatalogSourceLogo } from "../components/CatalogSourceLogo";
import { CatalogInstallButton } from "../components/CatalogInstallButton";
import { categoryKey } from "../lib/catalog-categories";
export function Catalog({
  query,
  setQuery,
  onProject,
  target,
  setTarget,
}: {
  query: string;
  setQuery: (v: string) => void;
  onProject: (p: Project) => void;
  target: CatalogTarget;
  setTarget: (v: CatalogTarget) => void;
}) {
  const { data, operation, run, busy } = useApp();
  const [pending, setPending] = useState<{
    projectId: string;
    source: string;
    profileId: string;
    action: "installing" | "removing";
  } | null>(null);
  const [source, setSource] = useState<CatalogSearchSource>("modrinth");
  const packsOnly = packSource(source);
  const [view, setView] = useState<"list" | "grid">(() =>
    localStorage.getItem("aurum:catalog-view") === "grid" ? "grid" : "list",
  );
  const changeView = (value: "list" | "grid") => {
    setView(value);
    localStorage.setItem("aurum:catalog-view", value);
  };
  const kind = packsOnly ? "modpack" : target.kind;
  const profile = data.profiles.find((p) => p.id === target.profileId);
  const bound = !!profile && kind !== "modpack";
  const needsLoader = bound && kind === "mod" && profile.loader === "vanilla";
  const [mc, setMc] = useState(profile?.minecraft || "");
  const [loader, setLoader] = useState(
    profile?.loader === "vanilla" ? "" : profile?.loader || "",
  );
  const [sort, setSort] = useState("downloads");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<
    {
      id: string;
      name: string;
    }[]
  >([]);
  const [versions, setVersions] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [failedSources, setFailedSources] = useState<CatalogSource[]>([]);
  const [error, setError] = useState("");
  const [filterError, setFilterError] = useState("");
  const [loading, setLoading] = useState(native);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setMc(profile?.minecraft || "");
    setLoader(profile?.loader === "vanilla" ? "" : profile?.loader || "");
  }, [profile?.id, profile?.minecraft, profile?.loader]);
  useEffect(() => {
    if (!native) return;
    let live = true;
    rpc("versions", {})
      .then((v) => {
        if (live)
          setVersions(
            v.versions
              .filter(
                (v) => v.type === "release" || data.settings.showSnapshots,
              )
              .map((v) => v.id),
          );
      })
      .catch((e) => {
        if (live) setFilterError(e.message);
      });
    return () => {
      live = false;
    };
  }, [data.settings.showSnapshots, retry]);
  useEffect(() => {
    setCategory("");
    setCategories([]);
    setFilterError("");
    if (!native || packsOnly || source === "all") return;
    let live = true;
    rpc("catalogCategories", { source, kind })
      .then((v) => {
        if (live) {
          setCategories(v);
          setFilterError("");
        }
      })
      .catch((e) => {
        if (live) setFilterError(e.message);
      });
    return () => {
      live = false;
    };
  }, [source, kind, data.curseforgeConfigured, retry]);
  useEffect(() => {
    setOffset(0);
  }, [query, source, kind, mc, loader, category, sort, profile?.id]);
  const effectiveMc = bound ? profile.minecraft : mc;
  const effectiveLoader =
    kind === "mod" ? (bound ? profile.loader : loader) : "";
  useEffect(() => {
    if (!native || needsLoader) return;
    let live = true;
    setLoading(true);
    const timer = setTimeout(
      () => {
        setError("");
        setFailedSources([]);
        const request: Omit<SearchQuery, "source"> = {
          query,
          kind,
          minecraft: effectiveMc || null,
          loader: effectiveLoader || null,
          category: category || null,
          sort,
          offset,
        };
        const work =
          source === "all"
            ? searchAllSources(request, (query) => rpc("search", { query }))
            : rpc("search", { query: { ...request, source } }).then(
                (result) => ({
                  ...result,
                  hasMore: offset + 24 < result.total,
                  failed: [] as CatalogSource[],
                  allFailed: false,
                }),
              );
        work
          .then((r) => {
            if (!live) return;
            setResults(r.projects);
            setTotal(r.total);
            setHasMore(r.hasMore);
            setFailedSources(r.failed);
            if (r.allFailed)
              setError(t("Не удалось загрузить каталоги. Повторите попытку."));
          })
          .catch((e) => {
            if (live) {
              setError(e.message);
              setResults([]);
            }
          })
          .finally(() => {
            if (live) setLoading(false);
          });
      },
      source === "all" ? 400 : 250,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    query,
    source,
    kind,
    effectiveMc,
    effectiveLoader,
    category,
    sort,
    offset,
    retry,
    data.curseforgeConfigured,
    needsLoader,
  ]);
  const install = async (project: Project) => {
    if (!profile || busy || data.running.includes(profile.id)) return;
    setPending({
      projectId: project.id,
      source: project.source,
      profileId: profile.id,
      action: "installing",
    });
    try {
      await operation(
        async (operationId) => {
          const detail = await rpc("project", {
            source: project.source,
            id: project.id,
            minecraft: profile.minecraft,
            ...(kind === "mod" ? { loader: profile.loader } : {}),
          });
          const version = detail.versions[0];
          if (!version)
            throw new Error(
              t("Для этой сборки нет совместимой версии проекта"),
            );
          await rpc("installContent", {
            id: profile.id,
            source: project.source,
            projectId: project.id,
            versionId: version.id,
            operationId,
          });
        },
        t("{{name}} установлен в {{profile}}", {
          name: project.title,
          profile: profile.name,
        }),
      );
    } finally {
      setPending(null);
    }
  };
  const remove = async (project: Project, contentId: string) => {
    if (!profile || busy || data.running.includes(profile.id)) return;
    setPending({
      projectId: project.id,
      source: project.source,
      profileId: profile.id,
      action: "removing",
    });
    try {
      await run(
        () =>
          rpc("manageContent", { id: profile.id, contentId, action: "remove" }),
        t("Файл перемещён в корзину"),
      );
    } finally {
      setPending(null);
    }
  };
  const reset = () => {
    setQuery("");
    setCategory("");
    setMc("");
    setLoader("");
    setSort(
      source === "atlauncher"
        ? "name"
        : source === "technic" || source === "all"
          ? "relevance"
          : "downloads",
    );
  };
  return (
    <>
      <div className="page-heading">
        <h1>{t("Каталог проектов")}</h1>
      </div>
      {!packsOnly && (
        <div className="catalog-context">
          <label htmlFor="catalog-target">{t("Установить в")}</label>
          <Select
            id="catalog-target"
            aria-label={t("Установить в")}
            value={target.profileId}
            onValueChange={(profileId) => setTarget({ ...target, profileId })}
            options={[
              { value: "", label: t("Без привязки к сборке") },
              ...data.profiles.map((p) => ({
                value: p.id,
                label: `${p.name} · ${p.minecraft} · ${ru.loaders[p.loader]}`,
              })),
            ]}
          />
          {bound && <span>{t("Только совместимые проекты")}</span>}
        </div>
      )}
      {packsOnly && (
        <p className="catalog-provider-note">
          {t(
            "Сборки {{source}} устанавливаются как отдельные профили. Вход для публичного каталога не нужен.",
            {
              source:
                source === "all" ? t("Все источники") : catalogSources[source],
            },
          )}
        </p>
      )}
      <div className="catalog-workspace">
        <section className="catalog-results">
          <div className="catalog-results-toolbar">
            <div className="input-icon">
              <Search size={19} />
              <input
                aria-label={t("Поиск проектов")}
                placeholder={t("Поиск модов, сборок и ресурспаков")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label={t("Очистить поиск")}
                  onClick={() => setQuery("")}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <Select
              aria-label={t("Сортировка проектов")}
              value={sort}
              onValueChange={setSort}
              options={
                source === "all"
                  ? [{ value: "relevance", label: t("По соответствию") }]
                  : [
                      { value: "downloads", label: t("По загрузкам") },
                      ...(source === "modrinth" || source === "technic"
                        ? [{ value: "relevance", label: t("По соответствию") }]
                        : []),
                      ...(source !== "technic"
                        ? [
                            {
                              value: "updated",
                              label: t("Недавно обновлённые"),
                            },
                            { value: "newest", label: t("Новые проекты") },
                          ]
                        : []),
                      ...(source === "atlauncher"
                        ? [{ value: "name", label: t("По названию") }]
                        : []),
                    ].filter(
                      (o) =>
                        (source !== "atlauncher" && source !== "technic") ||
                        o.value !== "downloads",
                    )
              }
            />
            <div
              className="catalog-view-switch"
              role="group"
              aria-label={t("Вид каталога")}
            >
              <button
                type="button"
                aria-label={t("Список")}
                title={t("Список")}
                aria-pressed={view === "list"}
                className={view === "list" ? "selected" : ""}
                onClick={() => changeView("list")}
              >
                <List size={18} />
              </button>
              <button
                type="button"
                aria-label={t("Плитки")}
                title={t("Плитки")}
                aria-pressed={view === "grid"}
                className={view === "grid" ? "selected" : ""}
                onClick={() => changeView("grid")}
              >
                <LayoutGrid size={18} />
              </button>
            </div>
          </div>
          {source === "all" &&
            failedSources.length > 0 &&
            !error &&
            !loading && (
              <div className="catalog-source-warning" role="status">
                <span>
                  {t(
                    "Недоступны: {{sources}}. Показаны результаты остальных источников.",
                    {
                      sources: failedSources
                        .map((s) => catalogSources[s])
                        .join(", "),
                    },
                  )}
                </span>
                <button
                  className="text-button"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  {t("Попробовать снова ")}
                </button>
              </div>
            )}
          {!native ? (
            <EmptyState
              icon={<Compass size={30} />}
              title={t("Каталог ждёт в desktop-приложении")}
              text={t("Поиск и установка доступны в Aurum.")}
            />
          ) : needsLoader ? (
            <EmptyState
              icon={<Compass size={30} />}
              title={t("Для модов нужен загрузчик")}
              text={t(
                "Создайте сборку с Fabric, Forge, NeoForge или Quilt. В Vanilla можно добавить ресурспаки.",
              )}
            >
              <button
                className="button secondary"
                onClick={() => setTarget({ ...target, kind: "resourcepack" })}
              >
                {t("Найти ресурспаки")}
              </button>
            </EmptyState>
          ) : loading ? (
            <Loading
              label={t("Поиск в {{v1}}\u2026", {
                v1:
                  source === "all"
                    ? t("Все источники")
                    : catalogSources[source],
              })}
            />
          ) : error ? (
            <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
          ) : results.length ? (
            <>
              <div className="result-summary">
                <span>{formatCount(total)}</span>
              </div>
              <div
                className={`catalog-result-list ${view === "grid" ? "catalog-result-grid" : ""}`}
              >
                {results.map((project) => {
                  const installed = bound
                    ? profile.content.find(
                        (c) =>
                          c.source === project.source &&
                          c.projectId === project.id,
                      )
                    : undefined;
                  const action =
                    pending?.projectId === project.id &&
                    pending.source === project.source &&
                    pending.profileId === profile?.id
                      ? pending.action
                      : installed
                        ? "installed"
                        : "available";
                  return (
                    <article
                      className="catalog-result"
                      key={`${project.source}:${project.id}`}
                    >
                      <button
                        className="catalog-card"
                        onClick={() => onProject(project)}
                      >
                        <span className="catalog-project-artwork">
                          <ProjectIcon project={project} />
                          {source === "all" && (
                            <span
                              className="catalog-project-source"
                              role="img"
                              aria-label={t("Источник: {{name}}", {
                                name:
                                  catalogSources[
                                    project.source as CatalogSource
                                  ] || project.source,
                              })}
                              title={
                                catalogSources[
                                  project.source as CatalogSource
                                ] || project.source
                              }
                            >
                              <CatalogSourceLogo
                                source={project.source}
                                size={16}
                              />
                            </span>
                          )}
                        </span>
                        <div>
                          <div className="catalog-project-heading">
                            <h3>{project.title}</h3>
                            {project.author && (
                              <span>
                                {t("от {{author}}", { author: project.author })}
                              </span>
                            )}
                          </div>
                          <p>{project.description}</p>
                          {project.downloads > 0 && (
                            <small>
                              <Download size={14} />{" "}
                              {formatNumber(project.downloads)}
                            </small>
                          )}
                        </div>
                      </button>
                      <CatalogInstallButton
                        state={action}
                        title={project.title}
                        disabled={
                          busy || (bound && data.running.includes(profile.id))
                        }
                        onClick={() => {
                          if (!bound) onProject(project);
                          else if (installed)
                            void remove(project, installed.id);
                          else void install(project);
                        }}
                      />
                    </article>
                  );
                })}
              </div>
              <div className="pagination">
                <button
                  className="button secondary"
                  disabled={!offset}
                  onClick={() => setOffset((v) => Math.max(0, v - 24))}
                >
                  <ChevronLeft size={17} />
                  {t(" Назад")}
                </button>
                <span>{Math.floor(offset / 24) + 1}</span>
                <button
                  className="button secondary"
                  disabled={!hasMore}
                  onClick={() => setOffset((v) => v + 24)}
                >
                  {t("Далее ")}
                  <ChevronRight size={17} />
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Search size={30} />}
              title={t("Ничего не найдено")}
              text={t("Измените запрос или фильтры.")}
            />
          )}
        </section>
        <aside
          className="catalog-filter-panel"
          aria-label={t("Фильтры проектов")}
        >
          <div className="filter-heading">
            <b>{t("Фильтры")}</b>
            <button className="text-button" onClick={reset}>
              {t("Сбросить")}
            </button>
          </div>
          <fieldset>
            <legend>{t("Источник")}</legend>
            <Select
              className="catalog-source-select"
              aria-label={t("Источник проектов")}
              value={source}
              onValueChange={(value) => {
                setSource(value as CatalogSearchSource);
                setOffset(0);
                setResults([]);
                setCategory("");
                setMc("");
                setLoader("");
                setSort(
                  value === "atlauncher"
                    ? "name"
                    : value === "technic" || value === "all"
                      ? "relevance"
                      : "downloads",
                );
                if (packSource(value))
                  setTarget({ profileId: "", kind: "modpack" });
              }}
              options={[
                ["all", t("Все источники")],
                ...Object.entries(catalogSources),
              ].map(([value, label]) => ({
                value,
                label,
                icon: <CatalogSourceLogo source={value} />,
              }))}
            />
          </fieldset>
          <fieldset>
            <legend>{t("Тип проекта")}</legend>
            <div className="filter-options">
              {Object.entries(ru.kinds)
                .filter(([value]) => !packsOnly || value === "modpack")
                .map(([value, label]) => (
                  <button
                    key={value}
                    className={kind === value ? "selected" : ""}
                    aria-pressed={kind === value}
                    onClick={() =>
                      setTarget({ ...target, kind: value as Kind })
                    }
                  >
                    <span className="filter-check">
                      {kind === value && <Check size={13} />}
                    </span>
                    {label}
                  </button>
                ))}
            </div>
          </fieldset>
          {source !== "technic" && (
            <fieldset>
              <legend>{t("Версия Minecraft")}</legend>
              <Select
                aria-label={t("Фильтр версии Minecraft")}
                value={effectiveMc}
                disabled={bound}
                onValueChange={setMc}
                options={[
                  { value: "", label: t("Все версии") },
                  ...[...new Set([effectiveMc, ...versions])]
                    .filter(Boolean)
                    .map((v) => ({ value: v, label: v })),
                ]}
              />
            </fieldset>
          )}
          {source === "all" && kind === "modpack" && effectiveMc && (
            <p className="catalog-filter-note">
              {t(
                "Technic не поддерживает фильтр версии Minecraft и не включён в этот поиск.",
              )}
            </p>
          )}
          {kind === "mod" && (
            <fieldset>
              <legend>{t("Загрузчик")}</legend>
              <Select
                aria-label={t("Фильтр загрузчика")}
                value={effectiveLoader}
                disabled={bound}
                onValueChange={setLoader}
                options={[
                  { value: "", label: t("Все загрузчики") },
                  ...Object.entries(ru.loaders)
                    .filter(([value]) => value !== "vanilla" || bound)
                    .map(([value, label]) => ({ value, label })),
                ]}
              />
            </fieldset>
          )}
          {!packsOnly && source !== "all" && (
            <fieldset>
              <legend>{t("Категория")}</legend>
              <Select
                aria-label={t("Категория проекта")}
                value={category}
                disabled={!categories.length}
                onValueChange={setCategory}
                options={[
                  { value: "", label: t("Все категории") },
                  ...categories.map((c) => ({
                    value: c.id,
                    label: t(categoryKey(c.name)),
                  })),
                ]}
              />
            </fieldset>
          )}
          {filterError && (
            <div className="filter-error" role="alert">
              {filterError}
              <button
                className="text-button"
                onClick={() => setRetry((v) => v + 1)}
              >
                {t("Повторить")}
              </button>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
