// Money: the currencies the app accepts, formatting, and conversion to US dollars.
//
// US dollars are the home currency: every expense and budget is stored in US cents. Other
// currencies are converted when an expense is entered, at that day's rate.
//
// To add a currency, add one line to CURRENCIES. Everything else (the picker on the main screen,
// the keypad, formatting, the daily rate download, editing, CSV export) reads from this table.
//   decimals:     digits after the decimal point when typing amounts (USD 2: 5 1 0 5 0 → $510.50;
//                 MXN 0: 5 1 0 5 0 → MX$51,050)
//   maxDigits:    longest amount you can type
//   fallbackRate: units per 1 USD, used only until the app first downloads a real rate
// The rate source (Frankfurter, European Central Bank data) covers about 30 major currencies.
export const CURRENCIES = {
  USD: { decimals: 2, maxDigits: 8, fallbackRate: 1 },
  MXN: { decimals: 0, maxDigits: 7, fallbackRate: 18.5 },
};
export const HOME = 'USD';
export const CURRENCY_CODES = Object.keys(CURRENCIES);
export const FOREIGN_CODES = CURRENCY_CODES.filter((code) => code !== HOME);

const formats = Object.fromEntries(CURRENCY_CODES.map((code) => [code, new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: code,
  minimumFractionDigits: CURRENCIES[code].decimals,
  maximumFractionDigits: CURRENCIES[code].decimals,
})]));

// Amounts are whole numbers in each currency's smallest typed unit: US cents, whole pesos, ...
export const formatMoney = (amount, code) => formats[code].format(amount / 10 ** CURRENCIES[code].decimals);
export const formatUsd = (cents) => formatMoney(cents, HOME);

// Budget minus spent, signed: "+$1,442.50" when under, "−$325.50" when over.
export const formatDiff = (cents) => `${cents >= 0 ? '+' : '−'}${formatUsd(Math.abs(cents))}`;

// perUsd: how many units of `code` one US dollar buys.
export function toUsdCents(amount, code, perUsd) {
  if (code === HOME) return amount;
  return Math.round(((amount / 10 ** CURRENCIES[code].decimals) * 100) / perUsd);
}
