import { Info } from "lucide-react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, type Settings, useAction } from "@/lib/api";
import { monoInput } from "@/lib/utils";
import { useShell } from "./shell.tsx";

export async function settingsLoader() {
  return api<Settings>("/settings");
}

const hint = "text-small text-muted-foreground";

export function InstanceSettings() {
  const { t } = useTranslation();
  const { can } = useShell();
  const settings = useLoaderData<typeof settingsLoader>();
  const save = useAction();
  const timeZones = [...new Set(["UTC", settings.timeZone, ...Intl.supportedValuesOf("timeZone")])];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save.run(async () => {
      await api<Settings>(
        "/settings",
        {
          timeZone: String(data.get("timeZone")),
          retentionMonths: Number(data.get("retentionMonths")),
          appStoreProviderToken: String(data.get("appStoreProviderToken")).trim() || null,
        },
        "PATCH",
      );
      toast.success(t("settings.saved"));
    });
  }

  return (
    <div className="flex max-w-[1040px] flex-col gap-6">
      <PageHeader title={t("settings.title")} lead={t("settings.lead")} />
      <form onSubmit={submit}>
        <fieldset disabled={!can("instance:admin")} className="flex flex-col gap-6">
          <Card aria-labelledby="time-zone-title" className="gap-5">
            <CardHeader>
              <CardTitle id="time-zone-title">{t("settings.timeZone")}</CardTitle>
              <CardDescription>{t("settings.timeZoneText")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Field className="max-w-[420px]">
                <FieldLabel htmlFor="time-zone">{t("settings.timeZone")}</FieldLabel>
                <NativeSelect id="time-zone" name="timeZone" defaultValue={settings.timeZone} className="w-full">
                  {timeZones.map((zone) => (
                    <NativeSelectOption key={zone} value={zone}>
                      {zone}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </CardContent>
          </Card>

          <Card aria-labelledby="retention" className="gap-5">
            <CardHeader>
              <CardTitle id="retention">{t("settings.retention")}</CardTitle>
              <CardDescription>{t("settings.retentionText")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field className="max-w-[420px]">
                <FieldLabel htmlFor="retention-months">{t("settings.keepFor")}</FieldLabel>
                <Input
                  id="retention-months"
                  name="retentionMonths"
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  required
                  defaultValue={settings.retentionMonths}
                  aria-describedby="retention-hint"
                />
                <p id="retention-hint" className={hint}>
                  {t("settings.retentionHint")}
                </p>
              </Field>
              <Alert role="note">
                <Info aria-hidden="true" />
                <AlertTitle>{t("settings.retentionNoteTitle")}</AlertTitle>
                <AlertDescription>{t("settings.retentionNote")}</AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card aria-labelledby="provider-token" className="gap-5">
            <CardHeader>
              <CardTitle id="provider-token">{t("settings.providerToken")}</CardTitle>
              <CardDescription>{t("settings.providerTokenText")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Field className="max-w-[420px]">
                <FieldLabel htmlFor="provider-token-input">{t("settings.providerTokenLabel")}</FieldLabel>
                <Input
                  id="provider-token-input"
                  name="appStoreProviderToken"
                  inputMode="numeric"
                  pattern="\d{1,20}"
                  defaultValue={settings.appStoreProviderToken ?? ""}
                  placeholder={t("examples.providerToken")}
                  aria-describedby="provider-token-hint"
                  {...monoInput}
                />
                <p id="provider-token-hint" className={hint}>
                  {t("settings.providerTokenHint")}
                </p>
              </Field>
            </CardContent>
          </Card>

          <FieldError>{save.error}</FieldError>
          <div>
            <SubmitButton pending={save.pending} pendingLabel={t("settings.saving")}>
              {t("settings.save")}
            </SubmitButton>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
