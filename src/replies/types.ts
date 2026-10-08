import type { SocialPlatform, SocialPostTarget } from '../urls.js'
import type { runYtDlp } from '../ytDlp.js'

export interface SocialReply {
  author: string
  text: string
  likes: number | null
}

export type ReplyLookup =
  | { status: 'found'; platform: SocialPlatform; replies: SocialReply[]; total: number | null }
  | { status: 'failed'; platform: SocialPlatform; reason: string }

export interface ReplyFetchContext {
  fetcher: typeof fetch
  runExtractor: typeof runYtDlp
  ytDlpPath: string
  signal: AbortSignal
  maxReplies: number
  maxReplyChars: number
  youtubeApiKey: string | undefined
  timeoutMs: number
}

export type ReplyFetcher = (target: SocialPostTarget, context: ReplyFetchContext) => Promise<ReplyLookup>
