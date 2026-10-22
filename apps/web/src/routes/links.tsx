import { ChartLine, CircleCheck, CirclePause, Plus, Search } from "lucide-react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Form, type LoaderFunctionArgs, Link as RouterLink, useLoaderData, useNavigate, useSubmit } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ShortUrl } from "@/components/short-url";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type Link, useAction } from "@/lib/api";
import { linkName, monoInput, titleLink } from "@/lib/utils";
import { useShell } from "./shell.tsx";

const pageSize = 50;

export async function linksLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const offset = Number(url.searchParams.get("offset")) || 0;
  const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset), ...(q && { search: q }) });
  return { q, offset, ...(await api<{ links: Link[]; nextOffset: number | null }>(`/links?${query}`, undefined, "GET", request.signal)) };
}

export function StatusBadge({ link }: { link: Pick<Link, "active"> }) {
  const { t } = useTranslation();
  return link.active ? (
    <Badge variant="success">
      <CircleCheck aria-hidden="true" />
      {t("links.active")}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      <CirclePause aria-hidden="true" />
      {t("links.deactivated")}
    </Badge>
  );
}

export function Links() {
  const { t } = useTranslation();
  const submit = useSubmit();
  const { can } = useShell();
  const { links, nextOffset, q, offset } = useLoaderData<typeof linksLoader>();

  if (!links.length && !q && !offset && can("links:write")) return <Onboarding />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("links.title")} lead={t("links.subtitle")}>
        {can("links:write") && (
          <Button asChild>
            <RouterLink to="/links/new">
              <Plus aria-hidden="true" />
              {t("links.create")}
            </RouterLink>
          </Button>
        )}
      </PageHeader>
      <Form role="search" onChange={(event) => submit(event.currentTarget, { replace: true })}>
        <label htmlFor="q" className="sr-only">
          {t("links.search")}
        </label>
        <InputGroup className="max-w-[420px]">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput id="q" name="q" type="search" defaultValue={q} placeholder={t("links.searchPlaceholder")} />
        </InputGroup>
      </Form>
      {links.length ? (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">{t("links.columnLink")}</TableHead>
              <TableHead scope="col">{t("links.columnShortUrl")}</TableHead>
              <TableHead scope="col">{t("links.columnRules")}</TableHead>
              <TableHead scope="col">{t("links.columnStatus")}</TableHead>
              <TableHead scope="col">
                <span className="sr-only">{t("links.columnActions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((link) => (
              <TableRow key={link.id}>
                <TableCell className="max-w-[320px]">
                  <RouterLink to={`/links/${link.id}`} className={titleLink}>
                    {linkName(link)}
                  </RouterLink>
                  <span translate="no" className="block max-w-[280px] truncate font-mono text-mono text-muted-foreground">
                    {link.defaultTarget}
                  </span>
                </TableCell>
                <TableCell>
                  <ShortUrl shortUrl={link.shortUrl} />
                </TableCell>
                <TableCell className="text-muted-foreground">{t("links.rules", { count: link.redirectRules.length })}</TableCell>
                <TableCell>
                  <StatusBadge link={link} />
                </TableCell>
                <TableCell className="w-11 text-right">
                  <Button asChild variant="ghost" size="icon-sm">
                    <RouterLink to={`/links/${link.id}/stats`} aria-label={t("stats.statsFor", { link: linkName(link) })}>
                      <ChartLine aria-hidden="true" />
                    </RouterLink>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">{q ? t("links.noResults", { q }) : t("onboarding.emptyTitle")}</p>
      )}
      <Pagination offset={offset} count={links.length} nextOffset={nextOffset} pageSize={pageSize} />
    </div>
  );
}

function Onboarding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useAction();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const defaultTarget = String(new FormData(event.currentTarget).get("target"));
    create.run(async () => {
      const link = await api<Link>("/links", { defaultTarget });
      toast.success(t("editor.shortUrlReady"));
      navigate(`/links/${link.id}`);
    });
  }

  return (
    <div className="flex max-w-[1040px] flex-col gap-8">
      <title>{t("pageTitle", { page: t("onboarding.title") })}</title>
      <header className="flex flex-col gap-2">
        <p className="text-small font-medium text-muted-foreground">{t("onboarding.ready")}</p>
        <h1 tabIndex={-1} className="font-heading text-title outline-none">
          {t("onboarding.title")}
        </h1>
        <p className="max-w-[620px] text-lead text-muted-foreground">{t("onboarding.lead")}</p>
      </header>
      <section aria-labelledby="first-link" className="flex flex-col gap-5 rounded-xl border bg-card p-6 md:p-8">
        <h2 id="first-link" className="sr-only">
          {t("onboarding.newLink")}
        </h2>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <Field className="min-w-0 flex-[1_1_360px]">
            <FieldLabel htmlFor="target">{t("editor.defaultTarget")}</FieldLabel>
            <Input id="target" name="target" type="url" required placeholder={t("examples.firstTarget")} {...monoInput} />
          </Field>
          <SubmitButton size="lg" pending={create.pending} pendingLabel={t("editor.creating")}>
            <Plus aria-hidden="true" />
            {t("links.create")}
          </SubmitButton>
        </form>
        <FieldError>{create.error}</FieldError>
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-4">
          <span className="text-small font-medium text-muted-foreground">{t("onboarding.preview")}</span>
          <ShortUrl shortUrl={new URL(t("examples.slug"), location.origin).href} disabled />
          <span className="text-small text-muted-foreground">{t("onboarding.generatedSlugs")}</span>
        </div>
      </section>
      <section
        aria-labelledby="empty"
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-input px-6 py-12 text-center"
      >
        <div aria-hidden="true" className="flex w-24 flex-col items-end gap-2">
          <span className="block h-2.5 w-14 rounded-full bg-primary" />
          <span className="block h-2.5 w-20 rounded-full bg-primary" />
        </div>
        <h2 id="empty" className="font-heading text-heading">
          {t("onboarding.emptyTitle")}
        </h2>
        <p className="max-w-[420px] text-muted-foreground">{t("onboarding.emptyText")}</p>
      </section>
    </div>
  );
}
