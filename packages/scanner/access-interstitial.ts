/** A CAPTCHA widget embedded in a real page is not a blocked visit. */
export function isAccessInterstitial(
  title: string,
  mitigation: string | string[] | undefined,
  challengePage: boolean,
) {
  const heading = title.trim();
  return (
    mitigation === "challenge" ||
    /^(?:403\s*[-:|]?\s*Forbidden|429\s*[-:|]?\s*Too Many Requests)$/i.test(
      heading,
    ) ||
    (challengePage &&
      /^(?:Just a moment[. …]*|Access denied|Verify (?:that )?you are human|Security verification)$/i.test(
        heading,
      ))
  );
}
