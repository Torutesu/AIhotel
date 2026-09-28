/** URL はアカウント選択にだけ使う。認証には別途パスワードが必要 */
export function currentTrialId(): string | null {
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.search)
  return params.has("trial") ? params.get("trial") || "invalid" : null
}
