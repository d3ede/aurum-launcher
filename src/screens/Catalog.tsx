import { t } from "../lib/i18n";
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
import {
  ImageLightbox,
  ProjectDescription,
  ProjectGallery,
  safeImageUrl,
} from "../components/ProjectMedia";
import { useApp } from "../context";
import { native, rpc, compatible } from "../lib/api";
import { ru, formatNumber } from "../lib/i18n";
import type { Kind, Loader, Project, ProjectDetail } from "../types";
import { Modal, Loading, ErrorBox, EmptyState, Field } from "../components/ui";
import { Select } from "../components/Select";
import {
  catalogSources,
  catalogWebsite,
  packSource,
} from "../lib/catalog-sources";
import {
  PlatformPackOptions,
  type PackConfiguration,
} from "../components/PlatformPackOptions";
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
  const [packConfig, setPackConfig] = useState<PackConfiguration | null>(null);
  const configurationKey = `${project.source}:${project.id}:${versionId}`;
  const platformReady =
    !packSource(project.source) ||
    (packConfig?.key === configurationKey && packConfig.ready);
  const [tab, setTab] = useState<"description" | "gallery" | "versions">(
    "description",
  );
  const [retry, setRetry] = useState(0);
  const [viewer, setViewer] = useState<{
    images: string[];
    index: number;
  } | null>(null);
  const gallery = [
    ...new Set(
      (detail?.gallery || [])
        .map(safeImageUrl)
        .filter((src): src is string => !!src),
    ),
  ];
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
            ...(packSource(project.source)
              ? { options: packConfig?.options }
              : {}),
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
        ? t("Модпак импортирован как новая сборка")
        : t("Проект и необходимые зависимости установлены"),
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
      {viewer && (
        <ImageLightbox
          images={viewer.images}
          initialIndex={viewer.index}
          onClose={() => setViewer(null)}
        />
      )}
      <div className="project-detail-head">
        <ProjectIcon project={project} />
        <div>
          <b>{project.author || t("Проект сообщества")}</b>
          <p>
            <Download size={14} /> {formatNumber(project.downloads)}
            {t(" загрузок \u00B7")} {catalogSources[project.source]}
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
                    : catalogWebsite(project.source)),
              }),
            )
          }
        >
          <ExternalLink size={16} />
          {t(" Страница проекта")}
        </button>
      </div>
      {loading ? (
        <Loading label={t("Получаем проект и совместимые версии\u2026")} />
      ) : error ? (
        <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
      ) : (
        detail && (
          <>
            <div className="project-install">
              <div className="form-grid">
                {project.kind !== "modpack" && (
                  <Field label={t("Установить в сборку")}>
                    <Select
                      value={profileId}
                      aria-label={t("Установить в сборку")}
                      onValueChange={setProfileId}
                      options={[
                        { value: "", label: t("Выберите сборку") },
                        ...data.profiles.map((p) => ({
                          value: p.id,
                          label: `${p.name} · ${p.minecraft} / ${ru.loaders[p.loader]}`,
                        })),
                      ]}
                    />
                  </Field>
                )}
                <Field label={t("Версия проекта")}>
                  <Select
                    value={versionId}
                    aria-label={t("Версия проекта")}
                    onValueChange={setVersionId}
                    options={[
                      {
                        value: "",
                        label: detail.versions.length
                          ? t("Выберите версию")
                          : t("Совместимых версий нет"),
                      },
                      ...detail.versions.map((v) => ({
                        value: v.id,
                        label: v.name,
                      })),
                    ]}
                  />
                </Field>
              </div>
              <button
                className="button primary"
                disabled={busy || !canInstall || !platformReady}
                onClick={() => void install()}
              >
                <PackagePlus size={16} />{" "}
                {project.kind === "modpack"
                  ? t("Создать сборку из модпака")
                  : t("Установить с зависимостями")}
              </button>
              {project.kind !== "modpack" && !profile && (
                <small>{t("Сначала создайте игровую сборку.")}</small>
              )}
              {selected && !canInstall && profile && (
                <small>{t("Версия не подходит для выбранной сборки.")}</small>
              )}
              {packSource(project.source) && versionId && (
                <PlatformPackOptions
                  key={configurationKey}
                  project={project}
                  versionId={versionId}
                  onChange={setPackConfig}
                  disabled={busy}
                />
              )}
            </div>
            <div className="tabs">
              {(
                [
                  ["description", t("Описание")],
                  [
                    "gallery",
                    t("Галерея \u00B7 {{v1}}", { v1: detail.gallery.length }),
                  ],
                  [
                    "versions",
                    t("Версии \u00B7 {{v1}}", { v1: detail.versions.length }),
                  ],
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
              <ProjectDescription
                body={detail.body || project.description}
                onLink={(url) => void run(() => rpc("openUrl", { url }))}
                onImage={(src) => {
                  const images = gallery.includes(src)
                    ? gallery
                    : [...gallery, src];
                  setViewer({ images, index: images.indexOf(src) });
                }}
              />
            )}
            {tab === "gallery" && (
              <ProjectGallery
                images={gallery}
                title={project.title}
                onOpen={(index) => setViewer({ images: gallery, index })}
              />
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
