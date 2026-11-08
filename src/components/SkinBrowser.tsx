import { useEffect, useRef, useState } from "react";
import { Check, Globe, Plus, Search, Shirt } from "lucide-react";
import { rpc } from "../lib/api";
import { t, tMessage } from "../lib/i18n";
import { textureBytes } from "../lib/defaultSkins";
import { skinThumbnail } from "../lib/skinThumbnails";
import type { SavedSkin } from "../types";
import {
  validSkinName,
  type BrowserAppearance,
  type BrowserEntry,
} from "../lib/skin-browser";
import { ErrorBox, Field, Loading, Modal } from "./ui";
import { Select } from "./Select";
import { SkinPreview } from "./SkinPreview";

type Entry = BrowserEntry;
type Mode = "latest" | "popular" | "random";
type Source = "catalog" | "player" | "mineskin";
const errorMessage = (e: unknown) =>
  tMessage(String(e instanceof Error ? e.message : e));
// Keep scrolling inexpensive: four downloads at a time and one shared 3D renderer.
let downloads = 0;
const waiting: (() => void)[] = [];
const thumbnails = new Map<string, Promise<string>>();
function thumbnail(hash: string) {
  const cached = thumbnails.get(hash);
  if (cached) return cached;
  const result = (async () => {
    if (downloads >= 4)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else downloads++;
    try {
      const texture = await rpc("skinBrowserTexture", { hash });
      return await skinThumbnail(texture, "auto");
    } finally {
      const next = waiting.shift();
      if (next) next();
      else downloads--;
    }
  })();
  thumbnails.set(hash, result);
  if (thumbnails.size > 180) thumbnails.delete(thumbnails.keys().next().value!);
  void result.catch(() => thumbnails.delete(hash));
  return result;
}

function BrowserTile({
  entry,
  selected,
  onClick,
}: {
  entry: Entry;
  selected: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    const observer = new IntersectionObserver(
      ([entry0]) => {
        if (!entry0.isIntersecting) return;
        observer.disconnect();
        void thumbnail(entry.hash)
          .then((image) => {
            if (live) setImage(image);
          })
          .catch(() => {
            if (live) setFailed(true);
          });
      },
      { rootMargin: "100px" },
    );
    observer.observe(ref.current!);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [entry.hash, retry]);
  return (
    <button
      ref={ref}
      className={`wardrobe-tile browser-tile ${selected ? "selected" : ""}`}
      aria-label={t("Посмотреть скин {{name}}", {
        name: entry.name || t("Без названия"),
      })}
      aria-pressed={selected}
      onClick={() => {
        if (failed) setRetry((n) => n + 1);
        onClick();
      }}
    >
      <span className="wardrobe-tile-image">
        {image ? (
          <img src={image} alt="" data-thumbnail-ready="true" />
        ) : failed ? (
          <Shirt size={30} />
        ) : (
          <span className="skin-thumb-loading" />
        )}
      </span>
      <span className="browser-tile-name">
        <span title={entry.name || undefined}>
          {entry.name || t("Без названия")}
        </span>
        <small className="browser-skin-id" title={entry.id}>
          ID: {entry.shortId || entry.id.slice(0, 8)}
        </small>
      </span>
    </button>
  );
}

export function SkinBrowser({
  library,
  onSaved,
  onClose,
}: {
  library: SavedSkin[];
  onSaved: (skin: SavedSkin) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source>("catalog");
  const [mode, setMode] = useState<Mode>("latest");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [selected, setSelected] = useState<BrowserAppearance | null>(null);
  const [libraryName, setLibraryName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [revision, setRevision] = useState(0);
  const searchVersion = useRef(0);
  const previewVersion = useRef(0);
  const saveLock = useRef(false);
  const criteria = useRef("");
  const currentCriteria = JSON.stringify([query.trim(), source, mode]);
  criteria.current = currentCriteria;
  const saved =
    selected &&
    library.some(
      (s) => s.texture === selected.texture && s.model === selected.model,
    );

  useEffect(
    () => () => {
      searchVersion.current++;
      previewVersion.current++;
    },
    [],
  );
  async function openSkin(
    value: string,
    kind: "mineskin" | "player" = "mineskin",
  ) {
    const version = ++previewVersion.current;
    setSelectedId(value);
    setSelected(null);
    setPreviewError("");
    setPreviewLoading(true);
    try {
      const skin = await rpc("skinBrowserSkin", { query: value, source: kind });
      if (version === previewVersion.current) {
        // Preserve a genuine catalog name if the detail response happens to omit it.
        const entry =
          kind === "mineskin"
            ? entries.find((entry) => entry.id === value)
            : null;
        const name = skin.name || entry?.name || null;
        setSelected({
          ...skin,
          name,
          shortId: skin.shortId || entry?.shortId || null,
        });
        setLibraryName(name || t("Без названия"));
        if (skin.name)
          setEntries((old) =>
            old.map((entry) =>
              entry.id === skin.id.replace("mineskin:", "")
                ? { ...entry, name: skin.name }
                : entry,
            ),
          );
      }
    } catch (e) {
      if (version === previewVersion.current) setPreviewError(errorMessage(e));
    } finally {
      if (version === previewVersion.current) setPreviewLoading(false);
    }
  }
  useEffect(() => {
    const version = ++searchVersion.current;
    previewVersion.current++;
    setEntries([]);
    setAfter(null);
    setSelected(null);
    setSelectedId("");
    setError("");
    setPreviewError("");
    setPreviewLoading(false);
    const input = query.trim();
    setLoading(source === "catalog" || !!input);
    const timer = setTimeout(
      () => {
        if (source !== "catalog") {
          setLoading(false);
          if (input) void openSkin(input, source);
          return;
        }
        // Pasting a MineSkin link or UUID opens it directly; ordinary words use the site's filter.
        if (
          /^https:\/\/(www\.)?mineskin\.org\//i.test(input) ||
          /^[a-f\d]{32}$/i.test(input.replaceAll("-", ""))
        ) {
          setLoading(false);
          void openSkin(input);
          return;
        }
        void rpc("browseSkins", { query: input, mode, after: null })
          .then((page) => {
            if (version !== searchVersion.current) return;
            setEntries(page.skins);
            setAfter(page.after);
          })
          .catch((e) => {
            if (version === searchVersion.current) setError(errorMessage(e));
          })
          .finally(() => {
            if (version === searchVersion.current) setLoading(false);
          });
      },
      input ? 450 : 0,
    );
    return () => {
      clearTimeout(timer);
      searchVersion.current++;
      previewVersion.current++;
    };
  }, [query, source, mode, revision]);

  async function more() {
    if (!after || loading) return;
    const version = searchVersion.current;
    const key = criteria.current;
    setLoading(true);
    setError("");
    try {
      const page = await rpc("browseSkins", {
        query: query.trim(),
        mode,
        after,
      });
      if (version !== searchVersion.current || key !== criteria.current) return;
      setEntries((old) => [
        ...old,
        ...page.skins.filter((s) => !old.some((e) => e.id === s.id)),
      ]);
      setAfter(page.after === after ? null : page.after);
    } catch (e) {
      if (version === searchVersion.current) setError(errorMessage(e));
    } finally {
      if (version === searchVersion.current) setLoading(false);
    }
  }
  async function save() {
    if (!selected || saved || saveLock.current || !validSkinName(libraryName))
      return;
    saveLock.current = true;
    setSaving(true);
    setPreviewError("");
    try {
      const value = await rpc("saveLibrarySkin", {
        id: null,
        name: libraryName.trim(),
        model: selected.model,
        bytes: textureBytes(selected.texture),
        capeId: null,
      });
      await onSaved(value);
    } catch (e) {
      setPreviewError(errorMessage(e));
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      wide
      className="skin-browser-modal"
      title={t("Браузер скинов")}
      subtitle="MineSkin"
      onClose={onClose}
      closeDisabled={saving}
    >
      <div className="skin-browser-toolbar">
        <div className="skin-browser-search">
          <Search size={17} />
          <input
            aria-label={t("Поиск скинов")}
            placeholder={t(
              source === "player"
                ? "Ник Minecraft или UUID"
                : source === "mineskin"
                  ? "ID или ссылка MineSkin"
                  : "Название, тег или ссылка MineSkin",
            )}
            value={query}
            maxLength={source === "catalog" ? 100 : 200}
            disabled={saving}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setRevision((n) => n + 1);
            }}
          />
        </div>
        <Select
          fitOptions
          menuClassName="skin-browser-select-menu"
          aria-label={t("Где искать скины")}
          value={source}
          disabled={saving}
          onValueChange={(v) => setSource(v as Source)}
          options={[
            { value: "catalog", label: t("Каталог MineSkin") },
            { value: "player", label: t("По нику игрока") },
            { value: "mineskin", label: t("По ID или ссылке") },
          ]}
        />
        {source === "catalog" && (
          <Select
            fitOptions
            menuClassName="skin-browser-select-menu"
            aria-label={t("Порядок скинов")}
            value={mode}
            disabled={saving}
            onValueChange={(v) => setMode(v as Mode)}
            options={[
              { value: "latest", label: t("Новые скины") },
              { value: "popular", label: t("Популярные скины") },
              { value: "random", label: t("Случайные скины") },
            ]}
          />
        )}
      </div>
      <div className="skin-browser-body">
        <section
          className="skin-browser-results"
          aria-label={t("Результаты поиска скинов")}
          aria-busy={loading}
        >
          {error && (
            <ErrorBox
              error={error}
              retry={() =>
                after && entries.length
                  ? void more()
                  : setRevision((n) => n + 1)
              }
            />
          )}
          <div className="skin-browser-grid">
            {entries.map((entry) => (
              <BrowserTile
                key={entry.id}
                entry={entry}
                selected={entry.id === selectedId}
                onClick={() => {
                  if (!saving) void openSkin(entry.id);
                }}
              />
            ))}
          </div>
          {loading ? (
            <Loading label={t("Ищем скины…")} />
          ) : !entries.length &&
            !selected &&
            !previewLoading &&
            !error &&
            !previewError ? (
            <p className="skin-browser-empty">
              <Globe size={32} />
              {t(
                source === "catalog"
                  ? "Скины не найдены. Попробуйте другое название или тег."
                  : "Введите ник, UUID или ID скина в строку поиска.",
              )}
            </p>
          ) : null}
          {after && (
            <button
              className="button secondary skin-browser-more"
              disabled={loading || saving}
              onClick={() => void more()}
            >
              {t("Показать ещё скины")}
            </button>
          )}
        </section>
        <aside
          className={`skin-browser-detail ${selected && !saved ? "skin-browser-editable" : ""}`}
          aria-label={t("Просмотр выбранного скина")}
        >
          {previewLoading ? (
            <Loading label={t("Загружаем скин…")} />
          ) : selected ? (
            <>
              <SkinPreview
                key={selected.id}
                texture={selected.texture}
                model={selected.model}
                onError={setPreviewError}
              />
              <h3>{selected.name || t("Без названия")}</h3>
              <small
                className="browser-skin-id"
                title={selected.id.split(":").at(-1)}
              >
                ID: {selected.shortId || selected.id.split(":").at(-1)}
              </small>
              <small>
                {t(selected.model === "alex" ? "Тонкие руки" : "Обычные руки")}
              </small>
              {!saved && (
                <Field label={t("Название образа")}>
                  <input
                    aria-label={t("Название образа")}
                    value={libraryName}
                    maxLength={120}
                    placeholder={t("Без названия")}
                    disabled={saving}
                    aria-invalid={!validSkinName(libraryName)}
                    aria-describedby={
                      !validSkinName(libraryName)
                        ? "skin-browser-name-error"
                        : undefined
                    }
                    onChange={(event) => setLibraryName(event.target.value)}
                  />
                  {!validSkinName(libraryName) && (
                    <small id="skin-browser-name-error" role="alert">
                      {t(
                        libraryName.trim()
                          ? "Название слишком длинное. Сократите его."
                          : "Введите название скина",
                      )}
                    </small>
                  )}
                </Field>
              )}
              <button
                className="button primary"
                disabled={saving || !!saved || !validSkinName(libraryName)}
                onClick={() => void save()}
              >
                {saved ? <Check size={16} /> : <Plus size={16} />}
                {t(
                  saved
                    ? "Уже в библиотеке"
                    : saving
                      ? "Добавляем скин…"
                      : "Добавить в библиотеку",
                )}
              </button>
              <p>
                {t(
                  "Добавление в библиотеку не меняет скин аккаунта. Выберите сохранённый скин и нажмите «Применить».",
                )}
              </p>
            </>
          ) : (
            <p className="skin-browser-empty">
              <Shirt size={36} />
              {t("Выберите скин для просмотра")}
            </p>
          )}
          {previewError && (
            <ErrorBox
              error={previewError}
              retry={() =>
                void openSkin(
                  selectedId,
                  source === "player" ? "player" : "mineskin",
                )
              }
            />
          )}
        </aside>
      </div>
    </Modal>
  );
}
