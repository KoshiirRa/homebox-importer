# AGENTS

## Project Goal

Maintain a small, mobile-first companion application that imports physical media and ordinary household inventory into HomeBox without modifying HomeBox itself.

HomeBox remains the system of record. This application may enrich and submit data through HomeBox's documented HTTP API, but it must never read or write the HomeBox database directly.

## Current Production Baseline

- HomeBox API compatibility target: `v0.26.2`
- Runtime: Node.js 24
- Deployment: Docker/Compose
- Browser UI: installable responsive PWA
- Supported workflows: ISBN books plus UPC/EAN music, movies, video games, and ordinary products
- Book metadata providers: Google Books, Open Library, optional Hardcover, then optional ISBNdb fallback
- General media providers: optional Discogs, MusicBrainz, then UPCitemdb
- Box labels: printable QR labels deep-linking to a preselected HomeBox destination
- Barcode scanning: ZXing in the browser

## Architecture Rules

- Keep provider credentials and the HomeBox API key on the server side.
- The browser must communicate only with this application's `/api/*` routes.
- Use bearer authentication for HomeBox API calls.
- Use HomeBox entity `parentId` relationships for locations and boxes.
- Use HomeBox's native `quantity` field for grouped items.
- Prefer external integrations over a HomeBox fork.
- Do not add persistent application storage unless a feature genuinely cannot be represented in HomeBox.
- Never log secrets, API keys, authorization headers, or complete upstream error bodies that may contain credentials.

## Development Rules

- Treat live HomeBox installations as read-only unless a test mutation is explicitly authorized.
- Live test records must begin with `[TEST]` and include `Safe to Delete` in their names.
- Never delete or modify non-test HomeBox records.
- Keep `HOMEBOX_URL` and `HOMEBOX_API_KEY` configurable through environment variables.
- Do not commit `.env`, generated frontend bundles, credentials, private hostnames, or private IP addresses.
- Validate external barcodes before sending provider requests.
- Upstream provider failures should degrade to another provider or return a clear user-facing error.
- Valid barcodes absent from every metadata provider must fall back to an editable manual record; provider coverage gaps must not block inventory entry.
- Preserve accessible labels, keyboard operation, and useful status announcements in the mobile UI.

## Required Verification

Run before committing:

```sh
npm ci
npm run build
npm test
npm audit --omit=dev
```

For changes to the Dockerfile or runtime dependencies, also build the container for the target architecture when Docker is available.

For HomeBox API changes, verify request and response shapes against the live Swagger document for the supported HomeBox version. Add or update mocked contract tests before performing an authorized junk-data smoke test.

## Release Rules

- `main` publishes `ghcr.io/koshiirra/homebox-importer:latest` and an immutable `sha-*` tag.
- Git tags matching `v*` publish semantic-version container tags.
- Do not create a release tag until the `main` container workflow succeeds.
- Never place deployment credentials in GitHub Actions configuration; use `GITHUB_TOKEN` for GHCR and repository/environment secrets for anything else.

## Scope Roadmap

Implement vertical slices in this order unless the user reprioritizes:

1. Books via ISBN
2. Ordinary items and native quantities
3. Music via Discogs
4. Movies via TMDB plus barcode resolution
5. Video games via IGDB or a suitable barcode-aware source
6. Duplicate detection and batch packing workflows

Each slice should be independently usable and should leave HomeBox data understandable without this companion application.
