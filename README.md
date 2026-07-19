# HomeBox Importer

A small mobile-first companion for importing barcode-backed media into HomeBox. It scans ISBN, UPC, EAN, and GTIN barcodes; looks up books, CDs and other music releases, movies, video games, and general products; supports editable manual entry; and creates quantity-aware items inside a selected HomeBox box or location.

Container image: `ghcr.io/koshiirra/homebox-importer`

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HOMEBOX_URL` | yes | `http://homebox:7745` | Base URL visible from the importer container |
| `HOMEBOX_API_KEY` | yes for authenticated actions | none | Dedicated HomeBox API key |
| `HARDCOVER_API_TOKEN` | no | none | Optional Hardcover token for additional metadata coverage |
| `ISBNDB_API_KEY` | no | none | Optional ISBNdb key for broader small-press and commercial metadata coverage |
| `DISCOGS_TOKEN` | no | none | Optional personal Discogs API token for physical music releases |
| `UPCITEMDB_API_KEY` | no | none | Optional paid UPCitemdb key; without it the 100-request/day trial endpoint is used |
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
      HARDCOVER_API_TOKEN: ${HARDCOVER_API_TOKEN:-}
      ISBNDB_API_KEY: ${ISBNDB_API_KEY:-}
      DISCOGS_TOKEN: ${DISCOGS_TOKEN:-}
      UPCITEMDB_API_KEY: ${UPCITEMDB_API_KEY:-}
    depends_on:
      - homebox
    ports:
      - "3101:8080"
```

The `HOMEBOX_IMPORTER_API_KEY` value belongs in a protected `.env` file or secret manager and must not be committed.

`HARDCOVER_API_TOKEN` and `ISBNDB_API_KEY` are optional. Lookup order is Google Books, Open Library, Hardcover (when configured), ISBNdb (when configured), and finally editable manual entry. You may paste the Hardcover token with or without its `Bearer ` prefix; the importer sends it only from the server. Hardcover API tokens expire annually, and provider availability and quotas remain subject to their respective services.

For non-book barcodes, lookup order is Discogs (when `DISCOGS_TOKEN` is configured), MusicBrainz, UPCitemdb, and editable manual entry. Discogs is used for release-specific music metadata; MusicBrainz is the credential-free music fallback; UPCitemdb covers movies, video games, and general retail products. UPCitemdb's unauthenticated trial is limited to 100 requests per day.

## Box labels

Open `/labels.html` to select HomeBox boxes or locations and generate printable QR labels. Presets are included for the Brother QL-810WC with DK-2205 62 mm continuous media (50 mm cut length), Avery 5160 (30 per sheet), Avery 5163 (10 per sheet), and 4 × 2 inch thermal labels. Each QR code opens the importer with that destination preselected, so you can scan a box once and then scan items into it. Set the QR destination base URL to an address the phone can reach from the storage unit before printing.

For the Brother preset, install the QL-810WC Windows driver, load a DK-2205 roll, choose the 62 mm continuous media size, disable browser headers and footers, and print at 100% scale. The printer's automatic cutter separates the 50 mm labels.

A standalone example is available in [`compose.example.yml`](compose.example.yml), with configuration names documented in [`.env.example`](.env.example).

Then deploy it:

```sh
docker compose pull homebox-importer
docker compose up -d homebox-importer
```

For repeatable production deployments, replace `latest` with a published version such as `0.1.0` after validating that release.

## Published tags

- `latest`: most recent successful build from `main`
- `0.1.0` and `0.1`: semantic-version tags created from Git tag `v0.1.0`
- `v0.1.0`: source Git tag
- `sha-…`: immutable commit build

## Test/reset boundary

Use only conspicuously named junk records until the workflow is accepted. Before production use, delete and recreate the HomeBox volume, rotate `HBOX_AUTH_API_KEY_PEPPER`, create a new importer API key, pin the tested HomeBox image version, and configure off-site backups.
