# Changelog

All notable changes to HomeBox Importer are documented here.

## Unreleased

## [0.4.6] - 2026-08-30

### Fixed

- Added the existing `Incorrect match? Scan cover instead` action to
  UPCitemdb results so ambiguous legacy UPC matches can pivot directly to the
  book-cover workflow.
- Prevented the rejected UPC from being treated as a scanned ISBN during the
  cover lookup, allowing a cover-verified catalog ISBN to be imported without
  a false identifier conflict.

### Verification

- The production build and all 65 automated tests pass on Ubuntu with Node.js
  22.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.

## [0.4.5] - 2026-08-30

### Fixed

- Bounded descriptions sent to HomeBox by UTF-8 byte length rather than
  JavaScript UTF-16 units, preventing multibyte provider text from exceeding
  HomeBox's 1,000-byte entity-description validator.
- Applied the same Unicode-safe bounded description to both entity creation and
  enrichment without splitting surrogate pairs or changing shorter text.

### Verification

- The production build and all 64 automated tests pass on Ubuntu with Node.js
  22.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.

## [0.4.4] - 2026-08-30

### Fixed

- Preserved validated Gemini cover suggestions as an editable, visibly
  AI-assisted option even when catalog candidates are also returned.
- Rescored catalog candidates against Gemini's title and author metadata and
  rejected candidates that conflict with available author or publisher
  evidence. This prevents unrelated records such as Numenera Character Options
  from displacing Eclipse Phase Second Edition: Character Options.
- Distinguished AI-extracted metadata from catalog-confirmed editions in the
  cover-scan result message while retaining explicit review before import.

### Verification

- The production build and all 62 automated tests pass on Ubuntu with Node.js
  22.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.

## [0.4.3] - 2026-08-30

### Added

- Added optional, server-side Gemini cover extraction with schema-constrained,
  validated metadata suggestions and a configurable `GEMINI_MODEL` defaulting
  to `gemini-2.5-flash`.
- Added Gemini-only cover scanning plus safe fallback between Gemini, Google
  Cloud Vision OCR, catalog matching, and editable manual entry.

### Security

- The Gemini schema excludes ISBNs, barcodes, catalog numbers, descriptions,
  and synopses. Model output remains an editable suggestion and cannot bypass
  deterministic catalog matching or the user's explicit import action.

### Verification

- The production build and all 60 automated tests pass on Ubuntu with Node.js
  22.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.

## [0.4.2] - 2026-08-30

### Fixed

- Tightened cover-title matching so long unrelated catalog titles cannot pass
  merely by containing one or two generic OCR words. Single-word cover queries
  now require an exact one-word catalog title, while exact scanned ISBN evidence
  still takes precedence.

### Verification

- The production build and all 53 automated tests pass on Ubuntu with Node.js
  22.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.

## [0.4.1] - 2026-08-30

### Added

- Added a first-class identifier-less book workflow with optional cover OCR,
  edition/printing, format, and accurately labeled alternate catalog fields.
- Added terminal `import.failed` events with correlation IDs for validation,
  identifier-conflict, and HomeBox write failures.

### Fixed

- Book candidates are now routed by explicit media type instead of the
  presence of provider-reported ISBN metadata. A scanned ISBN remains physical
  item evidence when a provider omits it, while conflicting provider and scan
  identifiers block import for review.
- Identifier-less cover searches keep catalog ISBNs informational and do not
  apply them to a physical copy that has no ISBN.

### Verification

- The production build and all 50 automated tests pass on Ubuntu with Node.js
  22.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.

## [0.4.0] - 2026-08-29

### Added

- Added coded operational failures, opaque correlation IDs, secret-safe provider-attempt summaries, and exactly one terminal structured event per lookup.
- Added structured Vision OCR line/word extraction, bounded fielded catalog searches, candidate deduplication and scoring, and editable OCR-assisted manual book drafts.
- Added import provenance for provider candidates and the distinct manual-entry paths after no match, rejected candidate, or unsuccessful cover search.

### Changed

- Expected validation and no-match outcomes no longer emit stack traces; unexpected defects retain secret-safe diagnostic stacks.
- Cover candidates with conflicting ISBNs are penalized and never receive the scanned ISBN, while exact-ISBN candidates always outrank OCR-only results.

## [0.3.13] - 2026-08-26

### Added

- Added secret-safe structured JSON success logs for book, media, and cover
  lookups, including the selected provider, result count, and elapsed time.
- Added structured import completion logs with destination, HomeBox entity and
  asset identifiers, quantity, provider, and elapsed time.
- Added bounded Docker `json-file` rotation to the example Compose service.

### Verification

- The production build and all automated tests pass.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.

## [0.3.12] - 2026-08-26

### Added

- Added an optional server-side Brave Search API fallback for exact ISBN and
  OCR-title searches when catalog providers do not return a trustworthy match.

### Fixed

- Reject loosely related cover-search candidates using distinctive OCR title
  overlap and never attach a scanned ISBN to a result that does not report it.

### Verification

- The production build and all 39 automated tests pass.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.

## [0.3.11] - 2026-08-25

### Added

- Added optional server-side `GOOGLE_BOOKS_API_KEY` support for both ISBN and
  cover-text Google Books searches so requests use configured project quota
  and reporting without exposing the key to the browser.

### Verification

- The production build and all 32 automated tests pass.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.

## [0.3.10] - 2026-08-25

### Added

- Displayed the contributing metadata provider on every lookup candidate.
- Added an `Incorrect match? Scan cover instead` action for provider-backed
  book results when cover OCR is configured. The suspect result is set aside,
  manual entry remains available, and the cover workflow is brought into view.

### Verification

- The production build and all 31 automated tests pass.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.

## [0.3.9] - 2026-08-25

### Added

- Added optional Google Cloud Vision cover OCR after ISBN metadata lookup
  failures. Cover text is searched through Google Books and Open Library, and
  candidates require review before import.

### Fixed

- Isolated book metadata provider transport and response failures so one
  unavailable provider no longer aborts the lookup chain or prevents editable
  manual entry.
- Kept cover OCR progress and results visible inside the mobile cover panel,
  distinguished unreadable photos from catalog misses and request failures,
  and exposed recognized text to assist manual entry.

### Verification

- The production build and all 29 automated tests pass.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.

## [0.3.8] - 2026-08-18

### Changed

- Updated the build and runtime container images from Node.js 24 Alpine to
  Node.js 26 Alpine. Local development and GitHub Actions continue to use
  Node.js 24 LTS.
- Updated `@zxing/browser` from 0.1.5 to 0.2.1, including its compatible
  `@zxing/library` peer dependency, while preserving the existing ISBN,
  UPC/EAN/GTIN, and container-QR scanning workflows.
- Updated esbuild from 0.25.12 to 0.28.2.
- Updated the container publishing workflow to current major versions of
  `actions/checkout`, `actions/setup-node`, `docker/setup-buildx-action`,
  `docker/login-action`, `docker/metadata-action`, and
  `docker/build-push-action`.
- Added grouped weekly Dependabot maintenance for npm, GitHub Actions, and
  Docker dependencies.

### Security

- Updated the bundled DOMPurify dependency from 3.4.12 to 3.4.13, resolving
  the moderate XSS advisory affecting 3.4.12 and earlier.

### Verification

- The production build and all 22 automated tests pass.
- Both the full npm audit and the production-only audit report zero known
  vulnerabilities.
- Post-merge GitHub Actions successfully built and published the multi-platform
  `linux/amd64` and `linux/arm64` container image.

[0.4.6]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.4.6
[0.4.5]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.4.5
[0.4.4]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.4.4
[0.4.3]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.4.3
[0.4.2]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.4.2
[0.4.1]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.4.1
[0.4.0]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.4.0
[0.3.13]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.3.13
[0.3.12]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.3.12
[0.3.11]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.3.11
[0.3.10]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.3.10
[0.3.9]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.3.9
[0.3.8]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.3.8
