# Contributing

## Development setup

Requirements:

- Node.js 24
- npm
- Optional Docker with Buildx for container verification

Install and verify:

```sh
npm ci
npm run build
npm test
npm audit --omit=dev
```

Copy `.env.example` to `.env` only for local use. Never commit the resulting file or an API key.

## Pull requests

- Keep changes focused on one vertical slice or repair.
- Add tests for new behavior and upstream failure handling.
- Describe any HomeBox API assumptions and the HomeBox version used for verification.
- Use only unmistakable disposable records for authorized live testing.
- Include screenshots for material visual changes when practical.

## Commits

Use short imperative commit messages, such as `Add ordinary item quantities` or `Handle Open Library timeouts`.
