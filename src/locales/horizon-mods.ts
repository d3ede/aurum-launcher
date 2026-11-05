export const horizonModsEnglish: Record<string, string> = {
  "Моды Horizon": "Horizon mods",
  "Версии модов должны поддерживать вашу версию Horizon и запуск из Aurum.":
    "Mod versions must support your Horizon version and launching from Aurum.",
  "Найти моды Horizon": "Find Horizon mods",
  "Моды Horizon собираются в игру": "Horizon mods are compiled into the game",
  "Установка скачивает исходники. Чтобы включить выбранные моды, нажмите «Скомпилировать».":
    "Installing downloads the source. To enable your selected mods, choose Compile.",
  "В первый раз Aurum скачает сборщик, Rust и библиотеки: понадобится несколько ГБ и примерно 20–30 минут или дольше. Повторные сборки используют кэш.":
    "The first build downloads the builder, Rust and libraries: allow several GB and around 20–30 minutes or longer. Later builds reuse the cache.",
  "Нативные моды работают с правами вашего пользователя. Компилируйте только моды, которым доверяете.":
    "Native mods run with your user permissions. Compile only mods you trust.",
  "Исходники и скомпилированная игра хранятся отдельно для вашей сборки.":
    "Sources and the compiled game are kept separately for your instance.",
  "Проверяем моды…": "Checking mods…",
  "Компилируем моды…": "Compiling mods…",
  "Изменения ещё не скомпилированы": "Changes have not been compiled",
  "Сборка модов готова": "Mod build ready",
  "Пользовательские моды выключены": "User mods are off",
  "Перед игрой с этими модами нужна компиляция. Можно отложить её и запустить обычный Horizon.":
    "Compile to play with these mods. You can postpone this and start the base Horizon game.",
  "Игра запускается только с проверенной сборкой выбранных модов.":
    "The game uses only a verified build of the selected mods.",
  Скомпилировать: "Compile",
  "Моды скомпилированы": "Mods compiled",
  "Сначала установите Horizon. Затем можно скомпилировать моды.":
    "Install Horizon first. Then you can compile mods.",
  "Включить мод {{name}}": "Enable mod {{name}}",
  "Удалить мод {{name}}": "Remove mod {{name}}",
  "Добавьте моды из каталога Horizon. После установки исходников они появятся здесь.":
    "Add mods from the Horizon catalog. They appear here once their sources are installed.",
  "Журнал компиляции": "Build log",
  "Обновить журнал": "Refresh log",
  "Журнал появится после начала компиляции.":
    "The log appears when compilation starts.",
  "Нативные моды Horizon на Rust. Каталог устанавливает исходники; компиляция запускается отдельно в сборке.":
    "Native Horizon mods in Rust. The catalog installs sources; start compilation separately in your instance.",
  "Моды ещё не скомпилированы": "Mods have not been compiled",
  "Выбранные изменения пока не входят в игру. Можно собрать их сейчас или отложить и запустить Horizon без пользовательских модов.":
    "Your selected changes are not in the game yet. Compile them now, or postpone this and start Horizon without user mods.",
  "Отложить и играть без модов": "Postpone and play without mods",
  "Скомпилировать и играть": "Compile and play",
  "Остановить компиляцию": "Stop compilation",
  "Скачать исходники": "Download source",
  "Исходники скачаны": "Sources downloaded",
  "Исходники мода установлены. Скомпилируйте их в сборке перед игрой.":
    "Mod sources installed. Compile them in your instance before playing.",
};
export const horizonModsRussian = Object.fromEntries(
  Object.keys(horizonModsEnglish).map((key) => [key, key]),
);
