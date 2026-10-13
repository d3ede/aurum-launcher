import { t, formatCount } from "../lib/i18n";
import { useEffect, useState } from "react";
import {
  Search,
  Download,
  Plus,
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  Compass,
} from "lucide-react";
import { useApp } from "../context";
import { native, rpc } from "../lib/api";
import { ru, formatNumber } from "../lib/i18n";
import type { CatalogTarget, Kind, Project } from "../types";
import { ProjectIcon } from "./Catalog";
import { Select } from "../components/Select";
import { EmptyState, ErrorBox, Loading } from "../components/ui";
const categoryNames: Record<string, string> = {
  adventure: "Приключения",
  decoration: "Декор",
  economy: "Экономика",
  equipment: "Снаряжение",
  food: "Еда",
  library: "Библиотеки",
  magic: "Магия",
  management: "Управление",
  minigame: "Мини-игры",
  mobs: "Мобы",
  optimization: "Оптимизация",
  social: "Общение",
  storage: "Хранение",
  technology: "Технологии",
  transportation: "Транспорт",
  utility: "Утилиты",
  worldgen: "Генерация мира",
  realistic: "Реалистичные",
  themed: "Тематические",
  "vanilla-like": "В стиле Vanilla",
  simplistic: "Минималистичные",
  fantasy: "Фэнтези",
  cartoon: "Мультяшные",
  atmosphere: "Атмосфера",
  bloom: "Свечение",
  shadows: "Тени",
  reflections: "Отражения",
  "low-end": "Для слабых ПК",
  "high-end": "Для мощных ПК",
  challenging: "Сложные",
  combat: "Сражения",
  quests: "Задания",
  lightweight: "Лёгкие",
  multiplayer: "Мультиплеер",
  audio: "Звуки",
  fonts: "Шрифты",
  gui: "Интерфейс",
  items: "Предметы",
  blocks: "Блоки",
  entities: "Существа",
  pbr: "PBR",
  potato: "Для слабых ПК",
};
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
  const { data, operation, busy } = useApp();
  const [source, setSource] = useState<"modrinth" | "curseforge">("modrinth");
  const kind = target.kind;
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
    if (!native || (source === "curseforge" && !data.curseforgeConfigured))
      return;
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
    if (
      !native ||
      needsLoader ||
      (source === "curseforge" && !data.curseforgeConfigured)
    )
      return;
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      setError("");
      rpc("search", {
        query: {
          query,
          source,
          kind,
          minecraft: effectiveMc || null,
          loader: effectiveLoader || null,
          category: category || null,
          sort,
          offset,
        },
      })
        .then((r) => {
          if (live) {
            setResults(r.projects);
            setTotal(r.total);
          }
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
    }, 250);
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
  const add = (project: Project) => {
    if (!profile) return;
    void operation(
      async (operationId) => {
        const detail = await rpc("project", {
          source: project.source,
          id: project.id,
          minecraft: profile.minecraft,
          ...(kind === "mod" ? { loader: profile.loader } : {}),
        });
        const version = detail.versions[0];
        if (!version)
          throw new Error(t("Для этой сборки нет совместимой версии проекта"));
        await rpc("installContent", {
          id: profile.id,
          source: project.source,
          projectId: project.id,
          versionId: version.id,
          operationId,
        });
      },
      t("{{v1}} добавлен в {{v2}}", { v1: project.title, v2: profile.name }),
    );
  };
  const reset = () => {
    setQuery("");
    setCategory("");
    setMc("");
    setLoader("");
    setSort("downloads");
  };
  return (
    <>
      <div className="page-heading">
        <h1>{t("Каталог проектов")}</h1>
      </div>
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
              options={[
                { value: "downloads", label: t("По загрузкам") },
                ...(source === "modrinth"
                  ? [{ value: "relevance", label: t("По соответствию") }]
                  : []),
                { value: "updated", label: t("Недавно обновлённые") },
                { value: "newest", label: t("Новые проекты") },
              ]}
            />
          </div>
          {!native ? (
            <EmptyState
              icon={<Compass size={30} />}
              title={t("Каталог ждёт в desktop-приложении")}
              text={t("Поиск и установка доступны в Aurum.")}
            />
          ) : source === "curseforge" && !data.curseforgeConfigured ? (
            <EmptyState
              icon={<Compass size={30} />}
              title={t("Подключите CurseForge")}
              text={t("Добавьте API-ключ в настройках интеграций.")}
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
                v1: source === "modrinth" ? "Modrinth" : "CurseForge",
              })}
            />
          ) : error ? (
            <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
          ) : results.length ? (
            <>
              <div className="result-summary">
                <span>{formatCount(total)}</span>
              </div>
              <div className="catalog-result-list">
                {results.map((project) => {
                  const installed = profile?.content.some(
                    (c) =>
                      c.source === project.source && c.projectId === project.id,
                  );
                  return (
                    <article
                      className="catalog-result"
                      key={`${project.source}:${project.id}`}
                    >
                      <button
                        className="catalog-card"
                        onClick={() => onProject(project)}
                      >
                        <ProjectIcon project={project} />
                        <div>
                          <h3>{project.title}</h3>
                          <p>{project.description}</p>
                          <small>
                            <Download size={14} />{" "}
                            {formatNumber(project.downloads)}
                            {project.author && <span>· {project.author}</span>}
                          </small>
                        </div>
                      </button>
                      {bound && (
                        <button
                          className={`button ${installed ? "secondary" : "primary"}`}
                          disabled={busy || installed}
                          onClick={() => add(project)}
                        >
                          {installed ? <Check size={16} /> : <Plus size={16} />}
                          {installed ? t("Добавлено") : t("Добавить")}
                        </button>
                      )}
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
                  disabled={offset + 24 >= total}
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
            <div className="source-switch">
              <button
                className={source === "modrinth" ? "active" : ""}
                onClick={() => setSource("modrinth")}
              >
                Modrinth
              </button>
              <button
                className={source === "curseforge" ? "active" : ""}
                onClick={() => {
                  setSource("curseforge");
                  if (sort === "relevance") setSort("downloads");
                }}
              >
                CurseForge
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend>{t("Тип проекта")}</legend>
            <div className="filter-options">
              {Object.entries(ru.kinds).map(([value, label]) => (
                <button
                  key={value}
                  className={kind === value ? "selected" : ""}
                  aria-pressed={kind === value}
                  onClick={() => setTarget({ ...target, kind: value as Kind })}
                >
                  <span className="filter-check">
                    {kind === value && <Check size={13} />}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
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
                  label: t(categoryNames[c.name] || c.name),
                })),
              ]}
            />
          </fieldset>
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
