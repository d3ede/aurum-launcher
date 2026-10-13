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
export function ProjectDialog({
  project,
  onClose,
  initialProfileId,
}: {
  project: Project;
  initialProfileId?: string;
  onClose: () => void;
}) {
  const { data, operation, busy, run } = useApp();
  const [profileId, setProfileId] = useState(
    initialProfileId || data.profiles[0]?.id || "",
  );
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
