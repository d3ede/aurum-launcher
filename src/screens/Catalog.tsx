import { t } from "../lib/i18n";
import { beginButtonHover } from "../lib/button-hover";
import { useEffect, useState } from "react";
import { Download, Compass, ExternalLink, LoaderCircle } from "lucide-react";
import {
  ImageLightbox,
  ProjectDescription,
  ProjectGallery,
  safeImageUrl,
} from "../components/ProjectMedia";
import { useApp } from "../context";
import { rpc, compatible } from "../lib/api";
import { ru, formatNumber } from "../lib/i18n";
import type { Project, ProjectDetail } from "../types";
import { Modal, Loading, ErrorBox, Field } from "../components/ui";
import { NativeModNotice } from "../components/NativeModNotice";
import { Select } from "../components/Select";
import { FavoriteButton } from "../components/FavoriteButton";
import { GamePresetChoice } from "../components/GamePresetChoice";
import { reloadableContent } from "../lib/content-runtime";
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
  onInstalled,
  installationOnly = false,
}: {
  project: Project;
  initialProfileId?: string;
  onClose: () => void;
  onInstalled?: (profileId: string) => void;
  installationOnly?: boolean;
}) {
  const { data, operation, busy, run } = useApp();
  const [profileId, setProfileId] = useState(initialProfileId || "");
  const [installOpen, setInstallOpen] = useState(false);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [versionId, setVersionId] = useState("");
  const [gameSettingsProfileId, setGameSettingsProfileId] = useState<string>();
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
    setVersionId("");
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
    profileId,
    profile?.minecraft,
    profile?.loader,
    retry,
  ]);
  const selected = detail?.versions.find((v) => v.id === versionId);
  const running = !!profile && data.running.includes(profile.id);
  const runtimeBlocked =
    project.kind !== "modpack" && running && !reloadableContent(project.kind);
  const canInstall =
    selected &&
    (project.kind === "modpack" ||
      (profile && compatible(selected, profile, project.kind)));
  const install = async () => {
    if (
      !selected ||
      loading ||
      error ||
      !canInstall ||
      !platformReady ||
      runtimeBlocked ||
      busy ||
      (project.kind === "modpack" &&
        gameSettingsProfileId !== undefined &&
        !data.gameSettingsProfiles?.some((p) => p.id === gameSettingsProfileId))
    )
      return;
    const ok = await operation(
      async (operationId) => {
        if (project.kind === "modpack")
          await rpc("downloadPack", {
            ...(project.icon ? { iconUrl: project.icon } : {}),
            ...(gameSettingsProfileId ? { gameSettingsProfileId } : {}),
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
        : project.source === "horizon"
          ? t(
              "Исходники мода установлены. Скомпилируйте их в сборке перед игрой.",
            )
          : t("Проект и необходимые зависимости установлены"),
    );
    if (ok) {
      if (project.kind !== "modpack" && profile) onInstalled?.(profile.id);
      onClose();
    }
  };
  const installDisabled =
    busy ||
    loading ||
    !!error ||
    runtimeBlocked ||
    !canInstall ||
    !platformReady ||
    (project.kind === "modpack" &&
      gameSettingsProfileId !== undefined &&
      !data.gameSettingsProfiles?.some((p) => p.id === gameSettingsProfileId));
  const installButton = (confirm = false) => (
    <button
      className="button primary project-install-action"
      onPointerEnter={beginButtonHover}
      disabled={
        confirm ? installDisabled : busy || loading || !!error || runtimeBlocked
      }
      onClick={() => {
        if (
          confirm ||
          (project.kind !== "modpack" &&
            profile &&
            canInstall &&
            detail?.versions.length === 1)
        )
          void install();
        else setInstallOpen(true);
      }}
    >
      {busy ? (
        <LoaderCircle size={18} className="spin" />
      ) : (
        <Download size={18} />
      )}
      {busy ? t("Установка…") : t("Установить")}
    </button>
  );
  const installation = (
    <>
      <div className="project-install-summary">
        <ProjectIcon project={project} />
        <div>
          <b>{project.title}</b>
          <small>{catalogSources[project.source]}</small>
        </div>
      </div>
      <div className="project-install">
        {project.source === "horizon" && <NativeModNotice />}
        {project.kind !== "modpack" && (
          <Field label={t("Установить в сборку")}>
            <Select
              value={profileId}
              aria-label={t("Установить в сборку")}
              disabled={busy}
              onValueChange={(id) => {
                setProfileId(id);
                setVersionId("");
                setLoading(true);
              }}
              options={[
                { value: "", label: t("Выберите сборку") },
                ...data.profiles.map((p) => ({
                  disabled:
                    project.source === "horizon"
                      ? p.engine !== "horizon"
                      : p.engine === "horizon",
                  value: p.id,
                  label: `${p.name} · ${p.minecraft} / ${p.engine === "horizon" ? "Horizon" : ru.loaders[p.loader]}`,
                })),
              ]}
            />
          </Field>
        )}
        {loading ? (
          <Loading label={t("Получаем проект и совместимые версии…")} />
        ) : error ? (
          <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
        ) : (
          detail && (
            <Field label={t("Версия проекта")}>
              <Select
                value={versionId}
                aria-label={t("Версия проекта")}
                disabled={busy}
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
          )
        )}
        {project.kind === "modpack" ? (
          <GamePresetChoice
            value={gameSettingsProfileId}
            onChange={setGameSettingsProfileId}
            disabled={busy}
          />
        ) : !profile ? (
          <small>
            {data.profiles.length
              ? t("Выберите сборку")
              : t("Сначала создайте игровую сборку.")}
          </small>
        ) : runtimeBlocked ? (
          <small>{t("Сначала остановите эту сборку")}</small>
        ) : !loading && !error && !detail?.versions.length ? (
          <small>{t("Для этой сборки нет совместимой версии проекта")}</small>
        ) : selected && !canInstall ? (
          <small>{t("Версия не подходит для выбранной сборки.")}</small>
        ) : (
          <small>
            {t("Необходимые зависимости установятся автоматически.")}
          </small>
        )}
        {packSource(project.source) && versionId && !loading && !error && (
          <PlatformPackOptions
            key={configurationKey}
            project={project}
            versionId={versionId}
            onChange={setPackConfig}
            disabled={busy}
          />
        )}
      </div>
      <div className="modal-actions project-install-footer">
        <button
          className="button secondary"
          disabled={busy}
          onClick={installationOnly ? onClose : () => setInstallOpen(false)}
        >
          {t("Отмена")}
        </button>
        {installButton(true)}
      </div>
    </>
  );
  if (installationOnly)
    return (
      <Modal
        title={t("Установить проект")}
        className="project-install-dialog"
        onClose={onClose}
        closeDisabled={busy}
      >
        {installation}
      </Modal>
    );
  return (
    <Modal
      title={project.title}
      subtitle={project.description}
      wide
      className="project-detail-dialog"
      onClose={onClose}
    >
      {installOpen && (
        <Modal
          title={t("Установить проект")}
          className="project-install-dialog"
          onClose={() => setInstallOpen(false)}
          closeDisabled={busy}
        >
          {installation}
        </Modal>
      )}
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
        {installButton()}
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
        <FavoriteButton project={project} />
      </div>
      {loading ? (
        <Loading label={t("Получаем проект и совместимые версии\u2026")} />
      ) : error ? (
        <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
      ) : (
        detail && (
          <>
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
