export function getPricing() {
  const cents = (value: string | undefined, fallback: number) => {
    const amount = Number(value);
    return value &&
      /^\d+$/.test(value) &&
      Number.isSafeInteger(amount) &&
      amount > 0
      ? amount
      : fallback;
  };
  const monthly = cents(process.env.DATADEAL_PRO_MONTHLY_CENTS, 399);
  const yearly = cents(process.env.DATADEAL_PRO_YEARLY_CENTS, 3499);
  return {
    monthly,
    yearly,
    currency: "EUR",
    yearlyBestValue: yearly < monthly * 12,
  } as const;
}
export const brand = {
  name: "DataDeal",
  tagline: "Know the deal before you sign up.",
} as const;
