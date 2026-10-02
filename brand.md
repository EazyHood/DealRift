# DealRift brand

Updated for the 1.5 interface on 2026-10-01.

## Direction

A considered game library: warm charcoal, ivory typography and real game artwork. Give prices and titles clear hierarchy, use measured spacing, and let the collection provide the colour. The interface should feel useful, calm and carefully edited.

No 3D scenery, neon glow, decorative gradients, polygon meshes or glass panels. Use solid surfaces and quiet separators. Reserve shadows for overlays rather than every card.

## Palette

Use the shared CSS tokens in `src/index.css`; components should not invent their own palettes.

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#141414` | Application background |
| `--surface` | `#1c1c1b` | Main panels |
| `--surface-raised` | `#252523` | Controls and raised surfaces |
| `--surface-hover` | `#2d2d2a` | Hover state |
| `--text` | `#f2f0e9` | Primary ivory text |
| `--muted` | `#a7a69c` | Supporting text |
| `--border` | `#363632` | Quiet separators |
| `--border-strong` | `#77776d` | Stronger control boundaries |
| `--accent` | `#efb58b` | Primary actions, focus and selection |
| `--accent-ink` | `#25190f` | Text on the apricot accent |
| `--green` | `#a8c8a0` | Positive or owned state |
| `--amber` | `#e8bf78` | Limited evidence and warnings |
| `--pink` | `#efa6a0` | Errors and destructive actions |

`--cyan` remains an alias of `--accent` for existing components; it does not introduce a second accent.

## Typography and shape

- Prefer Segoe UI Variable, Segoe UI, then the system sans-serif stack. No remote font dependency.
- Use weight, size and spacing to establish hierarchy. Keep metadata readable and prices aligned with tabular numerals.
- Use 12 px panel corners and 7 px control corners through the shared radius tokens.
- Artwork should remain sharp at the rendered size. Prefer larger official image variants with bounded fallbacks.

## Interaction and voice

- Keep both the artwork grid and compact list useful. Preserve search, filters and price evidence in either layout.
- Use visible keyboard focus, real buttons and links, and generous touch targets.
- Motion is short and purposeful. Respect both the system reduced-motion preference and the app's **Reduce motion** setting.
- Write clear Spanish and English. Place source, country and observation dates beside price claims.
- Distinguish verified prices from estimates, incomplete coverage and unavailable evidence. Do not invent scores, observations or scarcity to decorate the interface.
