import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function focusPageHeading(options?: FocusOptions) {
  document.querySelector<HTMLElement>("main h1")?.focus(options);
}

export function PageHeader({ title, badge, lead, children }: { title: string; badge?: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <title>{t("pageTitle", { page: title })}</title>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 tabIndex={-1} className="font-heading text-title outline-none">
            {title}
          </h1>
          {badge}
        </div>
        {lead && <p className="max-w-[640px] text-muted-foreground">{lead}</p>}
      </div>
      {children}
    </header>
  );
}
