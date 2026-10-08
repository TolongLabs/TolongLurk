import { array, nonNegativeInteger, object, string } from '../parsers.js'
import { failed, found, rankReplies } from './common.js'
import type { ReplyFetcher } from './types.js'

export const fetchInstagramReplies: ReplyFetcher = async (target, context) => {
  const result = await context.runExtractor(context.ytDlpPath, target.extractorUrl, context.timeoutMs, [
    '--write-comments'
  ])
  if ('reason' in result) return failed('instagram', result.reason)

  const data = object(result.metadata)
  const replies = rankReplies(
    array(data.comments)
      .map(object)
      .filter((comment) => {
        const parent = string(comment.parent)
        return !parent || parent === 'root'
      })
      .map((comment) => ({
        author: string(comment.author),
        text: string(comment.text),
        likes: nonNegativeInteger(comment.like_count)
      })),
    context.maxReplies,
    context.maxReplyChars
  )
  return found('instagram', replies, nonNegativeInteger(data.comment_count))
}
