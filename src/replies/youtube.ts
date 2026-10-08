import { array, nonNegativeInteger, object, string } from '../parsers.js'
import { failed, found, rankReplies } from './common.js'
import type { ReplyFetcher } from './types.js'

export const fetchYouTubeReplies: ReplyFetcher = async (target, context) => {
  if (!context.youtubeApiKey) return failed('youtube', 'not_configured')

  const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('videoId', target.id)
  // relevance is the closest server-side order to "most liked"; the pool is re-ranked by likes below.
  url.searchParams.set('order', 'relevance')
  url.searchParams.set('maxResults', '50')
  url.searchParams.set('textFormat', 'plainText')
  url.searchParams.set('key', context.youtubeApiKey)

  const response = await context.fetcher(url, { signal: context.signal })
  if (!response.ok) {
    const error = object(object(await response.json().catch(() => null)).error)
    const reason = string(object(array(error.errors)[0]).reason)
    return failed('youtube', reason === 'commentsDisabled' ? 'comments_disabled' : `http_${response.status}`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return failed('youtube', 'invalid_json')
  }
  const replies = rankReplies(
    array(object(body).items).map((item) => {
      const comment = object(object(object(object(item).snippet).topLevelComment).snippet)
      return {
        author: string(comment.authorDisplayName).replace(/^@/, ''),
        text: string(comment.textDisplay),
        likes: nonNegativeInteger(comment.likeCount)
      }
    }),
    context.maxReplies,
    context.maxReplyChars
  )
  return found('youtube', replies, null)
}
