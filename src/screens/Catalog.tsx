import { useEffect, useState } from "react";
import {
  Search,
  SlidersHorizontal,
  Download,
  ArrowRight,
  Compass,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  PackagePlus,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useApp } from "../context";
import { native, rpc, compatible } from "../lib/api";
import { ru, formatNumber } from "../lib/i18n";
import type { Kind, Loader, Project, ProjectDetail } from "../types";
import { Modal, Loading, ErrorBox, EmptyState, Field } from "../components/ui";
export function ProjectIcon({ project }: { project: Project }) {
  return project.icon ? (
    <img className="project-icon" src={project.icon} alt="" loading="lazy" />
  ) : (
    <div className="project-icon project-placeholder">
      <Compass size={26} />
    </div>
  );
}
export function Catalog({
  query,
  setQuery,
  onProject,
}: {
  query: string;
  setQuery: (v: string) => void;
  onProject: (p: Project) => void;
}) {
  const { data } = useApp();
  const [source, setSource] = useState<"modrinth" | "curseforge">("modrinth");
  const [kind, setKind] = useState<Kind>("mod");
  const [mc, setMc] = useState("");
  const [loader, setLoader] = useState("");
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setOffset(0);
  }, [query, source, kind, mc, loader]);
  useEffect(() => {
    if (!native) return;
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      rpc("search", {
        query: {
          query,
          source,
          kind,
          minecraft: mc || null,
          loader: loader || null,
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
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, source, kind, mc, loader, offset, retry]);
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">НОВЫЕ ВОЗМОЖНОСТИ ДЛЯ ВАШИХ МИРОВ</div>
        <h1>
          Найдите своё вдохновение<span className="heading-dot">.</span>
        </h1>
        <p>Моды, готовые сборки и маленькие детали, которые меняют всё.</p>
      </div>
      <div className="catalog-controls">
        <div className="catalog-search input-icon">
          <Search size={20} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Что добавим в ваш Minecraft?"
            aria-label="Поиск проектов"
          />
        </div>
        <div className="source-switch">
          <button
            className={source === "modrinth" ? "active" : ""}
            onClick={() => setSource("modrinth")}
          >
            <span className="source-dot modrinth" /> Modrinth
          </button>
          <button
            className={source === "curseforge" ? "active" : ""}
            onClick={() => setSource("curseforge")}
          >
            <span className="source-dot curseforge" /> CurseForge
          </button>
        </div>
      </div>
      <div className="catalog-filters">
        <div className="chips">
          {Object.entries(ru.kinds).map(([k, label]) => (
            <button
              key={k}
              className={kind === k ? "active" : ""}
              onClick={() => setKind(k as Kind)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="filter-fields">
          <SlidersHorizontal size={16} />
          <input
            value={mc}
            onChange={(e) => setMc(e.target.value)}
            placeholder="Версия Minecraft"
            aria-label="Фильтр версии Minecraft"
            list="installed-versions"
          />
          <datalist id="installed-versions">
            {[...new Set(data.profiles.map((p) => p.minecraft))].map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <select
            value={loader}
            onChange={(e) => setLoader(e.target.value)}
            aria-label="Фильтр загрузчика"
          >
            <option value="">Все загрузчики</option>
            {Object.entries(ru.loaders)
              .filter(([k]) => k !== "vanilla")
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </div>
      </div>
      {!native ? (
        <EmptyState
          icon={<Compass size={32} />}
          title="Каталог ждёт в desktop-приложении"
          text="Rust подключается к официальным API Modrinth и CurseForge. Откройте Auren через Tauri, чтобы искать и устанавливать проекты."
        />
      ) : source === "curseforge" && !data.curseforgeConfigured ? (
        <EmptyState
          icon={<ExternalLink size={30} />}
          title="Подключите CurseForge"
          text="Для официального API нужен собственный ключ. Добавьте его в настройках интеграций; он будет храниться в хранилище учётных данных ОС."
        />
      ) : loading ? (
        <div className="catalog-loading">
          <Loading
            label={`Ищем в ${source === "modrinth" ? "Modrinth" : "CurseForge"}…`}
          />
        </div>
      ) : error ? (
        <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
      ) : results.length ? (
        <>
          <div className="result-summary">
            <span>{formatNumber(total)} проектов</span>
            <span>По популярности</span>
          </div>
          <div className="catalog-grid">
            {results.map((p) => (
              <button
                className="catalog-card"
                key={`${p.source}:${p.id}`}
                onClick={() => onProject(p)}
              >
                <div className="catalog-card-head">
                  <ProjectIcon project={p} />
                  <span className="source-label">
                    {p.source === "modrinth" ? "Modrinth" : "CurseForge"}
                  </span>
                </div>
                <h3>{p.title}</h3>
                <p>{p.description}</p>
                <div className="catalog-card-bottom">
                  <span>
                    <Download size={13} /> {formatNumber(p.downloads)}
                  </span>
                  <ArrowRight size={17} />
                </div>
              </button>
            ))}
          </div>
          <div className="pagination">
            <button
              className="button secondary"
              disabled={!offset}
              onClick={() => setOffset((v) => Math.max(0, v - 24))}
            >
              <ChevronLeft size={16} /> Назад
            </button>
            <span>Страница {Math.floor(offset / 24) + 1}</span>
            <button
              className="button secondary"
              disabled={offset + 24 >= total}
              onClick={() => setOffset((v) => v + 24)}
            >
              Далее <ChevronRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <EmptyState
          icon={<Search size={30} />}
          title="Здесь пока тихо"
          text="Попробуйте другой запрос, версию игры или загрузчик."
        />
      )}
    </>
  );
}
export function ProjectDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { data, operation, busy, run } = useApp();
  const [profileId, setProfileId] = useState(data.profiles[0]?.id || "");
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [versionId, setVersionId] = useState("");
  const [tab, setTab] = useState<"description" | "gallery" | "versions">(
    "description",
  );
  const [retry, setRetry] = useState(0);
  const profile = data.profiles.find((p) => p.id === profileId);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    rpc("project", {
      source: project.source,
      id: project.id,
      ...(project.kind !== "modpack" && profile
        ? {
            minecraft: profile.minecraft,
            ...(project.kind === "mod" ? { loader: profile.loader } : {}),
          }
        : {}),
    })
      .then((d) => {
        if (live) {
          setDetail(d);
          setVersionId(d.versions[0]?.id || "");
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
  }, [
    project.id,
    project.source,
    project.kind,
    profile?.minecraft,
    profile?.loader,
    retry,
  ]);
  const selected = detail?.versions.find((v) => v.id === versionId);
  const canInstall =
    selected &&
    (project.kind === "modpack" ||
      (profile && compatible(selected, profile, project.kind)));
  const install = async () => {
    if (!selected) return;
    const ok = await operation(
      async (operationId) => {
        if (project.kind === "modpack")
          await rpc("downloadPack", {
            source: project.source,
            projectId: project.id,
            versionId,
            operationId,
          });
        else if (profile)
          await rpc("installContent", {
            id: profile.id,
            source: project.source,
            projectId: project.id,
            versionId,
            operationId,
          });
        return true;
      },
      project.kind === "modpack"
        ? "Модпак импортирован как новая сборка"
        : "Проект и необходимые зависимости установлены",
    );
    if (ok) onClose();
  };
  return (
    <Modal
      title={project.title}
      subtitle={project.description}
      wide
      onClose={onClose}
    >
      <div className="project-detail-head">
        <ProjectIcon project={project} />
        <div>
          <b>{project.author || "Проект сообщества"}</b>
          <p>
            <Download size={14} /> {formatNumber(project.downloads)} загрузок ·{" "}
            {project.source === "modrinth" ? "Modrinth" : "CurseForge"}
          </p>
        </div>
        <button
          className="text-button"
          onClick={() =>
            void run(() =>
              rpc("openUrl", {
                url:
                  detail?.url ||
                  (project.source === "modrinth"
                    ? `https://modrinth.com/project/${project.id}`
                    : `https://www.curseforge.com/minecraft`),
              }),
            )
          }
        >
          <ExternalLink size={16} /> Страница проекта
        </button>
      </div>
      {loading ? (
        <Loading label="Получаем проект и совместимые версии…" />
      ) : error ? (
        <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
      ) : (
        detail && (
          <>
            <div className="project-install">
              <div className="form-grid">
                {project.kind !== "modpack" && (
                  <Field label="Установить в сборку">
                    <select
                      value={profileId}
                      onChange={(e) => setProfileId(e.target.value)}
                    >
                      <option value="">Выберите сборку</option>
                      {data.profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.minecraft} / {ru.loaders[p.loader]}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Версия проекта">
                  <select
                    value={versionId}
                    onChange={(e) => setVersionId(e.target.value)}
                  >
                    <option value="">
                      {detail.versions.length
                        ? "Выберите версию"
                        : "Совместимых версий нет"}
                    </option>
                    {detail.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <button
                className="button primary"
                disabled={busy || !canInstall}
                onClick={() => void install()}
              >
                <PackagePlus size={16} />{" "}
                {project.kind === "modpack"
                  ? "Создать сборку из модпака"
                  : "Установить с зависимостями"}
              </button>
              {project.kind !== "modpack" && !profile && (
                <small>Сначала создайте игровую сборку.</small>
              )}
              {selected && !canInstall && profile && (
                <small>Версия не подходит для выбранной сборки.</small>
              )}
            </div>
            <div className="tabs">
              {(
                [
                  ["description", "Описание"],
                  ["gallery", `Галерея · ${detail.gallery.length}`],
                  ["versions", `Версии · ${detail.versions.length}`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={tab === id ? "active" : ""}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "description" && (
              <div className="markdown">
                <ReactMarkdown
                  components={{
                    a: ({ href, children }) => (
                      <button
                        className="inline-link"
                        onClick={() => {
                          if (href?.startsWith("https://"))
                            void run(() => rpc("openUrl", { url: href }));
                        }}
                      >
                        {children}
                      </button>
                    ),
                    img: ({ src, alt }) =>
                      src?.startsWith("https://") ? (
                        <img src={src} alt={alt || ""} loading="lazy" />
                      ) : null,
                  }}
                >
                  {detail.body || project.description}
                </ReactMarkdown>
              </div>
            )}
            {tab === "gallery" && (
              <div className="project-gallery">
                {detail.gallery.length ? (
                  detail.gallery.map((src) => (
                    <img
                      src={src}
                      alt={`Скриншот ${project.title}`}
                      key={src}
                      loading="lazy"
                    />
                  ))
                ) : (
                  <p>Автор не добавил скриншоты.</p>
                )}
              </div>
            )}
            {tab === "versions" && (
              <div className="version-list">
                {detail.versions.map((v) => (
                  <button
                    key={v.id}
                    className={versionId === v.id ? "selected" : ""}
                    onClick={() => setVersionId(v.id)}
                  >
                    <b>{v.name}</b>
                    <small>
                      {v.gameVersions.join(", ")} · {v.loaders.join(", ")}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </>
        )
      )}
    </Modal>
  );
}
