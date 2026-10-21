# Spec: bot-console UI stack migration (Tailwind v4 + shadcn-svelte + Lucide) and theme switch

**Tier:** 3 (user-visible UI flow change across every page; new dependency stack; interaction changes for confirm and rename)
**Status:** Approved 2026-10-14 (Joe: "yes, approve the spec")
**Requested by:** Joe, 2026-10-14:
- "what UI lib and icon lib is used? Should refer to ../tutored"
- AskUserQuestion: adopt tutored's stack; use Deploybot's own palette.
- "yes, JS required, write the spec"

Theme switch: "Surface the theme switch on the web ui".

**Supersedes:** the queued theme brief `tasks/briefs/w1e-console-theme.md` (a dark-only token scheme with `data-theme`). The theme switch is now part of this spec.

## 1. Goal

bot-console moves to the same UI stack and conventions as tutored's `ttd-webapp`, with Deploybot's own colours. It gets a System / Light / Dark switch. JavaScript becomes a requirement. URL-driven state and server-side form actions stay; the separate no-JavaScript code paths are removed.

## 2. Reference: tutored `ttd-webapp` (read-only, `../tutored/ttd-webapp`)

| Item | tutored |
|---|---|
| CSS | Tailwind CSS v4 (`@tailwindcss/vite`), `@import "tailwindcss"`, `tw-animate-css`, `shadcn-svelte/tailwind.css`, `@theme inline` |
| Components | shadcn-svelte (`components.json`: style `nova`, baseColor `neutral`, iconLibrary `lucide`, aliases `$lib/components/ui`, `$lib/utils`), built on bits-ui. Helpers: `clsx`, `tailwind-merge`, `tailwind-variants`; `cn()` in `src/lib/utils.ts`. |
| Icons | `@lucide/svelte` |
| Dark mode | `@custom-variant dark (&:is(.dark *))`; variables on `:root` and `.dark`, as oklch |
| Font | A system-UI stack for the body. Inter is installed but not first in the body stack (see their `app.css` comment). |

bot-console copies these conventions: the same `components.json` settings, the same `cn()` helper, the same dark-mode variant and variable names. Versions are pinned **exactly** (the bot-console policy), at the versions tutored resolves today or the nearest compatible with bot-console's Vite 7 / SvelteKit 2.70.

## 3. Decisions

| Topic | Decision |
|---|---|
| **JavaScript** | **Required.** <br>**Kept:** search, sort, page, tab and filter state in the URL (shareable links, Back, refresh); every write through SvelteKit form actions with `use:enhance`, with permission checks on the server; server-rendered first paint. <br>**Removed:** the no-JavaScript fallbacks `?confirm=<id>` and `?services.edit=<id>`, and their helpers and tests (`confirmHref`, the URL-open state in `confirm.ts`, `serviceEditHref`, `serviceEditCancelHref`). Sort and pager links and the GET search form stay as plain links and forms, because they are URL state, not fallbacks. |
| **Palette** | Deploybot's own colours in shadcn's variable set (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--chart-1..5`, `--sidebar-*`, each `*-foreground`), plus Deploybot status tokens `--status-online`, `--status-offline`, `--status-asleep`, `--status-revoked`, `--status-up`, `--status-down`, `--status-unknown`. Values in oklch, for light on `:root` and dark on `.dark`. **Brand:** a neutral base (like tutored) with one cool accent for primary and focus ring, so it reads as an ops tool and not as tutored. Text and muted text meet WCAG AA on `--background` and `--card` in both themes, and so do status colours as text. The existing dark look is the reference for the dark values. |
| **Font** | tutored's system-UI body stack, no webfont. Monospace (`ui-monospace, SFMono-Regular, Menlo, monospace`) for command lines, ports, IDs and tokens. |
| **Icons** | `@lucide/svelte` only:<br>• navigation: Projects, Hosts, Services, Catalog, Processes, Members, Tokens, Settings;<br>• actions: probe, rename, revoke, delete, copy, sign out;<br>• status dots stay CSS, not icons;<br>• theme: Monitor, Sun, Moon.<br>Icons sit beside text labels. An icon-only button has an `aria-label` and a tooltip. |
| **Theme switch** | Cookie `bot_theme` ∈ {`system`, `light`, `dark`}, default `system`. Path `/`, Max-Age 1 year, SameSite=Lax, HttpOnly, Secure only over https. Any other value counts as `system`. <br>**Setting it:** `POST /theme` (public route, default action, safe same-origin `next`, 303) sets the cookie. <br>**No flash:** `hooks.server.ts` `transformPageChunk` writes `class="dark"` on `<html>` for `dark`, nothing for `light`, and `data-theme="system"` for `system`. A tiny inline script in `app.html` `<head>` (`nonce="%sveltekit.nonce%"`, so a later CSP works) adds `.dark` before first paint when `data-theme="system"` and `prefers-color-scheme: dark`, and follows changes to that preference. <br>**UI:** `ThemeSwitch.svelte` is a shadcn `DropdownMenu` (or `ToggleGroup`) with System, Light and Dark and Lucide icons, in the header on every page, including sign-in. Choosing a theme sets the class at once, then posts the form with `use:enhance` (no reload). |
| **Shared components** | They keep their names and import paths so routes change little, but are rebuilt on shadcn primitives in `src/lib/components/ui/*`, which are generated by the shadcn-svelte CLI and committed: <br>• `DataTable` → shadcn `table`, plus `button` for sort headers and pager; same props, client and server mode. <br>• `Tabs` → link navigation styled like shadcn tabs (`aria-current`), because it is URL state. <br>• `PageHeader` / `Breadcrumbs` → shadcn `breadcrumb`. <br>• `StatusBadge` → shadcn `badge` with status-token variants. <br>• `Notice` → shadcn `alert` (`role` as today). <br>• `ConfirmAction` → shadcn `alert-dialog` holding the POST form; `typeToConfirm` keeps its input, and Confirm stays disabled until the text matches; the server check is unchanged. <br>• `SearchField` → shadcn `input` + `button`. <br>• `CopyButton` → shadcn `button` + Lucide Copy/Check. <br>• Rename → shadcn `dialog` (or `popover`) holding the form. <br>• The host filter → shadcn `select`, which writes `services.host` to the URL. <br>• Forms → shadcn `input`, `label`, `button`, `select`. |
| **Row actions (amendment 2026-10-14, Joe: "rename button should icon only, in table button should be simple, which has obvious meaning, apply this principle across UI pages")** | Every action inside a table row is an **icon-only** shadcn `Button` (`variant="ghost"`, `size="icon"` or `icon-sm`) with a Lucide icon whose meaning is obvious, an `aria-label` naming the action and the row (e.g. "Rename port 22 · root"), and a shadcn `tooltip` with the same text, except catalog Run on a container and Deploy, which append one sentence (Run starts the container already on the host; Deploy pulls the image and creates or replaces the container from the catalog entry). Destructive row actions use the destructive text colour. Mapping: rename → `Pencil`; probe → `Activity`; revoke credential → `ShieldOff`; remove member → `UserMinus`; change role → `UserCog`; revoke join token → `Ban`; copy → `Copy` (→ `Check` after copying); delete → `Trash2`. Actions outside tables (page and card primary actions such as Create project, Delete project, Snapshot, Search, Apply) keep text labels, optionally with a leading icon. One shared `RowAction.svelte` component renders every row action; the enforcement test fails on a text-labelled button inside a `DataTable` row. |
| **Charts** | `LineChart` keeps its SVG and draws with `var(--chart-n)`, `--border` and `--muted-foreground`. No new chart library. |
| **Layout** | An app shell with a header (product name, project switcher, user menu, ThemeSwitch) and a content column. Pages sit in shadcn `card`s where they hold sections today. Width works at 1280 px and at 390 px (no horizontal page scroll; wide tables scroll inside their card). |
| **Enforcement** | `tests/components-reuse.test.ts` keeps its current rules and adds:<br>• no `#hex`, `rgb(` or `oklch(` literal in any `.svelte` file;<br>• no `<button` or `<input` outside `src/lib/components/ui/**` and the shared components (routes use the components);<br>• no inline `style=` colour.<br>Each rule has a fixture. |
| **Scope** | UI only. No change to routes' data loading, API calls, URL parameter names, form action names or server permission logic. |

## 4. Changes

| Area | Files |
|---|---|
| Dependencies (installed by the orchestrator before dispatch, pinned exactly) | `tailwindcss`, `@tailwindcss/vite`, `tw-animate-css`, `shadcn-svelte` (CLI and `tailwind.css`), `bits-ui`, `clsx`, `tailwind-merge`, `tailwind-variants`, `@lucide/svelte` |
| Config | `vite.config.ts` (Tailwind plugin), `components.json`, `src/lib/utils.ts` (`cn`), `src/app.css` (rewritten: Tailwind imports, variables, base layer; the old 655 lines of hand CSS removed), `src/app.html` (theme script, `color-scheme`) |
| Components | `src/lib/components/ui/**` (generated primitives); the shared components above rebuilt; `ThemeSwitch.svelte` added |
| Routes | Every page moved to the new components and utilities; `src/routes/theme/+page.server.ts` added; `?confirm=` / `?services.edit=` handling removed from loads and actions (actions unchanged) |
| Server | `hooks.server.ts` (theme `transformPageChunk`; `/theme` added to public paths) |
| Tests | Updated, not deleted, apart from the removed no-JS helpers' tests. New: theme cookie, action, hook and render tests; enforcement rules; render tests for the rebuilt ConfirmAction (dialog content and type-to-confirm disabled state) and DataTable (both modes) |
| Docs | `README.md`, `docs/design.md` (UI stack, theme, the JS-required decision), `AGENTS.md` (shared components rule updated, shadcn conventions, "tokens only, no literals") |

## 5. Acceptance criteria

1. `pnpm check` reports 0 errors and 0 warnings; `pnpm test` all pass; `pnpm build` passes; no new dependency outside §4; all versions exact.
2. `components.json` matches tutored's style, baseColor, iconLibrary and aliases. `cn()` exists. The primitives under `src/lib/components/ui/` are the shadcn-svelte generated ones, unmodified except for imports.
3. No colour literal and no raw `<button>` or `<input>` outside the allowed folders (enforcement test).
4. Theme:
   - `bot_theme` handling is validated, and so are the cookie options.
   - `/theme` works signed out.
   - Exactly one theme marker ends up on `<html>`.
   - No flash on reload for `dark`, and for `system` with a dark OS (checked in the browser by the orchestrator).
   - The switch changes the theme without a reload.
5. Every page renders in light and dark with AA contrast for text, muted text and status text. The orchestrator checks this in the browser on: projects list, project (each tab), host (Overview and Processes), sign-in, device approval, and the error page.
6. Every behaviour that exists today still works with JavaScript:
   - search, sort and paging (client and server mode);
   - the host filter;
   - probe;
   - rename (now a dialog), with success keeping table state and conflict showing the message and keeping the value;
   - revoke, remove member, revoke token and delete project (now dialogs; delete keeps type-to-confirm);
   - copy buttons;
   - charts.
7. The `?confirm=` and `?services.edit=` code paths and helpers are gone (grep finds none).
8. Phone width (390 px): no horizontal page scroll; tables scroll inside their container.

## 6. Rollback

This is a single-repo change and the API is untouched. Revert the merge commit on bot-console `dev` and run `pnpm install` from the reverted lockfile. No data migration. The `bot_theme` cookie is ignored by the old code.

## 7. Risks and failure modes

| Risk | Handling |
|---|---|
| shadcn-svelte or bits-ui versions need Vite 8 or Svelte newer than 5.57 | The orchestrator resolves compatible exact versions before dispatch. If none exist, it stops and reports; bot-console's Vite/Svelte is not upgraded silently (that would be a separate change). |
| The `node:test` render harness cannot compile bits-ui `.svelte` from `node_modules` | Extend `tests/loader.mjs` to compile `.svelte` under `node_modules/bits-ui` too. If that is impossible, render tests of dialog internals are replaced by logic tests plus the orchestrator's browser check, and that is recorded in NOTES. |
| A theme flash for `system` | The inline head script runs before CSS paint; it is checked in the browser. |
| Big diff, hard to review | The worker delivers in this order (one NOTES section each): setup and tokens → primitives → shared components → routes → theme. Reviews are one lens each, as usual. |
| Lost accessibility in dialogs | bits-ui handles the focus trap and `aria`. The orchestrator tabs through every dialog in the browser. |

## 8. Tests and verification gates

- **Console gates:** `pnpm check` (0 errors, 0 warnings), `pnpm test`, `pnpm build`.
- **Orchestrator browser pass** (in-app browser, signed in by Joe once):
  - every page in light and in dark;
  - theme switch with no flash;
  - each dialog by keyboard;
  - 390 px width.
- **Independent Grok lens reviews:** security, spec, tests, plus a UI lens (`ui-portability-baseline` / `frontend-engineering`).

## 9. Applicable skill guidance

- **ui-portability-baseline:** tokens only, primitives reused, both themes, basic accessibility.
- **frontend-engineering (SvelteKit):** state ownership stays in the URL and in server loads; `use:enhance` for writes; no client stores for server data.
- **security-baseline:**
  - the theme cookie is validated against an allowlist and never echoed raw;
  - `next` is same-origin only;
  - the inline script has no dynamic content and carries a nonce placeholder;
  - no new network calls;
  - dependencies are pinned and come only from the list.
- **coding-discipline:** generated primitives are not edited by hand; there is no wrapper of a wrapper. Shared components are thin compositions of primitives.

## 10. Delegation

- One Grok worker (`w3-console-ui`) in a worktree of bot-console `dev`, after the orchestrator has installed and pinned the dependencies and run `shadcn-svelte init` with tutored's settings. Generating the primitives with the CLI is allowed for the worker if the sandbox permits it; otherwise the orchestrator pre-generates the listed components.
- Fix rounds via `grok -c`; reviews in fresh Grok sessions.
- Commit, push and merge only on Joe's go-ahead.
