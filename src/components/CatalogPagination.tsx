import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "../lib/i18n";

export function CatalogPagination({
  page,
  pages,
  loading,
  onPage,
}: {
  page: number;
  pages: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const [value, setValue] = useState(String(page));
  useEffect(() => setValue(String(page)), [page]);
  const jump = () => {
    const requested = Number(value);
    if (!value.trim() || !Number.isSafeInteger(requested)) {
      setValue(String(page));
      return;
    }
    const next = Math.min(pages, Math.max(1, requested));
    setValue(String(next));
    onPage(next);
  };
  return (
    <nav
      className="pagination catalog-pagination"
      aria-label={t("Страницы каталога")}
    >
      <button
        type="button"
        className="icon-button"
        aria-label={t("Предыдущая страница")}
        title={t("Предыдущая страница")}
        disabled={loading || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={18} />
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          jump();
        }}
      >
        <input
          aria-label={t("Номер страницы")}
          title={t("Введите номер страницы и нажмите Enter")}
          inputMode="numeric"
          value={value}
          disabled={loading}
          autoComplete="off"
          style={{
            width: `${Math.max(2, value.length, String(pages).length)}ch`,
          }}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setValue(event.target.value)}
          onBlur={jump}
          onKeyDown={(event) => {
            if (event.key === "Escape") setValue(String(page));
          }}
        />
        <span aria-hidden="true">/</span>
        <span aria-label={t("Всего страниц: {{count}}", { count: pages })}>
          {pages}
        </span>
      </form>
      <button
        type="button"
        className="icon-button"
        aria-label={t("Следующая страница")}
        title={t("Следующая страница")}
        disabled={loading || page >= pages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={18} />
      </button>
    </nav>
  );
}
