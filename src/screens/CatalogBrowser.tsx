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
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
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
    void operation(async (operationId) => {
      const detail = await rpc("project", {
        source: project.source,
        id: project.id,
        minecraft: profile.minecraft,
        ...(kind === "mod" ? { loader: profile.loader } : {}),
      });
      const version = detail.versions[0];
      if (!version)
        throw new Error("Для этой сборки нет совместимой версии проекта");
      await rpc("installContent", {
        id: profile.id,
        source: project.source,
        projectId: project.id,
        versionId: version.id,
        operationId,
      });
    }, `${project.title} добавлен в ${profile.name}`);
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
        <h1>Каталог проектов</h1>
      </div>
      <div className="catalog-context">
        <label htmlFor="catalog-target">Установить в</label>
        <select
          id="catalog-target"
          value={target.profileId}
          onChange={(e) => setTarget({ ...target, profileId: e.target.value })}
        >
          <option value="">Без привязки к сборке</option>
          {data.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.minecraft} · {ru.loaders[p.loader]}
            </option>
          ))}
        </select>
        {bound && <span>Только совместимые проекты</span>}
      </div>
      <div className="catalog-workspace">
        <aside className="catalog-filter-panel" aria-label="Фильтры проектов">
          <div className="filter-heading">
            <b>Фильтры</b>
            <button className="text-button" onClick={reset}>
              Сбросить
            </button>
          </div>
          <fieldset>
            <legend>Источник</legend>
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
            <legend>Тип проекта</legend>
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
            <legend>Версия Minecraft</legend>
            <select
              aria-label="Фильтр версии Minecraft"
              value={effectiveMc}
              disabled={bound}
              onChange={(e) => setMc(e.target.value)}
            >
              <option value="">Все версии</option>
              {[...new Set([effectiveMc, ...versions])]
                .filter(Boolean)
                .map((v) => (
                  <option key={v}>{v}</option>
                ))}
            </select>
          </fieldset>
          {kind === "mod" && (
            <fieldset>
              <legend>Загрузчик</legend>
              <select
                aria-label="Фильтр загрузчика"
                value={effectiveLoader}
                disabled={bound}
                onChange={(e) => setLoader(e.target.value)}
              >
                <option value="">Все загрузчики</option>
                {Object.entries(ru.loaders)
                  .filter(([value]) => value !== "vanilla" || bound)
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </fieldset>
          )}
          <fieldset>
            <legend>Категория</legend>
            <select
              aria-label="Категория проекта"
              value={category}
              disabled={!categories.length}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Все категории</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryNames[c.name] || c.name}
                </option>
              ))}
            </select>
          </fieldset>
          {filterError && (
            <div className="filter-error" role="alert">
              {filterError}
              <button
                className="text-button"
                onClick={() => setRetry((v) => v + 1)}
              >
                Повторить
              </button>
            </div>
          )}
        </aside>
        <section className="catalog-results">
          <div className="catalog-results-toolbar">
            <div className="input-icon">
              <Search size={19} />
              <input
                aria-label="Поиск проектов"
                placeholder="Поиск модов, сборок и ресурспаков"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Очистить поиск"
                  onClick={() => setQuery("")}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <select
              aria-label="Сортировка проектов"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="downloads">По загрузкам</option>
              {source === "modrinth" && (
                <option value="relevance">По соответствию</option>
              )}
              <option value="updated">Недавно обновлённые</option>
              <option value="newest">Новые проекты</option>
            </select>
          </div>
          {!native ? (
            <EmptyState
              icon={<Compass size={30} />}
              title="Каталог ждёт в desktop-приложении"
              text="Поиск и установка доступны в Aurum."
            />
          ) : source === "curseforge" && !data.curseforgeConfigured ? (
            <EmptyState
              icon={<Compass size={30} />}
              title="Подключите CurseForge"
              text="Добавьте API-ключ в настройках интеграций."
            />
          ) : needsLoader ? (
            <EmptyState
              icon={<Compass size={30} />}
              title="Для модов нужен загрузчик"
              text="Создайте сборку с Fabric, Forge, NeoForge или Quilt. В Vanilla можно добавить ресурспаки."
            >
              <button
                className="button secondary"
                onClick={() => setTarget({ ...target, kind: "resourcepack" })}
              >
                Найти ресурспаки
              </button>
            </EmptyState>
          ) : loading ? (
            <Loading
              label={`Поиск в ${source === "modrinth" ? "Modrinth" : "CurseForge"}…`}
            />
          ) : error ? (
            <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
          ) : results.length ? (
            <>
              <div className="result-summary">
                <span>{formatNumber(total)} проектов</span>
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
                          {installed ? "Добавлено" : "Добавить"}
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
                  <ChevronLeft size={17} /> Назад
                </button>
                <span>{Math.floor(offset / 24) + 1}</span>
                <button
                  className="button secondary"
                  disabled={offset + 24 >= total}
                  onClick={() => setOffset((v) => v + 24)}
                >
                  Далее <ChevronRight size={17} />
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Search size={30} />}
              title="Ничего не найдено"
              text="Измените запрос или фильтры."
            />
          )}
        </section>
      </div>
    </>
  );
}
