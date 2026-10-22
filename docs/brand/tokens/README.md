# flitz design tokens

Exported from the flitz Design System. `tokens.json` is the source; `tokens.css` is generated from it. The Tailwind v4 theme of the web app, with the shadcn/ui variables, flitz additions, radius, elevation, motion and the type scale, is `apps/web/src/globals.css`.

| File          | Use                                                                       |
| ------------- | ------------------------------------------------------------------------- |
| `tokens.css`  | The same values as plain CSS variables, for pages built without Tailwind. |
| `tokens.json` | Every token with its light and dark value and a usage note.               |

## Using the theme in `apps/web`

- Fonts are bundled, never loaded from a CDN.
- Dark theme: `class="dark"` on `<html>`. Both themes set `color-scheme`.
- Every type style is a utility: `text-display`, `text-title`, `text-stat`, `text-heading`, `text-lead`, `text-body`, `text-label`, `text-small`, `text-caption`, `text-mono`. Pair the first four with `font-heading` and `text-mono` with `font-mono`.
- Colours follow shadcn names (`bg-primary`, `text-muted-foreground`, …). The flitz additions are `destructive-foreground`, `destructive-soft`, `success`, `success-soft`, `warning`, `warning-soft`, `brand-coral` and `brand-violet`.
- `shadow-xs`, `shadow-sm` and `shadow-lg` read the theme's `elevation-*` values. `rounded-*` derives from `--radius` (0.75rem); actions use `rounded-full`.

The component edits to make after `shadcn add` (pill buttons, the solid focus outline, the dark destructive style) and the usage rules are in the Design System's brand book.

## Using `tokens.css`

Load it before your own styles. Dark theme: `class="dark"` or `data-theme="dark"` on any ancestor.
