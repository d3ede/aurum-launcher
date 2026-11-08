import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Download,
  Gamepad2,
  Keyboard,
  Languages,
  Monitor,
  Mouse,
  Plus,
  Pencil,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  Volume2,
  ScanEye,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { t } from "../lib/i18n";
import {
  bindingFromEvent,
  blankGamePreset,
  defaultBindings,
  displayBinding,
  editGameOption,
  gameCategories,
  parseGameOptions,
  supportedGameOptions,
  type GameCategory,
  type GameOption,
  type GameSettingsPreset,
} from "../lib/game-settings";
import { SettingsPageHeading } from "../components/SettingsPageHeading";
import { EmptyState, Field, Modal } from "../components/ui";
import { Select } from "../components/Select";
import "./game-settings.css";

const categoryIcons = {
  graphics: Monitor,
  fov: ScanEye,
  controls: Keyboard,
  mouse: Mouse,
  sound: Volume2,
  interface: Languages,
};
// Keep unfinished edits when navigating within the launcher. They never become
// installation presets until the player explicitly saves the profile.
const draftCache = new Map<string, GameSettingsPreset>();
const selectionCache = new Map<string, string>();

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="game-settings-toggle"
      disabled={disabled}
      onClick={onChange}
    >
      <span />
    </button>
  );
}

export function GameSettings() {
  const { data, busy, run, openSettings, notify } = useApp();
  const presets = data.gameSettingsProfiles ?? [];
  const [selected, setSelected] = useState(
    () =>
      presets.find((p) => p.id === selectionCache.get(data.dataDir))?.id ??
      presets[0]?.id ??
      "",
  );
  const current = presets.find((p) => p.id === selected);
  const [draft, setDraft] = useState<GameSettingsPreset | null>(
    current
      ? structuredClone(
          draftCache.get(`${data.dataDir}:${current.id}`) ?? current,
        )
      : null,
  );
  const [group, setGroup] = useState<GameCategory | null>(null);
  const [create, setCreate] = useState(false);
  const [remove, setRemove] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [replaceImport, setReplaceImport] = useState(false);
  const [apply, setApply] = useState(false);
  const [target, setTarget] = useState("");
  const [report, setReport] = useState<{
    applied: number;
    skipped: string[];
  } | null>(null);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(current);
  const select = (id: string) => {
    if (draft) draftCache.delete(`${data.dataDir}:${draft.id}`);
    setSelected(id);
    setDraft(structuredClone(presets.find((p) => p.id === id) ?? null));
    setReport(null);
  };
  useEffect(() => {
    selectionCache.set(data.dataDir, selected);
    if (draft) {
      const key = `${data.dataDir}:${draft.id}`;
      if (dirty) draftCache.set(key, structuredClone(draft));
      else draftCache.delete(key);
    }
  }, [draft, dirty, data.dataDir, selected]);
  useEffect(() => {
    if (!current && presets.length && !draft) select(presets[0].id);
  }, [presets.length, selected]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  const save = async () => {
    if (!draft) return false;
    const result = await run(
      () =>
        rpc("gameSettings.save", {
          preset: { ...draft, name: draft.name.trim() },
        }),
      t("@game.saved"),
    );
    if (result) {
      setDraft(result);
      return true;
    }
    return false;
  };
  const receive = (preset: GameSettingsPreset) => {
    setSelected(preset.id);
    setDraft(preset);
    setCreate(false);
    setImportOpen(false);
    setReplaceImport(false);
    setReport(null);
  };
  const targets = data.profiles.filter((p) => p.engine !== "horizon");
  return (
    <div className="settings-page game-settings-page" data-settings-page="game">
      <SettingsPageHeading
        title="@game.title"
        description="@game.description"
        onBack={() => openSettings("general")}
      />
      <div className="game-settings-intro">
        <span className="game-settings-mark">
          <Gamepad2 size={28} />
        </span>
        <div>
          <b>{t("@game.intro")}</b>
          <p>{t("@game.introText")}</p>
        </div>
        <span className="game-settings-cap">{presets.length} / 5</span>
      </div>
      <div className="game-settings-workspace">
        <aside
          className="game-settings-library"
          aria-label={t("@game.profiles")}
        >
          <div className="game-settings-section-head">
            <h2>{t("@game.profiles")}</h2>
            <span>{presets.length}/5</span>
          </div>
          <div className="game-settings-profile-list">
            {presets.map((preset, i) => (
              <button
                type="button"
                key={preset.id}
                className={`game-settings-profile ${selected === preset.id ? "selected" : ""}`}
                aria-pressed={selected === preset.id}
                onClick={() => {
                  if (preset.id === selected) return;
                  if (dirty) setSwitchTo(preset.id);
                  else select(preset.id);
                }}
              >
                <span className="game-settings-profile-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <b>{preset.name}</b>
                  <small>Minecraft {preset.sourceVersion}</small>
                </span>
                {selected === preset.id ? (
                  <Check size={16} />
                ) : (
                  <ChevronRight size={16} />
                )}
              </button>
            ))}
          </div>
          <button
            className="button secondary"
            disabled={busy || presets.length >= 5 || dirty}
            onClick={() => setCreate(true)}
          >
            <Plus size={16} />
            {t("@game.new")}
          </button>
          <button
            className="text-button"
            disabled={busy || presets.length >= 5 || dirty}
            onClick={() => setImportOpen(true)}
          >
            <Download size={16} />
            {t("@game.import")}
          </button>
          <p className="game-settings-library-note">
            {t(presets.length >= 5 ? "@game.limit" : "@game.local")}
          </p>
        </aside>
        <section
          className="game-settings-detail"
          aria-label={t("@game.editor")}
        >
          {draft ? (
            <>
              <div className="game-settings-detail-head">
                <div>
                  <span className="game-settings-eyebrow">
                    {t("@game.profile")}
                  </span>
                  <h2 className="game-settings-name">
                    <input
                      aria-label={t("@game.name")}
                      value={draft.name}
                      placeholder={t("@game.untitled")}
                      maxLength={80}
                      disabled={busy}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                    />
                    <Pencil size={15} />
                  </h2>
                  <p>
                    {draft.sourceName
                      ? t("@game.source", {
                          name: draft.sourceName,
                          version: draft.sourceVersion,
                        })
                      : t("@game.defaults", { version: draft.sourceVersion })}
                  </p>
                </div>
                <button
                  className="icon-button danger"
                  disabled={busy}
                  aria-label={t("@game.delete")}
                  onClick={() => setRemove(true)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <div className="game-settings-section-head">
                <div>
                  <h3>{t("@game.categories")}</h3>
                  <p>{t("@game.categoriesText")}</p>
                </div>
                <SlidersHorizontal size={20} />
              </div>
              <div className="game-settings-categories">
                {gameCategories.map((category) => {
                  const Icon = categoryIcons[category];
                  const enabled = draft.categories.includes(category);
                  return (
                    <div
                      key={category}
                      className={`game-settings-category ${enabled ? "enabled" : ""}`}
                    >
                      <button
                        type="button"
                        className="game-settings-category-open"
                        disabled={busy}
                        onClick={() => setGroup(category)}
                        aria-label={t("@game.configure", {
                          name: t(`@game.category.${category}`),
                        })}
                      >
                        <span className="game-settings-category-icon">
                          <Icon size={22} />
                        </span>
                        <span>
                          <b>{t(`@game.category.${category}`)}</b>
                          <small>{t(`@game.summary.${category}`)}</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                      <div className="game-settings-category-transfer">
                        <span>
                          {t(enabled ? "@game.transfer" : "@game.keepPack")}
                        </span>
                        <Toggle
                          checked={enabled}
                          disabled={busy}
                          label={t("@game.transferCategory", {
                            name: t(`@game.category.${category}`),
                          })}
                          onChange={() =>
                            setDraft({
                              ...draft,
                              categories: enabled
                                ? draft.categories.filter((c) => c !== category)
                                : [...draft.categories, category],
                            })
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="game-settings-footer">
                <span className={dirty ? "is-dirty" : ""}>
                  {dirty ? t("@game.unsaved") : t("@game.ready")}
                </span>
                <div className="game-settings-footer-actions">
                {dirty&&<button className="text-button" disabled={busy||!current} onClick={()=>current&&setDraft(structuredClone(current))}>{t("@game.discard")}</button>}
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    !dirty ||
                    !draft.name.trim() ||
                    !draft.categories.length
                  }
                  onClick={() => void save()}
                >
                  <Save size={16} />
                  {t("@game.save")}
                </button>
                </div>
              </div>
              {!draft.categories.length && (
                <p className="game-settings-warning" role="alert">
                  {t("@game.chooseCategory")}
                </p>
              )}
              <div className="game-settings-secondary-actions">
                <button
                  className="text-button"
                  disabled={busy || dirty}
                  onClick={() => {
                    setReplaceImport(true);
                    setImportOpen(true);
                  }}
                >
                  <Copy size={15} />
                  {t("@game.replaceImport")}
                </button>
                <button
                  className="text-button"
                  disabled={busy || dirty || !targets.length}
                  onClick={() => {
                    setTarget(
                      targets.find((p) => !data.running.includes(p.id))?.id ??
                        "",
                    );
                    setApply(true);
                    setReport(null);
                  }}
                >
                  {t("@game.applyExisting")}
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Gamepad2 size={34} />}
              title={t("@game.empty")}
              text={t("@game.emptyText")}
            >
              <button
                className="button primary"
                disabled={busy}
                onClick={() => setImportOpen(true)}
              >
                <Download size={17} />
                {t("@game.import")}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setCreate(true)}
              >
                <Plus size={17} />
                {t("@game.new")}
              </button>
            </EmptyState>
          )}
        </section>
      </div>
      {draft && group && (
        <CategoryEditor
          key={`${draft.id}:${group}`}
          preset={draft}
          category={group}
          onClose={() => setGroup(null)}
          onSave={(options) => {
            setDraft({ ...draft, options });
            setGroup(null);
          }}
        />
      )}
      {(create || importOpen) && (
        <ImportPreset
          initialName={replaceImport && draft ? draft.name : ""}
          replace={replaceImport && draft ? draft.id : undefined}
          importOnly={importOpen}
          onClose={() => {
            setCreate(false);
            setImportOpen(false);
            setReplaceImport(false);
          }}
          onSaved={receive}
        />
      )}
      {remove && draft && (
        <Modal
          title={t("@game.delete")}
          subtitle={t("@game.deleteText", { name: draft.name })}
          onClose={() => setRemove(false)}
          closeDisabled={busy}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRemove(false)}
            >
              {t("Отмена")}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                const done = await run(async () => {
                  await rpc("gameSettings.delete", { id: draft.id });
                  return true;
                });
                if (done) {
                  setRemove(false);
                  setDraft(null);
                  setSelected("");
                }
              }}
            >
              {t("Удалить")}
            </button>
          </div>
        </Modal>
      )}
      {switchTo !== null && (
        <Modal
          title={t("@game.unsaved")}
          subtitle={t("@game.unsavedText")}
          onClose={() => setSwitchTo(null)}
          closeDisabled={busy}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setSwitchTo(null)}
            >
              {t("Отмена")}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                select(switchTo);
                setSwitchTo(null);
              }}
            >
              {t("@game.discard")}
            </button>
            <button
              className="button primary"
              disabled={busy || !draft?.name.trim() || !draft.categories.length}
              onClick={async () => {
                if (await save()) {
                  const next = presets.find((p) => p.id === switchTo);
                  setSelected(switchTo);
                  setDraft(next ? structuredClone(next) : null);
                  setSwitchTo(null);
                }
              }}
            >
              {t("@game.save")}
            </button>
          </div>
        </Modal>
      )}
      {apply && draft && (
        <Modal
          title={t("@game.applyExisting")}
          subtitle={t("@game.applyText")}
          onClose={() => setApply(false)}
          closeDisabled={busy}
        >
          <Field label={t("@game.instance")}>
            <Select
              aria-label={t("@game.instance")}
              value={target}
              disabled={busy}
              onValueChange={(v) => {
                setTarget(v);
                setReport(null);
              }}
              options={[
                { value: "", label: t("Выберите сборку") },
                ...targets.map((p) => ({
                  value: p.id,
                  label: `${p.name} · ${p.minecraft}`,
                  disabled: data.running.includes(p.id),
                })),
              ]}
            />
          </Field>
          {report && (
            <p className="game-settings-result" role="status">
              {t("@game.partial", {
                applied: report.applied,
                skipped: report.skipped.length,
              })}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy || !target || data.running.includes(target)}
              onClick={async () => {
                await run(
                  () => rpc("gameSettings.restore", { profileId: target }),
                  t("@game.restored"),
                );
                setReport(null);
              }}
            >
              <RotateCcw size={15} />
              {t("@game.restore")}
            </button>
            <button
              className="button primary"
              disabled={busy || !target || data.running.includes(target)}
              onClick={async () => {
                const result = await run(() =>
                  rpc("gameSettings.apply", {
                    profileId: target,
                    presetId: draft.id,
                  }),
                );
                if (result) {
                  setReport(result);
                  notify(t("@game.applied"));
                }
              }}
            >
              {t("@game.apply")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ImportPreset({
  initialName,
  replace,
  importOnly,
  onClose,
  onSaved,
}: {
  initialName: string;
  replace?: string;
  importOnly: boolean;
  onClose: () => void;
  onSaved: (p: GameSettingsPreset) => void;
}) {
  const { data, busy, run } = useApp();
  const sources = data.profiles.filter((p) => p.engine !== "horizon");
  const [name, setName] = useState(initialName);
  const [source, setSource] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(!!replace);
  const limit =
    (data.gameSettingsProfiles?.length ?? 0) >= 5 && !replaceExisting;
  return (
    <Modal
      title={t(importOnly ? "@game.import" : "@game.new")}
      subtitle={t("@game.importText")}
      onClose={onClose}
      closeDisabled={busy}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await run(
            () =>
              source
                ? rpc("gameSettings.capture", {
                    profileId: source,
                    name: name.trim(),
                    ...(replaceExisting && replace
                      ? { replaceId: replace }
                      : {}),
                  })
                : rpc("gameSettings.save", {
                    preset: blankGamePreset(name.trim()),
                  }),
            t("@game.saved"),
          );
          if (result) onSaved(result);
        }}
      >
        <Field label={t("@game.name")}>
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("@game.namePlaceholder")}
          />
        </Field>
        <Field label={t("@game.importSource")}>
          <Select
            aria-label={t("@game.importSource")}
            disabled={busy}
            value={source}
            onValueChange={(id) => {
              setSource(id);
              if (!name) setName(sources.find((p) => p.id === id)?.name ?? "");
            }}
            options={[
              {
                value: "",
                label: t(
                  importOnly ? "@game.chooseSource" : "@game.useDefaults",
                ),
              },
              ...sources.map((p) => ({
                value: p.id,
                label: `${p.name} · ${p.minecraft}`,
                disabled: data.running.includes(p.id),
              })),
            ]}
          />
        </Field>
        <p className="game-settings-library-note">
          {t("@game.closeBeforeImport")}
        </p>
        {replace && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              disabled={busy}
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
            />
            {t("@game.replaceCurrent")}
          </label>
        )}
        {limit && (
          <p role="alert" className="game-settings-warning">
            {t("@game.limit")}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            {t("Отмена")}
          </button>
          <button
            className="button primary"
            disabled={busy || limit || !name.trim() || (importOnly && !source)}
          >
            <Download size={16} />
            {t(importOnly ? "@game.importAction" : "@game.createAction")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CategoryEditor({
  preset,
  category,
  onSave,
  onClose,
}: {
  preset: GameSettingsPreset;
  category: GameCategory;
  onSave: (options: string) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(preset.options);
  const values = parseGameOptions(raw);
  const options = supportedGameOptions(preset, category);
  const [capture, setCapture] = useState<string | null>(null);
  const set = (key: string, value: string) =>
    setRaw((old) => editGameOption(old, key, value));
  const Icon = categoryIcons[category];
  const keys = Object.entries(defaultBindings).filter(
    ([key]) =>
      key !== "swapOffhand" ||
      Number(preset.sourceVersion.split(".")[1]) >= 9 ||
      !preset.sourceVersion.startsWith("1."),
  );
  const conflicts = new Set(
    keys
      .map(([key]) => values[`key_key.${key}`] ?? defaultBindings[key])
      .filter(
        (value, i, array) =>
          value !== "key.keyboard.unknown" &&
          value !== "0" &&
          array.indexOf(value) !== i,
      ),
  );
  return (
    <Modal
      title={t(`@game.category.${category}`)}
      subtitle={t("@game.editText", { version: preset.sourceVersion })}
      wide
      className="game-option-modal"
      onClose={onClose}
    >
      <div className="game-option-banner">
        <Icon size={23} />
        <p>{t(`@game.summary.${category}`)}</p>
        <span>Minecraft {preset.sourceVersion}</span>
      </div>
      <div className="game-option-list">
        {options.map((option) => (
          <OptionControl
            key={option.key}
            option={option}
            value={values[option.key] ?? option.value}
            onChange={(value) => set(option.key, value)}
          />
        ))}
        {category === "controls" && (
          <>
            <div className="game-settings-section-head">
              <h3>{t("@game.keyBindings")}</h3>
              <small>{t("@game.keyHint")}</small>
            </div>
            {conflicts.size > 0 && (
              <p className="game-settings-warning" role="status">
                {t("@game.conflicts")}
              </p>
            )}
            <div className="game-keybindings">
              {keys.map(([key, defaultValue]) => {
                const value = values[`key_key.${key}`] ?? defaultValue;
                return (
                  <div className="game-keybinding" key={key}>
                    <span>{t(`@game.key.${key}`)}</span>
                    <button
                      type="button"
                      className={`game-keycap ${conflicts.has(value) ? "conflict" : ""}`}
                      aria-label={t("@game.bind", {
                        name: t(`@game.key.${key}`),
                      })}
                      onClick={() => setCapture(key)}
                    >
                      {displayBinding(value)}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t("@game.resetBinding", {
                        name: t(`@game.key.${key}`),
                      })}
                      disabled={value === defaultValue}
                      onClick={() => set(`key_key.${key}`, defaultValue)}
                    >
                      <RotateCcw size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          {t("Отмена")}
        </button>
        <button className="button primary" onClick={() => onSave(raw)}>
          <Check size={16} />
          {t("@game.done")}
        </button>
      </div>
      {capture && (
        <BindingCapture
          name={t(`@game.key.${capture}`)}
          onClose={() => setCapture(null)}
          onSelect={(value) => {
            set(`key_key.${capture}`, value);
            setCapture(null);
          }}
        />
      )}
    </Modal>
  );
}

function OptionControl({
  option,
  value,
  onChange,
}: {
  option: GameOption;
  value: string;
  onChange: (v: string) => void;
}) {
  const label = t(`@game.option.${option.key}`);
  const format = () =>
    option.key === "fov"
      ? `${Math.round(70 + Number(value) * 40)}°`
      : option.key === "guiScale" && value === "0"
        ? t("@game.auto")
        : option.key === "maxFps" && Number(value) >= 260
          ? t("@game.unlimited")
          : option.percent
            ? `${Math.round(Number(value) * (option.key === "mouseSensitivity" ? 200 : 100))}%`
            : value;
  return (
    <div className={`game-option game-option-${option.type}`}>
      <div className="game-option-label">
        <span>{label}</span>
        {option.type === "range" && <output>{format()}</output>}
      </div>
      {option.type === "range" ? (
        <input
          type="range"
          aria-label={label}
          aria-valuetext={format()}
          min={option.min}
          max={option.max}
          step={option.step}
          value={Number.isFinite(Number(value)) ? value : option.value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : option.type === "boolean" ? (
        <Toggle
          checked={value === "true"}
          label={label}
          onChange={() => onChange(value === "true" ? "false" : "true")}
        />
      ) : (
        <Select
          aria-label={label}
          value={value}
          onValueChange={onChange}
          options={[
            ...(option.choices?.some(([v]) => v === value)
              ? []
              : [{ value, label: value }]),
            ...(option.choices ?? []).map(([value, label]) => ({
              value,
              label: label.startsWith("@") ? t(label) : label,
            })),
          ]}
        />
      )}
    </div>
  );
}

function BindingCapture({
  name,
  onSelect,
  onClose,
}: {
  name: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  const pad = useRef<HTMLDivElement>(null);
  const [unsupported, setUnsupported] = useState(false);
  useEffect(() => {
    pad.current?.focus();
    const key = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const value = bindingFromEvent(event);
      if (value) onSelect(value);
      else setUnsupported(true);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onSelect, onClose]);
  return (
    <Modal
      title={t("@game.captureTitle", { name })}
      onClose={onClose}
      className="game-binding-modal"
    >
      <div
        ref={pad}
        tabIndex={0}
        className="game-binding-pad"
        onContextMenu={(e) => e.preventDefault()}
        onAuxClick={(e) => e.preventDefault()}
        onMouseDown={(e) => {
          e.preventDefault();
          const names = ["left", "middle", "right", "4", "5"];
          onSelect(`key.mouse.${names[e.button] ?? e.button + 1}`);
        }}
      >
        <Keyboard size={36} />
        <b>{t("@game.capturePrompt")}</b>
        <p>{t("@game.captureEscape")}</p>
      </div>
      {unsupported && (
        <p role="alert" className="game-settings-warning">
          {t("@game.unsupportedKey")}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          {t("Отмена")}
        </button>
        <button
          className="button secondary"
          onClick={() => onSelect("key.keyboard.unknown")}
        >
          {t("@game.unbind")}
        </button>
      </div>
    </Modal>
  );
}
