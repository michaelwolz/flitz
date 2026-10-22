import { useTranslation } from "react-i18next";
import { Link as RouterLink, useLoaderData, useRevalidator } from "react-router";
import { toast } from "sonner";
import { Confirm } from "@/components/confirm";
import { CopyButton } from "@/components/copy-button";
import { PageHeader } from "@/components/page-header";
import { ScopeBadges } from "@/components/scope-badges";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type Scope, useAction } from "@/lib/api";
import { formatDate, monoInput, stepBadge } from "@/lib/utils";
import { useShell } from "./shell.tsx";

type ConnectedApp = {
  id: string;
  clientId: string;
  name: string;
  scopes: Scope[];
  connectedBy: string;
  connectedAt: string;
  lastActiveAt: string;
};

const apps = ["claude", "chatgpt", "cursor"] as const;

export async function mcpLoader() {
  return api<{ connectedApps: ConnectedApp[] }>("/connected-apps");
}

function Code({ code, label }: { code: string; label: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-2">
      <pre translate="no" className="w-full overflow-x-auto rounded-md bg-muted p-4 font-mono text-mono">
        {code}
      </pre>
      <CopyButton text={code} aria-label={label}>
        {t("mcp.copy")}
      </CopyButton>
    </div>
  );
}

export function Mcp() {
  const { t } = useTranslation();
  const isAdmin = useShell().can("instance:admin");
  const { connectedApps } = useLoaderData<typeof mcpLoader>();
  const revalidator = useRevalidator();
  const disconnect = useAction();
  const url = `${location.origin}/api/mcp`;
  const key = "flitz_...";
  const configs = {
    cursor: JSON.stringify({ mcpServers: { flitz: { url } } }, null, 2),
    command: `claude mcp add --transport http flitz ${url} --header "Authorization: Bearer ${key}"`,
    json: JSON.stringify({ mcpServers: { flitz: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
  };

  function disconnectApp(app: ConnectedApp) {
    disconnect.run(async () => {
      await api(`/connected-apps/${app.id}`, undefined, "DELETE");
      await revalidator.revalidate();
      toast.success(t("mcp.disconnected", { name: app.name }));
      document.getElementById("connected")?.focus();
    });
  }

  return (
    <div className="flex max-w-[1040px] flex-col gap-6">
      <PageHeader title={t("mcp.title")} lead={t("mcp.lead")} />

      <Card aria-labelledby="connect" className="gap-5">
        <CardHeader>
          <CardTitle id="connect">{t("mcp.connect")}</CardTitle>
          <CardDescription>{t("mcp.connectText")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="mcp-url">{t("mcp.url")}</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="mcp-url"
                readOnly
                value={url}
                {...monoInput}
                className={`${monoInput.className} w-auto min-w-0 flex-[1_1_280px]`}
              />
              <CopyButton text={url} variant="default" size="default">
                {t("mcp.copyUrl")}
              </CopyButton>
            </div>
          </div>
          <ol className="flex flex-col gap-3.5">
            {(["add", "signIn", "choose"] as const).map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span aria-hidden="true" className={stepBadge}>
                  {index + 1}
                </span>
                <span className="flex flex-col">
                  <span className="font-semibold">{t(`mcp.steps.${step}.title`)}</span>
                  <span className="text-muted-foreground">{t(`mcp.steps.${step}.text`)}</span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card aria-labelledby="apps" className="gap-5">
        <CardHeader>
          <CardTitle id="apps">{t("mcp.apps")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {apps.map((app) => (
            <div key={app} className="flex flex-col gap-1">
              <h3 className="text-label">{t(`mcp.${app}.name`)}</h3>
              <p className="text-muted-foreground">{t(`mcp.${app}.text`)}</p>
              {app === "cursor" && <Code code={configs.cursor} label={t("mcp.copyCursor")} />}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card aria-labelledby="headless" className="gap-5">
        <CardHeader>
          <CardTitle id="headless">{t("mcp.headless")}</CardTitle>
          <CardDescription>{t("mcp.headlessText")}</CardDescription>
          {isAdmin && (
            <CardAction>
              <Button asChild variant="outline" size="sm">
                <RouterLink to="/settings/api-keys">{t("apiKeys.create")}</RouterLink>
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h3 className="text-label">{t("mcp.claudeCode")}</h3>
            <Code code={configs.command} label={t("mcp.copyCommand")} />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-label">{t("mcp.jsonConfig")}</h3>
            <Code code={configs.json} label={t("mcp.copyJson")} />
          </div>
          <p className="text-small text-muted-foreground">{t("mcp.keyHint")}</p>
        </CardContent>
      </Card>

      <section aria-labelledby="connected" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="connected" tabIndex={-1} className="font-heading text-heading outline-none">
            {t("mcp.connected")}
          </h2>
          <p className="text-muted-foreground">{t(isAdmin ? "mcp.connectedAll" : "mcp.connectedOwn")}</p>
        </div>
        <FieldError>{disconnect.error}</FieldError>
        {connectedApps.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">{t("mcp.app")}</TableHead>
                <TableHead scope="col">{t("apiKeys.scopes")}</TableHead>
                <TableHead scope="col">{t("mcp.connectedBy")}</TableHead>
                <TableHead scope="col">{t("mcp.lastActive")}</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">{t("apiKeys.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectedApps.map((app) => (
                <TableRow key={app.id}>
                  <TableCell>
                    <span className="block font-medium">{app.name}</span>
                    <span
                      translate="no"
                      className="block max-w-[320px] truncate font-mono text-small text-muted-foreground"
                      title={app.clientId}
                    >
                      {app.clientId}
                    </span>
                  </TableCell>
                  <TableCell>
                    <ScopeBadges scopes={app.scopes} />
                  </TableCell>
                  <TableCell>
                    <span className="block">{app.connectedBy}</span>
                    <span className="block text-small text-muted-foreground">
                      {t("mcp.connectedOn", { date: formatDate(app.connectedAt) })}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(app.lastActiveAt)}</TableCell>
                  <TableCell className="text-right">
                    <Confirm
                      trigger={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          aria-label={t("mcp.disconnectLabel", { name: app.name })}
                        >
                          {t("mcp.disconnect")}
                        </Button>
                      }
                      title={t("mcp.disconnectTitle", { name: app.name })}
                      description={t("mcp.disconnectText", { name: app.name })}
                      action={t("mcp.disconnect")}
                      onConfirm={() => disconnectApp(app)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground">{t("mcp.noneConnected")}</p>
        )}
      </section>
    </div>
  );
}
