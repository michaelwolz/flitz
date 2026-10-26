import { useTranslation } from "react-i18next";
import { useLoaderData, useSearchParams } from "react-router";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AuthMethods } from "../../../server/src/app.ts";
import { api, appUrl, auth, authClient, useAction } from "@/lib/api";

type Provider = AuthMethods["socialProviders"][number];

export async function accountLoader() {
  const [{ socialProviders: providers }, accounts] = await Promise.all([
    api<AuthMethods>("/auth-methods"),
    auth(authClient.listAccounts()),
  ]);
  return { providers, linkedProviders: accounts?.map(({ providerId }) => providerId) ?? [] };
}

export function Account() {
  const { t } = useTranslation();
  const { providers, linkedProviders } = useLoaderData<typeof accountLoader>();
  const [params] = useSearchParams();
  const link = useAction();
  const labels = {
    google: t("account.providers.google"),
    github: t("account.providers.github"),
    microsoft: t("account.providers.microsoft"),
  };
  const linked = params.get("linked");
  const error = params.get("error");
  const message =
    error === "email_does_not_match"
      ? t("account.emailMismatch")
      : error === "account_already_linked_to_different_user"
        ? t("account.alreadyLinked")
        : error
          ? t("account.linkFailed")
          : link.error;

  function connect(provider: Provider) {
    link.run(() =>
      auth(
        authClient.linkSocial({
          provider,
          callbackURL: appUrl(`/settings/account?linked=${provider}`),
          errorCallbackURL: appUrl("/settings/account"),
        }),
      ),
    );
  }

  return (
    <div className="flex max-w-[1040px] flex-col gap-6">
      <PageHeader title={t("account.title")} />
      {providers.length ? (
        <Card aria-labelledby="social-accounts" className="gap-5">
          <CardHeader>
            <CardTitle id="social-accounts">{t("account.socialAccounts")}</CardTitle>
            <CardDescription>{t("account.lead")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {linked && providers.includes(linked as Provider) && linkedProviders.includes(linked) && (
              <p role="status" className="text-small text-muted-foreground">
                {t("account.linked", { provider: labels[linked as Provider] })}
              </p>
            )}
            {message && (
              <p role="alert" className="text-small text-destructive">
                {message}
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {providers.map((provider) => {
                const connected = linkedProviders.includes(provider);
                return (
                  <li key={provider} className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-medium">{labels[provider]}</span>
                    {connected ? (
                      <Badge variant="success">{t("account.connected")}</Badge>
                    ) : (
                      <SubmitButton
                        type="button"
                        variant="outline"
                        pending={link.pending}
                        pendingLabel={t("account.connecting")}
                        onClick={() => connect(provider)}
                      >
                        {t("account.connect", { provider: labels[provider] })}
                      </SubmitButton>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <p className="text-muted-foreground">{t("account.noProviders")}</p>
      )}
    </div>
  );
}
