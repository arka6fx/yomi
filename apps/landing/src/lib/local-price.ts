"use client"

import { useEffect, useState } from "react"

// Display-only currency localization. Dodo bills in USD, so localized prices
// are approximations for familiarity — every non-USD display must keep the
// "billed in USD" note. Rates are static snapshots, not live FX.
type CurrencyDef = {
  currency: string
  rate: number // USD -> local, approximate
  wholeUnits: boolean // currencies where decimals look unnatural in marketing
}

const CURRENCIES: Record<string, CurrencyDef> = {
  INR: { currency: "INR", rate: 88, wholeUnits: true },
  EUR: { currency: "EUR", rate: 0.93, wholeUnits: false },
  GBP: { currency: "GBP", rate: 0.79, wholeUnits: false },
  JPY: { currency: "JPY", rate: 155, wholeUnits: true },
  CAD: { currency: "CAD", rate: 1.37, wholeUnits: false },
  AUD: { currency: "AUD", rate: 1.52, wholeUnits: false },
  SGD: { currency: "SGD", rate: 1.34, wholeUnits: false },
  AED: { currency: "AED", rate: 3.67, wholeUnits: false },
  BRL: { currency: "BRL", rate: 5.6, wholeUnits: true },
}

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  IN: "INR",
  GB: "GBP",
  JP: "JPY",
  CA: "CAD",
  AU: "AUD",
  SG: "SGD",
  AE: "AED",
  BR: "BRL",
  // Eurozone
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  IE: "EUR",
  PT: "EUR",
  AT: "EUR",
  BE: "EUR",
  FI: "EUR",
  GR: "EUR",
}

// Fallback for browsers whose locale carries no region (e.g. plain "en"):
// map a few unambiguous IANA timezones to countries.
const TIMEZONE_TO_COUNTRY: Record<string, string> = {
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Europe/London": "GB",
  "Asia/Tokyo": "JP",
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Asia/Singapore": "SG",
  "Asia/Dubai": "AE",
  "America/Sao_Paulo": "BR",
  "Europe/Berlin": "DE",
  "Europe/Paris": "FR",
  "Europe/Madrid": "ES",
  "Europe/Rome": "IT",
  "Europe/Amsterdam": "NL",
  "Europe/Dublin": "IE",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
}

function detectCountry(): string | null {
  try {
    for (const lang of navigator.languages ?? [navigator.language]) {
      const region = new Intl.Locale(lang).region
      if (region) return region.toUpperCase()
    }
  } catch {
    // best-effort
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return TIMEZONE_TO_COUNTRY[tz] ?? null
  } catch {
    return null
  }
}

export type LocalPriceFormatter = {
  /** e.g. 14.99 -> "₹1,319" for IN, "$14.99" for US/unknown */
  format: (usd: number) => string
  /** true when showing a non-USD approximation (render a "billed in USD" note) */
  localized: boolean
}

const USD_FORMATTER: LocalPriceFormatter = {
  format: (usd) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: usd % 1 === 0 ? 0 : 2,
    }).format(usd),
  localized: false,
}

// SSR and first client render must agree (hydration), so this starts as USD
// and swaps to the visitor's currency after mount.
export function useLocalPrice(): LocalPriceFormatter {
  const [formatter, setFormatter] = useState<LocalPriceFormatter>(USD_FORMATTER)

  useEffect(() => {
    const country = detectCountry()
    const def = country ? CURRENCIES[COUNTRY_TO_CURRENCY[country] ?? ""] : undefined
    if (!def) return
    setFormatter({
      format: (usd) =>
        new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: def.currency,
          maximumFractionDigits: def.wholeUnits ? 0 : 2,
          minimumFractionDigits: usd === 0 || def.wholeUnits ? 0 : 2,
        }).format(usd * def.rate),
      localized: true,
    })
  }, [])

  return formatter
}
