import { t } from "../lib/i18n";
import { Code2, Clock3 } from "lucide-react";
export function NativeModNotice() {
  return (
    <div className="native-mod-notice" role="note">
      <strong>
        <Code2 size={17} />
        {t("Моды Horizon собираются в игру")}
      </strong>
      <p>
        {t(
          "Установка скачивает исходники. Чтобы включить выбранные моды, нажмите «Скомпилировать».",
        )}
      </p>
      <p>
        {t(
          "Версии модов должны поддерживать вашу версию Horizon и запуск из Aurum.",
        )}
      </p>
      <p>
        <Clock3 size={15} />
        {t(
          "В первый раз Aurum скачает сборщик, Rust и библиотеки: понадобится несколько ГБ и примерно 20–30 минут или дольше. Повторные сборки используют кэш.",
        )}
      </p>
      <p className="native-code-trust">
        {t(
          "Нативные моды работают с правами вашего пользователя. Компилируйте только моды, которым доверяете.",
        )}
      </p>
    </div>
  );
}
