import type { SonekkApi } from '../../shared/api'

declare global {
  interface Window {
    sonekk: SonekkApi
  }
}

export {}
