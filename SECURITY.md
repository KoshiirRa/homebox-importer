# Security Policy

## Reporting a vulnerability

Do not open a public issue containing credentials, private hostnames, inventory data, or exploit details. Use GitHub's private vulnerability reporting for this repository when available.

## Deployment guidance

- Create a dedicated HomeBox API key for this application.
- Keep the API key in a protected environment file or secret manager.
- Put the browser-facing application behind HTTPS; camera access generally requires a secure context.
- Restrict direct access to HomeBox and the importer using the homelab's existing authentication and reverse-proxy controls.
- Rotate keys immediately if they appear in logs, shell history, screenshots, Compose files committed to Git, or support messages.
- Back up HomeBox independently; this application is not a backup system.

## Supported versions

Until the project reaches a stable release, security fixes are applied only to the latest published container and source on `main`.
