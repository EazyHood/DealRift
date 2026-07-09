# Changelog

All notable changes to DealRift are documented here. The project follows Semantic Versioning while public beta releases can still adjust internal data formats.

## [Unreleased]

## [1.1.1-beta.1] - 2026-07-09

### Added

- Public repository documentation, MIT license, issue templates, CI, Dependabot, and automated GitHub Releases.
- Security tests for store destinations, local navigation, CORS, CSP, and persistence.
- SHA-256 checksum generation for release artifacts.

### Changed

- External links now open only through HTTPS on supported store domains.
- CheapShark remains a data source but is never used as a browser redirect intermediary.
- CORS is restricted to the local development UI and explicit configured origins.
- Deal and price history files are replaced atomically to reduce corruption after interrupted writes.

### Security

- Added Content Security Policy, framing protection, permissions restrictions, referrer protection, and MIME sniffing protection.
- Blocked unsafe protocols, credentials in URLs, untrusted hosts, and lookalike domains.

## [1.1.0] - 2026-07-09

### Added

- Explainable offer intelligence with price observations, market rank, source confidence, regional advantage, urgency, and alternatives.
- Portable Windows application with local API, bilingual interface, filters, pagination, charts, alerts, watchlist, and CSV export.

[Unreleased]: https://github.com/EazyHood/DealRift/compare/v1.1.1-beta.1...HEAD
[1.1.1-beta.1]: https://github.com/EazyHood/DealRift/releases/tag/v1.1.1-beta.1
[1.1.0]: https://github.com/EazyHood/DealRift/commits/main
