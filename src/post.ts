import { resolveBlueskyDid } from './blueskyDid.js'
import { parseBlueskyThread, parseFxTwitterResponse, parseYouTubeOEmbed, parseYtDlpMetadata } from './parsers.js'
import { parseRedditFeedPost } from './redditFeed.js'
import { BROWSER_USER_AGENT } from './replies/common.js'
import type { SocialPost } from './types.js'
import type { SocialPlatform, SocialPostTarget } from './urls.js'
import { runYtDlp } from './ytDlp.js'

export type PostLookup =
  | { status: 'found'; post: SocialPost }
  | { status: 'failed'; platform: SocialPlatform; reason: string }

export interface PostLookupOptions {
  fetcher?: typeof fetch
  runExtractor?: typeof runYtDlp
  ytDlpPath?: string
  timeoutMs?: number
  maxTextChars?: number
}

function failure(platform: SocialPlatform, reason: string): PostLookup {
  return { status: 'failed', platform, reason }
}

async function redditFeed(
  target: SocialPostTarget,
  fetcher: typeof fetch,
  signal: AbortSignal,
  maxTextChars: number
): Promise<SocialPost | { refused: string } | null> {
  const feedUrl = new URL(`https://www.reddit.com/comments/${target.id}/.rss`)
  feedUrl.searchParams.set('limit', '1')
  try {
    const response = await fetcher(feedUrl, { headers: { 'User-Agent': BROWSER_USER_AGENT }, signal })
    // Reddit refuses a flagged IP here and on the JSON yt-dlp reads alike, so yt-dlp would only spend ~9 s failing.
    if (response.status === 403 || response.status === 429) return { refused: `http_${response.status}` }
    return response.ok ? parseRedditFeedPost(await response.text(), target, maxTextChars) : null
  } catch {
    return null
  }
}

export async function lookupPost(target: SocialPostTarget, options: PostLookupOptions = {}): Promise<PostLookup> {
  const fetcher = options.fetcher ?? fetch
  const runExtractor = options.runExtractor ?? runYtDlp
  const ytDlpPath = options.ytDlpPath ?? 'yt-dlp'
  const timeoutMs = options.timeoutMs ?? 20_000
  const maxTextChars = options.maxTextChars ?? 4000
  const signal = AbortSignal.timeout(timeoutMs)

  try {
    if (target.platform === 'x') {
      const response = await fetcher(`https://api.fxtwitter.com/status/${target.id}`, { signal })
      if (!response.ok) return failure('x', `http_${response.status}`)
      return { status: 'found', post: parseFxTwitterResponse(await response.json(), target, maxTextChars) }
    }

    if (target.platform === 'bluesky') {
      const resolved = await resolveBlueskyDid(target.profile ?? '', fetcher, signal)
      if ('reason' in resolved) return failure('bluesky', resolved.reason)
      const threadUrl = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread')
      threadUrl.searchParams.set('uri', `at://${resolved.did}/app.bsky.feed.post/${target.id}`)
      threadUrl.searchParams.set('depth', '0')
      threadUrl.searchParams.set('parentHeight', '0')
      const response = await fetcher(threadUrl, { signal })
      if (!response.ok) return failure('bluesky', `http_${response.status}`)
      const parsed = parseBlueskyThread(await response.json(), target, maxTextChars)
      return parsed ? { status: 'found', post: parsed.post } : failure('bluesky', 'missing_post')
    }

    // yt-dlp extracts only Reddit-hosted video and takes ~9 s to refuse anything else; the feed covers every post.
    const feed = target.platform === 'reddit' ? await redditFeed(target, fetcher, signal, maxTextChars) : null
    if (feed && 'refused' in feed) return failure('reddit', feed.refused)
    if (feed && feed.videoCount === 0) return { status: 'found', post: feed }

    const result = await runExtractor(ytDlpPath, target.extractorUrl, timeoutMs)
    if ('reason' in result) {
      if (feed) return { status: 'found', post: feed }
      if (target.platform !== 'youtube') return failure(target.platform, result.reason)
      // YouTube walls repeated requests from one home IP behind a bot check that oEmbed does not have.
      const oembedUrl = new URL('https://www.youtube.com/oembed')
      oembedUrl.searchParams.set('url', target.canonicalUrl)
      oembedUrl.searchParams.set('format', 'json')
      const response = await fetcher(oembedUrl, { signal })
      const post = response.ok ? parseYouTubeOEmbed(await response.json(), target, maxTextChars) : null
      return post ? { status: 'found', post } : failure('youtube', result.reason)
    }
    return { status: 'found', post: parseYtDlpMetadata(result.metadata, target, maxTextChars) }
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return failure(target.platform, timedOut ? 'timeout' : 'network_error')
  }
}
