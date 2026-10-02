import { useState } from 'react'
import { Gamepad2 } from 'lucide-react'

function artworkCandidates(image: string | undefined) {
  if (!image) return []
  try {
    const url = new URL(image)
    if (url.protocol === 'https:' && /(^|\.)steamstatic\.com$/.test(url.hostname) && /\/steam\/(apps|subs)\/\d+\/capsule_231x87\.jpg$/.test(url.pathname)) {
      return ['capsule_616x353.jpg', 'header.jpg'].map((file) => {
        const candidate = new URL(url)
        candidate.pathname = candidate.pathname.replace('capsule_231x87.jpg', file)
        return candidate.href
      }).concat(image)
    }
  } catch { /* Keep the original source as the final rendering attempt. */ }
  return [image]
}

/** Prefer sharp store artwork, with bounded fallbacks when an edition lacks it. */
export function GameArtwork({ image, title, className, eager = false }: { image?: string; title: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState<string[]>([])
  const source = artworkCandidates(image).find((candidate) => !failed.includes(candidate))
  return source ? <img key={source} className={className} src={source} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async"
    onError={() => setFailed((current) => [...current, source])} />
    : <span className={`cover-fallback ${className ?? ''}`}><Gamepad2 size={36} aria-hidden="true" /><span>{title}</span></span>
}
