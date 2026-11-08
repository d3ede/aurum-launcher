export function reloadableContent(kind: string): boolean {
  return kind === "resourcepack" || kind === "shader";
}

export const contentReloadHint =
  "Ресурспаки и шейдеры можно менять без выхода из игры. Выберите пак в настройках Minecraft; для перезагрузки текстур нажмите F3+T, для шейдеров используйте меню шейдеров.";
