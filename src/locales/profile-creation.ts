export const profileCreationEnglish: Record<string, string> = {
  Экспериментально: "Experimental",
  "Minecraft на Rust. Скачивается только для этой сборки; миры хранятся отдельно.":
    "Minecraft in Rust. Downloaded on demand; worlds are kept in a separate instance.",
  "Нужен Microsoft-аккаунт с Java Edition. Моды Fabric, Forge и Quilt не поддерживаются.":
    "Requires a Microsoft account that owns Java Edition. Fabric, Forge and Quilt mods are not supported.",
  "Перед созданием выберите Microsoft-аккаунт в разделе «Аккаунты и скины».":
    "Before creating this instance, select a Microsoft account under Accounts and skins.",
  "Horizon и ресурсы установятся автоматически. Подготовка первого запуска займёт несколько минут.":
    "Horizon and its resources will be installed automatically. First-time preparation takes a few minutes.",
  "Здесь работают моды Horizon. Обычные Java-моды и сборки Fabric/Forge несовместимы.":
    "This instance uses Horizon mods. Java mods and Fabric/Forge modpacks are incompatible.",
  "Добавляйте совместимый контент в папку сборки. Ресурспаки выбираются в настройках игры.":
    "Add compatible content to the instance folder. Select resource packs in the game settings.",
  "Открыть папку сборки": "Open instance folder",
  "Создайте новую сборку — Minecraft установится сразу. Или импортируйте готовую сборку.":
    "Create an instance to install Minecraft right away, or import an existing instance.",
  "Minecraft и подходящая Java установятся сразу после создания сборки.":
    "Minecraft and the required Java runtime will be installed as soon as the instance is created.",
  "Minecraft установлен": "Minecraft installed",
  "Устанавливаем…": "Installing…",
  Устанавливается: "Installing",
};
export const profileCreationRussian = Object.fromEntries(
  Object.keys(profileCreationEnglish).map((key) => [key, key]),
);
