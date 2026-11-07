export const favoritesEnglish: Record<string, string> = {
  Избранное: "Favorites",
  "Очистить избранное": "Clear favorites",
  "Убрать выбранные проекты из избранного?":
    "Remove selected projects from favorites?",
  "Выбрано проектов: {{count}}. Установленные файлы останутся на месте.":
    "Selected projects: {{count}}. Installed files will stay in place.",
  "Избранное: {{count}}": "Favorites: {{count}}",
  "Убрать {{name}} из избранного": "Remove {{name}} from favorites",
  "Добавить {{name}} в избранное": "Add {{name}} to favorites",
  "Не удалось сохранить избранное.": "Could not save favorites.",
  "Выберите подходящую сборку для этого проекта.":
    "Choose a compatible instance for this project.",
  "Сборка установлена, но не удалось сохранить отметку в избранном.":
    "The instance was installed, but its favorites record could not be saved.",
  "Очередь остановлена. Установлено: {{installed}}. Ошибок: {{failed}}.":
    "Queue stopped. Installed: {{installed}}. Failed: {{failed}}.",
  "Установлено: {{installed}}. Ошибок: {{failed}}.":
    "Installed: {{installed}}. Failed: {{failed}}.",
  "Сохранённые проекты из всех источников. После установки они останутся здесь.":
    "Saved projects from every source. They stay here after installation.",
  "В избранном пока пусто": "No favorites yet",
  "Нажмите звёздочку у мода, модпака, шейдера или ресурспака в каталоге.":
    "Use the star beside a mod, modpack, shader or resource pack in the catalog.",
  "Проверяем Minecraft и загрузчик. Модпаки создают отдельные сборки; ручные загрузки и выбор файлов сохраняются.":
    "Minecraft and loader compatibility is checked. Modpacks create separate instances; manual downloads and file selection still apply.",
  "Готово к установке: {{count}}": "Ready to install: {{count}}",
  "Проверить снова": "Check again",
  "Проверьте параметры модпака и выберите обязательные файлы.":
    "Review the modpack options and choose the required files.",
  "Готово к установке": "Ready to install",
  "Выбрать {{name}}": "Select {{name}}",
  "Установить {{name}}": "Install {{name}}",
  "Версия {{name}}": "Version of {{name}}",
  "Останавливаем очередь…": "Stopping the queue…",
  "Остановить очередь": "Stop queue",
  "Установить всё доступное": "Install all available",
  "Установить выбранное · {{count}}": "Install selected · {{count}}",
  "В избранном можно сохранить до 200 проектов.":
    "You can save up to 200 projects in favorites.",
  "Установлено. Остались файлы для ручной установки.":
    "Installed. Some files still need manual installation.",
};
export const favoritesRussian = Object.fromEntries(
  Object.keys(favoritesEnglish).map((key) => [key, key]),
);
