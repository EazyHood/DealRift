# Data Sources and Link Policy

DealRift aggregates public commercial information for comparison and discovery. It is not affiliated with, endorsed by, or operated by the stores and services listed below. Product names, trademarks, cover images, and store content belong to their respective owners.

## Live data sources

| Source | Purpose | Notes |
| --- | --- | --- |
| CheapShark | PC discounts and store metadata | US reference prices. Offers use the provider's required `https://www.cheapshark.com/redirect?dealID=…` destination; only that exact host, path and validated parameter are permitted. |
| Epic Games Store | Active and upcoming giveaways | Queried by country and locale through the public promotions endpoint. |
| Steam Store | Specials, app metadata, and regional prices | Featured specials plus bounded app-ID lookups discovered during title searches. This is not a complete Steam catalogue. Country prices do not prove activation or account eligibility. |
| GOG catalog | Discounted DRM-free catalog entries and title search | Sends the query to the catalogue API. Results remain bounded and may not cover all products. Product destinations are validated before reaching the UI. |
| Exchange Rate API | Approximate USD normalization | Converted values are comparison estimates, not payment quotes. |

## Marketplace scouts

Eneba, CDKeys, Kinguin, G2A, GG.deals, AllKeyShop, and SteamDB are presented as search routes. Unless a stable permitted API is integrated, DealRift does not claim that a search result has a verified price or availability.

## Operational policy

- Every request uses a timeout, retry limit, and cache where appropriate.
- Source failures are surfaced without turning cached information into a new live claim.
- Cached prices retain their original successful retrieval time. Stale, future, expired and foreign reference offers do not count as current local historical lows or trigger personal alerts.
- Up to 20 watched games are checked per pass, with bounded concurrency and rotation through larger lists. Desktop checks run every five minutes while DealRift is running; the PC must be awake and connected.
- Prices, taxes, stock, activation regions, editions, and seller reputation must be confirmed on the destination site.
- New sources require a documented public API or a clearly labeled search route plus a review of rate limits, attribution, and terms.
- Providers can change or withdraw endpoints without notice. DealRift does not bypass authentication, access controls, CAPTCHAs, or purchase restrictions.

Opening a link means leaving DealRift. The destination provider's terms and privacy policy apply from that point onward.

Provider documentation: [CheapShark API and required links](https://apidocs.cheapshark.com/). Additional integrations must be reviewed individually; IsThereAnyDeal is not integrated because its published API conditions restrict competing applications.
