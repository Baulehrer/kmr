import type { RadioConfig } from "./types"

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const config: RadioConfig = {
  libraryPath: process.env.KMR_LIBRARY_PATH || "./artists",
  maRateLimit: envInt("KMR_MA_RATE_LIMIT_MS", 1000),
  maGraphExpansionBudget: envInt("KMR_MA_GRAPH_EXPANSION_BUDGET", 2),
  anchorMixWindow: envInt("KMR_ANCHOR_MIX_WINDOW", 20),
  ytResolveCandidates: envInt("KMR_YT_RESOLVE_CANDIDATES", 3),
  queueSize: envInt("KMR_QUEUE_SIZE", 10),
  prefetchThreshold: envInt("KMR_PREFETCH_THRESHOLD", 5),
  repeatProtection: envInt("KMR_REPEAT_PROTECTION", 50),
  similarWeight: 0.7,
  defaultGenre: "Heavy",
  server: {
    port: envInt("KMR_PORT", envInt("PORT", 3000)),
  },
}

export default config
