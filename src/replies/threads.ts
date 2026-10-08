import { THREADS_PAGE_HEADERS, parseThreadsPage } from '../threads.js'
import { failed, found, rankReplies } from './common.js'
import type { ReplyFetcher } from './types.js'

// Logged out, the post page is the only source; it carries Threads' own first batch of replies, not all of them.
export const fetchThreadsReplies: ReplyFetcher = async (target, context) => {
  const response = await context.fetcher(target.canonicalUrl, { headers: THREADS_PAGE_HEADERS, signal: context.signal })
  if (!response.ok) return failed('threads', `http_${response.status}`)
  const page = parseThreadsPage(await response.text(), target, context.maxReplyChars)
  if (!page) return failed('threads', 'no_post_data')
  return found('threads', rankReplies(page.replies, context.maxReplies, context.maxReplyChars), page.post.replyCount)
}
