import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLoaderData, useRevalidator } from "react-router";
import { toast } from "sonner";
import { Confirm } from "@/components/confirm";
import { focusPageHeading, PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { api, type Domain, useAction } from "@/lib/api";
import { formatDate, monoInput } from "@/lib/utils";
import { useShell } from "./shell.tsx";

export async function domainsLoader() {
  return api<{ domains: Domain[] }>("/domains");
}

export function Domains() {
  const { t } = useTranslation();
  const { can } = useShell();
  const { domains } = useLoaderData<typeof domainsLoader>();

  return (
    <div className="flex max-w-[1040px] flex-col gap-6">
      <PageHeader title={t("domains.title")} lead={t("domains.lead")}>
        {can("domains:write") && <AddDomain />}
      </PageHeader>
      {domains.map((domain) => (
        <DomainCard key={domain.id} domain={domain} readOnly={!can("domains:write")} />
      ))}
      <section aria-labelledby="instance-domain" className="flex flex-col gap-3">
        <h2 id="instance-domain" className="font-heading text-heading">
          {t("domains.instanceDomain")}
        </h2>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-5 py-4">
          <span translate="no" className="font-mono font-medium">
            {location.host}
          </span>
          <Badge variant="outline">{t("domains.shared")}</Badge>
          <span className="flex-[1_1_280px] text-muted-foreground">{t("domains.generatedSlugs")}</span>
        </div>
      </section>
    </div>
  );
}

function AddDomain() {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const add = useAction();
  const [open, setOpen] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hostname = new FormData(event.currentTarget).get("hostname");
    add.run(async () => {
      await api("/domains", { hostname });
      await revalidator.revalidate();
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" />
          {t("domains.add")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("domains.add")}</DialogTitle>
          <DialogDescription>{t("domains.addText", { host: location.hostname })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="hostname">{t("domains.hostname")}</FieldLabel>
            <Input id="hostname" name="hostname" required placeholder={t("examples.hostname")} {...monoInput} />
          </Field>
          <FieldError>{add.error}</FieldError>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <SubmitButton pending={add.pending} pendingLabel={t("domains.adding")}>
              {t("domains.add")}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DomainCard({ domain, readOnly }: { domain: Domain; readOnly: boolean }) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const save = useAction();
  const remove = useAction();
  const { hostname } = domain;
  const id = `domain-${domain.id}`;

  function deleteDomain() {
    remove.run(async () => {
      await api(`/domains/${domain.id}`, undefined, "DELETE");
      await revalidator.revalidate();
      toast.success(t("domains.deleted", { hostname }));
      focusPageHeading();
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fallbackUrl = String(new FormData(event.currentTarget).get("fallbackUrl")).trim();
    save.run(async () => {
      await api(`/domains/${domain.id}`, { fallbackUrl: fallbackUrl || null }, "PATCH");
      toast.success(t("domains.saved"));
    });
  }

  return (
    <Card aria-labelledby={id} className="gap-5">
      <CardHeader>
        <CardTitle id={id} translate="no">
          {hostname}
        </CardTitle>
        <CardDescription>{t("domains.addedOn", { date: formatDate(domain.createdAt) })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <FieldLabel htmlFor={`${id}-fallback`}>{t("domains.fallbackUrl")}</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`${id}-fallback`}
              name="fallbackUrl"
              type="url"
              defaultValue={domain.fallbackUrl ?? ""}
              disabled={readOnly}
              placeholder={t("examples.fallbackUrl")}
              aria-describedby={`${id}-fallback-hint`}
              {...monoInput}
              className={`${monoInput.className} w-auto flex-[1_1_320px]`}
            />
            {!readOnly && (
              <SubmitButton pending={save.pending} pendingLabel={t("domains.saving")}>
                {t("domains.save")}
              </SubmitButton>
            )}
          </div>
          <p id={`${id}-fallback-hint`} className="text-small text-muted-foreground">
            {t("domains.fallbackHint", { hostname })}
          </p>
          <FieldError>{save.error}</FieldError>
        </form>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Confirm
              trigger={
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Trash2 aria-hidden="true" />
                  {t("domains.delete")}
                </Button>
              }
              title={t("domains.deleteTitle", { hostname })}
              description={t("domains.deleteText")}
              action={t("domains.delete")}
              onConfirm={deleteDomain}
            />
            <FieldError>{remove.error}</FieldError>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
