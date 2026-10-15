import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  FolderOpen,
  ImagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Shirt,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useApp } from "../context";
import { rpc, native } from "../lib/api";
import { t } from "../lib/i18n";
import {
  defaultSkins,
  defaultSkinImage,
  textureBytes,
  textureData,
} from "../lib/defaultSkins";
import { skinThumbnail } from "../lib/skinThumbnails";
import { SkinPreview, type SkinMotion } from "../components/SkinPreview";
import { Select } from "../components/Select";
import { ErrorBox, Field, Modal } from "../components/ui";
import type {
  SavedSkin,
  SavedCape,
  SkinLibrary,
  AccountAppearance,
  ModrinthSkinImportResult,
} from "../types";

const emptyLibrary: SkinLibrary = { skins: [], capes: [], selections: {} };
const motions: { value: SkinMotion; label: string }[] = [
  { value: "idle", label: "Ожидание" },
  { value: "still", label: "Без анимации" },
  { value: "walk", label: "Ходьба" },
  { value: "run", label: "Бег" },
  { value: "wave", label: "Помахать" },
  { value: "crouch", label: "Присесть" },
  { value: "hit", label: "Удар" },
];
type Draft = {
  id: string | null;
  name: string;
  model: "steve" | "alex";
  texture: string;
  preset: string | null;
  capeId: string | null;
};

function SkinTile({
  skin,
  selected,
  active,
  onClick,
}: {
  skin: SavedSkin;
  selected: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setImage("");
    setFailed(false);
    skinThumbnail(skin.texture, skin.model)
      .then((url) => {
        if (live) setImage(url);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [skin.texture, skin.model]);
  return (
    <button
      className={`wardrobe-tile ${selected ? "selected" : ""}`}
      onClick={onClick}
      aria-label={t("Выбрать скин {{name}}", { name: skin.name })}
      aria-pressed={selected}
    >
      <span className="wardrobe-tile-image">
        {image ? (
          <img src={image} alt="" data-thumbnail-ready="true" />
        ) : failed ? (
          <Shirt size={36} />
        ) : (
          <span className="skin-thumb-loading" />
        )}
      </span>
      {active && (
        <span className="wardrobe-active" title={t("Применён к аккаунту")}>
          <Check size={13} />
        </span>
      )}
    </button>
  );
}

function CapeTile({
  cape,
  selected,
  onClick,
  disabled,
}: {
  cape: SavedCape;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const [image, setImage] = useState("");
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 80;
      c.height = 128;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 1, 1, 10, 16, 0, 0, 80, 128);
      if (live) setImage(c.toDataURL());
    };
    img.src = cape.texture;
    return () => {
      live = false;
    };
  }, [cape.texture]);
  return (
    <button
      className={`cape-tile ${selected ? "selected" : ""}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={t("Плащ {{name}}", { name: cape.name })}
      aria-pressed={selected}
    >
      <span>{image && <img src={image} alt="" />}</span>
      <small>{cape.name}</small>
      {selected && <Check size={12} />}
    </button>
  );
}

export function Skins() {
  const { data, run, busy, navigate, notify } = useApp();
  const [accountId, setAccountId] = useState(
    data.selectedAccount || data.accounts[0]?.id || "",
  );
  const account = data.accounts.find((a) => a.id === accountId);
  const [library, setLibrary] = useState<SkinLibrary>(emptyLibrary);
  const [appearance, setAppearance] = useState<AccountAppearance | null>(null);
  const [chosen, setChosen] = useState("");
  const [capeId, setCapeId] = useState<string | null>(null);
  const [motion, setMotion] = useState<SkinMotion>("idle");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [editorError, setEditorError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] =
    useState<ModrinthSkinImportResult | null>(null);
  useEffect(() => {
    if (accountId && !data.accounts.some((a) => a.id === accountId))
      setAccountId(data.selectedAccount || data.accounts[0]?.id || "");
    else if (!accountId && data.accounts.length)
      setAccountId(data.selectedAccount || data.accounts[0].id);
  }, [data.accounts, data.selectedAccount, accountId]);
  useEffect(() => {
    let live = true;
    setError("");
    setProfileError("");
    setAppearance(null);
    setChosen("");
    setCapeId(null);
    if (!native) {
      setLibrary(emptyLibrary);
      return;
    }
    setLoading(true);
    Promise.allSettled([
      rpc("skinLibrary", {}),
      accountId
        ? rpc("accountAppearance", { id: accountId })
        : Promise.resolve(null),
    ])
      .then(([lib, result]) => {
        if (!live) return;
        if (lib.status === "fulfilled") {
          setLibrary(lib.value);
          const selected = lib.value.selections[accountId];
          if (selected) {
            setChosen(selected.skinId);
            setCapeId(selected.capeId);
          }
        } else
          setError(
            lib.reason instanceof Error
              ? lib.reason.message
              : String(lib.reason),
          );
        if (result.status === "fulfilled") {
          setAppearance(result.value);
          if (lib.status === "fulfilled" && !lib.value.selections[accountId])
            setCapeId(result.value?.capes.find((c) => c.active)?.id || null);
        } else
          setProfileError(
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [accountId, reload]);
  const all = [...library.skins, ...defaultSkins];
  const current: SavedSkin = {
    id: "current",
    name: t("Текущий скин"),
    model: appearance?.model || account?.skinModel || "steve",
    texture: appearance?.texture || defaultSkinImage("default:steve", "steve"),
    capeId,
  };
  const skin =
    all.find((s) => s.id === chosen) ||
    (appearance?.texture ? current : defaultSkins[0]);
  const capes = [...(appearance?.capes || []), ...library.capes];
  const selectedCape = capes.find((c) => c.id === capeId);
  const activeKey = library.selections[accountId]?.skinId;
  const choose = (s: SavedSkin) => {
    setChosen(s.id);
    setCapeId(s.capeId);
  };
  const edit = (s: SavedSkin) => {
    setEditorError("");
    setDraft({
      id: library.skins.some((item) => item.id === s.id) ? s.id : null,
      name: s.name,
      model: s.model,
      texture: s.texture,
      preset: s.id.startsWith("default:") ? s.id : null,
      capeId: s.id === skin.id ? capeId : s.capeId,
    });
  };
  const upload = async () => {
    try {
      const picked = await rpc("chooseSkinTexture", { cape: false });
      if (picked) {
        setEditorError("");
        setDraft({
          id: null,
          name: picked.name,
          model: "steve",
          texture: textureData(picked.bytes),
          preset: null,
          capeId: null,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const importSkins = async (chooseFolder = false) => {
    await run(async () => {
      setImporting(true);
      setError("");
      try {
        const directory = chooseFolder
          ? await rpc("chooseModrinthDirectory", {})
          : null;
        if (chooseFolder && !directory) return;
        setImportReport(null);
        const result = await rpc("importModrinthSkins", {
          directories: directory ? [directory] : [],
        });
        setImportReport(result);
        setLibrary(await rpc("skinLibrary", {}));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setImporting(false);
      }
    });
  };
  const save = async () => {
    if (!draft) return;
    const value = await run(async () => {
      try {
        const bytes = draft.preset
          ? await rpc("defaultSkinTexture", {
              id: draft.preset,
              model: draft.model,
            })
          : textureBytes(draft.texture);
        const saved = await rpc("saveLibrarySkin", {
          id: draft.id,
          name: draft.name,
          model: draft.model,
          bytes,
          capeId: draft.capeId,
        });
        setLibrary(await rpc("skinLibrary", {}));
        return saved;
      } catch (e) {
        setEditorError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    }, t("Скин сохранён в библиотеке"));
    if (value) {
      setChosen(value.id);
      setCapeId(value.capeId);
      setDraft(null);
    }
  };
  const uploadCape = async () => {
    try {
      const picked = await rpc("chooseSkinTexture", { cape: true });
      if (!picked) return;
      const saved = await run(async () => {
        const cape = await rpc("saveLibraryCape", {
          name: picked.name,
          bytes: picked.bytes,
        });
        setLibrary(await rpc("skinLibrary", {}));
        return cape;
      });
      if (saved) setDraft((d) => (d ? { ...d, capeId: saved.id } : d));
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : String(e));
    }
  };
  const apply = async () => {
    if (!account) return;
    if (skin.id === "current") {
      edit(skin);
      return;
    }
    const ok = await run(async () => {
      try {
        await rpc("applyLibrarySkin", {
          accountId,
          skinId: skin.id,
          model: skin.model,
          capeId,
        });
        setLibrary(await rpc("skinLibrary", {}));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    }, t("Образ применён"));
    if (ok) setError("");
  };
  const localCape = !!capeId && !capeId.startsWith("owned:");
  return (
    <>
      <div className="page-heading wardrobe-heading">
        <div>
          <h1>{t("Скины и плащи")}</h1>
          <p>
            {t(
              "Ваш персонаж, ваши образы. Сохраните любимые и меняйте их в один клик.",
            )}
          </p>
        </div>
        <div className="wardrobe-heading-actions">
          <button
            className="button secondary"
            disabled={busy || loading || !native}
            onClick={() => void importSkins()}
          >
            <Download size={16} />
            {importing ? t("Импортируем скины…") : t("Импорт из Modrinth")}
          </button>
          <button
            className="text-button"
            disabled={busy || loading || !native}
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCw size={15} />
            {t("Обновить профиль")}
          </button>
        </div>
      </div>
      <div className="wardrobe-layout">
        <section className="wardrobe-character">
          <div className="wardrobe-account">
            <span>{t("Аккаунт для образа")}</span>
            {data.accounts.length ? (
              <Select
                aria-label={t("Аккаунт для образа")}
                value={accountId}
                onValueChange={setAccountId}
                disabled={busy}
                options={data.accounts.map((a) => ({
                  value: a.id,
                  label: a.name,
                }))}
              />
            ) : (
              <button
                className="button secondary"
                onClick={() => navigate("accounts")}
              >
                {t("Добавить аккаунт")}
              </button>
            )}
          </div>
          {account && (
            <div className="wardrobe-character-name">
              <b>{account.name}</b>
            </div>
          )}
          <SkinPreview
            texture={skin.texture}
            model={skin.model}
            cape={selectedCape?.texture}
            motion={motion}
          />
          <Field label={t("Анимация")}>
            <Select
              aria-label={t("Анимация персонажа")}
              value={motion}
              onValueChange={(v) => setMotion(v as SkinMotion)}
              options={motions.map((m) => ({
                value: m.value,
                label: t(m.label),
              }))}
            />
          </Field>
          <div className="wardrobe-character-actions">
            <button
              className="button secondary"
              disabled={busy || loading || !native}
              onClick={() => edit(skin)}
            >
              <Pencil size={15} />
              {t("Изменить")}
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                loading ||
                !account ||
                (account.kind === "microsoft" && localCape)
              }
              onClick={() => void apply()}
            >
              <Check size={16} />
              {skin.id === "current" ? t("Сохранить образ") : t("Применить")}
            </button>
          </div>
          {account?.kind === "microsoft" && (
            <p className="wardrobe-account-note">
              {localCape
                ? t(
                    "Локальный плащ доступен для предпросмотра. Для игры выберите плащ вашего аккаунта.",
                  )
                : t(
                    "Скин и доступный плащ применяются к вашему Minecraft-профилю.",
                  )}
            </p>
          )}
          {loading && (
            <p className="wardrobe-account-note" role="status">
              {t("Получаем образ Minecraft…")}
            </p>
          )}
          {profileError && (
            <ErrorBox
              error={profileError}
              retry={() => setReload((n) => n + 1)}
            />
          )}
        </section>
        <section className="wardrobe-library">
          {importReport && (
            <div className="wardrobe-import-result">
              <p role="status">
                {importReport.imported +
                  importReport.duplicates +
                  importReport.invalid ===
                0
                  ? t("Сохранённые скины Modrinth не найдены.")
                  : t(
                      "Импортировано: {{imported}} · Уже в библиотеке: {{duplicates}} · Пропущено: {{invalid}}",
                      {
                        imported: importReport.imported,
                        duplicates: importReport.duplicates,
                        invalid: importReport.invalid,
                      },
                    )}
              </p>
              {importReport.invalid > 0 && (
                <p>
                  {t(
                    "Пропущены повреждённые текстуры и неизвестные модели рук.",
                  )}
                </p>
              )}
              {importReport.warnings.map((path) => (
                <p key={path}>
                  {t(
                    "Не удалось прочитать скины Modrinth: {{path}}. Закройте Modrinth и повторите импорт.",
                    { path },
                  )}
                </p>
              ))}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void importSkins(true)}
              >
                <FolderOpen size={15} />
                {t("Выбрать папку Modrinth")}
              </button>
            </div>
          )}
          {error && (
            <ErrorBox error={error} retry={() => setReload((n) => n + 1)} />
          )}
          <details open className="wardrobe-section">
            <summary>
              <ChevronDown size={17} />
              <h2>{t("Сохранённые скины")}</h2>
            </summary>
            <div className="wardrobe-grid">
              <button
                className="wardrobe-add"
                aria-label={t("Добавить скин")}
                disabled={busy || !native}
                onClick={() => void upload()}
              >
                <Plus size={30} />
                <b>{t("Добавить скин")}</b>
                <small>{t("PNG · 64×64 или 64×32")}</small>
              </button>
              {library.skins.map((s) => (
                <SkinTile
                  key={s.id}
                  skin={s}
                  selected={skin.id === s.id}
                  active={activeKey === s.id}
                  onClick={() => choose(s)}
                />
              ))}
            </div>
            {!library.skins.length && (
              <p className="wardrobe-empty-note">
                {t(
                  "Здесь появятся ваши сохранённые образы. Добавьте PNG или сохраните стандартный скин с нужными настройками.",
                )}
              </p>
            )}
          </details>
          <details open className="wardrobe-section">
            <summary>
              <ChevronDown size={17} />
              <h2>{t("Стандартные скины")}</h2>
            </summary>
            <div className="wardrobe-grid">
              {defaultSkins.map((s) => (
                <SkinTile
                  key={s.id}
                  skin={s}
                  selected={skin.id === s.id}
                  active={activeKey === s.id}
                  onClick={() => choose(s)}
                />
              ))}
            </div>
          </details>
        </section>
      </div>
      {draft && (
        <Modal
          wide
          className="skin-editor-modal"
          closeDisabled={busy}
          title={t("Настройка скина")}
          subtitle={t("Название, текстура, руки и плащ сохраняются вместе.")}
          onClose={() => {
            if (!busy) setDraft(null);
          }}
        >
          <div className="skin-editor-layout">
            <SkinPreview
              texture={
                draft.preset
                  ? defaultSkinImage(draft.preset, draft.model)
                  : draft.texture
              }
              model={draft.model}
              cape={capes.find((c) => c.id === draft.capeId)?.texture}
              motion={motion}
            />
            <div className="skin-editor-fields">
              <Field label={t("Название образа")}>
                <input
                  value={draft.name}
                  disabled={busy}
                  maxLength={120}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label={t("Текстура")}>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      const p = await rpc("chooseSkinTexture", { cape: false });
                      if (p)
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                texture: textureData(p.bytes),
                                preset: null,
                              }
                            : d,
                        );
                    } catch (e) {
                      setEditorError(
                        e instanceof Error ? e.message : String(e),
                      );
                    }
                  }}
                >
                  <Upload size={15} />
                  {t("Заменить текстуру")}
                </button>
              </Field>
              <Field label={t("Руки")}>
                <div className="model-switch">
                  {(["steve", "alex"] as const).map((model) => (
                    <button
                      key={model}
                      disabled={busy}
                      aria-pressed={draft.model === model}
                      className={draft.model === model ? "active" : ""}
                      onClick={() => setDraft({ ...draft, model })}
                    >
                      {model === "steve" ? t("Обычные руки") : t("Тонкие руки")}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="field">
                <span>{t("Плащ")}</span>
                <div className="cape-picker">
                  <button
                    className={`cape-tile no-cape ${draft.capeId === null ? "selected" : ""}`}
                    disabled={busy}
                    aria-pressed={draft.capeId === null}
                    onClick={() => setDraft({ ...draft, capeId: null })}
                  >
                    <span>
                      <X size={22} />
                    </span>
                    <small>{t("Без плаща")}</small>
                  </button>
                  {capes.map((c) => (
                    <CapeTile
                      key={c.id}
                      cape={c}
                      disabled={busy}
                      selected={draft.capeId === c.id}
                      onClick={() => setDraft({ ...draft, capeId: c.id })}
                    />
                  ))}
                </div>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void uploadCape()}
                >
                  <ImagePlus size={15} />
                  {t("Добавить PNG-плащ")}
                </button>
                <small className="wardrobe-account-note">
                  {t(
                    "В Minecraft можно применить только плащи, принадлежащие выбранному Microsoft-аккаунту.",
                  )}
                </small>
              </div>
              {editorError && <ErrorBox error={editorError} />}
            </div>
          </div>
          <div className="modal-actions">
            {draft.id && (
              <button
                className="text-button danger skin-delete"
                disabled={busy}
                onClick={async () => {
                  const ok = await run(async () => {
                    await rpc("deleteLibraryItem", {
                      id: draft.id!,
                      cape: false,
                    });
                    setLibrary(await rpc("skinLibrary", {}));
                    return true;
                  }, t("Скин удалён из библиотеки"));
                  if (ok) {
                    setDraft(null);
                    setChosen("");
                  }
                }}
              >
                <Trash2 size={15} />
                {t("Удалить из библиотеки")}
              </button>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              {t("Отмена")}
            </button>
            <button
              className="button primary"
              disabled={busy || !draft.name.trim()}
              onClick={() => void save()}
            >
              <Check size={16} />
              {t("Сохранить скин")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
