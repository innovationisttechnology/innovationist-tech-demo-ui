# Innovationist Tech — Demos UI

The front-end showcase for [Innovationist Technology Solutions](https://innovationisttech.com). It hosts a small set of interactive demos that each illustrate a real capability, backed by the demo API.

Built with **Next.js 16** (App Router), **React 19**, **Tailwind CSS v4**, and **TypeScript**.

## Demos

| Demo                       | Route                 | What it shows                                                                                                                         |
| -------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Content & Feature Sync** | `/demos/content-sync` | Flip a feature or content value and watch every connected client update instantly over Server-Sent Events — no redeploys, no polling. |
| **AI Document Chatbot**    | `/demos/ai-chatbot`   | Ask questions in natural language over your own documents using retrieval-augmented generation.                                       |

## Getting Started

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

### Environment

Copy the template and set the API base URL the browser uses to reach the [demo backend](#backend):

```bash
cp .env.dev .env.local
```

| Variable                               | Description                      | Example                        |
| -------------------------------------- | -------------------------------- | ------------------------------ |
| `NEXT_PUBLIC_API_BASE_URL`             | Base URL of the demo API.        | `http://localhost:8181`        |
| `NODE_ENV` / `ENVIRONMENT`             | Runtime environment flags.       | `development` / `local`        |
| `DOCKER_IMAGE_TAG` / `DOCKER_USERNAME` | Image coordinates used by CI/CD. | `latest` / `innovationisttech` |

`.env*` files are gitignored.

## Commands

```bash
npm run dev            # Start the dev server at http://localhost:3001
npm run build          # Production build
npm run start          # Start the production server at http://localhost:3001
npm run lint           # Run ESLint
npm run format         # Format with Prettier
npm test               # Run Vitest in watch mode
npm run test:run       # Run the test suite once
npm run test:coverage  # Run the test suite with a coverage report
```

## Architecture

- **App Router** — pages live in `app/` (e.g. `app/demos/content-sync/`). No `pages/` directory.
- **Tailwind CSS v4** — imported via a single `@import "tailwindcss"` in `app/globals.css`; theme tokens are defined with `@theme inline`. Dark mode is driven by a `.dark` class (`next-themes`).
- **Path alias** — `@/*` resolves to the project root, `@app/*` to `app/`.

### API layer (`lib/`)

API access mirrors an Angular-style service layer, using plain function modules instead of classes:

```
lib/
├── api/
│   ├── request.ts     # Single fetch choke-point: axios + zod validation, never throws
│   └── types.ts       # ApiResponse<T>, RequestOptions
├── zod/
│   └── primitives.ts  # Shared zod primitives
└── content-sync/      # Resource module for /api/flags
    ├── content-sync.schema.ts   # zod schemas (API shape + SSE events)
    ├── content-sync.mapper.ts   # API snake_case → domain camelCase
    ├── content-sync.types.ts    # Domain types
    ├── content-sync.service.ts  # fetchFlags / createFlag / updateFlag / deleteFlag / stream URL
    └── session.ts               # Per-browser session id (IndexedDB, sliding TTL)
```

Every service function calls `request()` with a zod schema and returns domain objects, so components never touch axios or the raw API shape. Each browser gets a stable `session_id` (a crypto-random UUID persisted in IndexedDB) that scopes its flags and is reused across the SSE stream and every REST call.

### Backend

The demos talk directly to the demo API (`innovationist-tech-demo-api`) from the browser via `NEXT_PUBLIC_API_BASE_URL`. The Content & Feature Sync demo opens an `EventSource` against `/api/flags/stream` and treats that stream as the source of truth: mutations POST/PUT/DELETE to the API, and the UI updates when the change echoes back over SSE — which is what keeps multiple clients in sync.

## Testing

Tests use **Vitest** with **@testing-library/react** in a **jsdom** environment. Config is in `vitest.config.ts`, with global setup in `vitest.setup.ts` (jest-dom matchers, React cleanup, a `next/navigation` mock). Test files are colocated with the components they cover.

## Deployment

The app is containerized (`Dockerfile`) and served on port `3001`. CI/CD is defined in `.github/workflows/github-actions.yml`: it lints and builds on pushes to `main` and `feature/**`, builds and pushes a Docker image, and deploys to EC2 on `main`.
