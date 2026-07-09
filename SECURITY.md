# Security Policy

## Supported versions

DealRift is currently in public beta. Security fixes are provided for the latest published release only.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting flow:

https://github.com/EazyHood/DealRift/security/advisories/new

Include the affected version, reproduction steps, impact, and any proof of concept that is safe to share. Do not include real credentials, payment data, or personal information.

You should receive an acknowledgement within seven days. A fix and disclosure timeline will depend on severity and reproducibility.

## Security boundaries

- The desktop API binds to `127.0.0.1` on a random port.
- External navigation is restricted to HTTPS destinations on supported store domains.
- DealRift does not request store passwords, payment credentials, or browser cookies.
- Marketplace and regional offers can still carry commercial, activation, account, or seller risk. Security controls do not guarantee that a third-party listing is legitimate.

The current Windows beta is not code signed. Verify its SHA-256 checksum against the `SHA256SUMS.txt` file attached to the same GitHub release.
