import type { RadioConfig } from "./types"

const config: RadioConfig = {
  libraryPath: "./artists",
  maRateLimit: 1000,
  queueSize: 10,
  prefetchThreshold: 5,
  repeatProtection: 50,
  similarWeight: 0.7,
  defaultGenre: "Heavy Metal",
  defaultCountry: "",
  server: {
    port: 3000,
  },
}

export default config
