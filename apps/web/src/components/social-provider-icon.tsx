import type { AuthMethods } from "../../../server/src/app.ts";

export function SocialProviderIcon({ provider }: { provider: AuthMethods["socialProviders"][number] }) {
  if (provider === "github") {
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
  if (provider === "microsoft") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.03 2.53-2.2 3.31v2.77h3.57c2.09-1.93 3.27-4.77 3.27-8.09ZM12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.05-3.71 1.05-2.86 0-5.28-1.93-6.14-4.53H2.18v2.84A11 11 0 0 0 12 23ZM5.86 14.09A6.6 6.6 0 0 1 5.52 12c0-.72.12-1.42.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.93l3.68-2.84ZM12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.53 10.53 0 0 0 12 1 11 11 0 0 0 2.18 7.07l3.68 2.84C6.72 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
