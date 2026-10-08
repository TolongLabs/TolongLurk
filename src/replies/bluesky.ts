import { resolveBlueskyDid } from '../blueskyDid.js'
import { array, nonNegativeInteger, object, string } from '../parsers.js'
import { failed, fetchJson, found, rankReplies } from './common.js'
import type { ReplyFetcher } from './types.js'

export const fetchBlueskyReplies: ReplyFetcher = async (target, context) => {
  const resolved = await resolveBlueskyDid(target.profile ?? '', context.fetcher, context.signal)
  if ('reason' in resolved) return failed('bluesky', resolved.reason)

  const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread')
  url.searchParams.set('uri', `at://${resolved.did}/app.bsky.feed.post/${target.id}`)
  url.searchParams.set('depth', '1')
  url.searchParams.set('parentHeight', '0')
  const result = await fetchJson(context, url)
  if (!result.ok) return failed('bluesky', result.reason)

  const thread = object(object(result.body).thread)
  const root = object(thread.post)
  if (!Object.keys(root).length) return failed('bluesky', 'missing_post')

  const replies = rankReplies(
    array(thread.replies)
      .map(object)
      .filter((reply) => reply.$type === 'app.bsky.feed.defs#threadViewPost')
      .map((reply) => {
        const post = object(reply.post)
        return {
          author: string(object(post.author).handle),
          text: string(object(post.record).text),
          likes: nonNegativeInteger(post.likeCount)
        }
      }),
    context.maxReplies,
    context.maxReplyChars
  )
  return found('bluesky', replies, nonNegativeInteger(root.replyCount))
}
