// Money formatting and conversion. Dollars are always whole cents; pesos are whole pesos.

const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const mxnFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const formatUsd = (cents) => usdFormat.format(cents / 100);
export const formatMxn = (pesos) => mxnFormat.format(pesos);

// Budget minus spent, signed: "+$1,442.50" when under, "−$325.50" when over.
export const formatDiff = (cents) => `${cents >= 0 ? '+' : '−'}${formatUsd(Math.abs(cents))}`;

export const pesosToUsdCents = (pesos, mxnPerUsd) => Math.round((pesos * 100) / mxnPerUsd);
