import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";

export function Pagination({
  offset,
  count,
  nextOffset,
  pageSize,
}: {
  offset: number;
  count: number;
  nextOffset: number | null;
  pageSize: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  if (offset === 0 && nextOffset === null) return null;

  function go(to: number) {
    const next = new URLSearchParams(params);
    next.set("offset", String(to));
    navigate(`?${next}`);
  }

  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 text-muted-foreground">
      <span className="tabular-nums">{t("pagination.showing", { from: offset + 1, to: offset + count })}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => go(Math.max(offset - pageSize, 0))}>
          {t("pagination.previous")}
        </Button>
        <Button variant="outline" size="sm" disabled={nextOffset === null} onClick={() => go(nextOffset!)}>
          {t("pagination.next")}
        </Button>
      </div>
    </footer>
  );
}
