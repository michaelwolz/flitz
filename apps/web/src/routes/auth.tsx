import { Bot, Mail, ShieldCheck, Smartphone } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type LoaderFunctionArgs,
  redirect,
  Link as RouterLink,
  useLoaderData,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import lockupDark from "../../../../docs/brand/flitz-lockup-dark.svg";
import lockupLight from "../../../../docs/brand/flitz-lockup-light.svg";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api, appUrl, auth, authClient, safeNext, useAction } from "@/lib/api";
import { textLink } from "@/lib/utils";

export async function guestLoader({ request }: LoaderFunctionArgs) {
  const [{ data }, providers] = await Promise.all([
    authClient.getSession(),
    api<("google" | "github")[]>("/social-providers").catch(() => []),
  ]);
  if (data) throw redirect(safeNext(new URL(request.url).searchParams.get("next")));
  return providers;
}

function AuthLayout({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-svh flex-wrap">
      <title>{t("pageTitle", { page: title })}</title>
      <section
        aria-label={t("auth.about")}
        className="flex min-w-0 flex-[1_1_480px] flex-col gap-8 bg-brand-coral px-8 pt-16 pb-12 text-brand-violet md:px-16"
      >
        <div aria-hidden="true" className="mt-12 flex flex-col gap-3.5">
          <span className="ml-10 block h-4 w-30 rounded-full bg-brand-violet" />
          <span className="block h-4 w-40 rounded-full bg-brand-violet" />
        </div>
        <h2 className="max-w-[520px] font-heading text-display text-balance max-sm:text-5xl max-sm:leading-13">{t("auth.tagline")}</h2>
        <ul className="flex max-w-[460px] flex-col gap-3.5 text-lead font-medium">
          {(
            [
              [Smartphone, t("auth.pointDevices")],
              [ShieldCheck, t("auth.pointPrivacy")],
              [Bot, t("auth.pointAgents")],
            ] as const
          ).map(([Icon, text]) => (
            <li key={text} className="flex items-start gap-3">
              <Icon className="mt-1 size-4 shrink-0" aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
        <p className="mt-auto text-small font-medium">
          {t("auth.openSource")}{" "}
          <a href="https://github.com/michaelwolz/flitz" className="underline underline-offset-3 hover:decoration-2">
            {t("auth.sourceCode")}
          </a>
        </p>
      </section>
      <main className="flex min-w-0 flex-[1_1_480px] items-center justify-center px-8 py-16">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <div>
            <img src={lockupLight} alt={t("auth.logo")} className="h-8 dark:hidden" />
            <img src={lockupDark} alt={t("auth.logo")} className="hidden h-8 dark:block" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="font-heading text-title">{title}</h1>
            <p className="text-muted-foreground">{lead}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function NewPasswordField({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <Field>
      <FieldLabel htmlFor="password">{label}</FieldLabel>
      <Input
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        aria-describedby="password-hint"
      />
      <FieldDescription id="password-hint">{t("signUp.passwordHint")}</FieldDescription>
    </Field>
  );
}

function useNext() {
  const [params] = useSearchParams();
  return safeNext(params.get("next"));
}

function useUrlError() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const error = params.get("error");
  if (!error) return undefined;
  if (error === "SIGN_UP_NOT_ALLOWED") return t("auth.notAllowed");
  if (error === "email_not_verified") return t("auth.notVerified");
  return t("auth.failed");
}

function GithubIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

function SocialSignIn() {
  const { t } = useTranslation();
  const providers = useLoaderData<typeof guestLoader>();
  const { pathname, search } = useLocation();
  const next = useNext();
  const social = useAction();
  const [started, setStarted] = useState("");
  if (providers.length === 0) return null;

  const labels = { google: t("socialSignIn.google"), github: t("socialSignIn.github") };
  function start(provider: (typeof providers)[number]) {
    setStarted(provider);
    social.run(() =>
      auth(
        authClient.signIn.social({
          provider,
          callbackURL: appUrl(next),
          errorCallbackURL: appUrl(`${pathname}${search}`),
        }),
      ),
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2.5">
        {providers.map((provider) => (
          <SubmitButton
            key={provider}
            type="button"
            variant="outline"
            size="lg"
            onClick={() => start(provider)}
            pending={social.pending && started === provider}
            pendingLabel={t("socialSignIn.redirecting")}
          >
            {provider === "github" && <GithubIcon />}
            {labels[provider]}
          </SubmitButton>
        ))}
        <FieldError>{social.error}</FieldError>
      </div>
      <div className="flex items-center gap-3 text-small text-muted-foreground">
        <Separator className="flex-1" />
        {t("socialSignIn.orWithEmail")}
        <Separator className="flex-1" />
      </div>
    </>
  );
}

export function SignIn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { search } = useLocation();
  const next = useNext();
  const urlError = useUrlError();
  const signIn = useAction();
  const magicLink = useAction();
  const email = useRef<HTMLInputElement>(null);
  const [sentTo, setSentTo] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    signIn.run(async () => {
      const data = await auth(authClient.signIn.email({ email: String(form.get("email")), password: String(form.get("password")) }), {
        EMAIL_NOT_VERIFIED: t("signIn.notVerified"),
      });
      if (!data?.redirect) navigate(next);
    });
  }

  function sendLink() {
    if (!email.current!.reportValidity()) return;
    const address = email.current!.value;
    magicLink.run(async () => {
      await auth(authClient.signIn.magicLink({ email: address, callbackURL: appUrl(next), errorCallbackURL: appUrl(`/sign-in${search}`) }));
      setSentTo(address);
    });
  }

  return (
    <AuthLayout title={t("signIn.title")} lead={t("signIn.lead")}>
      <SocialSignIn />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
          <Input ref={email} id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field>
          <div className="flex items-baseline justify-between gap-3">
            <FieldLabel htmlFor="password">{t("auth.password")}</FieldLabel>
            <RouterLink to={`/forgot-password${search}`} className={`text-small ${textLink}`}>
              {t("forgotPassword.link")}
            </RouterLink>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FieldError>{signIn.error ?? magicLink.error ?? urlError}</FieldError>
        <SubmitButton size="lg" pending={signIn.pending} pendingLabel={t("signIn.pending")}>
          {t("signIn.submit")}
        </SubmitButton>
        <SubmitButton
          type="button"
          variant="secondary"
          size="lg"
          onClick={sendLink}
          pending={magicLink.pending}
          pendingLabel={t("signIn.sendingLink")}
        >
          <Mail aria-hidden="true" />
          {t("signIn.sendLink")}
        </SubmitButton>
        <p role="status" className="text-small text-muted-foreground empty:hidden">
          {sentTo && t("signIn.linkSent", { email: sentTo })}
        </p>
      </form>
      <p className="text-muted-foreground">
        {t("signIn.newHere")}{" "}
        <RouterLink to={`/sign-up${search}`} className={textLink}>
          {t("signIn.createAccount")}
        </RouterLink>
      </p>
    </AuthLayout>
  );
}

export function SignUp() {
  const { t } = useTranslation();
  const { search } = useLocation();
  const [params] = useSearchParams();
  const next = useNext();
  const urlError = useUrlError();
  const signUp = useAction();
  const [sentTo, setSentTo] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    signUp.run(async () => {
      await auth(
        authClient.signUp.email({
          name: String(form.get("name")),
          email,
          password: String(form.get("password")),
          callbackURL: appUrl(next),
        }),
      );
      setSentTo(email);
    });
  }

  return (
    <AuthLayout title={t("signUp.title")} lead={t("signUp.lead")}>
      <p role="status" className="empty:hidden">
        {sentTo && t("signUp.checkEmail", { email: sentTo })}
      </p>
      {!sentTo && (
        <>
          <SocialSignIn />
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="name">{t("auth.name")}</FieldLabel>
              <Input id="name" name="name" autoComplete="name" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
              <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={params.get("email") ?? ""} />
            </Field>
            <NewPasswordField label={t("auth.password")} />
            <FieldError>{signUp.error ?? urlError}</FieldError>
            <SubmitButton size="lg" pending={signUp.pending} pendingLabel={t("signUp.pending")}>
              {t("signUp.submit")}
            </SubmitButton>
          </form>
        </>
      )}
      <p className="text-muted-foreground">
        {t("signUp.haveAccount")}{" "}
        <RouterLink to={`/sign-in${search}`} className={textLink}>
          {t("signUp.signIn")}
        </RouterLink>
      </p>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const { t } = useTranslation();
  const { search } = useLocation();
  const request = useAction();
  const [sentTo, setSentTo] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    request.run(async () => {
      await auth(authClient.requestPasswordReset({ email }));
      setSentTo(email);
    });
  }

  return (
    <AuthLayout title={t("forgotPassword.title")} lead={t("forgotPassword.lead")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <FieldError>{request.error}</FieldError>
        <SubmitButton size="lg" pending={request.pending} pendingLabel={t("forgotPassword.pending")}>
          {t("forgotPassword.submit")}
        </SubmitButton>
        <p role="status" className="text-small text-muted-foreground empty:hidden">
          {sentTo && t("forgotPassword.sent", { email: sentTo })}
        </p>
      </form>
      <p className="text-muted-foreground">
        <RouterLink to={`/sign-in${search}`} className={textLink}>
          {t("forgotPassword.backToSignIn")}
        </RouterLink>
      </p>
    </AuthLayout>
  );
}

export function ResetPassword() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const reset = useAction();
  const [done, setDone] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newPassword = String(new FormData(event.currentTarget).get("password"));
    reset.run(async () => {
      await auth(authClient.resetPassword({ newPassword, token: params.get("token") ?? "" }), {
        INVALID_TOKEN: t("resetPassword.invalidLink"),
      });
      setDone(true);
    });
  }

  return (
    <AuthLayout title={t("resetPassword.title")} lead={t("resetPassword.lead")}>
      <p role="status" className="empty:hidden">
        {done && t("resetPassword.done")}
      </p>
      {done ? (
        <Button asChild size="lg">
          <RouterLink to="/sign-in">{t("resetPassword.signIn")}</RouterLink>
        </Button>
      ) : (
        <>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <NewPasswordField label={t("resetPassword.newPassword")} />
            <FieldError>{reset.error}</FieldError>
            <SubmitButton size="lg" pending={reset.pending} pendingLabel={t("resetPassword.pending")}>
              {t("resetPassword.submit")}
            </SubmitButton>
          </form>
          <p className="text-muted-foreground">
            {t("resetPassword.expired")}{" "}
            <RouterLink to="/forgot-password" className={textLink}>
              {t("resetPassword.requestNew")}
            </RouterLink>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
