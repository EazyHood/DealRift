# Privacy

Last updated: July 9, 2026

DealRift is a local-first desktop application. It has no DealRift account system, advertising SDK, analytics service, or first-party telemetry endpoint.

## Data stored locally

DealRift stores the following information on the device:

- Watchlist entries, alert preferences, language, country, and interface preferences in the application's browser storage.
- Aggregated deal snapshots and price observations in DealRift's operating-system application data directory.
- Startup error logs only when the desktop application cannot start normally.

This information is not uploaded to a DealRift-operated server. Uninstalling the portable executable does not automatically remove the operating-system application data directory.

## External requests

The local backend requests public deal, catalog, promotion, and exchange-rate endpoints from the providers documented in `DATA_SOURCES.md`. Those providers can receive the device's public IP address, request time, DealRift user agent, selected country or locale, and any search term required by the source.

Opening an offer leaves DealRift and sends the browser directly to the selected store. The destination store then applies its own privacy policy, cookies, account rules, regional restrictions, and payment process.

## Notifications and exports

Notifications are generated locally after permission is granted. CSV exports are created only when requested and remain under the user's control.

## Sensitive information

DealRift does not ask for or store store passwords, payment-card data, activation keys, VPN credentials, or browser sessions. Do not place sensitive information in searches, issue reports, screenshots, or exported files.

## Questions

Privacy questions can be opened as a GitHub discussion or issue as long as they do not disclose sensitive information. Vulnerabilities must follow `SECURITY.md`.
