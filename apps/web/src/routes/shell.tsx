import { Bot, BookOpen, ChartLine, Globe, KeyRound, Link2, LogOut, type LucideIcon, Moon, Settings, Sun, Users } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type LoaderFunctionArgs,
  NavLink,
  Outlet,
  redirect,
  Link as RouterLink,
  ScrollRestoration,
  useLocation,
  useNavigate,
  useRouteLoaderData,
} from "react-router";
import { toast } from "sonner";
import lockupDark from "../../../../docs/brand/flitz-lockup-dark.svg";
import lockupLight from "../../../../docs/brand/flitz-lockup-light.svg";
import { focusPageHeading } from "@/components/page-header";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { auth, authClient, type Scope, scopesOf, signInPath, useAction } from "@/lib/api";
import { setTheme, useTheme } from "@/lib/theme";
import { avatar } from "@/lib/utils";

export async function shellLoader({ request }: LoaderFunctionArgs) {
  const { data: session } = await authClient.getSession();
  if (!session) throw redirect(signInPath(request.url));
  const scopes = scopesOf(session.user.role);
  return { user: session.user, can: (scope: Scope) => scopes.includes(scope) };
}

export function useShell() {
  return useRouteLoaderData<typeof shellLoader>("shell")!;
}

const navButton = "h-9 rounded-full px-3 data-[active=true]:font-semibold";

const settingsNav = [
  { to: "/settings/domains", label: "domains.title", icon: Globe, admin: false },
  { to: "/settings/api-keys", label: "apiKeys.title", icon: KeyRound, admin: true },
  { to: "/settings/mcp", label: "mcp.title", icon: Bot, admin: false },
  { to: "/settings/users", label: "users.title", icon: Users, admin: true },
  { to: "/settings/instance", label: "settings.title", icon: Settings, admin: true },
] as const;

function NavItem({ to, icon: Icon, label, active }: { to: string; icon: LucideIcon; label: string; active: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} className={navButton}>
        <NavLink to={to}>
          <Icon aria-hidden="true" />
          {label}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NameDialog({ name, email, onSaved }: { name: string; email: string; onSaved: (name: string) => void }) {
  const { t } = useTranslation();
  const save = useAction();
  const [open, setOpen] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newName = String(new FormData(event.currentTarget).get("name")).trim();
    save.run(async () => {
      await auth(authClient.updateUser({ name: newName }));
      onSaved(newName);
      setOpen(false);
      toast.success(t("shell.nameSaved"));
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="-m-1 flex min-w-0 flex-1 items-center gap-2 rounded-full p-1 text-left hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span aria-hidden="true" className={avatar}>
            {(name || email).charAt(0).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{name}</span>
            <span className="truncate text-caption font-normal text-muted-foreground">{email}</span>
          </span>
          <span className="sr-only">{t("shell.changeName")}</span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("shell.changeName")}</DialogTitle>
          <DialogDescription>{t("shell.changeNameText")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="own-name">{t("auth.name")}</FieldLabel>
            <Input id="own-name" name="name" defaultValue={name} autoComplete="name" required />
          </Field>
          <FieldError>{save.error}</FieldError>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <SubmitButton pending={save.pending} pendingLabel={t("shell.savingName")}>
              {t("shell.saveName")}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RouteChanges() {
  const { pathname } = useLocation();
  const { openMobile, setOpenMobile } = useSidebar();
  const last = useRef(pathname);
  useEffect(() => {
    if (last.current === pathname) return;
    if (openMobile) return setOpenMobile(false);
    last.current = pathname;
    focusPageHeading({ preventScroll: true });
  }, [pathname, openMobile, setOpenMobile]);
  return <ScrollRestoration />;
}

export function Shell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useTheme();
  const { pathname } = useLocation();
  const { user, can } = useShell();
  const [name, setName] = useState(user.name);

  async function signOut() {
    await authClient.signOut();
    navigate("/sign-in");
  }

  return (
    <SidebarProvider>
      <RouteChanges />
      <Sidebar>
        <SidebarHeader className="px-3 pt-5">
          <RouterLink to="/" aria-label={t("shell.home")} className="block self-start rounded-md px-2 py-1">
            <img src={lockupLight} alt="" className="h-7 dark:hidden" />
            <img src={lockupDark} alt="" className="hidden h-7 dark:block" />
          </RouterLink>
        </SidebarHeader>
        <SidebarContent className="px-3 pt-3">
          <nav aria-label={t("shell.mainNav")} className="flex flex-col gap-5">
            <SidebarMenu>
              <NavItem to="/" icon={Link2} label={t("links.title")} active={pathname === "/" || pathname.startsWith("/links/")} />
              <NavItem to="/stats" icon={ChartLine} label={t("stats.title")} active={pathname === "/stats"} />
            </SidebarMenu>
            <SidebarGroup className="p-0">
              <SidebarGroupLabel id="nav-instance" className="h-auto px-3 pb-1 text-caption text-muted-foreground">
                {t("shell.instance")}
              </SidebarGroupLabel>
              <SidebarMenu aria-labelledby="nav-instance">
                {settingsNav
                  .filter((item) => !item.admin || can("instance:admin"))
                  .map(({ to, label, icon }) => (
                    <NavItem key={to} to={to} icon={icon} label={t(label)} active={pathname.startsWith(to)} />
                  ))}
              </SidebarMenu>
            </SidebarGroup>
          </nav>
        </SidebarContent>
        <SidebarFooter className="gap-3 px-3 pb-4">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild className={navButton}>
                <a href="/docs">
                  <BookOpen aria-hidden="true" />
                  {t("shell.apiDocs")}
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="flex items-center gap-2 border-t border-sidebar-border px-2 pt-3">
            <NameDialog name={name} email={user.email} onSaved={setName} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={theme === "dark" ? t("shell.lightTheme") : t("shell.darkTheme")}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("shell.signOut")} onClick={signOut}>
              <LogOut aria-hidden="true" />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <div className="p-2 md:hidden">
          <SidebarTrigger />
        </div>
        <div className="w-full max-w-[1200px] px-4 py-8 md:px-10 md:pt-10 md:pb-12">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
