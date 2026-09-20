# Privacy

Last updated: September 20, 2026

DealRift is a local-first desktop application. It has no DealRift account system, advertising SDK, analytics service, or first-party telemetry endpoint.

## Data stored locally

DealRift stores the following information on the device:

- Library entries, owned/watched status, target prices, notes, alert history, language, country, and interface preferences in a versioned local `library.json` file. This storage survives changes to the desktop API port. Legacy browser preferences available at the current origin are migrated once; data from previously used random origins cannot be automatically recovered.
- Aggregated deal snapshots and price observations in DealRift's operating-system application data directory.
- Startup error logs only when the desktop application cannot start normally.

This information is not uploaded to a DealRift-operated server. Uninstalling the portable executable does not automatically remove the operating-system application data directory.

## External requests

The local backend requests public deal, catalog, promotion, and exchange-rate endpoints from the providers documented in `DATA_SOURCES.md`. Those providers can receive the device's public IP address, request time, DealRift user agent, selected country or locale, and any search term required by the source.

Opening an offer leaves DealRift. CheapShark-sourced offers pass through CheapShark's required deal redirect before reaching the store; other providers use product or explicitly labelled search destinations. Each destination applies its own privacy policy and cookies. Watched titles are sent to the same data sources during checks, including optional background checks while the application runs in the Windows tray.

## Notifications and exports

Notifications are generated locally after opt-in and respect configured quiet hours. Checks continue after closing the window only if background monitoring is enabled; quitting from the tray stops them. Import and export run locally. Backups can include titles, ownership, notes, targets and settings, and remain under the user's control. Imported prices are not treated as verified current offers.

## Sensitive information

DealRift does not ask for or store store passwords, payment-card data, activation keys, VPN credentials, or browser sessions. Do not place sensitive information in searches, issue reports, screenshots, or exported files.

## Questions

Privacy questions can be opened as a GitHub discussion or issue as long as they do not disclose sensitive information. Vulnerabilities must follow `SECURITY.md`.
