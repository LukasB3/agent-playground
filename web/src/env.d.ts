/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_TURNSTILE_SITEKEY?: string
}

interface Turnstile {
  render(
    container: string,
    options: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void },
  ): string
  reset(widget?: string): void
}

interface Window {
  turnstile?: Turnstile
  onTurnstileLoad?: () => void
}
