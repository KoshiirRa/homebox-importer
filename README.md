# HomeBox Importer

A small mobile-first companion for importing barcode-backed media into HomeBox. The first vertical slice supports ISBN-10/ISBN-13 scanning, Google Books metadata lookup, destination selection, and creation of a book inside a HomeBox box/location.

Container image: `ghcr.io/koshiirra/homebox-importer`

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HOMEBOX_URL` | yes | `http://homebox:7745` | Base URL visible from the importer container |
| `HOMEBOX_API_KEY` | yes for authenticated actions | none | Dedicated HomeBox API key |
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
    depends_on:
      - homebox
    ports:
      - "3101:8080"
```

The `HOMEBOX_IMPORTER_API_KEY` value belongs in a protected `.env` file or secret manager and must not be committed.

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
