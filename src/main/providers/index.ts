import type { ProviderId } from '../../shared/types'
import { streamAnthropic } from './anthropic'
import { streamGoogle } from './google'
import { streamOpenAi } from './openai'
import type { StreamFn } from './types'

export function streamFor(provider: ProviderId): StreamFn {
  switch (provider) {
    case 'anthropic':
      return streamAnthropic
    case 'google':
      return streamGoogle
    case 'deepseek':
    case 'openrouter':
      return streamOpenAi
  }
}

export type { StreamEvent, StreamFn, StreamRequest } from './types'
export { ProviderError } from './types'
