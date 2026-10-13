import { useEffect, useState } from "react";
import {
  Plus,
  Check,
  FolderOpen,
  Trash2,
  Play,
  Square,
  RefreshCw,
  Terminal,
  Settings2,
  Puzzle,
  FileInput,
  ToggleLeft,
  ToggleRight,
  Compass,
  Search,
  ArrowLeft,
} from "lucide-react";
import { Modal, Field, Loading, ErrorBox, EmptyState } from "./ui";
import { ProfileIcon, IconPicker } from "./ProfileIcon";
import { Select } from "./Select";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { ru } from "../lib/i18n";
import type { Content, Kind, Loader, Profile } from "../types";
export function CreateProfile({
  onClose,
  folderImport = false,
  onCreated,
}: {
  onClose: () => void;
  folderImport?: boolean;
  onCreated?: (profile: Profile) => void;
}) {
  const { data, run, operation, busy } = useApp();
  const [name, setName] = useState("");
  const [mc, setMc] = useState("");
  const [loader, setLoader] = useState<Loader>("vanilla");
  const [lv, setLv] = useState("");
  const [versions, setVersions] = useState<string[]>([]);
  const [loaders, setLoaders] = useState<string[]>([]);
  const [cover, setCover] = useState(0);
  const [icon, setIcon] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaderLoading, setLoaderLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    rpc("versions", {})
      .then((m) => {
        if (live) {
          setVersions(
            m.versions
              .filter(
                (v) => v.type === "release" || data.settings.showSnapshots,
              )
              .map((v) => v.id),
          );
          setMc(m.latest.release);
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
  }, [data.settings.showSnapshots, retry]);
  useEffect(() => {
    setLv("");
    setLoaders([]);
    setLoaderLoading(false);
    if (loader === "vanilla" || !mc) return;
    let live = true;
    setLoaderLoading(true);
    rpc("loaders", { minecraft: mc, loader })
      .then((v) => {
        if (live) {
          setLoaders(v);
          setLv(v[0] || "");
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoaderLoading(false);
      });
    return () => {
      live = false;
    };
  }, [mc, loader]);
  const submit = async () => {
    const result = folderImport
      ? await operation(
          (operationId) =>
            rpc("importFolder", {
              name: name.trim() || `Minecraft ${mc}`,
              minecraft: mc,
              loader,
              loaderVersion: lv || null,
              operationId,
            }),
          "Папка игры импортирована",
        )
      : await run(
          () =>
            rpc("createProfile", {
              name: name.trim() || `Minecraft ${mc}`,
              minecraft: mc,
              loader,
              loaderVersion: lv || null,
              cover,
              icon,
            }),
          "Сборка создана",
        );
    if (result) {
      onClose();
      if (typeof result !== "string") onCreated?.(result);
    }
  };
  return (
    <Modal
      title={folderImport ? "Импорт папки игры" : "Новая сборка"}
      subtitle={
        folderImport
          ? "Будут скопированы миры, моды и настройки. Исходная папка сохранится."
          : undefined
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Название сборки">
          <input
            autoFocus
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Minecraft ${mc}`}
          />
        </Field>
        {loading ? (
          <Loading label="Получаем версии Minecraft…" />
        ) : (
          <>
            <div className="form-grid">
              <Field label="Версия Minecraft">
                <Select
                  value={mc}
                  onValueChange={setMc}
                  aria-label="Версия Minecraft"
                  options={versions.map((v) => ({ value: v, label: v }))}
                />
              </Field>
              <Field label="Загрузчик">
                <Select
                  value={loader}
                  aria-label="Загрузчик"
                  onValueChange={(v) => setLoader(v as Loader)}
                  options={Object.entries(ru.loaders).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Field>
            </div>
            {loader !== "vanilla" && (
              <Field
                label={`Версия ${ru.loaders[loader]}`}
                hint={
                  !loaderLoading && !loaders.length
                    ? "Для этой версии игры нет совместимого загрузчика. Выберите другую версию Minecraft."
                    : undefined
                }
              >
                <Select
                  value={lv}
                  aria-label={`Версия ${ru.loaders[loader]}`}
                  onValueChange={setLv}
                  disabled={loaderLoading || !loaders.length}
                  options={[
                    {
                      value: "",
                      label: loaderLoading
                        ? "Проверяем совместимость…"
                        : "Выберите версию",
                    },
                    ...loaders.map((v) => ({ value: v, label: v })),
                  ]}
                />
              </Field>
            )}
          </>
        )}
        {!folderImport && (
          <div className="field">
            <span>Значок сборки</span>
            <IconPicker
              value={{ cover, icon }}
              onChange={(value) => {
                setCover(value.cover);
                setIcon(value.icon || null);
              }}
            />
          </div>
        )}
        {error && (
          <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
        )}
        <div className="dialog-note">
          {folderImport
            ? "Выберите папку .minecraft или папку игры из другого лаунчера."
            : "Minecraft и подходящая Java загрузятся при первом запуске. Для официальных серверов нужен Microsoft-аккаунт."}
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Отмена
          </button>
          <button
            className="button primary"
            disabled={
              busy ||
              loading ||
              loaderLoading ||
              !mc ||
              (loader !== "vanilla" && !lv)
            }
          >
            {folderImport ? <FolderOpen size={16} /> : <Plus size={16} />}{" "}
            {folderImport ? "Выбрать папку" : "Создать сборку"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ProfileDialog({
  initial,
  onClose,
  onFindProjects,
}: {
  initial: Profile;
  onFindProjects: (profile: Profile, kind: Kind) => void;
  onClose: () => void;
}) {
  const { data, busy, run, operation, play, navigate } = useApp();
  const profile = data.profiles.find((p) => p.id === initial.id) || initial;
  const [draft, setDraft] = useState(profile);
  const [tab, setTab] = useState<"content" | "settings" | "logs">("content");
  const [content, setContent] = useState<Content[]>([]);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [revision, setRevision] = useState(0);
  const running = data.running.includes(profile.id);
  const { logs } = useApp();
  const visible = content.filter(
    (c) =>
      (kind === "all" || c.kind === kind) &&
      `${c.name} ${c.filename}`.toLowerCase().includes(search.toLowerCase()),
  );
  const find = () => onFindProjects(profile, kind === "all" ? "mod" : kind);
  useEffect(() => {
    let live = true;
    setLoading(true);
    rpc("content", { id: profile.id })
      .then((c) => {
        if (live) {
          setContent(c);
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
  }, [profile.id, data.profiles, revision]);
  useEffect(() => {
    if (tab !== "logs") return;
    let live = true;
    rpc("logs", { id: profile.id })
      .then((v) => {
        if (live) setLog(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [profile.id, tab, revision]);
  const manage = async (c: Content, action: "toggle" | "remove") => {
    await run(
      () => rpc("manageContent", { id: profile.id, contentId: c.id, action }),
      action === "remove" ? "Файл перемещён в корзину" : undefined,
    );
    setRevision((v) => v + 1);
  };
  return (
    <section className="instance-page">
      <button className="text-button instance-back" onClick={onClose}>
        <ArrowLeft size={18} /> Все сборки
      </button>
      <div className="instance-heading">
        <button
          className="instance-icon-edit"
          aria-label="Изменить значок сборки"
          onClick={() => setTab("settings")}
        >
          <ProfileIcon profile={profile} size={72} />
        </button>
        <div>
          <h1>{profile.name}</h1>
          <p>
            Minecraft {profile.minecraft} · {ru.loaders[profile.loader]}
            {profile.loaderVersion ? " " + profile.loaderVersion : ""}
          </p>
        </div>
        <div className="profile-dialog-actions">
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              running
                ? void run(() => rpc("stop", { id: profile.id }))
                : void play(profile)
            }
          >
            {running ? <Square size={16} /> : <Play size={16} />}{" "}
            {running
              ? "Остановить"
              : profile.installedVersion
                ? "Играть"
                : "Установить и играть"}
          </button>
          <button
            className="button secondary"
            onClick={() =>
              void run(() => rpc("openFolder", { id: profile.id }))
            }
          >
            <FolderOpen size={16} /> Папка
          </button>
          <button
            className="button secondary"
            disabled={busy || running}
            onClick={() =>
              void operation(
                (operationId) =>
                  rpc("install", { id: profile.id, operationId }),
                "Установка проверена",
              )
            }
          >
            <RefreshCw size={15} /> Проверить установку
          </button>
        </div>
      </div>
      <div className="tabs">
        {(
          [
            ["content", "Контент", Puzzle],
            ["settings", "Параметры", Settings2],
            ["logs", "Журнал", Terminal],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      {tab === "content" && (
        <>
          <div className="instance-content-actions">
            <div className="input-icon">
              <Search size={18} />
              <input
                aria-label="Поиск в сборке"
                placeholder="Поиск в сборке"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button className="button primary" onClick={find}>
              <Compass size={18} /> Найти проекты
            </button>
          </div>
          <div className="content-toolbar">
            <div className="chips">
              {(["all", "mod", "shader", "resourcepack"] as const).map((k) => (
                <button
                  key={k}
                  className={kind === k ? "active" : ""}
                  onClick={() => setKind(k)}
                >
                  {k === "all" ? "Всё" : ru.kinds[k]}
                </button>
              ))}
            </div>
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
              <FileInput size={15} /> Добавить файл
            </button>
          </div>
          {loading ? (
            <Loading />
          ) : visible.length ? (
            <div className="content-list">
              <div className="content-table-heading">
                <span>Проект / файл</span>
                <span>Действия</span>
              </div>
              {visible.map((c) => (
                <div
                  className={`content-row ${!c.enabled ? "disabled" : ""}`}
                  key={c.id}
                >
                  <Puzzle size={19} />
                  <div>
                    <b>{c.name}</b>
                    <small title={c.filename}>
                      {c.filename} ·{" "}
                      {c.source === "local" ? "Локальный файл" : c.source}
                    </small>
                  </div>
                  {c.source !== "local" && (
                    <button
                      className="icon-button"
                      aria-label={`Обновить ${c.name}`}
                      disabled={busy || running}
                      onClick={async () => {
                        await operation(
                          (operationId) =>
                            rpc("updateContent", {
                              id: profile.id,
                              contentId: c.id,
                              operationId,
                            }),
                          "Контент обновлён",
                        );
                        setRevision((v) => v + 1);
                      }}
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    aria-label={`${c.enabled ? "Отключить" : "Включить"} ${c.name}`}
                    disabled={busy || running}
                    onClick={() => void manage(c, "toggle")}
                  >
                    {c.enabled ? (
                      <ToggleRight size={23} />
                    ) : (
                      <ToggleLeft size={23} />
                    )}
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Удалить ${c.name}`}
                    disabled={busy || running}
                    onClick={() => void manage(c, "remove")}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Puzzle size={27} />}
              title={
                search ? "Ничего не найдено" : "Нет установленных проектов"
              }
              text={
                search
                  ? "Измените поисковый запрос."
                  : "Добавьте моды, шейдеры или ресурспаки."
              }
            />
          )}
        </>
      )}
      {tab === "settings" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => rpc("updateProfile", { profile: draft }),
              "Параметры сохранены",
            );
          }}
        >
          <div className="field">
            <span>Значок сборки</span>
            <IconPicker
              value={draft}
              onChange={(value) => setDraft({ ...draft, ...value })}
            />
          </div>
          <Field label="Название">
            <input
              value={draft.name}
              required
              maxLength={120}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field
            label="Память, МБ"
            hint="Оставьте пустым, чтобы использовать общие настройки"
          >
            <input
              type="number"
              min="512"
              max="65536"
              step="256"
              value={draft.ramMb ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  ramMb: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </Field>
          <Field label="Дополнительные JVM-аргументы">
            <input
              value={draft.jvmArgs}
              onChange={(e) => setDraft({ ...draft, jvmArgs: e.target.value })}
              placeholder="-XX:+UseG1GC"
            />
          </Field>
          <div className="modal-actions">
            <button
              type="button"
              className="text-button danger"
              disabled={busy || running}
              onClick={() => setConfirm(true)}
            >
              <Trash2 size={15} /> Удалить сборку
            </button>
            <button className="button primary" disabled={busy || running}>
              Сохранить
            </button>
          </div>
        </form>
      )}
      {tab === "logs" && (
        <>
          <div className="log-toolbar">
            <span>Журнал Minecraft</span>
            <button
              className="text-button"
              onClick={() => setRevision((v) => v + 1)}
            >
              <RefreshCw size={14} /> Обновить
            </button>
          </div>
          <pre className="game-log">
            {log}
            {logs
              .filter((l) => l.profileId === profile.id)
              .map((l, i) => (
                <span key={i}>
                  {"\n"}
                  {l.message}
                </span>
              ))}
          </pre>
        </>
      )}
      {error && <ErrorBox error={error} />}{" "}
      {confirm && (
        <div className="inline-confirm" role="alert">
          <b>Удалить «{profile.name}»?</b>
          <p>Папка сборки с мирами будет перемещена в корзину Aurum.</p>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() => setConfirm(false)}
            >
              Отмена
            </button>
            <button
              className="button destructive"
              onClick={async () => {
                const ok = await run(async () => {
                  await rpc("deleteProfile", { id: profile.id });
                  return true;
                }, "Сборка перемещена в корзину");
                if (ok) onClose();
              }}
            >
              Удалить сборку
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
