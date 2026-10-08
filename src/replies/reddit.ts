import { entryAuthor, entryContent, feedEntries, feedField, htmlToText } from '../redditFeed.js'
import { BROWSER_USER_AGENT, type ReplyCandidate, failed, found, takeReplies } from './common.js'
import type { ReplyFetcher } from './types.js'

export function parseRedditComments(feed: string): ReplyCandidate[] {
  return feedEntries(feed)
    .filter((entry) => feedField(entry, /<id>([^<]*)<\/id>/).startsWith('t1_'))
    .map((entry) => ({ author: entryAuthor(entry), text: htmlToText(entryContent(entry)), likes: null }))
}

export const fetchRedditReplies: ReplyFetcher = async (target, context) => {
  const url = new URL(`https://www.reddit.com/comments/${target.id}/.rss`)
  url.searchParams.set('sort', 'top')
  url.searchParams.set('limit', String(context.maxReplies))
  const response = await context.fetcher(url, {
    headers: { 'User-Agent': BROWSER_USER_AGENT },
    signal: context.signal
  })
  if (!response.ok) return failed('reddit', `http_${response.status}`)

  const feed = await response.text()
  if (!feed.includes('<feed')) return failed('reddit', 'invalid_feed')
  return found('reddit', takeReplies(parseRedditComments(feed), context.maxReplies, context.maxReplyChars), null)
}
