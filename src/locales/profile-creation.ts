export const profileCreationEnglish: Record<string, string> = {
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
