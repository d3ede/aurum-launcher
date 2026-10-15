import { useEffect, useState } from "react";
import { Check, ExternalLink, FolderOpen } from "lucide-react";
import { rpc } from "../lib/api";
import { t } from "../lib/i18n";
import type { PackOptions, PackRequirements, Project } from "../types";
import { ErrorBox, Loading } from "./ui";

export interface PackConfiguration {
  key: string;
  ready: boolean;
  options: PackOptions;
}

export function PlatformPackOptions({
  project,
  versionId,
  onChange,
  disabled,
}: {
  project: Project;
  versionId: string;
  onChange: (config: PackConfiguration) => void;
  disabled: boolean;
}) {
  const [optional, setOptional] = useState<string[] | undefined>();
  const [manualFiles, setManualFiles] = useState<Record<string, string>>({});
  const [requirements, setRequirements] = useState<PackRequirements | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [fileError, setFileError] = useState("");
  useEffect(() => {
    let live = true;
    const options = { optional, manualFiles };
    const key = `${project.source}:${project.id}:${versionId}`;
    onChange({ key, ready: false, options });
    setLoading(true);
    setError("");
    rpc("packRequirements", {
      source: project.source,
      projectId: project.id,
      versionId,
      options,
    })
      .then((r) => {
        if (!live) return;
        setRequirements(r);
        onChange({
          key,
          ready: r.manualFiles.every((f) => !!manualFiles[f.id]),
          options,
        });
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
    project.source,
    project.id,
    versionId,
    optional,
    manualFiles,
    retry,
    onChange,
  ]);
  const choose = async (id: string) => {
    setFileError("");
    try {
      const path = await rpc("choosePackFile", {});
      if (path) setManualFiles((old) => ({ ...old, [id]: path }));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section
      className="pack-options"
      aria-label={t("Параметры установки сборки")}
    >
      {loading && <Loading label={t("Проверяем файлы сборки…")} />}
      {error ? (
        <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
      ) : (
        requirements && (
          <>
            {!!requirements.optional.length && (
              <>
                <b>{t("Необязательные моды")}</b>
                {requirements.optional.map((item) => (
                  <label className="pack-option" key={item.id}>
                    <input
                      type="checkbox"
                      checked={item.selected}
                      disabled={disabled || loading}
                      onChange={(e) => {
                        const next = requirements.optional
                          .filter((m) => m.selected)
                          .map((m) => m.id);
                        setOptional(
                          e.target.checked
                            ? [...next, item.id]
                            : next.filter((id) => id !== item.id),
                        );
                      }}
                    />
                    <span>
                      <b>{item.name}</b>
                      {item.description && <small>{item.description}</small>}
                    </span>
                  </label>
                ))}
              </>
            )}
            {!!requirements.manualFiles.length && (
              <>
                <b>{t("Файлы с сайта автора")}</b>
                <p>
                  {t(
                    "Автор разрешает скачивание этих файлов только в браузере. Скачайте их и выберите здесь — Aurum проверит контрольные суммы.",
                  )}
                </p>
                {requirements.manualFiles.map((file) => (
                  <div className="pack-manual-file" key={file.id}>
                    <b>{file.name}</b>
                    {file.url && (
                      <button
                        className="button secondary"
                        disabled={disabled}
                        onClick={() =>
                          void rpc("openUrl", { url: file.url }).catch((e) =>
                            setFileError(e.message),
                          )
                        }
                      >
                        <ExternalLink size={16} />
                        {t("Скачать на сайте")}
                      </button>
                    )}
                    <button
                      className="button secondary"
                      disabled={disabled || loading}
                      onClick={() => void choose(file.id)}
                    >
                      {manualFiles[file.id] ? (
                        <Check size={16} />
                      ) : (
                        <FolderOpen size={16} />
                      )}
                      {t("Выбрать файл")}
                    </button>
                    {manualFiles[file.id] && (
                      <small>{manualFiles[file.id]}</small>
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )
      )}
      {fileError && <ErrorBox error={fileError} />}
    </section>
  );
}
