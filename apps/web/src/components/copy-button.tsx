import { Check, Copy } from "lucide-react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";

export function CopyButton({ text, children, ...props }: ComponentProps<typeof Button> & { text: string }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy(() => toast.error(t("copy.failed")));

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => copy(text)} {...props}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? t("copy.copied") : children}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t("copy.copiedStatus") : ""}
      </span>
    </>
  );
}
