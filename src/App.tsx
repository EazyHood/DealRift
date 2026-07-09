import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  BellRing,
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Gamepad2,
  Gift,
  GitCompareArrows,
  Globe2,
  Languages,
  MapPin,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  TrendingDown,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import { RadarCanvas } from './components/RadarCanvas'
import { useCopy } from './lib/i18n'
import { fetchHistory, fetchRadar, fetchRegionalScan, type RadarParams } from './lib/radarApi'
import type {
  Deal,
  DealHistoryPoint,
  IntelligenceReasonCode,
  Language,
  RadarResponse,
  RegionalScan,
  RiskLevel,
  SortMode,
  SourceKind,
} from './shared/dealTypes'

type SourceFilter = 'all' | SourceKind
type DashboardView = 'deals' | 'regions' | 'alerts' | 'analytics' | 'sources'

const countries = [
  { code: 'US', es: 'Estados Unidos', en: 'United States' },
  { code: 'CO', es: 'Colombia', en: 'Colombia' },
  { code: 'IN', es: 'India', en: 'India' },
  { code: 'TR', es: 'Turquia', en: 'Turkiye' },
  { code: 'AR', es: 'Argentina', en: 'Argentina' },
  { code: 'BR', es: 'Brasil', en: 'Brazil' },
  { code: 'MX', es: 'Mexico', en: 'Mexico' },
  { code: 'CL', es: 'Chile', en: 'Chile' },
  { code: 'PE', es: 'Peru', en: 'Peru' },
  { code: 'ID', es: 'Indonesia', en: 'Indonesia' },
  { code: 'MY', es: 'Malasia', en: 'Malaysia' },
  { code: 'PH', es: 'Filipinas', en: 'Philippines' },
  { code: 'TH', es: 'Tailandia', en: 'Thailand' },
  { code: 'VN', es: 'Vietnam', en: 'Vietnam' },
  { code: 'ZA', es: 'Sudafrica', en: 'South Africa' },
  { code: 'PL', es: 'Polonia', en: 'Poland' },
  { code: 'CN', es: 'China', en: 'China' },
  { code: 'JP', es: 'Japon', en: 'Japan' },
  { code: 'KR', es: 'Corea del Sur', en: 'South Korea' },
  { code: 'GB', es: 'Reino Unido', en: 'United Kingdom' },
  { code: 'DE', es: 'Alemania', en: 'Germany' },
  { code: 'ES', es: 'Espana', en: 'Spain' },
  { code: 'CA', es: 'Canada', en: 'Canada' },
  { code: 'AU', es: 'Australia', en: 'Australia' },
]

const sourceFilters: SourceFilter[] = ['all', 'official', 'authorized', 'freebie', 'regional', 'marketplace']
const sortModes: SortMode[] = ['value', 'price', 'savings', 'regional', 'rating', 'ending', 'signal']
const pageSizeOptions = [10, 20, 30, 40]

function readSetting(key: string, fallback: string) {
  if (typeof localStorage === 'undefined') return fallback
  return localStorage.getItem(key) ?? fallback
}

function readJsonSetting<T>(key: string, fallback: T) {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function readPageSizeSetting() {
  const value = Number(readSetting('dealrift-page-size', '10'))
  return pageSizeOptions.includes(value) ? value : 10
}

function riskLabel(risk: RiskLevel, t: ReturnType<typeof useCopy>) {
  if (risk === 'low') return t('riskLow')
  if (risk === 'medium') return t('riskMedium')
  return t('riskHigh')
}

function confidenceLabel(confidence: Deal['confidence'], t: ReturnType<typeof useCopy>) {
  if (confidence === 'live-api') return t('liveApi')
  if (confidence === 'computed') return t('computed')
  if (confidence === 'search-link') return t('searchLink')
  return 'fallback'
}

function intelligenceScore(deal: Deal) {
  return deal.intelligence?.score ?? deal.signalScore
}

function verdictLabel(verdict: NonNullable<Deal['intelligence']>['verdict'], t: ReturnType<typeof useCopy>) {
  if (verdict === 'exceptional') return t('verdictExceptional')
  if (verdict === 'strong') return t('verdictStrong')
  if (verdict === 'fair') return t('verdictFair')
  return t('verdictWait')
}

function intelligenceReasonLabel(code: IntelligenceReasonCode, t: ReturnType<typeof useCopy>) {
  const labels: Record<IntelligenceReasonCode, Parameters<typeof t>[0]> = {
    'free-game': 'reasonFreeGame',
    'observed-low': 'reasonObservedLow',
    'near-observed-low': 'reasonNearObservedLow',
    'market-lowest': 'reasonMarketLowest',
    'market-competitive': 'reasonMarketCompetitive',
    'deep-discount': 'reasonDeepDiscount',
    'high-rating': 'reasonHighRating',
    'regional-advantage': 'reasonRegionalAdvantage',
    'direct-link': 'reasonDirectLink',
    'live-source': 'reasonLiveSource',
    'limited-history': 'reasonLimitedHistory',
    'search-link': 'reasonSearchLink',
    'medium-risk': 'reasonMediumRisk',
    'high-risk': 'reasonHighRisk',
    'above-market': 'reasonAboveMarket',
    'price-anomaly': 'reasonPriceAnomaly',
  }
  return t(labels[code])
}

function formatUsd(value: number | undefined) {
  return typeof value === 'number' ? `$${value.toFixed(2)}` : '-'
}

function frontendGameKey(deal: Deal) {
  return deal.intelligence?.gameKey ?? deal.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function formatTime(value?: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatRelativeTime(value: string | undefined, language: Language, now = Date.now()) {
  if (!value) return ''
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return ''
  const elapsedSeconds = Math.max(0, Math.round((now - timestamp) / 1000))
  const formatter = new Intl.RelativeTimeFormat(language === 'es' ? 'es' : 'en', { numeric: 'auto' })
  if (elapsedSeconds < 60) return formatter.format(-elapsedSeconds, 'second')
  const elapsedMinutes = Math.round(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return formatter.format(-elapsedMinutes, 'minute')
  const elapsedHours = Math.round(elapsedMinutes / 60)
  if (elapsedHours < 24) return formatter.format(-elapsedHours, 'hour')
  return formatter.format(-Math.round(elapsedHours / 24), 'day')
}

function linkHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function downloadDealsCsv(deals: Deal[]) {
  const headers = ['Title', 'Store', 'Platform', 'Price', 'Currency', 'USD', 'Normal price', 'Savings', 'Intelligence', 'Verdict', 'Observed low USD', 'Market rank', 'Market offers', 'Best country', 'Risk', 'Link']
  const rows = deals.map((deal) => [
    deal.title,
    deal.source,
    deal.platform,
    deal.isFree ? 0 : deal.salePrice.amount,
    deal.salePrice.currency,
    deal.isFree ? 0 : dealUsd(deal),
    deal.normalPrice?.amount ?? '',
    deal.savingsPercent,
    intelligenceScore(deal),
    deal.intelligence?.verdict ?? '',
    deal.intelligence?.history.paidLowUsd ?? '',
    deal.intelligence?.market.rank ?? '',
    deal.intelligence?.market.offerCount ?? '',
    deal.bestRegion?.countryName ?? '',
    deal.riskLevel,
    deal.url,
  ])
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([String.fromCharCode(0xfeff), csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `dealrift-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Continue with the compatibility fallback below.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

function useOnlineStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}

function dealUsd(deal: Deal) {
  return deal.salePrice.usd ?? deal.salePrice.amount
}

function dealRating(deal: Deal) {
  return deal.steamRatingPercent ?? deal.metacriticScore ?? 0
}

function regionalStrength(deal: Deal) {
  return Math.abs(deal.bestRegion?.relativeToBaselinePercent ?? 0)
}

function endingSoonScore(deal: Deal) {
  if (!deal.expiresAt) return Number.MAX_SAFE_INTEGER
  return Math.max(0, new Date(deal.expiresAt).getTime() - Date.now())
}

function isEndingSoon(deal: Deal) {
  if (!deal.expiresAt) return false
  const remaining = new Date(deal.expiresAt).getTime() - Date.now()
  return remaining > 0 && remaining <= 72 * 60 * 60 * 1000
}

function formatTimeLeft(value?: string) {
  if (!value) return ''
  const remaining = new Date(value).getTime() - Date.now()
  if (remaining <= 0) return ''
  const hours = Math.ceil(remaining / (60 * 60 * 1000))
  if (hours < 24) return `${hours}h`
  return `${Math.ceil(hours / 24)}d`
}

function valueScore(deal: Deal) {
  const price = dealUsd(deal)
  const priceBonus = deal.isFree ? 24 : Math.max(0, 24 - Math.min(24, price * 1.2))
  return intelligenceScore(deal) * 1.2 + deal.savingsPercent * 0.2 + dealRating(deal) * 0.12 + regionalStrength(deal) * 0.18 + priceBonus
}

function sourceLabel(filter: SourceFilter, t: ReturnType<typeof useCopy>) {
  if (filter === 'all') return t('all')
  if (filter === 'freebie') return t('freebies')
  if (filter === 'marketplace') return t('marketplaces')
  return t(filter)
}

function useRadarData(params: RadarParams, autoRefresh: boolean) {
  const [data, setData] = useState<RadarResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetchRadar(params, controller.signal)
      .then((response) => {
        setData(response)
        setError(null)
      })
      .catch((nextError: unknown) => {
        if (!controller.signal.aborted) {
          setError(nextError instanceof Error ? nextError.message : 'Radar failed')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [params, tick])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = window.setInterval(refresh, Math.max(30, data?.refreshSeconds ?? 300) * 1000)
    return () => window.clearInterval(interval)
  }, [autoRefresh, data?.refreshSeconds, refresh])

  return { data, error, loading, refresh }
}

function useHistoryData(refreshKey: string | undefined) {
  const [history, setHistory] = useState<DealHistoryPoint[]>([])

  useEffect(() => {
    const controller = new AbortController()
    fetchHistory(controller.signal)
      .then(setHistory)
      .catch(() => {
        if (!controller.signal.aborted) setHistory([])
      })

    return () => controller.abort()
  }, [refreshKey])

  return history
}

function App() {
  const [language, setLanguage] = useState<Language>(() =>
    readSetting('dealrift-language', navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en') as Language,
  )
  const [country, setCountry] = useState(() => readSetting('dealrift-country', 'US'))
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [minSavings, setMinSavings] = useState(() => Number(readSetting('dealrift-min-savings', '35')))
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [activeView, setActiveView] = useState<DashboardView>('deals')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [selectedStore, setSelectedStore] = useState('all')
  const [sortMode, setSortMode] = useState<SortMode>(() => readSetting('dealrift-sort-mode', 'value') as SortMode)
  const [pageSize, setPageSize] = useState(readPageSizeSetting)
  const [currentPage, setCurrentPage] = useState(1)
  const [compactMode, setCompactMode] = useState(() => readSetting('dealrift-compact-mode', 'false') === 'true')
  const [maxPrice, setMaxPrice] = useState(() => Number(readSetting('dealrift-max-price', '100')))
  const [minRating, setMinRating] = useState(() => Number(readSetting('dealrift-min-rating', '0')))
  const [onlyFree, setOnlyFree] = useState(() => readSetting('dealrift-only-free', 'false') === 'true')
  const [onlyRegional, setOnlyRegional] = useState(() => readSetting('dealrift-only-regional', 'false') === 'true')
  const [onlyWatched, setOnlyWatched] = useState(() => readSetting('dealrift-only-watched', 'false') === 'true')
  const [onlyEndingSoon, setOnlyEndingSoon] = useState(() => readSetting('dealrift-only-ending-soon', 'false') === 'true')
  const [onlyDeepDiscount, setOnlyDeepDiscount] = useState(() => readSetting('dealrift-only-deep-discount', 'false') === 'true')
  const [onlyLowRisk, setOnlyLowRisk] = useState(() => readSetting('dealrift-only-low-risk', 'false') === 'true')
  const [onlyExceptional, setOnlyExceptional] = useState(() => readSetting('dealrift-only-exceptional', 'false') === 'true')
  const [showHighRisk, setShowHighRisk] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [notificationReady, setNotificationReady] = useState(
    () => typeof Notification !== 'undefined' && Notification.permission === 'granted',
  )
  const [selectedScanId, setSelectedScanId] = useState('')
  const [manualScan, setManualScan] = useState<RegionalScan | null>(null)
  const [scanLoadingId, setScanLoadingId] = useState('')
  const [regionError, setRegionError] = useState('')
  const [watchlist, setWatchlist] = useState<string[]>(() => readJsonSetting<string[]>('dealrift-watchlist', []))
  const [alertSavings, setAlertSavings] = useState(() => Number(readSetting('dealrift-alert-savings', '80')))
  const [alertSignal, setAlertSignal] = useState(() => Number(readSetting('dealrift-alert-signal', '90')))
  const [alertFree, setAlertFree] = useState(() => readSetting('dealrift-alert-free', 'true') === 'true')
  const [now, setNow] = useState(Date.now)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const notifiedRef = useRef(readSetting('dealrift-last-notification', ''))
  const online = useOnlineStatus()

  const t = useCopy(language)
  const locale = language === 'es' ? 'es-ES' : 'en-US'

  const params = useMemo<RadarParams>(
    () => ({
      country,
      locale,
      limit: 120,
      minSavings,
      search: submittedQuery || undefined,
      regionSample: 5,
    }),
    [country, locale, minSavings, submittedQuery],
  )

  const { data, error, loading, refresh } = useRadarData(params, autoRefresh)
  const history = useHistoryData(data?.updatedAt)

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.matches('input, textarea, select, [contenteditable="true"]')
      if (event.key !== '/' || typing) return
      event.preventDefault()
      searchInputRef.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
    localStorage.setItem('dealrift-language', language)
    localStorage.setItem('dealrift-country', country)
    localStorage.setItem('dealrift-min-savings', String(minSavings))
    localStorage.setItem('dealrift-watchlist', JSON.stringify(watchlist))
    localStorage.setItem('dealrift-alert-savings', String(alertSavings))
    localStorage.setItem('dealrift-alert-signal', String(alertSignal))
    localStorage.setItem('dealrift-alert-free', String(alertFree))
    localStorage.setItem('dealrift-sort-mode', sortMode)
    localStorage.setItem('dealrift-page-size', String(pageSize))
    localStorage.setItem('dealrift-compact-mode', String(compactMode))
    localStorage.setItem('dealrift-max-price', String(maxPrice))
    localStorage.setItem('dealrift-min-rating', String(minRating))
    localStorage.setItem('dealrift-only-free', String(onlyFree))
    localStorage.setItem('dealrift-only-regional', String(onlyRegional))
    localStorage.setItem('dealrift-only-watched', String(onlyWatched))
    localStorage.setItem('dealrift-only-ending-soon', String(onlyEndingSoon))
    localStorage.setItem('dealrift-only-deep-discount', String(onlyDeepDiscount))
    localStorage.setItem('dealrift-only-low-risk', String(onlyLowRisk))
    localStorage.setItem('dealrift-only-exceptional', String(onlyExceptional))
  }, [
    alertFree,
    alertSavings,
    alertSignal,
    compactMode,
    country,
    language,
    maxPrice,
    minRating,
    onlyDeepDiscount,
    onlyEndingSoon,
    minSavings,
    onlyFree,
    onlyExceptional,
    onlyLowRisk,
    onlyRegional,
    onlyWatched,
    pageSize,
    sortMode,
    watchlist,
  ])

  useEffect(() => {
    if (!data?.regionalScans.length || selectedScanId) return
    setSelectedScanId(data.regionalScans[0].appId)
  }, [data, selectedScanId])

  const allScans = useMemo(() => {
    const scans = data?.regionalScans ?? []
    if (!manualScan) return scans
    const withoutDuplicate = scans.filter((scan) => scan.appId !== manualScan.appId)
    return [manualScan, ...withoutDuplicate]
  }, [data, manualScan])

  const selectedScan = useMemo(
    () => allScans.find((scan) => scan.appId === selectedScanId) ?? allScans[0],
    [allScans, selectedScanId],
  )

  const deals = useMemo(() => {
    const source = data?.deals ?? []
    const normalizedQuery = submittedQuery.trim().toLowerCase()
    const filtered = source.filter((deal) => {
      const searchOk =
        !normalizedQuery ||
        deal.title.toLowerCase().includes(normalizedQuery) ||
        deal.source.toLowerCase().includes(normalizedQuery) ||
        deal.platform.toLowerCase().includes(normalizedQuery) ||
        deal.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
      const sourceOk =
        sourceFilter === 'all' ||
        deal.sourceKind === sourceFilter ||
        (sourceFilter === 'regional' && Boolean(deal.bestRegion))
      const storeOk = selectedStore === 'all' || deal.source === selectedStore
      const riskOk = showHighRisk || deal.riskLevel !== 'high'
      const priceOk = maxPrice >= 100 || dealUsd(deal) <= maxPrice
      const ratingOk = minRating <= 0 || dealRating(deal) >= minRating
      const freeOk = !onlyFree || deal.isFree
      const regionalOk = !onlyRegional || Boolean(deal.bestRegion)
      const watchedOk = !onlyWatched || watchlist.includes(deal.title)
      const endingOk = !onlyEndingSoon || isEndingSoon(deal)
      const deepDiscountOk = !onlyDeepDiscount || deal.savingsPercent >= 80
      const lowRiskOk = !onlyLowRisk || deal.riskLevel === 'low'
      const exceptionalOk = !onlyExceptional || deal.intelligence?.verdict === 'exceptional'
      return searchOk && sourceOk && storeOk && riskOk && priceOk && ratingOk && freeOk && regionalOk && watchedOk && endingOk && deepDiscountOk && lowRiskOk && exceptionalOk
    })

    return [...filtered].sort((a, b) => {
      if (sortMode === 'price') return dealUsd(a) - dealUsd(b) || b.savingsPercent - a.savingsPercent || intelligenceScore(b) - intelligenceScore(a)
      if (sortMode === 'savings') return b.savingsPercent - a.savingsPercent || dealUsd(a) - dealUsd(b)
      if (sortMode === 'regional') return regionalStrength(b) - regionalStrength(a) || dealUsd(a) - dealUsd(b)
      if (sortMode === 'rating') return dealRating(b) - dealRating(a) || intelligenceScore(b) - intelligenceScore(a)
      if (sortMode === 'ending') return endingSoonScore(a) - endingSoonScore(b) || intelligenceScore(b) - intelligenceScore(a)
      if (sortMode === 'signal') return intelligenceScore(b) - intelligenceScore(a) || dealUsd(a) - dealUsd(b)
      return valueScore(b) - valueScore(a) || dealUsd(a) - dealUsd(b)
    })
  }, [data, maxPrice, minRating, onlyDeepDiscount, onlyEndingSoon, onlyExceptional, onlyFree, onlyLowRisk, onlyRegional, onlyWatched, selectedStore, showHighRisk, sortMode, sourceFilter, submittedQuery, watchlist])

  const storeOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const deal of data?.deals ?? []) {
      counts.set(deal.source, (counts.get(deal.source) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  const alternativesByGame = useMemo(() => {
    const groups = new Map<string, Deal[]>()
    for (const deal of data?.deals ?? []) {
      const key = frontendGameKey(deal)
      const group = groups.get(key) ?? []
      group.push(deal)
      groups.set(key, group)
    }
    for (const group of groups.values()) {
      group.sort((a, b) => dealUsd(a) - dealUsd(b) || intelligenceScore(b) - intelligenceScore(a))
    }
    return groups
  }, [data])

  const dealHighlights = useMemo(() => {
    const pool = deals
    const paid = pool.filter((deal) => !deal.isFree && dealUsd(deal) > 0)
    const endingSoon = pool.filter(isEndingSoon).sort((a, b) => endingSoonScore(a) - endingSoonScore(b))[0]

    const candidates = [
      [...pool].sort((a, b) => intelligenceScore(b) - intelligenceScore(a))[0],
      pool.find((deal) => deal.isFree),
      paid.sort((a, b) => dealUsd(a) - dealUsd(b))[0],
      [...pool].sort((a, b) => b.savingsPercent - a.savingsPercent)[0],
      endingSoon,
    ].filter((deal): deal is Deal => Boolean(deal))

    return candidates.filter((deal, index) => candidates.findIndex((item) => item.id === deal.id) === index).slice(0, 4)
  }, [deals])

  const activeFilterLabels = useMemo(
    () =>
      [
        sourceFilter !== 'all' ? sourceLabel(sourceFilter, t) : '',
        selectedStore !== 'all' ? selectedStore : '',
        submittedQuery ? `${t('search')}: ${submittedQuery}` : '',
        minSavings !== 35 ? `${t('minSavings')} ${minSavings}%` : '',
        sortMode !== 'value' ? `${t('sort')}: ${t(sortMode)}` : '',
        maxPrice < 100 ? `${t('maxPrice')} $${maxPrice}` : '',
        minRating > 0 ? `${t('minRating')} ${minRating}%` : '',
        onlyFree ? t('onlyFree') : '',
        onlyRegional ? t('onlyRegional') : '',
        onlyWatched ? t('onlyWatched') : '',
        onlyEndingSoon ? t('endingSoon') : '',
        onlyDeepDiscount ? t('deepDiscount') : '',
        onlyLowRisk ? t('lowRiskOnly') : '',
        onlyExceptional ? t('onlyExceptional') : '',
        showHighRisk ? t('highRisk') : '',
      ].filter(Boolean),
    [maxPrice, minRating, minSavings, onlyDeepDiscount, onlyEndingSoon, onlyExceptional, onlyFree, onlyLowRisk, onlyRegional, onlyWatched, selectedStore, showHighRisk, sortMode, sourceFilter, submittedQuery, t],
  )

  const filteredMetrics = useMemo(
    () => ({
      total: deals.length,
      free: deals.filter((deal) => deal.isFree).length,
      maxSavings: deals.reduce((highest, deal) => Math.max(highest, deal.savingsPercent), 0),
      regions: deals.filter((deal) => Boolean(deal.bestRegion)).length,
    }),
    [deals],
  )

  const totalPages = Math.max(1, Math.ceil(deals.length / pageSize))
  const pageStart = deals.length ? (currentPage - 1) * pageSize + 1 : 0
  const pageEnd = Math.min(deals.length, currentPage * pageSize)
  const pagedDeals = useMemo(
    () => deals.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, deals, pageSize],
  )

  useEffect(() => {
    setCurrentPage(1)
  }, [country, maxPrice, minRating, minSavings, onlyDeepDiscount, onlyEndingSoon, onlyExceptional, onlyFree, onlyLowRisk, onlyRegional, onlyWatched, pageSize, selectedStore, showHighRisk, sortMode, sourceFilter, submittedQuery])

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages))
  }, [totalPages])

  const storeChart = useMemo(() => {
    const groups = new Map<string, { store: string; savings: number; count: number }>()
    for (const deal of deals) {
      const current = groups.get(deal.source) ?? { store: deal.source, savings: 0, count: 0 }
      current.savings += deal.savingsPercent
      current.count += 1
      groups.set(deal.source, current)
    }
    return Array.from(groups.values())
      .map((item) => ({ store: item.store, savings: Math.round(item.savings / item.count), count: item.count }))
      .sort((a, b) => b.savings - a.savings)
      .slice(0, 8)
  }, [deals])

  const signalChart = useMemo(
    () =>
      deals.slice(0, 24).map((deal) => ({
        title: deal.title,
        savings: deal.savingsPercent,
        signal: intelligenceScore(deal),
        price: dealUsd(deal),
      })),
    [deals],
  )

  const historyChart = useMemo(
    () =>
      history.slice(-24).map((point) => ({
        time: formatTime(point.updatedAt),
        deals: point.totalDeals,
        free: point.freebies,
        regions: point.regionalOpportunities,
      })),
    [history],
  )

  const regionChart = useMemo(
    () =>
      (selectedScan?.rows ?? [])
        .filter((row) => row.available)
        .slice(0, 12)
        .map((row) => ({
          country: row.countryCode,
          usd: row.usd,
          delta: row.relativeToBaselinePercent,
          label: row.countryName,
        })),
    [selectedScan],
  )

  const watchedDeals = useMemo(() => {
    if (!watchlist.length) return []
    const watched = new Set(watchlist)
    return (data?.deals ?? []).filter((deal) => watched.has(deal.title))
  }, [data, watchlist])

  const alertMatches = useMemo(
    () =>
      (data?.deals ?? [])
        .filter((deal) => {
          const watched = watchlist.includes(deal.title)
          const matchesRule = watched || intelligenceScore(deal) >= alertSignal || deal.savingsPercent >= alertSavings || (alertFree && deal.isFree)
          return deal.riskLevel !== 'high' && matchesRule
        })
        .sort((a, b) => Number(watchlist.includes(b.title)) - Number(watchlist.includes(a.title)) || intelligenceScore(b) - intelligenceScore(a))
        .slice(0, 8),
    [alertFree, alertSavings, alertSignal, data, watchlist],
  )

  useEffect(() => {
    if (!notificationReady || typeof Notification === 'undefined' || !data?.deals.length) return
    const hotDeal = alertMatches[0]
    if (!hotDeal || notifiedRef.current === hotDeal.id) return
    notifiedRef.current = hotDeal.id
    localStorage.setItem('dealrift-last-notification', hotDeal.id)
    const notification = new Notification('DealRift', {
      body: `${hotDeal.title} - ${hotDeal.isFree ? t('freePrice') : hotDeal.salePrice.formatted} - ${hotDeal.source}`,
      tag: hotDeal.id,
    })
    notification.onclick = () => {
      window.open(hotDeal.url, '_blank', 'noopener,noreferrer')
      notification.close()
    }
  }, [alertMatches, data, notificationReady, t])

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return
    const permission = await Notification.requestPermission()
    setNotificationReady(permission === 'granted')
  }

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmittedQuery(query.trim())
  }

  const clearSearch = () => {
    setQuery('')
    setSubmittedQuery('')
    searchInputRef.current?.focus()
  }

  const scanDealRegions = async (deal: Deal) => {
    if (!deal.steamAppId || deal.isFree) return
    setActiveView('regions')
    setScanLoadingId(deal.id)
    setRegionError('')
    try {
      const scan = await fetchRegionalScan(deal.steamAppId, deal.title, country)
      setManualScan(scan)
      setSelectedScanId(scan.appId)
    } catch (scanError) {
      setRegionError(scanError instanceof Error ? scanError.message : t('regionScanFailed'))
    } finally {
      setScanLoadingId('')
    }
  }

  const toggleWatch = (deal: Deal) => {
    setWatchlist((current) =>
      current.includes(deal.title) ? current.filter((title) => title !== deal.title) : [deal.title, ...current].slice(0, 20),
    )
  }

  const resetOfferFilters = () => {
    setQuery('')
    setSubmittedQuery('')
    setMinSavings(35)
    setSourceFilter('all')
    setSelectedStore('all')
    setSortMode('value')
    setMaxPrice(100)
    setMinRating(0)
    setOnlyFree(false)
    setOnlyRegional(false)
    setOnlyWatched(false)
    setOnlyEndingSoon(false)
    setOnlyDeepDiscount(false)
    setOnlyLowRisk(false)
    setOnlyExceptional(false)
    setShowHighRisk(false)
    setCompactMode(false)
    setShowAdvancedFilters(false)
    setCurrentPage(1)
  }

  const dataIsStale = Boolean(
    data && now - new Date(data.updatedAt).getTime() > Math.max(60, data.refreshSeconds * 2) * 1000,
  )
  const connectionTone = !online ? 'offline' : error || dataIsStale ? 'stale' : 'live'
  const connectionLabel = !online ? t('offline') : error || dataIsStale ? t('dataStale') : t('online')

  const pulse = data?.metrics.totalDeals ?? 20
  const dashboardTabs = [
    { id: 'deals', icon: <Zap size={18} />, label: t('viewDeals'), meta: `${deals.length}` },
    { id: 'regions', icon: <MapPin size={18} />, label: t('viewRegions'), meta: String(allScans.length) },
    { id: 'alerts', icon: <BellRing size={18} />, label: t('viewAlerts'), meta: String(alertMatches.length) },
    { id: 'analytics', icon: <BarChart3 size={18} />, label: t('viewAnalytics'), meta: String(history.length) },
    { id: 'sources', icon: <ShieldCheck size={18} />, label: t('viewSources'), meta: String(data?.sourceStatus.length ?? 0) },
  ] satisfies Array<{ id: DashboardView; icon: React.ReactNode; label: string; meta: string }>

  return (
    <main className="app-shell">
      <RadarCanvas pulse={pulse} />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Radar size={25} />
          </div>
          <div>
            <h1>{t('appName')}</h1>
            <p>{t('appSubtitle')}</p>
          </div>
        </div>

        <div className="top-actions">
          <div className={`connection-pill ${connectionTone}`} title={data ? `${t('updated')} ${formatTime(data.updatedAt)}` : connectionLabel}>
            {online ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span>
              <strong>{connectionLabel}</strong>
              {data ? <small>{formatRelativeTime(data.updatedAt, language, now)}</small> : null}
            </span>
          </div>
          <button type="button" className="icon-text" onClick={refresh} title={t('refresh')}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
            <span>{t('refresh')}</span>
          </button>
          <button type="button" className={`icon-text ${autoRefresh ? 'is-on' : ''}`} onClick={() => setAutoRefresh((value) => !value)}>
            <Clock3 size={18} />
            <span>{t('autoRefresh')}</span>
          </button>
          <button type="button" className={`icon-text ${notificationReady ? 'is-on' : ''}`} onClick={enableNotifications}>
            {notificationReady ? <BellRing size={18} /> : <Bell size={18} />}
            <span>{notificationReady ? t('notificationsOn') : t('notifications')}</span>
          </button>
          <button type="button" className="icon-button" onClick={() => setLanguage(language === 'es' ? 'en' : 'es')} title={t('language')}>
            <Languages size={20} />
          </button>
        </div>
      </header>

      <section className="control-band">
        <form className="search-box" onSubmit={submitSearch}>
          <Search size={18} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && (query || submittedQuery)) clearSearch()
            }}
            placeholder={t('searchPlaceholder')}
          />
          {query || submittedQuery ? (
            <button type="button" className="clear-search" onClick={clearSearch} title={t('clearSearch')} aria-label={t('clearSearch')}>
              <X size={16} />
            </button>
          ) : null}
          <button type="submit">{t('scan')}</button>
        </form>

        <label className="field">
          <Globe2 size={16} />
          <span>{t('country')}</span>
          <select value={country} onChange={(event) => setCountry(event.target.value)}>
            {countries.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} - {item[language]}
              </option>
            ))}
          </select>
        </label>

        <label className="field savings-field">
          <SlidersHorizontal size={16} />
          <span>{t('minSavings')}: {minSavings}%</span>
          <input type="range" min="0" max="95" step="5" value={minSavings} onChange={(event) => setMinSavings(Number(event.target.value))} />
        </label>
      </section>

      <section className="metric-grid">
        <Metric icon={<Gamepad2 size={22} />} label={t('totalDeals')} value={String(filteredMetrics.total)} />
        <Metric icon={<Gift size={22} />} label={t('freeGames')} value={String(filteredMetrics.free)} tone="green" />
        <Metric icon={<TrendingDown size={22} />} label={t('maxSavings')} value={formatPercent(filteredMetrics.maxSavings)} tone="pink" />
        <Metric icon={<MapPin size={22} />} label={t('regionFinds')} value={String(filteredMetrics.regions)} tone="amber" />
      </section>

      <nav className="view-tabs" aria-label={t('sections')}>
        {dashboardTabs.map((view) => (
          <button
            key={view.id}
            type="button"
            className={activeView === view.id ? 'active' : ''}
            onClick={() => setActiveView(view.id)}
          >
            <span className="view-tab-icon">{view.icon}</span>
            <span>
              <strong>{view.label}</strong>
              <small>{view.meta}</small>
            </span>
          </button>
        ))}
      </nav>

      {error ? (
        <div className="error-line">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button type="button" onClick={refresh}><RefreshCw size={15} />{t('retry')}</button>
        </div>
      ) : null}

      {activeView === 'deals' ? (
        <section className={`view-panel deals-view ${compactMode ? 'compact-mode' : ''}`}>
          <div className="deal-toolbar">
            <section className="filter-strip">
              <div className="segmented" aria-label={t('source')}>
                {sourceFilters.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={sourceFilter === filter ? 'active' : ''}
                    onClick={() => setSourceFilter(filter)}
                  >
                    {filter === 'all' ? t('all') : filter === 'freebie' ? t('freebies') : filter === 'marketplace' ? t('marketplaces') : t(filter)}
                  </button>
                ))}
              </div>

              <div className="filter-actions">
                <label className="compact-select">
                  <Store size={16} />
                  <select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}>
                    <option value="all">{t('store')}: {t('all')}</option>
                    {storeOptions.map((store) => (
                      <option key={store.name} value={store.name}>
                        {store.name} ({store.count})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="compact-select">
                  <BarChart3 size={16} />
                  <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                    {sortModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {t('sort')}: {t(mode)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="filter-count">
                  <span>{t('showing')}</span>
                  <strong>{pageStart}-{pageEnd}</strong>
                  <span>{t('of')} {deals.length}</span>
                </div>

                <button type="button" className={`filter-toggle ${showAdvancedFilters ? 'active' : ''}`} onClick={() => setShowAdvancedFilters((value) => !value)}>
                  <SlidersHorizontal size={16} />
                  <span>{showAdvancedFilters ? t('hideFilters') : t('moreFilters')}</span>
                </button>

                <button type="button" className={`filter-toggle ${compactMode ? 'active' : ''}`} onClick={() => setCompactMode((value) => !value)}>
                  <Gamepad2 size={16} />
                  <span>{t('compactMode')}</span>
                </button>

                <button type="button" className="filter-toggle" onClick={() => downloadDealsCsv(deals)} disabled={!deals.length} title={t('exportCsv')}>
                  <Download size={16} />
                  <span>{t('exportCsv')}</span>
                </button>

                <button type="button" className="reset-filters" onClick={resetOfferFilters}>
                  {t('reset')}
                </button>
              </div>
            </section>

            {activeFilterLabels.length ? (
              <div className="active-filters">
                {activeFilterLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            ) : null}

            <section className="pagination-bar">
              <label className="compact-select page-size-select">
                <span>{t('perPage')}</span>
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  {pageSizeOptions.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>

              <div className="page-controls">
                <button type="button" onClick={() => setCurrentPage(1)} disabled={currentPage <= 1} title={t('firstPage')}>
                  1
                </button>
                <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage <= 1} title={t('previous')}>
                  <ChevronLeft size={17} />
                </button>
                <span>{t('page')} {currentPage} / {totalPages}</span>
                <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage >= totalPages} title={t('next')}>
                  <ChevronRight size={17} />
                </button>
                <button type="button" onClick={() => setCurrentPage(totalPages)} disabled={currentPage >= totalPages} title={t('lastPage')}>
                  {totalPages}
                </button>
              </div>
            </section>

            {dealHighlights.length ? <DealHighlights deals={dealHighlights} t={t} /> : null}

            {showAdvancedFilters ? (
              <section className="advanced-filters">
                <label className="range-chip">
                  <span>{t('maxPrice')}: {maxPrice >= 100 ? t('anyPrice') : `$${maxPrice}`}</span>
                  <input type="range" min="0" max="100" step="5" value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))} />
                </label>

                <label className="range-chip">
                  <span>{t('minRating')}: {minRating <= 0 ? t('all') : `${minRating}%`}</span>
                  <input type="range" min="0" max="95" step="5" value={minRating} onChange={(event) => setMinRating(Number(event.target.value))} />
                </label>

                <label className={`quick-toggle ${onlyFree ? 'active' : ''}`}>
                  <input type="checkbox" checked={onlyFree} onChange={(event) => setOnlyFree(event.target.checked)} />
                  <span>{t('onlyFree')}</span>
                </label>

                <label className={`quick-toggle ${onlyRegional ? 'active' : ''}`}>
                  <input type="checkbox" checked={onlyRegional} onChange={(event) => setOnlyRegional(event.target.checked)} />
                  <span>{t('onlyRegional')}</span>
                </label>

                <label className={`quick-toggle ${onlyWatched ? 'active' : ''}`}>
                  <input type="checkbox" checked={onlyWatched} onChange={(event) => setOnlyWatched(event.target.checked)} />
                  <span>{t('onlyWatched')}</span>
                </label>

                <label className={`quick-toggle ${onlyEndingSoon ? 'active' : ''}`}>
                  <input type="checkbox" checked={onlyEndingSoon} onChange={(event) => setOnlyEndingSoon(event.target.checked)} />
                  <span>{t('endingSoon')}</span>
                </label>

                <label className={`quick-toggle ${onlyDeepDiscount ? 'active' : ''}`}>
                  <input type="checkbox" checked={onlyDeepDiscount} onChange={(event) => setOnlyDeepDiscount(event.target.checked)} />
                  <span>{t('deepDiscount')}</span>
                </label>

                <label className={`quick-toggle ${onlyLowRisk ? 'active' : ''}`}>
                  <input type="checkbox" checked={onlyLowRisk} onChange={(event) => setOnlyLowRisk(event.target.checked)} />
                  <span>{t('lowRiskOnly')}</span>
                </label>

                <label className={`quick-toggle ${onlyExceptional ? 'active' : ''}`}>
                  <input type="checkbox" checked={onlyExceptional} onChange={(event) => setOnlyExceptional(event.target.checked)} />
                  <span>{t('onlyExceptional')}</span>
                </label>

                <label className="toggle">
                  <input type="checkbox" checked={showHighRisk} onChange={(event) => setShowHighRisk(event.target.checked)} />
                  <span>{t('highRisk')}</span>
                </label>
              </section>
            ) : null}
          </div>

          <div className="deal-column">
            <SectionTitle icon={<Zap size={19} />} label={t('dealFeed')} meta={data ? `${t('updated')} ${formatTime(data.updatedAt)}` : t('loading')} />
            <div className="deal-list">
              {loading && !data ? (
                Array.from({ length: 4 }, (_, index) => <DealSkeleton key={`skeleton-${index}`} />)
              ) : pagedDeals.length ? (
                pagedDeals.map((deal, index) => (
                  <DealRow
                    key={deal.id}
                    deal={deal}
                    index={(currentPage - 1) * pageSize + index}
                    isWatched={watchlist.includes(deal.title)}
                    isScanning={scanLoadingId === deal.id}
                    alternatives={(alternativesByGame.get(frontendGameKey(deal)) ?? []).filter((alternative) => alternative.id !== deal.id).slice(0, 3)}
                    onRegionScan={scanDealRegions}
                    onToggleWatch={toggleWatch}
                    t={t}
                  />
                ))
              ) : (
                <div className="empty-state">
                  <Search size={22} />
                  <span>{loading ? t('loading') : t('noDeals')}</span>
                  {!loading ? <button type="button" onClick={resetOfferFilters}>{t('clearFilters')}</button> : null}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {activeView === 'regions' ? (
        <section className="view-panel region-layout">
          {regionError ? (
            <div className="error-line"><AlertTriangle size={18} /><span>{regionError}</span></div>
          ) : null}
          <section className="tool-panel regional-focus">
            <SectionTitle icon={<MapPin size={18} />} label={t('regionIntel')} meta={selectedScan?.title ?? t('loading')} />
            <div className="regional-grid">
              <div className="regional-controls">
                <label className="wide-select">
                  <span>{t('selectGame')}</span>
                  <select value={selectedScan?.appId ?? ''} onChange={(event) => setSelectedScanId(event.target.value)}>
                    {allScans.map((scan) => (
                      <option key={scan.appId} value={scan.appId}>
                        {scan.title}
                      </option>
                    ))}
                  </select>
                </label>
                <RegionalSummary scan={selectedScan} t={t} />
                <RegionalTable scan={selectedScan} t={t} />
                <p className="fine-print">{t('regionalNote')}</p>
              </div>
              <div className="chart-shell region-chart">
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={regionChart} margin={{ top: 16, right: 18, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
                    <XAxis dataKey="country" stroke="#91a1aa" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#91a1aa" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(18,247,214,.08)' }} />
                    <Bar dataKey="usd" radius={[4, 4, 0, 0]}>
                      {regionChart.map((entry) => (
                        <Cell key={entry.country} fill={entry.delta < -20 ? '#61e294' : entry.delta < 0 ? '#12f7d6' : '#ff3d6e'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        </section>
      ) : null}

      {activeView === 'alerts' ? (
        <section className="view-panel alert-layout">
          <section className="tool-panel">
            <SectionTitle icon={<BellRing size={18} />} label={t('alertCenter')} meta={`${alertMatches.length} ${t('hotNow')}`} />
            <div className="alert-controls">
              <label>
                <span>{t('alertSavings')}: {alertSavings}%</span>
                <input type="range" min="40" max="100" step="5" value={alertSavings} onChange={(event) => setAlertSavings(Number(event.target.value))} />
              </label>
              <label>
                <span>{t('alertSignal')}: {alertSignal}</span>
                <input type="range" min="50" max="100" step="5" value={alertSignal} onChange={(event) => setAlertSignal(Number(event.target.value))} />
              </label>
              <label className="toggle inline-toggle">
                <input type="checkbox" checked={alertFree} onChange={(event) => setAlertFree(event.target.checked)} />
                <span>{t('alertFree')}</span>
              </label>
            </div>
            <AlertList deals={alertMatches} watchedDeals={watchedDeals} onToggleWatch={toggleWatch} t={t} />
          </section>

          <section className="tool-panel">
            <SectionTitle icon={<Eye size={18} />} label={t('watchlist')} meta={String(watchedDeals.length)} />
            <AlertList deals={[]} watchedDeals={watchedDeals} onToggleWatch={toggleWatch} t={t} />
          </section>
        </section>
      ) : null}

      {activeView === 'analytics' ? (
        <section className="view-panel analytics-grid">
          <section className="tool-panel analytics-wide">
            <SectionTitle icon={<BarChart3 size={18} />} label={t('comparison')} meta={t('savings')} />
            <div className="chart-shell analytics-chart">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={storeChart} layout="vertical" margin={{ top: 6, right: 24, left: 2, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.08)" horizontal={false} />
                  <XAxis type="number" stroke="#91a1aa" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="store" width={110} stroke="#91a1aa" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="savings" fill="#ffc857" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="tool-panel">
            <SectionTitle icon={<TrendingDown size={18} />} label={t('signal')} meta={t('savings')} />
            <div className="chart-shell analytics-chart">
              <ResponsiveContainer width="100%" height={250}>
                <ScatterChart margin={{ top: 10, right: 12, bottom: 8, left: -18 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.07)" />
                  <XAxis type="number" dataKey="savings" name={t('savings')} stroke="#91a1aa" fontSize={10} />
                  <YAxis type="number" dataKey="signal" name={t('signal')} stroke="#91a1aa" fontSize={10} />
                  <Tooltip content={<ChartTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                  <Scatter data={signalChart} fill="#ff3d6e" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="tool-panel">
            <SectionTitle icon={<Clock3 size={18} />} label={t('timeline')} meta={`${history.length} ${t('history')}`} />
            <div className="chart-shell analytics-chart">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={historyChart} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.07)" />
                  <XAxis dataKey="time" stroke="#91a1aa" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#91a1aa" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="deals" stroke="#12f7d6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="free" stroke="#61e294" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="regions" stroke="#ffc857" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </section>
      ) : null}

      {activeView === 'sources' ? (
        <section className="view-panel sources-layout">
          <section className="tool-panel">
            <SectionTitle icon={<ShieldCheck size={18} />} label={t('marketScouts')} meta={t('marketplaces')} />
            <div className="scout-list">
              {(data?.marketScouts ?? []).slice(0, 16).map((scout) => (
                <a className="scout-link" key={scout.id} href={scout.url} target="_blank" rel="noreferrer">
                  <span>
                    <strong>{scout.marketplace}</strong>
                    <small>{scout.title}</small>
                  </span>
                  <ExternalLink size={16} />
                </a>
              ))}
            </div>
            <p className="fine-print">{t('marketplaceNote')}</p>
          </section>

          <section className="status-grid">
            <SectionTitle icon={<Radar size={18} />} label={t('sourceHealth')} meta={data?.country ?? country} />
            {(data?.sourceStatus ?? []).map((item) => (
              <div className="status-row" key={item.name}>
                <span className={item.ok ? 'status-dot ok' : 'status-dot fail'} />
                <span className="status-copy">
                  <strong>{item.name}</strong>
                  <small>{item.message} {formatRelativeTime(item.updatedAt, language, now)}</small>
                </span>
                <em>{item.ok ? t('active') : t('failed')}</em>
              </div>
            ))}
          </section>
        </section>
      ) : null}
    </main>
  )
}

interface MetricProps {
  icon: React.ReactNode
  label: string
  value: string
  tone?: 'green' | 'pink' | 'amber'
}

interface DealHighlightsProps {
  deals: Deal[]
  t: ReturnType<typeof useCopy>
}

function DealHighlights({ deals, t }: DealHighlightsProps) {
  return (
    <div className="deal-highlights">
      {deals.map((deal) => (
        <a key={`highlight-${deal.id}`} href={deal.url} target="_blank" rel="noreferrer">
          <span>{deal.intelligence?.verdict === 'exceptional' ? t('verdictExceptional') : deal.isFree ? t('freebies') : deal.savingsPercent >= 90 ? t('maxSavings') : isEndingSoon(deal) ? t('endingSoon') : t('price')}</span>
          <strong>{deal.title}</strong>
          <small>{deal.source} - {deal.isFree ? t('freePrice') : deal.salePrice.formatted}</small>
        </a>
      ))}
    </div>
  )
}

function DealSkeleton() {
  return (
    <div className="deal-row deal-skeleton" aria-hidden="true">
      <div className="skeleton-cover" />
      <div className="skeleton-lines">
        <span />
        <span />
        <span />
      </div>
      <div className="skeleton-actions"><span /><span /></div>
    </div>
  )
}

function Metric({ icon, label, value, tone }: MetricProps) {
  return (
    <motion.div className={`metric ${tone ?? ''}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </motion.div>
  )
}

interface SectionTitleProps {
  icon: React.ReactNode
  label: string
  meta?: string
}

function SectionTitle({ icon, label, meta }: SectionTitleProps) {
  return (
    <div className="section-title">
      <div>
        {icon}
        <h2>{label}</h2>
      </div>
      {meta ? <span>{meta}</span> : null}
    </div>
  )
}

interface IntelligencePanelProps {
  deal: Deal
  alternatives: Deal[]
  t: ReturnType<typeof useCopy>
}

function IntelligencePanel({ deal, alternatives, t }: IntelligencePanelProps) {
  const intelligence = deal.intelligence
  if (!intelligence) return null

  return (
    <section className={`intelligence-panel ${intelligence.verdict}`}>
      <div className="intelligence-head">
        <BrainCircuit size={18} />
        <div>
          <span>{t('dealIntelligence')}</span>
          <strong>{verdictLabel(intelligence.verdict, t)}</strong>
        </div>
        <div className="intelligence-score">
          <strong>{intelligence.score}</strong>
          <small>/100</small>
        </div>
      </div>

      <div className="intelligence-meter" aria-label={`${t('intelligenceScore')} ${intelligence.score}`}>
        <span style={{ width: `${intelligence.score}%` }} />
      </div>

      <div className="intelligence-stats">
        <div>
          <span>{t('observedLow')}</span>
          <strong>{intelligence.history.reliable && intelligence.history.paidLowUsd !== undefined ? formatUsd(intelligence.history.paidLowUsd) : t('collectingHistory')}</strong>
          <small>{intelligence.history.sampleCount} {t('observations')}</small>
        </div>
        <div>
          <span>{t('marketPosition')}</span>
          <strong>#{intelligence.market.rank} / {intelligence.market.offerCount}</strong>
          <small>{intelligence.market.storeCount} {t('storesCompared')}</small>
        </div>
        <div>
          <span>{t('confidence')}</span>
          <strong>{intelligence.confidenceScore}%</strong>
          <small>{intelligence.history.wasEverFree ? t('wasFreeBefore') : intelligence.flags.searchDestination ? t('storeSearch') : t('directLink')}</small>
        </div>
      </div>

      <div className="intelligence-explanation">
        <div className="mini-title">{t('whyThisScore')}</div>
        <ul>
          {intelligence.reasons.map((reason) => (
            <li key={reason.code}>
              <span>{intelligenceReasonLabel(reason.code, t)}{reason.evidence ? <small>{reason.evidence}</small> : null}</span>
              <em className={reason.impact < 0 ? 'negative' : reason.impact > 0 ? 'positive' : 'neutral'}>
                {reason.impact > 0 ? '+' : ''}{reason.impact}
              </em>
            </li>
          ))}
        </ul>
      </div>

      {alternatives.length ? (
        <div className="intelligence-alternatives">
          <div className="mini-title"><GitCompareArrows size={14} />{t('otherStores')}</div>
          {alternatives.map((alternative) => (
            <a key={alternative.id} href={alternative.url} target="_blank" rel="noreferrer">
              <span>{alternative.source}</span>
              <strong>{alternative.isFree ? t('freePrice') : alternative.salePrice.formatted}</strong>
              <small>{verdictLabel(alternative.intelligence?.verdict ?? 'fair', t)}</small>
              <ExternalLink size={13} />
            </a>
          ))}
        </div>
      ) : null}
    </section>
  )
}

interface DealRowProps {
  deal: Deal
  index: number
  isWatched: boolean
  isScanning: boolean
  alternatives: Deal[]
  onRegionScan: (deal: Deal) => void
  onToggleWatch: (deal: Deal) => void
  t: ReturnType<typeof useCopy>
}

function DealRow({ deal, index, isWatched, isScanning, alternatives, onRegionScan, onToggleWatch, t }: DealRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const hasRegion = !deal.isFree && Boolean(deal.bestRegion && deal.bestRegion.usd < dealUsd(deal) * 0.98)
  const nextDate = deal.expiresAt ?? deal.startsAt
  const timeLeft = formatTimeLeft(nextDate)
  const normalizedUsd = deal.salePrice.usd
  const showUsd = !deal.isFree && deal.salePrice.currency !== 'USD' && typeof normalizedUsd === 'number'
  const priceNow = deal.isFree ? t('freePrice') : deal.salePrice.formatted
  const directLink = !deal.tags.includes('store-search-link') && deal.confidence !== 'search-link'

  const copyLink = async () => {
    if (await copyText(deal.url)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } else {
      setCopied(false)
    }
  }

  return (
    <motion.article
      className={`deal-row ${expanded ? 'expanded' : ''}`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.3) }}
    >
      <div className="cover-wrap">
        {deal.image ? <img src={deal.image} alt="" loading="lazy" /> : <div className="cover-fallback"><Gamepad2 size={28} /></div>}
        <span className={`score-badge ${deal.intelligence?.verdict ?? ''}`} title={t('intelligenceScore')}>{intelligenceScore(deal)}</span>
      </div>

      <div className="deal-body">
        <div className="deal-heading">
          <div>
            <h3>{deal.title}</h3>
            <p>{deal.source} - {deal.platform}</p>
          </div>
          <div className="deal-status">
            {deal.intelligence ? <span className={`verdict ${deal.intelligence.verdict}`}>{verdictLabel(deal.intelligence.verdict, t)}</span> : null}
            <span className={`risk ${deal.riskLevel}`}>{riskLabel(deal.riskLevel, t)}</span>
          </div>
        </div>

        <div className="deal-meta">
          <span className="price-now">{priceNow}</span>
          {deal.normalPrice && !deal.isFree ? <span className="price-before">{deal.normalPrice.formatted}</span> : null}
          <span className="save-pill">{formatPercent(deal.savingsPercent)}</span>
          {deal.isFree ? <span className="free-pill">{deal.startsAt && new Date(deal.startsAt) > new Date() ? t('upcoming') : t('claimNow')}</span> : null}
          {deal.savingsPercent >= 80 && !deal.isFree ? <span className="hot-pill">{t('deepDiscount')}</span> : null}
          {isEndingSoon(deal) ? <span className="time-left">{t('endingSoon')}</span> : null}
          {timeLeft ? <span className="time-left"><Clock3 size={13} />{t('timeLeft')} {timeLeft}</span> : null}
          {showUsd ? <span className="usd-normalized">~${normalizedUsd.toFixed(2)} {t('usdApprox')}</span> : null}
          {deal.steamRatingPercent ? <span>{deal.steamRatingPercent}% Steam</span> : null}
        </div>

        {hasRegion ? (
          <div className="region-callout">
            <MapPin size={15} />
            <strong>{t('bestRegion')}: {deal.bestRegion?.countryName}</strong>
            <span>{deal.bestRegion?.finalFormatted}</span>
            <small>{deal.bestRegion ? `${Math.abs(deal.bestRegion.relativeToBaselinePercent).toFixed(1)}% ${t('discountVsBase')}` : ''}</small>
          </div>
        ) : null}

        {expanded ? (
          <motion.div className="deal-details" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
            <IntelligencePanel deal={deal} alternatives={alternatives} t={t} />
            <div className="deal-detail-head">
              <span><ExternalLink size={13} />{directLink ? t('directLink') : t('storeSearch')} - {linkHost(deal.url)}</span>
              <span>{t('detectedAt')}: {formatTime(deal.detectedAt)}</span>
              {nextDate ? <span>{t('expiresAt')}: {formatTime(nextDate)}</span> : null}
            </div>
            <div className="tag-line">
              {deal.tags.slice(0, 5).map((tag) => (
                <span key={tag}>{tag.replaceAll('-', ' ')}</span>
              ))}
              <span>{confidenceLabel(deal.confidence, t)}</span>
            </div>
            {deal.notes.length ? (
              <ul className="deal-notes">
                {deal.notes.slice(0, 2).map((note) => <li key={note}>{note}</li>)}
              </ul>
            ) : null}
          </motion.div>
        ) : null}
      </div>

      <div className="deal-actions">
        <a className="primary-link" href={deal.url} target="_blank" rel="noreferrer">
          <ExternalLink size={17} />
          <span>{t('openDeal')}</span>
        </a>
        {deal.steamAppId && !deal.isFree ? (
          <button type="button" className="ghost-link" onClick={() => onRegionScan(deal)} disabled={isScanning}>
            <Globe2 size={16} className={isScanning ? 'spin' : ''} />
            <span>{isScanning ? t('scanningRegions') : t('regional')}</span>
          </button>
        ) : null}
        <button type="button" className={`ghost-link ${isWatched ? 'watching' : ''}`} onClick={() => onToggleWatch(deal)}>
          {isWatched ? <EyeOff size={16} /> : <Eye size={16} />}
          <span>{isWatched ? t('watching') : t('watch')}</span>
        </button>
        <div className="deal-action-icons">
          <button type="button" className={`ghost-link icon-action ${copied ? 'copied' : ''}`} onClick={copyLink} title={copied ? t('copiedLink') : t('copyLink')} aria-label={copied ? t('copiedLink') : t('copyLink')}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button type="button" className={`ghost-link icon-action ${expanded ? 'active' : ''}`} onClick={() => setExpanded((value) => !value)} title={expanded ? t('hideDetails') : t('details')} aria-label={expanded ? t('hideDetails') : t('details')}>
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </div>
    </motion.article>
  )
}

interface RegionalSummaryProps {
  scan?: RegionalScan
  t: ReturnType<typeof useCopy>
}

function RegionalSummary({ scan, t }: RegionalSummaryProps) {
  if (!scan?.best) {
    return <div className="regional-summary muted">{t('loading')}</div>
  }

  return (
    <div className="regional-summary">
      <span>{t('bestRegion')}</span>
      <strong>{scan.best.countryName}</strong>
      <small>{scan.best.finalFormatted} / ${scan.best.usd.toFixed(2)} USD</small>
      <em>{scan.best.relativeToBaselinePercent.toFixed(1)}% {t('discountVsBase')}</em>
    </div>
  )
}

function RegionalTable({ scan, t }: RegionalSummaryProps) {
  const rows = (scan?.rows ?? []).filter((row) => row.available).slice(0, 7)
  if (!rows.length) return null

  return (
    <div className="regional-table">
      <div className="mini-title">{t('regionalTable')}</div>
      {rows.map((row) => (
        <a key={`${row.countryCode}-${row.currency}`} href={row.storeUrl} target="_blank" rel="noreferrer">
          <span>{row.countryName}</span>
          <strong>{row.finalFormatted}</strong>
          <small>{row.relativeToBaselinePercent.toFixed(1)}%</small>
        </a>
      ))}
    </div>
  )
}

interface AlertListProps {
  deals: Deal[]
  watchedDeals: Deal[]
  onToggleWatch: (deal: Deal) => void
  t: ReturnType<typeof useCopy>
}

function AlertList({ deals, watchedDeals, onToggleWatch, t }: AlertListProps) {
  const visible = deals.length ? deals : watchedDeals
  const watchedTitles = new Set(watchedDeals.map((deal) => deal.title))

  return (
    <div className="alert-list">
      <div className="mini-title">{deals.length ? t('hotNow') : t('watchlist')}</div>
      {visible.length ? (
        visible.slice(0, 6).map((deal) => {
          const isWatched = watchedTitles.has(deal.title)
          return (
            <div className="alert-row" key={`alert-${deal.id}`}>
              <span>
                <strong>{deal.title}</strong>
                <small>{deal.source} - {deal.isFree ? t('freePrice') : deal.salePrice.formatted}</small>
              </span>
              <a href={deal.url} target="_blank" rel="noreferrer" title={t('openDeal')}>
                <ExternalLink size={15} />
              </a>
              <button type="button" onClick={() => onToggleWatch(deal)} title={isWatched ? t('clearWatch') : t('watch')}>
                {isWatched ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          )
        })
      ) : (
        <div className="alert-empty">{t('noDeals')}</div>
      )}
    </div>
  )
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name?: string; value?: number | string; payload?: Record<string, unknown> }> }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload ?? {}
  return (
    <div className="chart-tooltip">
      <strong>{String(row.title ?? row.label ?? row.store ?? row.country ?? '')}</strong>
      {payload.map((item) => (
        <span key={`${item.name}-${item.value}`}>{item.name}: {String(item.value)}</span>
      ))}
    </div>
  )
}

export default App
