# Changelog

All notable changes to DealRift are documented here. The project follows Semantic Versioning while public beta releases can still adjust internal data formats.

## [Unreleased]

## [1.4.0-beta.1] - 2026-09-23

### Added

- **Any country · lowest USD** in the country selector for PC, PlayStation and Xbox.
- Current regional offer comparison with USD-first prices, the winning country and native price, and cheapest-first ordering.
- Explicit country coverage and partial-source failure reporting, bounded concurrent requests and cached comparisons.
- Persisted worldwide preference while retaining the base country for personal targets, alerts and planning.

### Fixed

- Regional comparisons reject stale, expired, unavailable and unconvertible offers instead of allowing them to become a misleading minimum.
- Minimum-discount filtering runs after regional winner selection so a more expensive discounted offer cannot hide a cheaper full-price quote.

## [1.3.0-beta.1] - 2026-09-20

### Added

- PlayStation Store PS4/PS5 and Microsoft Xbox catalog adapters with country prices, title search and exact product lookup.
- PC/PlayStation/Xbox navigation, console compatibility filter and shared offer filters.
- Console favorites, price targets, notifications, local history, imports, backups and purchase planning.
- Store rating metadata, bounded discovery, source coverage messages and regression tests for subscription exclusions and console identity.

### Fixed

- Identical titles on different platforms no longer share library identity, price history or market comparisons.
- Dashboard history is separated by platform and country; legacy PC data remains readable.
- Console store URLs are accepted only on explicit official hosts in the API, backup parser and desktop shell.

## [1.2.0-beta.1] - 2026-09-20

### Added

- Persistent local library, owned-game filtering, price targets, priorities, notes, import previews and backups.
- Game detail sheets with observed minimum-price history and offer evidence.
- Personal budget plans, comparison of selected editions, alert inbox and quiet hours.
- Opt-in Windows tray monitoring, bounded rotating watchlist checks and a manual release link in the tray menu.
- Regression coverage for regional identity, source outages, future giveaways, concurrent history writes, imports, local API mutations, alerts, planning and desktop lifecycle.

### Fixed

- Preferences and watchlist no longer depend on the random desktop server port or the current search results.
- All watched-game matches are evaluated, with durable notification deduplication and price-drop/target rules.
- Local prices cannot be displaced by cheaper foreign reference quotes from the same store.
- Cached data preserves its successful retrieval time and becomes visibly stale after refresh failures.
- Upcoming and expired giveaways do not become current purchase recommendations or false historical lows.
- Concurrent requests no longer overwrite each other's price observations.
- GOG title searches reach the catalogue API; Steam search adds bounded app-ID lookups and reports coverage limits.
- CheapShark destinations now comply with its required redirect policy using strict URL validation.

### Changed

- More compact dashboard controls, accessible control states and optional low-power background with WebGL fallback.
- Dependency patches; CI audits all dependencies and packages the Windows executable.
- Personal data, source policy and operating limitations documented in the repository.

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

[Unreleased]: https://github.com/EazyHood/DealRift/compare/v1.2.0-beta.1...HEAD
[1.2.0-beta.1]: https://github.com/EazyHood/DealRift/releases/tag/v1.2.0-beta.1
[1.1.1-beta.1]: https://github.com/EazyHood/DealRift/releases/tag/v1.1.1-beta.1
[1.1.0]: https://github.com/EazyHood/DealRift/commits/main
