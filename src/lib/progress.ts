import type { Progress } from "../types";
import { formatDecimal, getFormatLocale } from "./i18n";

export function progressAmount(progress: Progress) {
  // Modrinth import reports copied bytes; other phases report item counts.
  if (progress.phase === "import")
    return `${formatDecimal(progress.done / 1_000_000)} MB / ${formatDecimal(progress.total / 1_000_000)} MB`;
  const number = new Intl.NumberFormat(getFormatLocale());
  return `${number.format(progress.done)} / ${number.format(progress.total)}`;
}
