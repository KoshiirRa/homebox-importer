# Changelog

All notable changes to HomeBox Importer are documented here.

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

[0.3.8]: https://github.com/KoshiirRa/homebox-importer/releases/tag/v0.3.8
