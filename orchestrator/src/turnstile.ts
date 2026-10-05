export type CaptchaCheck = (token: string, ip: string) => Promise<boolean>

export const turnstile =
  (secret: string): CaptchaCheck =>
  async (token, ip) => {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null)
    if (!res?.ok) return false
    const body = (await res.json().catch(() => null)) as { success?: boolean } | null
    return body?.success === true
  }
