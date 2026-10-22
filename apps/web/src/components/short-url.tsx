import { Check, Copy } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCopy } from "@/hooks/use-copy";
import { cn, displayUrl } from "@/lib/utils";

const hidden = "scale-80 opacity-0 blur-[2px] motion-reduce:scale-100";

export function ShortUrl({ shortUrl, disabled = false }: { shortUrl: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const text = useRef<HTMLSpanElement>(null);
  const { copied, copy } = useCopy(() => {
    getSelection()?.selectAllChildren(text.current!);
    toast.error(t("shortUrl.copyFailed"));
  });
  const { host, pathname } = new URL(shortUrl);

  return (
    <span className="inline-flex h-8 max-w-full items-center rounded-full border bg-card">
      <span ref={text} translate="no" className="flex min-w-0 pr-2 pl-3 font-mono text-mono font-medium whitespace-nowrap">
        <span className="min-w-[4ch] shrink-[1000] truncate font-normal text-muted-foreground">{host}</span>
        <span className="min-w-0 truncate">{pathname}</span>
      </span>
      <button
        type="button"
        onClick={() => copy(shortUrl)}
        disabled={disabled}
        aria-label={disabled ? t("shortUrl.copyLater") : t("shortUrl.copyLabel", { url: displayUrl(shortUrl) })}
        className={cn(
          "inline-flex h-full shrink-0 items-center rounded-r-full border-l bg-muted pr-3 pl-2.5 text-small font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
          copied && "text-success",
        )}
      >
        <span className="grid" aria-hidden="true">
          <span
            className={cn("col-start-1 row-start-1 inline-flex items-center gap-1.5 transition-[opacity,scale,filter]", copied && hidden)}
          >
            <Copy className="size-4" />
            {t("shortUrl.copy")}
          </span>
          <span
            className={cn("col-start-1 row-start-1 inline-flex items-center gap-1.5 transition-[opacity,scale,filter]", !copied && hidden)}
          >
            <Check className="size-4" />
            {t("shortUrl.copied")}
          </span>
        </span>
      </button>
      <span role="status" className="sr-only">
        {copied ? t("shortUrl.copiedStatus") : ""}
      </span>
    </span>
  );
}
