import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/api";

export function NameDialog({
  trigger,
  title,
  description,
  name,
  save,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  name: string;
  save: (name: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const action = useAction();
  const [open, setOpen] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newName = String(new FormData(event.currentTarget).get("name")).trim();
    action.run(async () => {
      await save(newName);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor={id}>{t("auth.name")}</FieldLabel>
            <Input id={id} name="name" defaultValue={name} autoComplete="name" required />
          </Field>
          <FieldError>{action.error}</FieldError>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <SubmitButton pending={action.pending} pendingLabel={t("common.savingName")}>
              {t("common.saveName")}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
