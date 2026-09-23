// Dodo bills in USD only, and its own checkout page already lets a customer
// pick their currency with a live, accurate conversion at the point of
// payment. A separate client-side estimate here (static FX rates, no
// connection to what checkout actually charges) risked showing a different
// number pre-checkout than the real total — so pricing is shown in USD
// everywhere before that point, plain and simple.
export function formatUsd(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: usd % 1 === 0 ? 0 : 2,
  }).format(usd)
}
