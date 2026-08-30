# HomeBox Importer

A small mobile-first companion for importing physical media into HomeBox. It scans ISBN, UPC, EAN, and GTIN barcodes; looks up books, CDs and other music releases, movies, video games, and general products; supports books without identifiers and editable manual entry; and creates quantity-aware items inside a selected HomeBox box or location.

Container image: `ghcr.io/koshiirra/homebox-importer`

Local development uses Node.js 22, GitHub Actions uses Node.js 24 LTS, and
published containers use Node.js 26. See [CHANGELOG.md](CHANGELOG.md) for
release history and upgrade notes.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HOMEBOX_URL` | yes | `http://homebox:7745` | Base URL visible from the importer container |
| `HOMEBOX_API_KEY` | yes for authenticated actions | none | Dedicated HomeBox API key |
| `GOOGLE_BOOKS_API_KEY` | no | none | Identifies Google Books metadata requests for project quota and reporting |
| `HARDCOVER_API_TOKEN` | no | none | Optional Hardcover token for additional metadata coverage |
| `ISBNDB_API_KEY` | no | none | Optional ISBNdb key for broader small-press and commercial metadata coverage |
| `BRAVE_SEARCH_API_KEY` | no | none | Enables a full-web fallback when exact ISBN catalog providers have no trustworthy match |
| `DISCOGS_TOKEN` | no | none | Optional personal Discogs API token for physical music releases |
| `UPCITEMDB_API_KEY` | no | none | Optional paid UPCitemdb key; without it the 100-request/day trial endpoint is used |
| `GOOGLE_CLOUD_VISION_API_KEY` | no | none | Enables book-cover OCR after barcode metadata providers fail |
| `GEMINI_API_KEY` | no | none | Enables structured, AI-assisted book-cover metadata extraction |
| `GEMINI_MODEL` | no | `gemini-2.5-flash` | Gemini model used for cover extraction |
| `PORT` | no | `8080` | Importer listening port |

Do not use a personal login token. In HomeBox, create a dedicated API key for the importer and inject it as a Docker secret or protected environment value.

## Local development

```powershell
npm install
npm run build
$env:HOMEBOX_URL = 'http://your-homebox-host:3100'
$env:HOMEBOX_API_KEY = 'replace-with-test-key'
npm start
```

Open `http://localhost:8080`. Camera scanning requires a secure context; use HTTPS through the reverse proxy on a phone. Manual ISBN entry works over plain HTTP.

## Install with Docker Compose

Add this service to the same Compose project as HomeBox:

```yaml
  homebox-importer:
    image: ghcr.io/koshiirra/homebox-importer:latest
    restart: unless-stopped
    environment:
      HOMEBOX_URL: http://homebox:7745
      HOMEBOX_API_KEY: ${HOMEBOX_IMPORTER_API_KEY}
      GOOGLE_BOOKS_API_KEY: ${GOOGLE_BOOKS_API_KEY:-}
      HARDCOVER_API_TOKEN: ${HARDCOVER_API_TOKEN:-}
      ISBNDB_API_KEY: ${ISBNDB_API_KEY:-}
      BRAVE_SEARCH_API_KEY: ${BRAVE_SEARCH_API_KEY:-}
      DISCOGS_TOKEN: ${DISCOGS_TOKEN:-}
      UPCITEMDB_API_KEY: ${UPCITEMDB_API_KEY:-}
      GOOGLE_CLOUD_VISION_API_KEY: ${GOOGLE_CLOUD_VISION_API_KEY:-}
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
      GEMINI_MODEL: ${GEMINI_MODEL:-gemini-2.5-flash}
    depends_on:
      - homebox
    ports:
      - "3101:8080"
```

The `HOMEBOX_IMPORTER_API_KEY` value belongs in a protected `.env` file or secret manager and must not be committed.

`GOOGLE_BOOKS_API_KEY`, `HARDCOVER_API_TOKEN`, `ISBNDB_API_KEY`, and `BRAVE_SEARCH_API_KEY` are optional. Lookup order is Google Books, Open Library, Hardcover (when configured), ISBNdb (when configured), Brave Search (when configured and no catalog result reports the exact ISBN), and finally editable manual entry. Configure `GOOGLE_BOOKS_API_KEY` with a server-side key restricted to the Google Books API so requests use the project's quota and reporting; the key is never sent to the browser. You may paste the Hardcover token with or without its `Bearer ` prefix; the importer sends it only from the server. Brave credentials also remain server-side. The importer uses Brave results transiently and does not cache raw search responses; confirm current Brave pricing and storage terms for your account. Provider availability and quotas remain subject to their respective services.

For non-book barcodes, lookup order is Discogs (when `DISCOGS_TOKEN` is configured), MusicBrainz, UPCitemdb, and editable manual entry. Discogs is used for release-specific music metadata; MusicBrainz is the credential-free music fallback; UPCitemdb covers movies, video games, and general retail products. UPCitemdb's unauthenticated trial is limited to 100 requests per day.

When `GOOGLE_CLOUD_VISION_API_KEY` or `GEMINI_API_KEY` is configured, a failed ISBN metadata lookup also offers **Scan the cover**. The browser resizes and JPEG-compresses the photo before sending it to the importer server. Google Cloud Vision uses `TEXT_DETECTION` for conventional OCR. Optional Gemini extraction separates the visible work title from series, edition, format, marketing text, and publisher marks, and returns schema-constrained title, subtitle, author, publisher, date, edition, format, series, and confidence fields. `GEMINI_MODEL` defaults to the stable `gemini-2.5-flash` model but remains configurable.

Gemini suggestions are bounded, validated, and treated as untrusted input. The schema deliberately contains no ISBN, barcode, catalog-number, synopsis, or description field, so a model assertion cannot become identifier evidence. A maximum of three likely title or title-plus-author queries use Google Books `intitle:`/`inauthor:` and Open Library `title`/`author` fields in parallel. Candidates are deduplicated and scored deterministically for exact provider ISBN, distinctive title, author, subtitle or series, and completeness. Academic and non-academic books use the same evidence rules. Conflicting ISBNs receive a strong penalty and are never rewritten to the scanned ISBN; weak matches are rejected.

If Gemini is unavailable, invalid, or rate limited, configured Vision OCR continues normally. If Vision is unavailable but Gemini returns trustworthy structured fields, cover lookup can still continue. If neither produces a trustworthy catalog match, the manual book form receives clearly labeled, editable cover suggestions. User review and the **Add book** action remain mandatory; the importer never imports directly from model output.

Provider keys stay on the server and are never included in browser code or request URLs. Cover photos, OCR text, prompts, model responses, and complete upstream bodies are processed transiently and are not stored or logged by the importer. Gemini API quotas, pricing, and data-use terms belong to the Google API project associated with the key and may differ between free and paid tiers; verify the current terms for that project before production use. A Gemini or Google AI consumer subscription should not be treated as unlimited API quota.

For pre-ISBN and other identifier-less publications, choose **Book has no ISBN
or barcode**. You may scan the cover when Vision or Gemini is configured or enter the
book directly. ISBN is optional; edition/printing, format, and an accurately
labeled alternate catalog identifier may be recorded instead. Catalog ISBNs
found from cover text are shown only as candidate metadata and are not applied
to a physical copy declared identifier-less. The importer never invents an
ISBN or disguises another catalog number as one.

## Box labels

Open `/labels.html` to select HomeBox boxes or locations and generate printable QR labels. Presets are included for the Brother QL-810WC with DK-2205 62 mm continuous media (50 mm cut length), Avery 5160 (30 per sheet), Avery 5163 (10 per sheet), and 4 × 2 inch thermal labels. Each QR code opens the importer with that destination preselected and displays its current direct contents, so you can identify what is inside before scanning additional items into it. You can also open the importer first and use **Scan container QR** to select a labeled box without leaving the page. Set the QR destination base URL to an address the phone can reach from the storage unit before printing.

For the Brother preset, the importer downloads a print-ready PDF with one exact 62 × 50 mm page per label. Install the QL-810WC Windows driver, load a DK-2205 roll, open the PDF, select 62 mm continuous media, and print at `Actual size` or `100%` with no page margins. Do not use `Fit`, `Shrink oversized pages`, or a browser print preview. The printer's automatic cutter separates the 50 mm labels.

A standalone example is available in [`compose.example.yml`](compose.example.yml), with configuration names documented in [`.env.example`](.env.example).

Then deploy it:

```sh
docker compose pull homebox-importer
docker compose up -d homebox-importer
```

For repeatable production deployments, replace `latest` with a published version such as `0.4.2` after validating that release.

## Published tags

- `latest`: most recent successful build from `main`
- `0.4.2` and `0.4`: semantic-version container tags created from Git tag `v0.4.2`
- `v0.4.2`: source Git tag and container tag
- `sha-…`: immutable commit build

## Operational logs

Every metadata lookup emits exactly one terminal `lookup.succeeded` or
`lookup.failed` structured JSON line. Events include an opaque correlation ID,
workflow, duration, and a normalized identifier only when valid. Successes add
the selected provider and result count; failures use `invalid_identifier`,
`provider_no_match`, `provider_unavailable`, `cover_no_text`, or
`cover_no_match` plus a bounded provider-attempt summary. Expected validation
and no-match outcomes do not print stack traces. Unexpected internal defects
retain a secret-safe stack trace. Import events include provider/manual
provenance, destination ID, resulting HomeBox entity and asset IDs, and
quantity. Every import attempt emits exactly one `import.succeeded` or
`import.failed` event with a correlation ID; validation and identifier conflicts
use `invalid_identifier`, while HomeBox write failures use `homebox_failure`. Logs never
include provider credentials, authorization headers, cover image payloads,
descriptions, OCR text, or complete upstream response bodies.

The example Compose service uses Docker's `json-file` driver with three 10 MB
rotated files. These logs survive container restarts but are not durable
application storage and are normally removed when the container is removed.

## Test/reset boundary

Use only conspicuously named junk records until the workflow is accepted. Before production use, delete and recreate the HomeBox volume, rotate `HBOX_AUTH_API_KEY_PEPPER`, create a new importer API key, pin the tested HomeBox image version, and configure off-site backups.
