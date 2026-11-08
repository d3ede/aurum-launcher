import { ArrowLeft } from "lucide-react";
import { t } from "../lib/i18n";

export function scrollSettingsToTop() {
  document.querySelector(".content-scroll")?.scrollTo(0, 0);
  window.scrollTo(0, 0);
}

export function SettingsPageHeading({
  title,
  description,
  onBack,
  backLabel = "Назад к настройкам",
}: {
  title: string;
  description?: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <header className="page-heading settings-page-heading">
      {onBack && (
        <button
          type="button"
          className="text-button settings-back"
          onClick={onBack}
        >
          <ArrowLeft size={17} />
          {t(backLabel)}
        </button>
      )}
      <h1>{t(title)}</h1>
      {description && <p>{t(description)}</p>}
    </header>
  );
}
