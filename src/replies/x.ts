import { array, nonNegativeInteger, object, string } from '../parsers.js'
import { BROWSER_USER_AGENT, failed, fetchJson, found, rankReplies } from './common.js'
import type { ReplyFetcher } from './types.js'

// X prefixes every reply with the handles it answers; they say nothing about what the reply says.
const LEADING_MENTIONS = /^(?:@\w+(?:\s+|$))+/

export const fetchXReplies: ReplyFetcher = async (target, context) => {
  const url = new URL(`https://api.fxtwitter.com/2/conversation/${target.id}`)
  url.searchParams.set('ranking_mode', 'likes')
  const result = await fetchJson(context, url, { headers: { 'User-Agent': BROWSER_USER_AGENT } })
  if (!result.ok) return failed('x', result.reason)

  const body = object(result.body)
  if (body.code !== undefined && body.code !== 200) return failed('x', `api_${String(body.code)}`)

  const replies = rankReplies(
    array(body.replies).map((value) => {
      const reply = object(value)
      return {
        author: string(object(reply.author).screen_name),
        text: string(reply.text).replace(LEADING_MENTIONS, ''),
        likes: nonNegativeInteger(reply.likes),
        tiebreak: nonNegativeInteger(reply.views) ?? 0
      }
    }),
    context.maxReplies,
    context.maxReplyChars
  )
  return found('x', replies, nonNegativeInteger(object(body.status).replies))
}
