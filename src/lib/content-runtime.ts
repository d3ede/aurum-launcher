export function reloadableContent(kind: string): boolean {
  return kind === "resourcepack" || kind === "shader";
}
