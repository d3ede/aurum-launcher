import { bindings, defineConfig } from "cf/config";

export const apiBindings = {
  CURSEFORGE_ENABLED: bindings.text(process.env.AURUM_CURSEFORGE_ENABLED === "true" ? "true" : "false"),
  CURSEFORGE_API_KEY: bindings.secret(),
  RATE_LIMITER: bindings.rateLimit({ namespace: "73101", simple: { limit: 120, period: 60 } }),
};

export default defineConfig(({ mode }) => ({
  worker: {
    name: mode === "production" ? "api" : "aurum-api-staging",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-10-23",
    env: {
      ...apiBindings,
      RATE_LIMITER: bindings.rateLimit({ namespace: mode === "production" ? "73101" : "73102", simple: { limit: 120, period: 60 } }),
    },
    workersDev: true,
    observability: { enabled: true, traces: { enabled: true, headSamplingRate: 0.1 } },
  },
}));
