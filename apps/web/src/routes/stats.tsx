import i18n, { t } from "i18next";
import { Download, Pencil, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type LoaderFunctionArgs, Link as RouterLink, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Breadcrumb } from "@/components/breadcrumb";
import { PageHeader } from "@/components/page-header";
import { SegmentedControl } from "@/components/segmented-control";
import { ShortUrl } from "@/components/short-url";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type ClickBreakdown, type ClickTimeSeries, type Link, type OrphanClicks } from "@/lib/api";
import { cn, countryName, displayUrl, linkName, titleLink } from "@/lib/utils";
import type en from "@/locales/en.json";
import { StatusBadge } from "./links.tsx";

const dimensions = ["country", "device", "os", "browser", "referrer", "utmSource", "utmMedium", "utmCampaign"] as const;
type Dimension = (typeof dimensions)[number];
const botModes = ["exclude", "include", "only"] as const;
type BotMode = (typeof botModes)[number];
const presets = [
  [7, "days7"],
  [30, "days30"],
  [365, "months12"],
] as const;
const topValues = 5;
const allValues = 100;
const topLinks = 10;

function statsQuery(request: Request, linkId?: string) {
  const search = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of ["from", "to", "bots", ...dimensions]) {
    const value = search.get(key);
    if (value !== null) query.set(key, value);
  }
  if (linkId) query.set("linkId", linkId);
  return query;
}

function withParams(query: URLSearchParams, params: Record<string, string>) {
  const result = new URLSearchParams(query);
  for (const [key, value] of Object.entries(params)) result.set(key, value);
  return result;
}

async function loadStats(query: URLSearchParams, signal: AbortSignal, by: readonly string[] = dimensions) {
  const breakdownQuery = withParams(query, { limit: String(allValues) });
  for (const name of by) breakdownQuery.append("by", name);
  const [timeSeries, botClicks, { breakdowns }] = await Promise.all([
    api<ClickTimeSeries>(`/stats/time-series?${query}`, undefined, "GET", signal),
    query.get("bots") === "only"
      ? undefined
      : api<ClickTimeSeries>(`/stats/time-series?${withParams(query, { bots: "only" })}`, undefined, "GET", signal),
    api<ClickBreakdown>(`/stats/breakdown?${breakdownQuery}`, undefined, "GET", signal),
  ]);
  return { query: query.toString(), timeSeries, botClicks: (botClicks ?? timeSeries).clicks, breakdowns };
}

export async function linkStatsLoader({ params, request }: LoaderFunctionArgs) {
  const [link, stats] = await Promise.all([api<Link>(`/links/${params.id}`), loadStats(statsQuery(request, params.id), request.signal)]);
  return { link, stats };
}

export async function instanceStatsLoader({ request }: LoaderFunctionArgs) {
  const query = statsQuery(request);
  const range = new URLSearchParams([...query].filter(([key]) => ["from", "to", "bots"].includes(key)));
  const [stats, orphans] = await Promise.all([
    loadStats(query, request.signal, [...dimensions, "link"]),
    api<OrphanClicks>(`/stats/orphan-clicks?${withParams(range, { limit: "20" })}`),
  ]);
  return { stats, orphans: orphans.slugs };
}

type Stats = Awaited<ReturnType<typeof loadStats>>;

const formatNumber = (value: number) => value.toLocaleString(i18n.language);
const formatShare = (value: number, total: number) => (total ? value / total : 0).toLocaleString(i18n.language, { style: "percent" });
const formatDay = (day: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(i18n.language, { ...options, timeZone: "UTC" });
const longDay = { weekday: "short", month: "short", day: "numeric", year: "numeric" } as const;

function valueLabel(by: Dimension, value: string | null) {
  if (value === null) return by === "referrer" ? t("stats.direct") : by.startsWith("utm") ? t("stats.none") : t("stats.unknown");
  if (by === "country") return countryName(value);
  if (by === "device" && i18n.exists(`stats.deviceTypes.${value}`))
    return t(`stats.deviceTypes.${value as keyof typeof en.stats.deviceTypes}`);
  return value;
}

function presetRange(days: number) {
  const today = new Date();
  const day = (offset: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset).toLocaleDateString("en-CA");
  return { from: day(days - 1), to: day(0) };
}

function useStatsParams() {
  const [params, setParams] = useSearchParams();
  function update(changes: Record<string, string | null>) {
    setParams((current) => {
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) current.delete(key);
        else current.set(key, value);
      }
      return current;
    });
  }
  return [params, update] as const;
}

function Toolbar({ stats }: { stats: Stats }) {
  const { t } = useTranslation();
  const [params, update] = useStatsParams();
  const { from, to } = stats.timeSeries;
  const range = presets.find(([days]) => {
    const preset = presetRange(days);
    return preset.from === from && preset.to === to;
  })?.[0];
  const bots = (params.get("bots") ?? "exclude") as BotMode;
  const filters = dimensions.filter((by) => params.has(by));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label={t("stats.range")}
            options={presets.map(([days, key]) => [days, t(`stats.${key}`)] as const)}
            value={range}
            onChange={(days) => update(presetRange(days))}
          />
          <form
            key={`${from}/${to}`}
            aria-label={t("stats.range")}
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              update({ from: String(form.get("from")), to: String(form.get("to")) });
            }}
            className="flex items-center gap-2"
          >
            <Input type="date" name="from" required aria-label={t("stats.from")} defaultValue={from} className="h-8 w-auto" />
            <span aria-hidden="true" className="text-muted-foreground">
              –
            </span>
            <Input type="date" name="to" required aria-label={t("stats.to")} defaultValue={to} className="h-8 w-auto" />
            <Button type="submit" variant="outline" size="sm">
              {t("stats.apply")}
            </Button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span aria-hidden="true" className="text-label">
            {t("stats.bots")}
          </span>
          <SegmentedControl
            label={t("stats.bots")}
            options={botModes.map((mode) => [mode, t(`stats.botModes.${mode}`)] as const)}
            value={bots}
            onChange={(mode) => update({ bots: mode === "exclude" ? null : mode })}
          />
          <Button asChild variant="outline" size="sm">
            <a href={`/api/stats/export?${stats.query}`} download>
              <Download aria-hidden="true" />
              {t("stats.export")}
            </a>
          </Button>
        </div>
      </div>
      {filters.length ? (
        <ul aria-label={t("stats.filters")} className="flex flex-wrap gap-2">
          {filters.map((by) => {
            const filter = t("stats.filter", { name: t(`stats.dimensions.${by}`), value: valueLabel(by, params.get(by) || null) });
            return (
              <li key={by}>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t("stats.removeFilter", { filter })}
                  onClick={() => update({ [by]: null })}
                >
                  {filter}
                  <X aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-small text-muted-foreground">{t("stats.filterHint")}</p>
      )}
    </div>
  );
}

function Tiles({ stats }: { stats: Stats }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { from, to, clicks } = stats.timeSeries;
  const [topCountry] = stats.breakdowns.country ?? [];
  const tiles = [
    [t("stats.clicks"), formatNumber(clicks), t("stats.rangeHint", { from: formatDay(from), to: formatDay(to) })],
    [
      t("stats.botClicks"),
      formatNumber(stats.botClicks),
      (params.get("bots") ?? "exclude") === "exclude" ? t("stats.botsHidden") : t("stats.botsShown"),
    ],
    ...(topCountry
      ? [
          [
            t("stats.topCountry"),
            valueLabel("country", topCountry.value),
            t("stats.shareOfClicks", { share: formatShare(topCountry.clicks, clicks) }),
          ],
        ]
      : []),
  ];
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
      {tiles.map(([label, value, hint]) => (
        <div key={label} className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-6 py-4">
          <dt className="text-small font-medium text-muted-foreground">{label}</dt>
          <dd className="truncate font-heading text-stat tabular-nums">{value}</dd>
          <dd className="text-small text-muted-foreground tabular-nums">{hint}</dd>
        </div>
      ))}
    </dl>
  );
}

function ClicksChart({ stats }: { stats: Stats }) {
  const { t } = useTranslation();
  const { from, to, clicks, series } = stats.timeSeries;
  const config = {
    clicks: { label: t("stats.clicks"), color: "var(--chart-1)" },
    uniqueVisitors: { label: t("stats.uniqueVisitors"), color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const peak = series.reduce((best, bucket) => (bucket.clicks > best.clicks ? bucket : best), series[0]);
  const summary = clicks
    ? t("stats.chartSummary", {
        from: formatDay(from, longDay),
        to: formatDay(to, longDay),
        clicks: formatNumber(clicks),
        peak: formatNumber(peak.clicks),
        day: formatDay(peak.start, longDay),
      })
    : t("stats.chartEmpty", { from: formatDay(from, longDay), to: formatDay(to, longDay) });

  return (
    <figure aria-labelledby="clicks-chart" className="m-0 flex flex-col gap-3 rounded-lg border bg-card px-6 pt-4 pb-6">
      <h2 id="clicks-chart" className="font-heading text-heading">
        {t("stats.clicksPerDay")}
      </h2>
      <div className="relative">
        <ChartContainer config={config} className="aspect-auto h-60 w-full">
          <AreaChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} aria-label={summary}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="start"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(day) => formatDay(day)}
            />
            <YAxis tickLine={false} axisLine={false} width={48} allowDecimals={false} tickFormatter={formatNumber} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(day) => formatDay(String(day), longDay)} />} />
            <ChartLegend verticalAlign="top" align="right" content={<ChartLegendContent className="justify-end" />} />
            <Area
              dataKey="clicks"
              type="linear"
              fill="var(--color-clicks)"
              fillOpacity={0.14}
              stroke="var(--color-clicks)"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Area
              dataKey="uniqueVisitors"
              type="linear"
              fill="none"
              stroke="var(--color-uniqueVisitors)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
        {!clicks && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="bg-card px-2 text-muted-foreground">{t("stats.noClicks")}</span>
          </p>
        )}
      </div>
      <figcaption className="text-small text-muted-foreground">{t("stats.uniqueVisitorsHint")}</figcaption>
      <details className="text-small">
        <summary className="font-medium">{t("stats.showTable")}</summary>
        <Table className="mt-3">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">{t("stats.day")}</TableHead>
              <TableHead scope="col" className="text-right">
                {t("stats.clicks")}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t("stats.uniqueVisitors")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            {series.map((bucket) => (
              <TableRow key={bucket.start}>
                <TableCell>{formatDay(bucket.start, longDay)}</TableCell>
                <TableCell className="text-right">{formatNumber(bucket.clicks)}</TableCell>
                <TableCell className="text-right">{formatNumber(bucket.uniqueVisitors)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  );
}

function Bar({ share }: { share: number }) {
  return (
    <span aria-hidden="true" className="block h-2 rounded-full bg-muted">
      <span className="block h-2 rounded-full bg-chart-1" style={{ width: `${share * 100}%` }} />
    </span>
  );
}

function Breakdowns({ stats }: { stats: Stats }) {
  const { t } = useTranslation();
  const [params, update] = useStatsParams();
  const total = stats.timeSeries.clicks;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-6">
      {dimensions.map((by) => {
        const values = stats.breakdowns[by] ?? [];
        const row = (label: string, clicks: number) => (
          <>
            <span className="truncate">{label}</span>
            <span className="text-muted-foreground tabular-nums">
              {formatNumber(clicks)} · {formatShare(clicks, total)}
            </span>
            <span className="col-span-2">
              <Bar share={total ? clicks / total : 0} />
            </span>
          </>
        );
        const rowClass = "grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-md px-2 py-1.5 text-left";
        const list = (shown: typeof values, inSheet = false) => {
          const other = total - shown.reduce((sum, row) => sum + row.clicks, 0);
          return (
            <ul className="flex flex-col gap-1">
              {shown.map(({ value, clicks }) => {
                const filter = value ?? "";
                const active = params.get(by) === filter;
                const button = (
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => update({ [by]: active ? null : filter })}
                    className={cn(
                      rowClass,
                      "transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-accent",
                    )}
                  >
                    {row(valueLabel(by, value), clicks)}
                  </button>
                );
                return <li key={filter}>{inSheet ? <SheetClose asChild>{button}</SheetClose> : button}</li>;
              })}
              {other > 0 && <li className={rowClass}>{row(t("stats.other"), other)}</li>}
            </ul>
          );
        };
        return (
          <Card key={by} aria-labelledby={`breakdown-${by}`} className="gap-4">
            <CardHeader>
              <CardTitle id={`breakdown-${by}`}>{t(`stats.breakdowns.${by}`)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {values.length ? list(values.slice(0, topValues)) : <p className="text-muted-foreground">{t("stats.noClicks")}</p>}
              {values.length > topValues && (
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="link" size="sm" aria-describedby={`breakdown-${by}`} className="self-start px-2">
                      {t("stats.showAll")}
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader className="pr-12">
                      <SheetTitle>{t(`stats.breakdowns.${by}`)}</SheetTitle>
                      <SheetDescription>{t("stats.allValues", { max: allValues })}</SheetDescription>
                    </SheetHeader>
                    <div className="overflow-y-auto px-2 pb-4">{list(values, true)}</div>
                  </SheetContent>
                </Sheet>
              )}
              {by === "country" && (
                <a
                  href="https://db-ip.com"
                  className="self-start text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {t("stats.geolocation")}
                </a>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function StatsBody({ stats, children }: { stats: Stats; children: ReactNode }) {
  const navigation = useNavigation();
  return (
    <div
      aria-busy={navigation.state === "loading"}
      className={cn("flex flex-col gap-6 transition-opacity", navigation.state === "loading" && "opacity-60")}
    >
      <Toolbar stats={stats} />
      <Tiles stats={stats} />
      {children}
    </div>
  );
}

export function LinkStats() {
  const { t } = useTranslation();
  const { link, stats } = useLoaderData<typeof linkStatsLoader>();
  const name = linkName(link);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb current={name} />
      <PageHeader
        title={name}
        badge={<StatusBadge link={link} />}
        lead={
          <span className="mt-2 flex flex-wrap items-center gap-3">
            <ShortUrl shortUrl={link.shortUrl} />
            <span className="min-w-0 truncate">
              {t("editor.defaultTarget")}{" "}
              <span translate="no" className="font-mono text-mono text-foreground">
                {link.defaultTarget}
              </span>
            </span>
          </span>
        }
      >
        <Button asChild variant="secondary">
          <RouterLink to={`/links/${link.id}`}>
            <Pencil aria-hidden="true" />
            {t("editor.editTitle")}
          </RouterLink>
        </Button>
      </PageHeader>
      <StatsBody stats={stats}>
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-6">
            <ClicksChart stats={stats} />
            <Breakdowns stats={stats} />
          </div>
          <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-6">
            <Card aria-labelledby="qr-code" className="gap-4">
              <CardHeader>
                <CardTitle id="qr-code">{t("stats.qrTitle")}</CardTitle>
                <CardDescription>{t("stats.qrText")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-4">
                <img
                  src={`/api/links/${link.id}/qr?format=svg`}
                  alt={t("stats.qrAlt", { url: displayUrl(link.shortUrl) })}
                  className="aspect-square w-full max-w-[280px] rounded-xl border"
                />
                <div className="flex flex-wrap gap-2">
                  {(["svg", "png"] as const).map((format) => (
                    <Button key={format} asChild variant="outline" size="sm">
                      <a href={`/api/links/${link.id}/qr?format=${format}`} download={`${link.slug}.${format}`}>
                        <Download aria-hidden="true" />
                        {t(`stats.download.${format}`)}
                      </a>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </StatsBody>
    </div>
  );
}

export function InstanceStats() {
  const { t } = useTranslation();
  const { stats, orphans } = useLoaderData<typeof instanceStatsLoader>();
  const total = stats.timeSeries.clicks;
  const links = (stats.breakdowns.link ?? []).slice(0, topLinks);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("stats.title")} lead={t("stats.subtitle", { timeZone: stats.timeSeries.timeZone })} />
      <StatsBody stats={stats}>
        <ClicksChart stats={stats} />
        <section aria-labelledby="top-links" className="flex flex-col gap-3">
          <h2 id="top-links" className="font-heading text-heading">
            {t("stats.topLinks")}
          </h2>
          {links.length ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">{t("links.columnLink")}</TableHead>
                  <TableHead scope="col">{t("links.columnShortUrl")}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("stats.clicks")}
                  </TableHead>
                  <TableHead scope="col" className="w-[28%]">
                    {t("stats.columnShare")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums">
                {links.map(({ value, clicks, shortUrl, title }) => (
                  <TableRow key={value}>
                    <TableCell className="max-w-[280px]">
                      <RouterLink to={`/links/${value}/stats`} className={titleLink}>
                        {linkName({ title, shortUrl })}
                      </RouterLink>
                    </TableCell>
                    <TableCell translate="no" className="font-mono text-mono text-muted-foreground">
                      {displayUrl(shortUrl)}
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(clicks)}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2.5">
                        <span className="flex-1">
                          <Bar share={total ? clicks / total : 0} />
                        </span>
                        <span className="w-10 text-right text-muted-foreground">{formatShare(clicks, total)}</span>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground">{t("stats.noClicks")}</p>
          )}
        </section>
        <Breakdowns stats={stats} />
        <Card aria-labelledby="orphan-clicks" className="gap-4">
          <CardHeader>
            <CardTitle id="orphan-clicks">{t("stats.orphanTitle")}</CardTitle>
            <CardDescription>{t("stats.orphanText")}</CardDescription>
          </CardHeader>
          <CardContent>
            {orphans.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col">{t("stats.columnRequested")}</TableHead>
                    <TableHead scope="col" className="text-right">
                      {t("stats.clicks")}
                    </TableHead>
                    <TableHead scope="col">{t("stats.columnLastClick")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="tabular-nums">
                  {orphans.map((orphan) => (
                    <TableRow key={orphan.shortUrl}>
                      <TableCell translate="no" className="font-mono text-mono">
                        {displayUrl(orphan.shortUrl)}
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(orphan.clicks)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(orphan.lastClickedAt).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground">{t("stats.noOrphans")}</p>
            )}
          </CardContent>
        </Card>
      </StatsBody>
    </div>
  );
}
