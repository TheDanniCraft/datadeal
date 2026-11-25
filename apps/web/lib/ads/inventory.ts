export function limitedDisplayUnit() {
  const unit = process.env.DATADEAL_GOOGLE_LIMITED_AD_UNIT;
  if (unit && /^\/[0-9]+(?:,[0-9]+)?(?:\/[A-Za-z0-9_.-]+)+$/.test(unit))
    return unit;
  if (
    process.env.NODE_ENV === "development" &&
    process.env.DATADEAL_LOCAL_SAMPLE_ADS === "true"
  )
    return "/6355419/Travel/Europe/France/Paris";
}
