import { type ClassValue, clsx } from "clsx";
import i18n from "i18next";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["display", "title", "stat", "heading", "lead", "body", "label", "small", "caption", "mono"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const monoInput = {
  className: "font-mono text-mono md:text-mono",
  spellCheck: false,
  autoCapitalize: "none",
  autoCorrect: "off",
  autoComplete: "off",
  translate: "no",
} as const;

export const formatDate = (date: Date | string) => new Date(date).toLocaleDateString(i18n.language, { dateStyle: "medium" });

export const displayUrl = (url: string) => url.replace(/^https?:\/\//, "");

export const linkName = ({ title, shortUrl }: { title: string | null; shortUrl: string }) => title || displayUrl(shortUrl);

let regions: Intl.DisplayNames | undefined;
export function countryName(code: string) {
  regions ??= new Intl.DisplayNames([i18n.language], { type: "region" });
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

export const textLink = "font-medium text-foreground underline decoration-primary decoration-2 underline-offset-3";
export const titleLink = "block truncate font-medium hover:underline hover:decoration-primary hover:decoration-2 hover:underline-offset-3";
export const avatar =
  "grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-caption font-semibold text-secondary-foreground";
export const stepBadge =
  "grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-caption font-semibold text-secondary-foreground tabular-nums";
