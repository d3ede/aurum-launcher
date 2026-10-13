export const updaterEnglish: Record<string, string> = {
  "Обновления лаунчера": "Launcher updates",
  "Aurum проверяет новые версии при запуске и каждые 6 часов.":
    "Aurum checks for new versions on startup and every 6 hours.",
  "Проверить обновления": "Check for updates",
  "Проверяем обновления…": "Checking for updates…",
  "Установлена последняя версия": "You're up to date",
  "Доступен Aurum {{version}}": "Aurum {{version}} is available",
  "Обновить и перезапустить": "Update and restart",
  "Загружаем обновление…": "Downloading update…",
  "Перезапускаем Aurum…": "Restarting Aurum…",
  Позже: "Later",
  "Завершите игру и текущие действия перед обновлением.":
    "Close your games and finish current tasks before updating.",
  "Не удалось проверить обновления. Попробуйте ещё раз.":
    "Couldn't check for updates. Please try again.",
  "Не удалось загрузить или проверить обновление. Попробуйте ещё раз.":
    "Couldn't download or verify the update. Please try again.",
  "Обновления доступны в desktop-приложении.":
    "Updates are available in the desktop app.",
};

export const updaterRussian: Record<string, string> = Object.fromEntries(
  Object.keys(updaterEnglish).map((key) => [key, key]),
);
