import { array, nonNegativeInteger, object, string } from '../parsers.js'
import { BROWSER_USER_AGENT, failed, fetchJson, found, rankReplies } from './common.js'
import type { ReplyFetcher } from './types.js'

export const fetchTikTokReplies: ReplyFetcher = async (target, context) => {
  const url = new URL('https://www.tiktok.com/api/comment/list/')
  url.searchParams.set('aweme_id', target.id)
  url.searchParams.set('count', '50')
  url.searchParams.set('cursor', '0')
  url.searchParams.set('aid', '1988')
  const result = await fetchJson(context, url, { headers: { 'User-Agent': BROWSER_USER_AGENT } })
  if (!result.ok) return failed('tiktok', result.reason)

  const body = object(result.body)
  if (body.status_code !== 0) return failed('tiktok', `status_${String(body.status_code ?? 'missing')}`)

  const replies = rankReplies(
    array(body.comments).map((value) => {
      const comment = object(value)
      return {
        author: string(object(comment.user).unique_id),
        text: string(comment.text),
        likes: nonNegativeInteger(comment.digg_count)
      }
    }),
    context.maxReplies,
    context.maxReplyChars
  )
  return found('tiktok', replies, nonNegativeInteger(body.total))
}
