import { useEffect, useRef, useState } from "react";
import {
  Check,
  Eye,
  House,
  Layers3,
  Palette,
  Play,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Field } from "../components/ui";
import { Select } from "../components/Select";
import { SettingsPageHeading } from "../components/SettingsPageHeading";
import {
  builtInThemes,
  type CustomTheme,
  type ThemePalette,
} from "../lib/personalization";
import { t } from "../lib/i18n";

const colorGroups: {
  title: string;
  hint: string;
  fields: { key: keyof ThemePalette; label: string; hint: string }[];
}[] = [
  {
    title: "Фон и поверхности",
    hint: "Основа оформления: страница, карточки и навигация.",
    fields: [
      { key: "bg", label: "Фон страницы", hint: "Пространство за карточками" },
      { key: "surface", label: "Карточки", hint: "Панели, поля и окна" },
      {
        key: "sidebar",
        label: "Боковая панель",
        hint: "Меню и верхняя панель",
      },
      { key: "border", label: "Границы", hint: "Контуры и разделители" },
    ],
  },
  {
    title: "Текст и читаемость",
    hint: "Текст должен хорошо читаться на выбранном фоне.",
    fields: [
      { key: "text", label: "Основной текст", hint: "Заголовки и названия" },
      {
        key: "secondary",
        label: "Вторичный текст",
        hint: "Подписи и описания",
      },
    ],
  },
  {
    title: "Акцентные цвета",
    hint: "Кнопки, выбранные элементы и детали интерфейса.",
    fields: [
      { key: "accent", label: "Акцент", hint: "Основные кнопки и выделение" },
      {
        key: "accentInk",
        label: "Текст акцента",
        hint: "Значки и акцентные подписи",
      },
    ],
  },
];

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <div className="theme-editor-color">
      <input
        className="theme-color-swatch"
        type="color"
        aria-label={t(label)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div>
        <b>{t(label)}</b>
        <small>{t(hint)}</small>
      </div>
      <input
        className="theme-color-hex"
        aria-label={t("HEX: {{name}}", { name: t(label) })}
        value={hex}
        maxLength={7}
        spellCheck={false}
        onChange={(e) => {
          setHex(e.target.value);
          if (/^#[\da-f]{6}$/i.test(e.target.value)) onChange(e.target.value);
        }}
        onBlur={() => setHex(value)}
      />
    </div>
  );
}

export function ThemeEditor({
  theme,
  isNew,
  busy,
  onChange,
  onSave,
  onBack,
}: {
  theme: CustomTheme;
  isNew: boolean;
  busy: boolean;
  onChange: (theme: CustomTheme) => void;
  onSave: () => Promise<void>;
  onBack: () => void;
}) {
  const original = useRef(structuredClone(theme));
  return (
    <div
      className="settings-page theme-editor-page"
      data-settings-page="theme-editor"
    >
      <SettingsPageHeading
        title={isNew ? "Создание своей темы" : "Редактирование темы"}
        description="Название, цвета и предпросмотр — всё оформление в одном месте."
        onBack={onBack}
        backLabel="Назад к внешнему виду"
      />
      <form
        className="theme-editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave();
        }}
      >
        <div className="theme-editor-layout">
          <div className="theme-editor-controls">
            <section className="settings-section">
              <div className="settings-title">
                <span>
                  <Palette size={22} />
                </span>
                <div>
                  <h2>{t("Ваша тема")}</h2>
                  <p>{t("Дайте теме имя, чтобы найти её в коллекции.")}</p>
                </div>
              </div>
              <Field label={t("Название темы")}>
                <input
                  required
                  autoFocus
                  aria-label={t("Название темы")}
                  maxLength={48}
                  placeholder={t("Например, Полярная ночь")}
                  value={theme.name}
                  onChange={(e) => onChange({ ...theme, name: e.target.value })}
                />
              </Field>
              <div className="theme-editor-base">
                <Field label={t("Основа темы")}>
                  <Select
                    aria-label={t("Основа темы")}
                    value={theme.base}
                    onValueChange={(base) =>
                      onChange({ ...theme, base: base as "light" | "dark" })
                    }
                    options={[
                      { value: "light", label: t("Светлая") },
                      { value: "dark", label: t("Тёмная") },
                    ]}
                  />
                </Field>
              </div>
              <div className="theme-starting-palettes">
                <span>{t("Взять цвета готовой темы")}</span>
                <div className="button-row">
                  {builtInThemes.map((preset) => (
                    <button
                      type="button"
                      className="theme-preset"
                      key={preset.id}
                      onClick={() =>
                        onChange({
                          ...theme,
                          base: preset.base,
                          colors: { ...preset.colors },
                        })
                      }
                    >
                      <i style={{ background: preset.colors.bg }} />
                      <i style={{ background: preset.colors.accent }} />
                      {t(preset.name)}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            {colorGroups.map((group) => (
              <section
                className="settings-section theme-editor-group"
                key={group.title}
              >
                <h2>{t(group.title)}</h2>
                <p>{t(group.hint)}</p>
                {group.fields.map(({ key, label, hint }) => (
                  <ColorField
                    key={key}
                    label={label}
                    hint={hint}
                    value={theme.colors[key]}
                    onChange={(value) =>
                      onChange({
                        ...theme,
                        colors: { ...theme.colors, [key]: value },
                      })
                    }
                  />
                ))}
              </section>
            ))}
          </div>
          <aside
            className="theme-editor-preview"
            aria-label={t("Предпросмотр темы")}
          >
            <div className="theme-preview-heading">
              <Eye size={17} />
              <b>{t("Предпросмотр темы")}</b>
              <span>{t("В реальном времени")}</span>
            </div>
            <div className="theme-preview-launcher">
              <div className="theme-preview-top">
                <span>Au</span>
                <b>Aurum</b>
                <i />
              </div>
              <div className="theme-preview-body">
                <nav aria-hidden="true">
                  <House size={19} />
                  <Layers3 size={19} />
                  <Settings2 size={19} />
                </nav>
                <div className="theme-preview-main">
                  <h3>{theme.name.trim() || t("Моя тема")}</h3>
                  <p>{t("Ваш следующий мир начинается здесь.")}</p>
                  <div className="theme-preview-hero">
                    <Sparkles size={26} />
                    <b>Minecraft</b>
                    <small>{t("Готова к запуску")}</small>
                    <span className="button primary">
                      <Play size={14} />
                      {t("Играть")}
                    </span>
                  </div>
                  <div className="theme-preview-cards">
                    <div>
                      <i />
                      <b>Vanilla</b>
                      <small>Minecraft</small>
                    </div>
                    <div>
                      <i />
                      <b>Fabric</b>
                      <small>Minecraft</small>
                    </div>
                  </div>
                  <div className="theme-preview-selection">
                    <Check size={15} />
                    {t("Выбранный элемент")}
                  </div>
                </div>
              </div>
            </div>
            <p className="theme-preview-hint">
              {t(
                "Цвета также применяются к окну лаунчера. Сохраните тему, чтобы оставить их.",
              )}
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                onChange({
                  ...theme,
                  base: original.current.base,
                  colors: { ...original.current.colors },
                })
              }
            >
              <RotateCcw size={15} />
              {t("Вернуть исходные цвета")}
            </button>
          </aside>
        </div>
        <div className="theme-editor-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onBack}
            disabled={busy}
          >
            {t("Отмена")}
          </button>
          <button
            className="button primary"
            disabled={!theme.name.trim() || busy}
          >
            <Save size={17} />
            {t("Сохранить тему")}
          </button>
        </div>
      </form>
    </div>
  );
}
