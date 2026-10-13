export const profileIconEnglish: Record<string, string> = {
  "Предпросмотр значка": "Icon preview",
  Символ: "Symbol",
  "Цвет символа": "Symbol color",
  "Цвет фона": "Background color",
  "Свой цвет": "Custom color",
  "Сбросить значок": "Reset icon",
  "У загруженной картинки можно изменить фон.":
    "You can change the background of an uploaded image.",
  "Неизвестный символ значка": "Unknown icon symbol",
  "Цвет значка должен быть в формате #RRGGBB":
    "Icon colors must use the #RRGGBB format",
  Куб: "Cube",
  Лес: "Forest",
  Горы: "Mountains",
  Компас: "Compass",
  Кирка: "Pickaxe",
  Меч: "Sword",
  Огонь: "Fire",
  Снежинка: "Snowflake",
  Луна: "Moon",
  Солнце: "Sun",
  Звезда: "Star",
  Сердце: "Heart",
  Кристалл: "Crystal",
  Призрак: "Ghost",
  Ракета: "Rocket",
  Геймпад: "Gamepad",
};
export const profileIconRussian: Record<string, string> = Object.fromEntries(
  Object.keys(profileIconEnglish).map((key) => [key, key]),
);
