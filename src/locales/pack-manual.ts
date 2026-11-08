const messages: Record<string, [string, string, string]> = {
  completeTitle: ["Files installed", "Файлы установлены", "Файли встановлено"],
  completeText: [
    "You can close this window and continue with the instance. The installed files are saved.",
    "Можно закрыть окно и продолжить работу со сборкой. Установленные файлы сохранены.",
    "Можна закрити вікно та продовжити роботу зі збіркою. Установлені файли збережено.",
  ],
  replaceTitle: [
    "Use a different file?",
    "Использовать другой файл?",
    "Використати інший файл?",
  ],
  replaceWarning: [
    "This archive does not match the checksum in the modpack manifest. It may be another version or another project.",
    "Контрольная сумма архива отличается от указанной в модпаке. Это может быть другая версия или другой проект.",
    "Контрольна сума архіву відрізняється від зазначеної в модпаку. Це може бути інша версія або інший проєкт.",
  ],
  selected: ["Selected file", "Выбранный файл", "Вибраний файл"],
  destination: ["Install as", "Установить как", "Установити як"],
  replaceHint: [
    "Continue only if you want this replacement. The selected bytes will be checked again before installation. The modpack may need a different version to work.",
    "Продолжите, если хотите установить именно эту замену. Перед установкой файл проверится повторно. Для работы модпака может потребоваться другая версия.",
    "Продовжте, якщо хочете встановити саме цю заміну. Перед установленням файл буде перевірено повторно. Для роботи модпака може знадобитися інша версія.",
  ],
  useFile: ["Use this file", "Использовать этот файл", "Використати цей файл"],
};
const errors: Record<string, [string, string]> = {
  "Выбранный файл изменился. Выберите его заново": [
    "The selected file changed. Select it again",
    "Вибраний файл змінився. Виберіть його знову",
  ],
  "Выберите читаемый JAR или ZIP, а не страницу загрузки": [
    "Select a readable JAR or ZIP archive, not a download page",
    "Виберіть читаний архів JAR або ZIP, а не сторінку завантаження",
  ],
  "Выбранный архив пуст": [
    "The selected archive is empty",
    "Вибраний архів порожній",
  ],
};
const language = (n: number) =>
  Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      `@manual.${key}`,
      value[n],
    ]),
  );
export const packManualEnglish = {
  ...language(0),
  ...Object.fromEntries(
    Object.entries(errors).map(([key, value]) => [key, value[0]]),
  ),
};
export const packManualRussian = {
  ...language(1),
  ...Object.fromEntries(Object.keys(errors).map((key) => [key, key])),
};
export const packManualUkrainian = {
  ...language(2),
  ...Object.fromEntries(
    Object.entries(errors).map(([key, value]) => [key, value[1]]),
  ),
};
