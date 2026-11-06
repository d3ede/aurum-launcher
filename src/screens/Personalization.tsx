import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  GripVertical,
  House,
  ImagePlus,
  LayoutTemplate,
  Sun,
  Moon,
  Monitor,
  Palette,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Server,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { useApp } from "../context";
import { t } from "../lib/i18n";
import { Field } from "../components/ui";
import { Select } from "../components/Select";
import {
  applyAppearance,
  applyFont,
  builtInThemes,
  homeDefaults,
  preferences,
  readPersonalFile,
  type CustomTheme,
  type HomeBlock,
} from "../lib/personalization";

import {
  SettingsPageHeading,
  scrollSettingsToTop,
} from "../components/SettingsPageHeading";
import { ThemeEditor } from "./ThemeEditor";

const blocks = {
  launch: { label: "Быстрый запуск", Icon: Play },
  servers: { label: "Недавние серверы", Icon: Server },
  profiles: { label: "Недавние сборки", Icon: LayoutTemplate },
  discover: { label: "Рекомендации", Icon: Sparkles },
};
function Intro({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-title">
      <span>{icon}</span>
      <div>
        <h2>{t(title)}</h2>
        <p>{children}</p>
      </div>
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox-label">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{t(label)}</span>
    </label>
  );
}
export function HomeSettings() {
  const { data, saveSettings, busy, notify, navigate } = useApp();
  const [draft, setDraft] = useState(() => preferences(data.settings).home);
  const [dragging, setDragging] = useState<HomeBlock | null>(null);
  const set = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) => setDraft((old) => ({ ...old, [key]: value }));
  const move = (from: HomeBlock, to: HomeBlock) =>
    setDraft((old) => {
      const order = [...old.order];
      order.splice(order.indexOf(from), 1);
      order.splice(old.order.indexOf(to), 0, from);
      return { ...old, order };
    });
  const active = (block: HomeBlock) =>
    block === "launch"
      ? draft.launch !== "hidden"
      : block === "servers"
        ? draft.serverCount > 0
        : block === "profiles"
          ? draft.profileCount > 0
          : draft.discovery !== "hidden";
  const [reading, setReading] = useState(false);
  return (
    <form
      className="settings-form customization-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          await saveSettings({
            ...data.settings,
            personalization: { ...preferences(data.settings), home: draft },
          })
        )
          navigate("home");
      }}
    >
      <section className="settings-section">
        <Intro icon={<House size={22} />} title="Ваша главная">
          {t("Выберите, что встречает вас при запуске лаунчера.")}
        </Intro>
        <div className="home-editor-layout">
          <div className="home-block-editor">
            <h3>{t("Порядок блоков")}</h3>
            <p className="customization-hint">
              {t("Перетаскивайте за ручку или используйте стрелки.")}
            </p>
            <div className="home-block-list">
              {draft.order.map((id, index) => {
                const { label, Icon } = blocks[id];
                return (
                  <div
                    key={id}
                    className={`home-block-row ${active(id) ? "" : "is-hidden"} ${dragging === id ? "is-dragging" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragging && dragging !== id) move(dragging, id);
                      setDragging(null);
                    }}
                  >
                    <span
                      className="block-drag-handle"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      title={t("Перетащить блок")}
                    >
                      <GripVertical size={18} />
                    </span>
                    <Icon size={18} />
                    <span className="block-label">
                      {t(label)}
                      <small>
                        {active(id) ? t("Показывается") : t("Скрыт")}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={!index}
                      aria-label={t("Переместить {{name}} вверх", {
                        name: t(label),
                      })}
                      onClick={() => move(id, draft.order[index - 1])}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={index === draft.order.length - 1}
                      aria-label={t("Переместить {{name}} вниз", {
                        name: t(label),
                      })}
                      onClick={() => move(id, draft.order[index + 1])}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className="home-layout-preview"
            aria-label={t("Предпросмотр главной")}
            style={
              draft.background && draft.backgroundTarget === "page"
                ? {
                    backgroundImage: `linear-gradient(var(--surface-translucent), var(--surface-translucent)), url(${JSON.stringify(draft.background)})`,
                  }
                : undefined
            }
          >
            <div className="home-preview-heading">
              <Eye size={15} />
              {t("Предпросмотр главной")}
            </div>
            <div className="home-preview-columns">
              <div>
                {draft.order.filter(active).map((id) => (
                  <div
                    key={id}
                    className={`preview-block preview-${id}`}
                    style={
                      id === "launch" &&
                      draft.background &&
                      draft.backgroundTarget === "launch"
                        ? {
                            backgroundImage: `linear-gradient(var(--surface-translucent), var(--surface-translucent)), url(${JSON.stringify(draft.background)})`,
                          }
                        : undefined
                    }
                  >
                    <span>{t(blocks[id].label)}</span>
                    {id === "profiles" || id === "servers" ? (
                      <div className="preview-tiles">
                        {Array.from(
                          {
                            length:
                              id === "profiles"
                                ? draft.profileCount
                                : draft.serverCount,
                          },
                          (_, i) => (
                            <i key={i} />
                          ),
                        )}
                      </div>
                    ) : (
                      <i />
                    )}
                  </div>
                ))}
              </div>
              {draft.sidebar && (
                <aside>
                  <i />
                  <i />
                  <i />
                </aside>
              )}
            </div>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <Intro icon={<Play size={21} />} title="Быстрый запуск">
          {t("Большой блок на главной — под ваш способ играть.")}
        </Intro>
        <Field label={t("Что запускать")}>
          <Select
            aria-label={t("Что запускать")}
            value={draft.launch}
            onValueChange={(v) => set("launch", v as typeof draft.launch)}
            options={[
              {
                value: "last-profile",
                label: t("Последняя запущенная сборка"),
              },
              { value: "last-server", label: t("Последний сервер") },
              { value: "profile", label: t("Определённая сборка") },
              { value: "hidden", label: t("Скрыть блок") },
            ]}
          />
        </Field>
        {draft.launch === "profile" && (
          <Field label={t("Сборка для быстрого запуска")}>
            <Select
              aria-label={t("Сборка для быстрого запуска")}
              value={draft.profileId}
              onValueChange={(v) => set("profileId", v)}
              options={[
                { value: "", label: t("Выберите сборку") },
                ...data.profiles.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            {!data.profiles.length && (
              <small>{t("Сначала создайте сборку.")}</small>
            )}
          </Field>
        )}
        <Toggle
          label="Повторять сборку из быстрого запуска в недавних"
          checked={draft.repeatProfile}
          onChange={(v) => set("repeatProfile", v)}
        />
      </section>
      <section className="settings-section">
        <Intro icon={<LayoutTemplate size={21} />} title="Содержимое страницы">
          {t("Ноль скрывает блок. Можно оставить только нужное.")}
        </Intro>
        <div className="form-grid">
          {(
            [
              ["profileCount", "Количество недавних сборок"],
              ["serverCount", "Количество серверов"],
            ] as const
          ).map(([key, label]) => (
            <Field label={t(label)} key={key}>
              <input
                aria-label={t(label)}
                type="number"
                min={0}
                max={12}
                value={draft[key]}
                onChange={(e) =>
                  set(key, Math.min(12, Math.max(0, Number(e.target.value))))
                }
              />
            </Field>
          ))}
        </div>
        <Field label={t("Что показывать в рекомендациях")}>
          <Select
            aria-label={t("Что показывать в рекомендациях")}
            value={draft.discovery}
            onValueChange={(v) => set("discovery", v as typeof draft.discovery)}
            options={[
              { value: "modrinth", label: t("Популярное в Modrinth") },
              { value: "curseforge", label: t("Популярное в CurseForge") },
              { value: "modpacks", label: t("Сборки из Modrinth") },
              { value: "hidden", label: t("Скрыть блок") },
            ]}
          />
        </Field>
        <Toggle
          label="Показывать аккаунт и новости сбоку"
          checked={draft.sidebar}
          onChange={(v) => set("sidebar", v)}
        />
      </section>
      <section className="settings-section">
        <Intro icon={<ImagePlus size={21} />} title="Свой фон">
          {t("PNG, JPG или WebP до 2 МБ. Картинка сохранится в настройках.")}
        </Intro>
        <div className="background-editor">
          {draft.background && (
            <img src={draft.background} alt={t("Свой фон")} />
          )}
          <label className="button secondary file-button">
            <Upload size={17} />
            {t("Выбрать изображение")}
            <input
              aria-label={t("Выбрать изображение")}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={reading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setReading(true);
                try {
                  set("background", await readPersonalFile(file, "image"));
                } catch (error) {
                  notify(t(String((error as Error).message)), true);
                } finally {
                  setReading(false);
                  e.target.value = "";
                }
              }}
            />
          </label>
          {draft.background && (
            <button
              type="button"
              className="text-button danger"
              onClick={() => set("background", "")}
            >
              <Trash2 size={16} />
              {t("Убрать изображение")}
            </button>
          )}
        </div>
        <Field label={t("Где использовать фон")}>
          <Select
            aria-label={t("Где использовать фон")}
            value={draft.backgroundTarget}
            onValueChange={(v) =>
              set("backgroundTarget", v as typeof draft.backgroundTarget)
            }
            options={[
              { value: "launch", label: t("В быстром запуске") },
              { value: "page", label: t("На всей главной") },
            ]}
          />
        </Field>
      </section>
      <div className="settings-save">
        <button
          type="button"
          className="text-button"
          onClick={() => setDraft(structuredClone(homeDefaults))}
        >
          <RotateCcw size={16} />
          {t("Сбросить главную")}
        </button>
        <button className="button primary" disabled={busy || reading}>
          <Save size={17} />
          {t("Сохранить и открыть главную")}
        </button>
      </div>
    </form>
  );
}

export function AppearanceSettings() {
  const { data, saveSettings, busy, notify, openSettings } = useApp();
  const [draft, setDraft] = useState(
    () => preferences(data.settings).appearance,
  );
  const [base, setBase] = useState(data.settings.theme);
  const [editor, setEditor] = useState<CustomTheme | null>(null);
  useLayoutEffect(scrollSettingsToTop, [!!editor]);
  const [reading, setReading] = useState(false);
  const saved = useRef(data.settings);
  saved.current = data.settings;
  useEffect(() => {
    const personal = preferences(saved.current);
    const appearance = editor
      ? {
          ...draft,
          themeId: editor.id,
          themes: [...draft.themes.filter((v) => v.id !== editor.id), editor],
        }
      : draft;
    applyAppearance({
      ...saved.current,
      theme: editor?.base || base,
      personalization: { ...personal, appearance },
    });
  }, [draft, base, editor]);
  useEffect(() => {
    void applyFont(draft.fontData).catch(() =>
      notify(t("Не удалось загрузить шрифт"), true),
    );
  }, [draft.fontData, notify]);
  useEffect(
    () => () => {
      applyAppearance(saved.current);
      void applyFont(preferences(saved.current).appearance.fontData).catch(
        () => {},
      );
    },
    [],
  );
  const choose = (id: string, themeBase: typeof base) => {
    setDraft((old) => ({ ...old, themeId: id }));
    setBase(themeBase);
    setEditor(null);
  };
  const custom = [...builtInThemes, ...draft.themes];
  const createTheme = () => {
    const current = custom.find((item) => item.id === draft.themeId);
    const style = getComputedStyle(document.documentElement);
    const color = (key: string) => style.getPropertyValue(`--${key}`).trim();
    setEditor({
      id: `custom-${crypto.randomUUID()}`,
      name: t("Моя тема"),
      base:
        document.documentElement.dataset.theme === "light" ? "light" : "dark",
      colors: current
        ? { ...current.colors }
        : {
            bg: color("bg"),
            surface: color("surface"),
            sidebar: color("sidebar"),
            text: color("text"),
            secondary: color("secondary"),
            border: color("border"),
            accent: color("gold"),
            accentInk: color("accent-ink"),
          },
    });
  };
  if (editor)
    return (
      <ThemeEditor
        theme={editor}
        isNew={!draft.themes.some((item) => item.id === editor.id)}
        busy={busy}
        onChange={setEditor}
        onBack={() => setEditor(null)}
        onSave={async () => {
          const theme = { ...editor, name: editor.name.trim() };
          if (!theme.name) return;
          const appearance = {
            ...draft,
            themeId: theme.id,
            themes: [...draft.themes.filter((v) => v.id !== theme.id), theme],
          };
          if (
            await saveSettings({
              ...data.settings,
              theme: theme.base,
              personalization: { ...preferences(data.settings), appearance },
            })
          ) {
            setDraft(appearance);
            setBase(theme.base);
            setEditor(null);
          }
        }}
      />
    );
  return (
    <div className="settings-page" data-settings-page="appearance">
      <SettingsPageHeading
        title="Внешний вид"
        description="Темы, свои цвета и шрифт"
        onBack={() => openSettings("general")}
      />
      <form
        className="settings-form customization-form"
        onSubmit={async (e) => {
          e.preventDefault();
          await saveSettings({
            ...data.settings,
            theme: base,
            personalization: {
              ...preferences(data.settings),
              appearance: draft,
            },
          });
        }}
      >
        <section className="settings-section">
          <Intro icon={<Palette size={22} />} title="Настроение лаунчера">
            {t(
              "Выберите готовую палитру или создайте свою. Изменения видны сразу.",
            )}
          </Intro>
          <div className="appearance-theme-grid">
            {(
              [
                { id: "light", name: "Тёплый свет", base: "light" },
                { id: "dark", name: "Тихий вечер", base: "dark" },
                { id: "system", name: "Системная тема", base: "system" },
              ] as const
            ).map((item) => (
              <button
                type="button"
                key={item.id}
                className={`theme-option ${item.id} ${draft.themeId === item.id ? "selected" : ""}`}
                aria-pressed={draft.themeId === item.id}
                aria-label={t(item.name)}
                aria-describedby={`theme-kind-${item.id}`}
                onClick={() => choose(item.id, item.base)}
              >
                <div className="theme-mini">
                  <span />
                  <div>
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <span>
                  {item.base === "light" ? (
                    <Sun size={16} />
                  ) : item.base === "dark" ? (
                    <Moon size={16} />
                  ) : (
                    <Monitor size={16} />
                  )}
                  <span className="theme-card-name">
                    {t(item.name)}
                    <small id={`theme-kind-${item.id}`}>
                      {t(
                        item.base === "light"
                          ? "Светлая"
                          : item.base === "dark"
                            ? "Тёмная"
                            : "Автоматически",
                      )}
                    </small>
                  </span>
                  {draft.themeId === item.id && (
                    <Check className="theme-selected-check" size={15} />
                  )}
                </span>
              </button>
            ))}
            {custom.map((item) => (
              <div className="custom-theme-card" key={item.id}>
                <button
                  type="button"
                  className={`theme-option ${draft.themeId === item.id ? "selected" : ""}`}
                  aria-pressed={draft.themeId === item.id}
                  aria-label={
                    builtInThemes.some((v) => v.id === item.id)
                      ? t(item.name)
                      : item.name
                  }
                  aria-describedby={`theme-kind-${item.id}`}
                  onClick={() => choose(item.id, item.base)}
                >
                  <div
                    className="palette-mini"
                    style={{
                      background: item.colors.bg,
                      borderColor: item.colors.border,
                    }}
                  >
                    <span style={{ background: item.colors.sidebar }} />
                    <div>
                      <b style={{ background: item.colors.accent }} />
                      <div>
                        {[0, 1, 2].map((i) => (
                          <i
                            key={i}
                            style={{
                              background: item.colors.surface,
                              borderColor: item.colors.border,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <span>
                    {item.base === "light" ? (
                      <Sun size={16} />
                    ) : (
                      <Moon size={16} />
                    )}
                    <span className="theme-card-name">
                      {builtInThemes.some((v) => v.id === item.id)
                        ? t(item.name)
                        : item.name}
                      <small id={`theme-kind-${item.id}`}>
                        {t(item.base === "light" ? "Светлая" : "Тёмная")}
                      </small>
                    </span>
                    {draft.themeId === item.id && (
                      <Check className="theme-selected-check" size={15} />
                    )}
                  </span>
                </button>
                {draft.themes.some((v) => v.id === item.id) && (
                  <div className="custom-theme-actions">
                    <button
                      className="text-button"
                      type="button"
                      aria-label={t("Изменить тему {{name}}", {
                        name: item.name,
                      })}
                      onClick={() => setEditor(structuredClone(item))}
                    >
                      <Pencil size={13} />
                      {t("Изменить")}
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={t("Удалить тему {{name}}", {
                        name: item.name,
                      })}
                      onClick={() => {
                        setDraft((old) => ({
                          ...old,
                          themes: old.themes.filter((v) => v.id !== item.id),
                          themeId:
                            old.themeId === item.id ? "light" : old.themeId,
                        }));
                        if (draft.themeId === item.id) setBase("light");
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            <button
              type="button"
              className="create-theme-card"
              onClick={createTheme}
            >
              <Plus size={38} strokeWidth={1.4} />
              <b>{t("Создать свою тему")}</b>
              <small>{t("Ваши цвета и название")}</small>
            </button>
          </div>
        </section>
        <section className="settings-section">
          <Intro icon={<Type size={22} />} title="Шрифт интерфейса">
            {t("Выберите установленный шрифт или загрузите свой файл.")}
          </Intro>
          <Field label={t("Шрифт интерфейса")}>
            <Select
              aria-label={t("Шрифт интерфейса")}
              value={
                [
                  "",
                  "Segoe UI",
                  "Arial",
                  "Georgia",
                  "Verdana",
                  "Consolas",
                ].includes(draft.font)
                  ? draft.font
                  : "custom"
              }
              onValueChange={(v) =>
                setDraft({
                  ...draft,
                  font: v === "custom" ? "Inter Variable" : v,
                  fontData: "",
                })
              }
              options={[
                { value: "", label: t("По умолчанию · Inter") },
                ...["Segoe UI", "Arial", "Georgia", "Verdana", "Consolas"].map(
                  (font) => ({ value: font, label: font }),
                ),
                { value: "custom", label: t("Другой шрифт") },
              ]}
            />
          </Field>
          <Field
            label={t("Название установленного шрифта")}
            hint={t(
              "Шрифт должен быть установлен на компьютере. Иначе используется Inter.",
            )}
          >
            <input
              aria-label={t("Название установленного шрифта")}
              placeholder="Inter, Manrope, Nunito…"
              value={draft.font}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  font: e.target.value.slice(0, 100),
                  fontData: "",
                })
              }
            />
          </Field>
          <div className="button-row">
            <label className="button secondary file-button">
              <Upload size={16} />
              {t("Загрузить шрифт")}
              <input
                type="file"
                aria-label={t("Загрузить шрифт")}
                accept=".woff,.woff2,.ttf,.otf"
                disabled={reading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setReading(true);
                  try {
                    const fontData = await readPersonalFile(file, "font");
                    await new FontFace(
                      "Aurum Font Check",
                      `url(${JSON.stringify(fontData)})`,
                    ).load();
                    setDraft({ ...draft, font: file.name, fontData });
                  } catch {
                    notify(
                      t(
                        "Не удалось загрузить шрифт. Выберите WOFF, WOFF2, TTF или OTF до 2 МБ.",
                      ),
                      true,
                    );
                  } finally {
                    setReading(false);
                    e.target.value = "";
                  }
                }}
              />
            </label>
            {(draft.font || draft.fontData) && (
              <button
                type="button"
                className="text-button"
                onClick={() => setDraft({ ...draft, font: "", fontData: "" })}
              >
                {t("Шрифт по умолчанию")}
              </button>
            )}
          </div>
          <p
            className="font-preview"
            style={{
              fontFamily: draft.fontData
                ? undefined
                : draft.font
                  ? `${JSON.stringify(draft.font)}, sans-serif`
                  : undefined,
            }}
          >
            Aurum · {t("Ваш следующий мир начинается здесь.")}
            <small>Аа Бб Вв · Aa Bb Cc · 0123456789</small>
          </p>
        </section>
        <div className="settings-save">
          <span>
            {t(
              "Сохраните, чтобы использовать оформление при следующем запуске.",
            )}
          </span>
          <button
            className="button primary"
            disabled={busy || reading || !!editor}
          >
            <Save size={17} />
            {t("Сохранить оформление")}
          </button>
        </div>
      </form>
    </div>
  );
}
