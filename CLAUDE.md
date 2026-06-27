# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev            # Start dev server at http://localhost:3001
npm run build          # Production build
npm run start          # Start production server at http://localhost:3001
npm run lint           # Run ESLint
npm test               # Run Vitest in watch mode
npm run test:run       # Run the test suite once
npm run test:coverage  # Run the test suite with a coverage report
```

Tests use **Vitest** with **@testing-library/react** in a **jsdom** environment.
Config lives in `vitest.config.ts`, with global setup in `vitest.setup.ts` (jest-dom
matchers, React cleanup, and a `next/navigation` mock). Test files are colocated with
the components they cover (e.g. `components/layout/container/container.test.tsx`).

## Architecture

This is a **Next.js 16** app using the **App Router** (the `app/` directory — not `pages/`).

**Styling** uses **Tailwind CSS v4**, which is imported via a single `@import "tailwindcss"` in `app/globals.css` rather than the v3 `@tailwind` directives. Theme tokens (colors, fonts) are defined with `@theme inline` in that same file.

**Fonts** are loaded via `next/font/google` in `app/layout.tsx` and exposed as CSS variables (`--font-geist-sans`, `--font-geist-mono`), then wired into the Tailwind theme in `globals.css`.

**Dark mode** is handled via `@media (prefers-color-scheme: dark)` CSS variables — no `darkMode` Tailwind config key is needed.

**Path alias**: `@/*` resolves to the project root (e.g. `@/app/...`, `@/public/...`).

**ESLint** uses the flat config format (`eslint.config.mjs`) with `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`.
