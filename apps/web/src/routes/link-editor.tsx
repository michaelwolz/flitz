import { ChartLine, CircleAlert, Globe, Monitor, Smartphone, Trash2 } from "lucide-react";
import { type ComponentProps, type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type LoaderFunctionArgs, Link as RouterLink, useBeforeUnload, useBlocker, useLoaderData, useNavigate } from "react-router";
import { toast } from "sonner";
import { Breadcrumb } from "@/components/breadcrumb";
import { Confirm } from "@/components/confirm";
import { PageHeader } from "@/components/page-header";
import { RedirectRules, type RuleEditing, type RuleItem, ruleError, toItems, toRules } from "@/components/redirect-rules";
import { ShortUrl } from "@/components/short-url";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, type Domain, type Link, type RedirectRule, useAction } from "@/lib/api";
import { formatDate, linkName, monoInput } from "@/lib/utils";
import { StatusBadge } from "./links.tsx";
import { useShell } from "./shell.tsx";

const presets = {
  appStore: { path: "app-store", icon: Smartphone },
  mobileDesktop: { path: "mobile-desktop", icon: Monitor },
  countrySplit: { path: "country-split", icon: Globe },
} as const;
type Preset = keyof typeof presets;

export async function editorLoader({ params }: LoaderFunctionArgs) {
  if (params.id) return { link: await api<Link>(`/links/${params.id}`), domains: [] };
  const { domains } = await api<{ domains: Domain[] }>("/domains");
  return { link: null, domains: domains.map((domain) => domain.hostname) };
}

export function LinkEditor() {
  const data = useLoaderData<typeof editorLoader>();
  return <Editor key={data.link?.id ?? "new"} {...data} />;
}

function Editor({ link: loaded, domains }: Awaited<ReturnType<typeof editorLoader>>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [link, setLink] = useState(loaded);
  const [domain, setDomain] = useState("");
  const [defaultTarget, setDefaultTarget] = useState(loaded?.defaultTarget ?? "");
  const [rules, setRules] = useState(() => toItems(loaded?.redirectRules ?? []));
  const [editingRule, setEditingRule] = useState<RuleEditing>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const save = useAction();
  const applyPreset = useAction();
  const toggle = useAction();
  const remove = useAction();
  const { can } = useShell();
  const readOnly = !can("links:write");
  const host = link ? new URL(link.shortUrl).host : domain || location.host;
  const dirty = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty.current && currentLocation.pathname !== nextLocation.pathname);
  useBeforeUnload((event) => {
    if (dirty.current) event.preventDefault();
  });

  function changeRules(items: RuleItem[]) {
    dirty.current = true;
    setRules(items);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = rules.findIndex((item, index) => ruleError(item, index));
    if (invalid >= 0) return setEditingRule({ id: rules[invalid].id, check: true });
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    const slug = value("slug");
    const fields = {
      defaultTarget,
      redirectRules: toRules(rules),
      title: value("title") || null,
      description: value("description") || null,
    };
    save.run(async () => {
      if (link) {
        setLink(await api<Link>(`/links/${link.id}`, fields, "PATCH"));
        dirty.current = false;
        toast.success(t("editor.saved"));
        return;
      }
      const created = await api<Link>("/links", { ...fields, ...(domain && { domain }), ...(slug && { slug }) });
      dirty.current = false;
      toast.success(t("editor.shortUrlReady"));
      navigate(`/links/${created.id}`);
    });
  }

  function submitPreset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    const countries = value("countries")
      .split(/[\s,]+/)
      .filter(Boolean);
    const body =
      preset === "appStore"
        ? { appStoreId: value("appStoreId"), googlePlayPackage: value("googlePlayPackage"), defaultTarget }
        : preset === "mobileDesktop"
          ? { mobileTarget: value("mobileTarget"), desktopTarget: defaultTarget }
          : { countryTargets: Object.fromEntries(countries.map((code) => [code, value("countryTarget")])), defaultTarget };
    applyPreset.run(async () => {
      if (!defaultTarget) throw new Error(t("presets.needsDefaultTarget"));
      const result = await api<{ defaultTarget: string; redirectRules: RedirectRule[] }>(`/presets/${presets[preset!].path}`, body);
      setDefaultTarget(result.defaultTarget);
      changeRules([...rules, ...toItems(result.redirectRules)]);
      setPreset(null);
      toast.success(t("presets.applied", { count: result.redirectRules.length }));
    });
  }

  function setActive(active: boolean) {
    toggle.run(async () => {
      setLink(await api<Link>(`/links/${link!.id}/${active ? "reactivate" : "deactivate"}`, {}));
      toast.success(active ? t("editor.reactivated") : t("editor.deactivated"));
    });
  }

  function deleteLink() {
    remove.run(async () => {
      await api(`/links/${link!.id}`, undefined, "DELETE");
      dirty.current = false;
      toast.success(t("editor.deleted"));
      navigate("/");
    });
  }

  const presetField = (name: string, label: string, props: ComponentProps<"input"> = {}) => (
    <Field>
      <FieldLabel htmlFor={`preset-${name}`}>{label}</FieldLabel>
      <Input id={`preset-${name}`} name={name} form="preset-form" required {...monoInput} {...props} />
    </Field>
  );

  const heading = link ? t("editor.editTitle") : t("editor.createTitle");

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb current={link ? linkName(link) : t("editor.newLink")} />
      <PageHeader title={heading}>
        <div className="flex gap-2">
          <Button asChild variant="ghost">
            <RouterLink to="/">{t("editor.cancel")}</RouterLink>
          </Button>
          {!readOnly && (
            <SubmitButton form="link-form" pending={save.pending} pendingLabel={link ? t("editor.saving") : t("editor.creating")}>
              {link ? t("editor.save") : t("links.create")}
            </SubmitButton>
          )}
        </div>
      </PageHeader>
      {save.error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("editor.notSaved")}</AlertTitle>
          <AlertDescription>{save.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-start gap-6">
        <form
          id="link-form"
          onSubmit={submit}
          onChange={() => {
            dirty.current = true;
          }}
          className="min-w-0 flex-[2_1_560px]"
        >
          <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
            <Card aria-labelledby="card-short-url">
              <CardHeader>
                <CardTitle id="card-short-url">{t("editor.shortUrl")}</CardTitle>
                <CardDescription>{t("editor.shortUrlText")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="domain">{t("editor.domain")}</FieldLabel>
                  <NativeSelect
                    id="domain"
                    value={link ? host : domain}
                    disabled={!!link || !domains.length}
                    onChange={(event) => setDomain(event.target.value)}
                    className="w-full"
                  >
                    {link ? (
                      <NativeSelectOption value={host}>{host}</NativeSelectOption>
                    ) : (
                      <>
                        <NativeSelectOption value="">{location.host}</NativeSelectOption>
                        {domains.map((hostname) => (
                          <NativeSelectOption key={hostname} value={hostname}>
                            {hostname}
                          </NativeSelectOption>
                        ))}
                      </>
                    )}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="slug">{t("editor.slug")}</FieldLabel>
                  <InputGroup className="overflow-hidden">
                    <InputGroupAddon className="max-w-1/2 self-stretch border-r border-input bg-muted pr-3 font-mono font-normal">
                      <InputGroupText>
                        <span translate="no" className="min-w-0 truncate">
                          {host}/
                        </span>
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      id="slug"
                      name="slug"
                      defaultValue={loaded?.slug}
                      disabled={!!link}
                      placeholder={link ? "" : t("editor.generated")}
                      aria-describedby="slug-hint"
                      {...monoInput}
                    />
                  </InputGroup>
                </Field>
                <p id="slug-hint" className="-mt-2 text-small text-muted-foreground sm:col-span-2">
                  {link ? t("editor.slugFixed") : t("editor.slugOptional")}
                </p>
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="title">{t("editor.title")}</FieldLabel>
                  <Input id="title" name="title" defaultValue={loaded?.title ?? ""} maxLength={200} />
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="description">{t("editor.description")}</FieldLabel>
                  <Textarea id="description" name="description" rows={2} maxLength={2000} defaultValue={loaded?.description ?? ""} />
                </Field>
              </CardContent>
            </Card>

            <Card aria-labelledby="card-default-target">
              <CardHeader>
                <CardTitle id="card-default-target">{t("editor.defaultTarget")}</CardTitle>
                <CardDescription>{t("editor.defaultTargetText")}</CardDescription>
              </CardHeader>
              <CardContent>
                <label htmlFor="default-target" className="sr-only">
                  {t("editor.defaultTarget")}
                </label>
                <Input
                  id="default-target"
                  type="url"
                  required
                  placeholder={t("examples.defaultTarget")}
                  value={defaultTarget}
                  onChange={(event) => setDefaultTarget(event.target.value)}
                  {...monoInput}
                />
              </CardContent>
            </Card>

            <Card aria-labelledby="card-rules">
              <CardHeader>
                <CardTitle id="card-rules">{t("rules.title")}</CardTitle>
                <CardDescription>{t("rules.text")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {!readOnly && (
                  <fieldset className="flex flex-col gap-2.5">
                    <legend className="mb-2.5 text-label">{t("presets.legend")}</legend>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                      {(Object.keys(presets) as Preset[]).map((key) => {
                        const Icon = presets[key].icon;
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={preset === key}
                            onClick={() => setPreset(preset === key ? null : key)}
                            className="flex flex-col items-start gap-1.5 rounded-lg border border-input bg-card px-4 py-3.5 text-left text-card-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-ring aria-pressed:bg-accent aria-pressed:ring-1 aria-pressed:ring-ring aria-pressed:ring-inset"
                          >
                            <span className="flex items-center gap-2 font-semibold">
                              <Icon className="size-4" aria-hidden="true" />
                              {t(`presets.${key}.name`)}
                            </span>
                            <span className="text-small text-muted-foreground">{t(`presets.${key}.description`)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-small text-muted-foreground">{t("presets.hint")}</p>
                  </fieldset>
                )}
                {preset && (
                  <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
                    {preset === "appStore" && (
                      <>
                        {presetField("appStoreId", t("presets.appStoreId"), {
                          inputMode: "numeric",
                          placeholder: t("examples.appStoreId"),
                        })}
                        {presetField("googlePlayPackage", t("presets.googlePlayPackage"), { placeholder: t("examples.googlePlayPackage") })}
                      </>
                    )}
                    {preset === "mobileDesktop" &&
                      presetField("mobileTarget", t("presets.mobileTarget"), { type: "url", placeholder: t("examples.mobileTarget") })}
                    {preset === "countrySplit" && (
                      <>
                        {presetField("countries", t("presets.countries"), { placeholder: t("examples.countries") })}
                        {presetField("countryTarget", t("rules.target"), { type: "url", placeholder: t("examples.countryTarget") })}
                      </>
                    )}
                    <p className="text-small text-muted-foreground sm:col-span-2">{t(`presets.${preset}.hint`)}</p>
                    <FieldError className="sm:col-span-2">{applyPreset.error}</FieldError>
                    <div className="sm:col-span-2">
                      <SubmitButton
                        form="preset-form"
                        variant="secondary"
                        pending={applyPreset.pending}
                        pendingLabel={t("presets.applying")}
                      >
                        {t("presets.apply")}
                      </SubmitButton>
                    </div>
                  </div>
                )}
                <RedirectRules
                  items={rules}
                  onChange={changeRules}
                  editing={editingRule}
                  onEdit={setEditingRule}
                  defaultTarget={defaultTarget}
                />
              </CardContent>
            </Card>
          </fieldset>
        </form>

        {link && (
          <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-6">
            <Card aria-labelledby="card-link" className="gap-4">
              <CardHeader>
                <CardTitle id="card-link" className="truncate">
                  {linkName(link)}
                </CardTitle>
                <CardAction>
                  <StatusBadge link={link} />
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div>
                  <ShortUrl shortUrl={link.shortUrl} />
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small">
                  <dt className="text-muted-foreground">{t("editor.createdOn")}</dt>
                  <dd>{formatDate(link.createdAt)}</dd>
                </dl>
                <Button asChild variant="secondary" size="sm" className="self-start">
                  <RouterLink to={`/links/${link.id}/stats`}>
                    <ChartLine aria-hidden="true" />
                    {t("stats.viewStats")}
                  </RouterLink>
                </Button>
              </CardContent>
            </Card>
            {!readOnly && (
              <Card aria-labelledby="card-active" className="gap-3">
                <CardHeader>
                  <CardTitle id="card-active">{link.active ? t("editor.deactivateTitle") : t("editor.reactivateTitle")}</CardTitle>
                  <CardDescription>{link.active ? t("editor.deactivateText") : t("editor.reactivateText")}</CardDescription>
                </CardHeader>
                <CardFooter className="flex-col items-start gap-2">
                  <SubmitButton
                    type="button"
                    variant="outline"
                    pending={toggle.pending}
                    pendingLabel={link.active ? t("editor.deactivating") : t("editor.reactivating")}
                    onClick={() => setActive(!link.active)}
                  >
                    {link.active ? t("editor.deactivate") : t("editor.reactivate")}
                  </SubmitButton>
                  <FieldError>{toggle.error}</FieldError>
                  {!link.active && can("instance:admin") && (
                    <Confirm
                      trigger={
                        <Button variant="ghost" size="sm" className="text-destructive">
                          <Trash2 aria-hidden="true" />
                          {t("editor.delete")}
                        </Button>
                      }
                      title={t("editor.deleteTitle")}
                      description={t("editor.deleteText", { shortUrl: link.shortUrl })}
                      action={t("editor.delete")}
                      onConfirm={deleteLink}
                    />
                  )}
                  <FieldError>{remove.error}</FieldError>
                </CardFooter>
              </Card>
            )}
          </aside>
        )}
      </div>
      <form id="preset-form" onSubmit={submitPreset} />
      <Confirm
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset();
        }}
        title={t("editor.leaveTitle")}
        description={t("editor.leaveText")}
        action={t("editor.leave")}
        onConfirm={() => {
          dirty.current = false;
          blocker.proceed?.();
        }}
      />
    </div>
  );
}
