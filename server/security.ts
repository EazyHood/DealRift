export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ')

const DEFAULT_DEVELOPMENT_ORIGINS = Object.freeze([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
])

function configuredOrigins(value?: string) {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export function isAllowedCorsOrigin(origin?: string, configured = process.env.RADAR_ALLOWED_ORIGINS) {
  if (!origin) return true
  return new Set([...DEFAULT_DEVELOPMENT_ORIGINS, ...configuredOrigins(configured)]).has(origin)
}

export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
})
