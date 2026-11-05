import { t } from "../lib/i18n";
import { Code2 } from "lucide-react";
export function NativeModNotice() {
  return (
    <div className="native-mod-notice" role="note">
      <strong>
        <Code2 size={17} />
        {t("Моды Horizon собираются в игру")}
      </strong>
      <p>
        {t(
          "После установки моды нужно скомпилировать. В первый раз это может занять 20–30 минут или дольше и потребовать несколько ГБ.",
        )}
      </p>
      <details>
        <summary>{t("Подробнее")}</summary>
        <p>
          {t(
            "Aurum скачает исходники, сборщик, Rust и библиотеки; повторные сборки используют кэш.",
          )}
        </p>
        <p>
          {t(
            "Версии модов должны поддерживать вашу версию Horizon и запуск из Aurum.",
          )}
        </p>
        <p className="native-code-trust">
          {t(
            "Нативные моды работают с правами вашего пользователя. Компилируйте только моды, которым доверяете.",
          )}
        </p>
      </details>
    </div>
  );
}
