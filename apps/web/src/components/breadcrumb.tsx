import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router";

export function Breadcrumb({ current }: { current: string }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("common.breadcrumb")} className="flex gap-2 text-small text-muted-foreground">
      <RouterLink to="/" className="hover:text-foreground">
        {t("links.title")}
      </RouterLink>
      <span aria-hidden="true">/</span>
      <span aria-current="page" className="truncate text-foreground">
        {current}
      </span>
    </nav>
  );
}
