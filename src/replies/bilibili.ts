import { array, nonNegativeInteger, object, string } from '../parsers.js'
import { BROWSER_USER_AGENT, failed, fetchJson, found, rankReplies } from './common.js'
import type { ReplyFetcher } from './types.js'

const BV_ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf'
const BV_XOR = 23442827791579n
const BV_MASK = 2251799813685247n

export function bilibiliAid(id: string): string | null {
  if (/^av\d+$/i.test(id)) return id.slice(2)
  if (!/^BV1[0-9A-Za-z]{9}$/.test(id)) return null
  const chars = [...id]
  ;[chars[3], chars[9]] = [chars[9], chars[3]]
  ;[chars[4], chars[7]] = [chars[7], chars[4]]
  let value = 0n
  for (const char of chars.slice(3)) {
    const digit = BV_ALPHABET.indexOf(char)
    if (digit < 0) return null
    value = value * 58n + BigInt(digit)
  }
  return String((value & BV_MASK) ^ BV_XOR)
}

export const fetchBilibiliReplies: ReplyFetcher = async (target, context) => {
  const aid = bilibiliAid(target.id)
  if (!aid) return failed('bilibili', 'invalid_id')

  const url = new URL('https://api.bilibili.com/x/v2/reply')
  url.searchParams.set('type', '1')
  url.searchParams.set('oid', aid)
  url.searchParams.set('sort', '1')
  url.searchParams.set('ps', '20')
  url.searchParams.set('pn', '1')
  const result = await fetchJson(context, url, {
    headers: { 'User-Agent': BROWSER_USER_AGENT, Referer: 'https://www.bilibili.com/' }
  })
  if (!result.ok) return failed('bilibili', result.reason)

  const body = object(result.body)
  if (body.code !== 0) return failed('bilibili', `code_${String(body.code ?? 'missing')}`)

  const data = object(body.data)
  const replies = rankReplies(
    array(data.replies).map((value) => {
      const reply = object(value)
      return {
        author: string(object(reply.member).uname),
        text: string(object(reply.content).message),
        likes: nonNegativeInteger(reply.like)
      }
    }),
    context.maxReplies,
    context.maxReplyChars
  )
  return found('bilibili', replies, nonNegativeInteger(object(data.page).count))
}
