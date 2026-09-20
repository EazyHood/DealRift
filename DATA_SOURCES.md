# Data Sources and Link Policy

DealRift aggregates public commercial information for comparison and discovery. It is not affiliated with, endorsed by, or operated by the stores and services listed below. Product names, trademarks, cover images, and store content belong to their respective owners.

## Live data sources

| Source | Purpose | Notes |
| --- | --- | --- |
| CheapShark | PC discounts and store metadata | US reference prices. Offers use the provider's required `https://www.cheapshark.com/redirect?dealID=…` destination; only that exact host, path and validated parameter are permitted. |
| Epic Games Store | Active and upcoming giveaways | Queried by country and locale through the public promotions endpoint. |
| Steam Store | Specials, app metadata, and regional prices | Featured specials plus bounded app-ID lookups discovered during title searches. This is not a complete Steam catalogue. Country prices do not prove activation or account eligibility. |
| GOG catalog | Discounted DRM-free catalog entries and title search | Sends the query to the catalogue API. Results remain bounded and may not cover all products. Product destinations are validated before reaching the UI. |
| PlayStation Store | PS4/PS5 public offers, catalog search and exact product lookup | Uses the same public persisted GraphQL operations as the official web store, without authentication. Up to 192 source results per query and 120 returned offers; unsupported storefronts fail explicitly. PS Plus-only prices, demos, preorders and identified add-ons are excluded. |
| Microsoft/Xbox catalog | Xbox public offers, title search and exact product lookup | Microsoft Store discovery plus Display Catalog product/SKU validation. Up to 60 product IDs checked; console purchase availability must match the requested market. Excludes PC-only SKUs, trials, preorders, membership entitlements and standalone DLC. |
| Exchange Rate API | Approximate USD normalization | Converted values are comparison estimates, not payment quotes. |

## Console coverage

PlayStation prices come from the selected storefront (including USD prices in Colombia). Xbox prices come from current public purchase SKUs with the requested market and `Windows.Xbox` support. Subscription entitlements with a zero price are not free ownership. Game bundles are identified where the provider publishes them; included content still needs confirmation on the product page.

PlayStation ratings are checked for up to 24 returned products with concurrency four and an eight-second budget. Its catalog does not publish promotion end dates in the selected operation, so the ending-soon filter only shows entries with actual dates. Xbox publishes dates for applicable purchase offers.

Rating values, when present, are official store user ratings normalized to a percentage, not Metacritic scores. Missing rating or expiry data remains unknown and is excluded by filters that require it. Product IDs isolate platforms and editions in the library, comparisons and history; a regional product ID may differ across storefronts. Old PC backups remain compatible.

The free-only filter queries each console store’s public free-to-play collection when no search term is present, then verifies the actual public zero-price offer; it is not limited to the discount feed. Only the selected ecosystem is queried for a radar request. Watchlist checks query each saved game's ecosystem even while another platform is visible. Prices are cached for five minutes. Search and discovery are bounded and do not guarantee exhaustive catalog coverage. Console cross-country scanning and subscription library entitlement tracking are not implemented.

## Marketplace scouts

Eneba, CDKeys, Kinguin, G2A, GG.deals, AllKeyShop, and SteamDB are presented as search routes. Unless a stable permitted API is integrated, DealRift does not claim that a search result has a verified price or availability.

## Operational policy

- Every request uses a timeout, retry limit, and cache where appropriate.
- Source failures are surfaced without turning cached information into a new live claim.
- Cached prices retain their original successful retrieval time. Stale, future, expired and foreign reference offers do not count as current local historical lows or trigger personal alerts.
- Up to 20 watched games are checked per pass, with bounded concurrency and rotation through larger lists. Desktop checks run every five minutes while DealRift is running; the PC must be awake and connected.
- Prices, taxes, stock, activation regions, editions, and seller reputation must be confirmed on the destination site.
- Console adapters use publicly accessible store interfaces, not a contracted API. Their response formats and PlayStation persisted operation identifiers can change; source errors are surfaced instead of fabricating prices. No credentials, tokens, cookies or access-control bypass are used.
- Providers can change or withdraw endpoints without notice. DealRift does not bypass authentication, access controls, CAPTCHAs, or purchase restrictions.

Opening a link means leaving DealRift. The destination provider's terms and privacy policy apply from that point onward.

Provider documentation: [CheapShark API and required links](https://apidocs.cheapshark.com/). Additional integrations must be reviewed individually; IsThereAnyDeal is not integrated because its published API conditions restrict competing applications.
