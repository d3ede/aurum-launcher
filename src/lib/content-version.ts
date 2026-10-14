// Keep packaging tags in the tooltip instead of repeating the game/loader in every row.
export function contentVersion(
  raw: string | undefined,
  minecraft: string,
): string {
  if (!raw) return "";
  const mc = minecraft.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let compact = raw
    .replace(
      new RegExp(
        `(^|[-+_\\s])(?:mc|minecraft[-_ ]?)?${mc}(?=$|[-+_\\s])`,
        "gi",
      ),
      "$1",
    )
    .replace(
      /(^|[-+_\s])(fabric|neoforge|forge|quilt|iris|optifine|release)(?=$|[-+_\s])/gi,
      "$1",
    )
    .replace(/^[-+_\s]+|[-+_\s]+$/g, "")
    .replace(/^v(?=\d)/, "");
  const version = compact.match(
    /\d+(?:\.\d+){1,3}(?:[-+](?:alpha|beta|rc|pre|build)[.-]?\d+)?/i,
  )?.[0];
  compact = version || compact;
  return (
    compact
      .replace(/[-+]beta[.-]?(\d+)/i, " β$1")
      .replace(/[-+]alpha[.-]?(\d+)/i, " α$1") || raw
  );
}
