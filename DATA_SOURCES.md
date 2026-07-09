# Data Sources and Link Policy

DealRift aggregates public commercial information for comparison and discovery. It is not affiliated with, endorsed by, or operated by the stores and services listed below. Product names, trademarks, cover images, and store content belong to their respective owners.

## Live data sources

| Source | Purpose | Notes |
| --- | --- | --- |
| CheapShark | PC discounts and store metadata | Used as a data feed. Browser links are rebuilt as clean retailer destinations and never use its redirect endpoint. |
| Epic Games Store | Active and upcoming giveaways | Queried by country and locale through the public promotions endpoint. |
| Steam Store | Specials, app metadata, and regional prices | Country codes are comparison hints, not a promise that an account can purchase in that region. |
| GOG catalog | Discounted DRM-free catalog entries | Product destinations are validated before they reach the UI. |
| Exchange Rate API | Approximate USD normalization | Converted values are comparison estimates, not payment quotes. |

## Marketplace scouts

Eneba, CDKeys, Kinguin, G2A, GG.deals, AllKeyShop, and SteamDB are presented as search routes. Unless a stable permitted API is integrated, DealRift does not claim that a search result has a verified price or availability.

## Operational policy

- Every request uses a timeout, retry limit, and cache where appropriate.
- Source failures are surfaced without turning cached information into a new live claim.
- Prices, taxes, stock, activation regions, editions, and seller reputation must be confirmed on the destination site.
- New sources require a documented public API or a clearly labeled search route plus a review of rate limits, attribution, and terms.
- Providers can change or withdraw endpoints without notice. DealRift does not bypass authentication, access controls, CAPTCHAs, or purchase restrictions.

Opening a link means leaving DealRift. The destination provider's terms and privacy policy apply from that point onward.
