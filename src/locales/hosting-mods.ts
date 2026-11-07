export const hostingModsEnglish: Record<string, string> = {
  "Выберите Fabric, Forge или NeoForge": "Choose Fabric, Forge or NeoForge",
  "Список версий загрузчика слишком велик":
    "The loader version list is too large",
  "Версия загрузчика не подходит для выбранного Minecraft":
    "The loader version does not match the selected Minecraft version",
  "Установщик не создал серверные файлы загрузчика":
    "The installer did not create the loader's server files",
  "Файл запуска должен находиться в папке сервера":
    "The launch file must be inside the server folder",
  "Нет совместимой версии загрузчика":
    "No compatible loader version is available",
  "Нет версии установщика Fabric": "No Fabric installer version is available",
  "Загружаем официальный сервер Fabric":
    "Downloading the official Fabric server",
  "Загружаем официальный установщик сервера":
    "Downloading the official server installer",
  "Устанавливаем серверный загрузчик и библиотеки":
    "Installing the server loader and libraries",
  "Сервер с модами Fabric": "Server with Fabric mods",
  "Сервер с модами Forge": "Server with Forge mods",
  "Сервер с модами NeoForge": "Server with NeoForge mods",
  "Серверы с модами": "Modded servers",
  "Версия загрузчика": "Loader version",
  "Добавляйте серверные моды в папку mods. Версии Minecraft, загрузчика и модов у игроков должны быть совместимы с сервером.":
    "Add server mods to the mods folder. Players need Minecraft, loader and mod versions compatible with the server.",
};
export const hostingModsRussian = Object.fromEntries(
  Object.keys(hostingModsEnglish).map((key) => [key, key]),
);
