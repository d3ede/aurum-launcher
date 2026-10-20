export const profileOrderEnglish: Record<string, string> = {
  "Сначала новые": "Newest first",
  Пользовательская: "Custom",
  "Переместить сборку {{name}}": "Move instance {{name}}",
  "Перетащите для сортировки. Стрелки — переместить с клавиатуры.":
    "Drag to reorder. Use arrow keys to move with the keyboard.",
  "Не удалось сохранить порядок сборок": "Could not save instance order",
};
export const profileOrderRussian = Object.fromEntries(
  Object.keys(profileOrderEnglish).map((key) => [key, key]),
);
