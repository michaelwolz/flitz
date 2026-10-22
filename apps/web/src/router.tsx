import { useTranslation } from "react-i18next";
import { createBrowserRouter, redirect, Link as RouterLink, useLocation, useRouteError, useRouteLoaderData } from "react-router";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ForgotPassword, guestLoader, ResetPassword, SignIn, SignUp } from "./routes/auth.tsx";
import { Links, linksLoader } from "./routes/links.tsx";
import { Shell, shellLoader } from "./routes/shell.tsx";

function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();
  const shell = useRouteLoaderData("shell");
  const { pathname } = useLocation();
  const canGoHome = shell !== undefined && pathname !== "/";
  return (
    <div role="alert" className="flex max-w-[620px] flex-col items-start gap-4 p-4">
      <PageHeader title={t("errors.title")} lead={error instanceof Error ? error.message : t("errors.generic")} />
      {canGoHome ? (
        <Button asChild variant="outline">
          <RouterLink to="/" reloadDocument>
            {t("errors.goToLinks")}
          </RouterLink>
        </Button>
      ) : (
        <Button variant="outline" onClick={() => location.reload()}>
          {t("errors.tryAgain")}
        </Button>
      )}
    </div>
  );
}

const linkEditor = () => import("./routes/link-editor.tsx").then((m) => ({ Component: m.LinkEditor, loader: m.editorLoader }));

export const router = createBrowserRouter(
  [
    {
      errorElement: <RouteError />,
      children: [
        { path: "/sign-in", element: <SignIn />, loader: guestLoader },
        { path: "/sign-up", element: <SignUp />, loader: guestLoader },
        { path: "/forgot-password", element: <ForgotPassword /> },
        { path: "/reset-password", element: <ResetPassword /> },
      ],
    },
    {
      id: "shell",
      path: "/",
      element: <Shell />,
      loader: shellLoader,
      shouldRevalidate: () => false,
      errorElement: <RouteError />,
      children: [
        {
          errorElement: <RouteError />,
          children: [
            { index: true, element: <Links />, loader: linksLoader },
            { path: "links/new", lazy: linkEditor },
            { path: "links/:id", lazy: linkEditor },
            {
              path: "links/:id/stats",
              lazy: () => import("./routes/stats.tsx").then((m) => ({ Component: m.LinkStats, loader: m.linkStatsLoader })),
            },
            {
              path: "stats",
              lazy: () => import("./routes/stats.tsx").then((m) => ({ Component: m.InstanceStats, loader: m.instanceStatsLoader })),
            },
            {
              path: "settings/domains",
              lazy: () => import("./routes/domains.tsx").then((m) => ({ Component: m.Domains, loader: m.domainsLoader })),
            },
            {
              path: "settings/api-keys",
              lazy: () => import("./routes/api-keys.tsx").then((m) => ({ Component: m.ApiKeys, loader: m.apiKeysLoader })),
            },
            { path: "settings/mcp", lazy: () => import("./routes/mcp.tsx").then((m) => ({ Component: m.Mcp, loader: m.mcpLoader })) },
            {
              path: "settings/users",
              lazy: () => import("./routes/users.tsx").then((m) => ({ Component: m.Users, loader: m.usersLoader })),
            },
            {
              path: "settings/instance",
              lazy: () => import("./routes/settings.tsx").then((m) => ({ Component: m.InstanceSettings, loader: m.settingsLoader })),
            },
          ],
        },
      ],
    },
    { path: "*", loader: () => redirect("/") },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") },
);
