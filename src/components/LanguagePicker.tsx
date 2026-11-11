import { useEffect, useMemo, useState } from "react";
import { Check, Languages, Search, ChevronDown } from "lucide-react";
import { useApp } from "../context";
import { Modal } from "./ui";
import { languages } from "../locales/registry";
import {
  t,
  getLocale,
  getLanguagePreference,
  setLanguagePreference,
  getLanguageName,
} from "../lib/i18n";

const languageIcons = import.meta.glob<string>("../assets/languages/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

function LanguageIcon({ code }: { code: string }) {
  return (
    <img
      className="language-icon"
      src={languageIcons[`../assets/languages/${code.split("-")[0]}.svg`]}
      alt=""
      width={38}
      height={38}
    />
  );
}

export function LanguagePicker() {
  const { data, saveSettings, busy, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [changing, setChanging] = useState(false);
  const preference = getLanguagePreference();
  const locale = getLocale();
  const current = languages.find((l) => l.code === locale)!;
  useEffect(() => {
    if (open)
      document
        .querySelector<HTMLInputElement>(".language-search input")
        ?.focus();
  }, [open]);
  const choices = useMemo(
    () =>
      languages.filter((l) =>
        `${l.nativeName} ${l.englishName} ${getLanguageName(l.code)} ${l.code}`
          .normalize("NFKD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase()
          .includes(
            query
              .normalize("NFKD")
              .replace(/\p{Diacritic}/gu, "")
              .toLowerCase(),
          ),
      ),
    [query, locale],
  );
  const choose = async (language: string) => {
    const previous = preference;
    setChanging(true);
    try {
      await setLanguagePreference(language);
      const ok = await saveSettings({ ...data.settings, language }, true);
      if (!ok) {
        await setLanguagePreference(previous);
        return;
      }
      setOpen(false);
      setQuery("");
      notify(t("Язык сохранён"));
    } catch (error) {
      notify(String(error), true);
    } finally {
      setChanging(false);
    }
  };
  return (
    <section className="settings-section language-section">
      <div className="settings-title">
        <span>
          <Languages size={21} />
        </span>
        <div>
          <h2>{t("Язык интерфейса")}</h2>
          <p>{t("Выберите язык интерфейса.")}</p>
        </div>
      </div>
      <button
        type="button"
        className="language-current"
        onClick={() => setOpen(true)}
        disabled={busy || changing}
        aria-label={t("Выбор языка")}
      >
        <LanguageIcon code={locale} />
        <span>
          <b dir="auto">{current.nativeName}</b>
          <small>{getLanguageName(locale)}</small>
        </span>
        <span className="language-count">{languages.length}</span>
        <ChevronDown size={18} />
      </button>
      {open && (
        <Modal
          title={t("Выбор языка")}
          subtitle={t("Переключение сразу, без перезапуска.")}
          onClose={() => {
            if (!changing) setOpen(false);
          }}
          closeDisabled={changing}
          wide
          className="language-modal"
        >
          <div className="language-search input-icon">
            <Search size={19} />
            <input
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (query && choices.length === 1)
                    void choose(choices[0].code);
                }
              }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Поиск языков")}
              aria-label={t("Поиск языков")}
              dir="auto"
            />
          </div>
          <div className="language-groups">
            {["europe", "world"].map((region) => {
              const list = choices.filter((l) => l.region === region);
              return list.length ? (
                <section key={region}>
                  <h3>
                    {region === "europe" ? t("Европа") : t("Другие регионы")}
                  </h3>
                  <div className="language-grid">
                    {list.map((l) => (
                      <button
                        type="button"
                        key={l.code}
                        className={`language-option ${preference === l.code ? "selected" : ""}`}
                        aria-label={l.nativeName}
                        aria-pressed={preference === l.code}
                        disabled={changing}
                        onClick={() => void choose(l.code)}
                      >
                        <LanguageIcon code={l.code} />
                        <span>
                          <b dir="auto">{l.nativeName}</b>
                          <small>{getLanguageName(l.code)}</small>
                        </span>
                        {preference === l.code && <Check size={18} />}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null;
            })}
            {!choices.length && (
              <div className="language-empty">
                <Search size={27} />
                <p>{t("Язык не найден")}</p>
              </div>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
