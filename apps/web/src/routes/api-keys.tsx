import { CircleCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLoaderData, useRevalidator } from "react-router";
import { toast } from "sonner";
import { Confirm } from "@/components/confirm";
import { CopyButton } from "@/components/copy-button";
import { PageHeader } from "@/components/page-header";
import { ScopeBadges } from "@/components/scope-badges";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ApiKey, api, type Scope, scopes, useAction } from "@/lib/api";
import { formatDate, monoInput, textLink } from "@/lib/utils";

const defaultScopes: readonly Scope[] = ["links:read", "links:write", "stats:read"];
const scopeKeys = {
  "links:read": "linksRead",
  "links:write": "linksWrite",
  "stats:read": "statsRead",
  "domains:write": "domainsWrite",
  "instance:admin": "instanceAdmin",
} as const;

export async function apiKeysLoader() {
  return api<{ apiKeys: ApiKey[] }>("/api-keys");
}

export function ApiKeys() {
  const { t } = useTranslation();
  const { apiKeys } = useLoaderData<typeof apiKeysLoader>();
  const revalidator = useRevalidator();
  const create = useAction();
  const revoke = useAction();
  const [created, setCreated] = useState<(ApiKey & { key: string }) | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    create.run(async () => {
      if (!data.has("scope")) throw new Error(t("apiKeys.pickScope"));
      setCreated(await api<ApiKey & { key: string }>("/api-keys", { name: data.get("name"), scopes: data.getAll("scope") }));
      form.reset();
      await revalidator.revalidate();
    });
  }

  function revokeKey(apiKey: ApiKey) {
    revoke.run(async () => {
      await api(`/api-keys/${apiKey.id}`, undefined, "DELETE");
      setCreated((key) => (key?.id === apiKey.id ? null : key));
      await revalidator.revalidate();
      toast.success(t("apiKeys.revoked", { name: apiKey.name }));
      document.getElementById("keys")?.focus();
    });
  }

  return (
    <div className="flex max-w-[1040px] flex-col gap-6">
      <PageHeader
        title={t("apiKeys.title")}
        lead={
          <>
            {t("apiKeys.lead")}{" "}
            <a href="https://michaelwolz.github.io/flitz/docs/api-quick-start.html#1-sign-up-and-create-an-api-key" className={textLink}>
              {t("apiKeys.docs")}
            </a>
          </>
        }
      />
      {created && (
        <Alert variant="success" role="status">
          <CircleCheck aria-hidden="true" />
          <AlertTitle>{t("apiKeys.copyNow")}</AlertTitle>
          <AlertDescription className="gap-2.5">
            <p>{t("apiKeys.shownOnce", { name: created.name })}</p>
            <div className="flex w-full flex-wrap items-center gap-2">
              <label htmlFor="new-key" className="sr-only">
                {t("apiKeys.newKey")}
              </label>
              <Input
                id="new-key"
                readOnly
                value={created.key}
                {...monoInput}
                className={`${monoInput.className} w-auto min-w-0 flex-[1_1_320px]`}
              />
              <CopyButton text={created.key}>{t("apiKeys.copyKey")}</CopyButton>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <Card aria-labelledby="create-key">
        <CardHeader>
          <CardTitle id="create-key">{t("apiKeys.create")}</CardTitle>
          <CardDescription>{t("apiKeys.createText")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-5">
            <Field className="max-w-[420px]">
              <FieldLabel htmlFor="key-name">{t("apiKeys.name")}</FieldLabel>
              <Input id="key-name" name="name" required maxLength={100} autoComplete="off" placeholder={t("examples.apiKeyName")} />
            </Field>
            <fieldset className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
              <legend className="mb-3 text-label">{t("apiKeys.scopes")}</legend>
              {scopes.map((scope) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    name="scope"
                    value={scope}
                    defaultChecked={defaultScopes.includes(scope)}
                    className="mt-px size-[18px] shrink-0 accent-ring"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span translate="no" className="font-mono text-mono font-medium">
                      {scope}
                    </span>
                    <span className="text-small text-muted-foreground">{t(`scopes.${scopeKeys[scope]}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <FieldError>{create.error}</FieldError>
            <div>
              <SubmitButton pending={create.pending} pendingLabel={t("apiKeys.creating")}>
                {t("apiKeys.create")}
              </SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
      <section aria-labelledby="keys" className="flex flex-col gap-3">
        <h2 id="keys" tabIndex={-1} className="font-heading text-heading outline-none">
          {t("apiKeys.keys")}
        </h2>
        <FieldError>{revoke.error}</FieldError>
        {apiKeys.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">{t("apiKeys.name")}</TableHead>
                <TableHead scope="col">{t("apiKeys.key")}</TableHead>
                <TableHead scope="col">{t("apiKeys.scopes")}</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">{t("apiKeys.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((apiKey) => (
                <TableRow key={apiKey.id}>
                  <TableCell>
                    <span className="block font-medium">{apiKey.name}</span>
                    <span className="block text-small text-muted-foreground">
                      {t("apiKeys.createdBy", { date: formatDate(apiKey.createdAt), name: apiKey.createdBy })}
                    </span>
                  </TableCell>
                  <TableCell translate="no" className="font-mono text-mono text-muted-foreground">
                    {apiKey.start}…
                  </TableCell>
                  <TableCell>
                    <ScopeBadges scopes={apiKey.scopes} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Confirm
                      trigger={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          aria-label={t("apiKeys.revokeLabel", { name: apiKey.name })}
                        >
                          {t("apiKeys.revoke")}
                        </Button>
                      }
                      title={t("apiKeys.revokeTitle", { name: apiKey.name })}
                      description={t("apiKeys.revokeText")}
                      action={t("apiKeys.revoke")}
                      onConfirm={() => revokeKey(apiKey)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground">{t("apiKeys.none")}</p>
        )}
      </section>
    </div>
  );
}
