# Contributing to DealRift

Thanks for helping improve DealRift. Small, focused pull requests are the easiest to review and verify.

## Development setup

Requirements:

- Windows, macOS, or Linux for web/API development
- Node.js 20.19 or newer
- Windows x64 for validating the portable executable

```bash
git clone https://github.com/EazyHood/DealRift.git
cd DealRift
npm ci
npm run dev
```

Before opening a pull request:

```bash
npm run check
```

## Pull requests

1. Create a branch from `main`.
2. Keep unrelated formatting and refactors out of the change.
3. Add or update tests when behavior changes.
4. Update English and Spanish copy together.
5. Include screenshots for visible desktop or mobile changes.
6. Explain source provenance, rate limits, and terms when adding an external provider.

## Deal-source requirements

Every source adapter must produce the shared `Deal` model and must distinguish exact product destinations from declared search routes. Never fabricate a price, availability window, country restriction, or direct product URL.

New outbound destinations must use HTTPS, pass the trusted-domain checks in both the server and Electron layers, and include tests. APIs must have timeouts, bounded retries, caching, and a source-status message for recoverable failures.

## Reporting problems

Use the GitHub issue templates for bugs and product suggestions. Follow `SECURITY.md` for vulnerabilities and avoid posting personal data or credentials.
