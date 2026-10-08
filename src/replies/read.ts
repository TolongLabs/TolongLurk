import type { SocialPlatform, SocialPostTarget } from '../urls.js'
import { runYtDlp } from '../ytDlp.js'
import { fetchBilibiliReplies } from './bilibili.js'
import { fetchBlueskyReplies } from './bluesky.js'
import { failed } from './common.js'
import { fetchInstagramReplies } from './instagram.js'
import { fetchRedditReplies } from './reddit.js'
import { fetchTikTokReplies } from './tiktok.js'
import type { ReplyFetcher, ReplyLookup } from './types.js'
import { fetchXReplies } from './x.js'
import { fetchYouTubeReplies } from './youtube.js'

const FETCHERS: Record<SocialPlatform, ReplyFetcher> = {
  x: fetchXReplies,
  bluesky: fetchBlueskyReplies,
  youtube: fetchYouTubeReplies,
  tiktok: fetchTikTokReplies,
  reddit: fetchRedditReplies,
  instagram: fetchInstagramReplies,
  bilibili: fetchBilibiliReplies
}

export interface ReadRepliesOptions {
  maxReplies?: number
  maxReplyChars?: number
  timeoutMs?: number
  ytDlpPath?: string
  youtubeApiKey?: string
  fetcher?: typeof fetch
  runExtractor?: typeof runYtDlp
  fetchers?: Partial<Record<SocialPlatform, ReplyFetcher>>
}

export async function readReplies(target: SocialPostTarget, options: ReadRepliesOptions = {}): Promise<ReplyLookup> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const fetcher = { ...FETCHERS, ...options.fetchers }[target.platform]
  try {
    return await fetcher(target, {
      fetcher: options.fetcher ?? fetch,
      runExtractor: options.runExtractor ?? runYtDlp,
      ytDlpPath: options.ytDlpPath ?? 'yt-dlp',
      signal: AbortSignal.timeout(timeoutMs),
      maxReplies: options.maxReplies ?? 5,
      maxReplyChars: options.maxReplyChars ?? 400,
      youtubeApiKey: options.youtubeApiKey,
      timeoutMs
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return failed(target.platform, timedOut ? 'timeout' : 'network_error')
  }
}
