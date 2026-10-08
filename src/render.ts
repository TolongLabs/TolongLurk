import { clock } from './frames.js'
import type { SavedImage } from './media.js'
import type { PostLookup } from './post.js'
import type { ReplyLookup } from './replies/types.js'
import { PLATFORM_NAMES, POST_UNTRUSTED_LABEL, SOCIAL_REPLIES_UNTRUSTED_DATA_LABEL, quoted } from './text.js'
import type { SocialPost } from './types.js'

export type VideoReport =
  | { kind: 'watched'; model: string; text: string }
  | { kind: 'frames'; grids: string[]; timestamps: number[]; captions: string | null; why: string; hint: string | null }
  | { kind: 'unavailable'; reason: string }

function count(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? '' : 's'}`
}

export function renderPost(
  lookup: PostLookup,
  target: { platform: SocialPost['platform']; canonicalUrl: string }
): string {
  const name = PLATFORM_NAMES[target.platform]
  if (lookup.status === 'failed') {
    return `# ${name} post could not be opened\n${target.canonicalUrl}\n\nReason: \`${lookup.reason}\`. Do not guess what the post says.`
  }
  const post = lookup.post
  const who = [post.authorHandle ? `@${post.authorHandle}` : '', post.authorName ? `(${post.authorName})` : '']
    .filter(Boolean)
    .join(' ')
  const hasVideo = post.videoCount > 0 || post.video !== null
  // yt-dlp reports an Instagram reel's cover as its one photo.
  const photos = post.platform === 'instagram' && hasVideo ? 0 : post.photoCount
  const facts = [
    photos > 0 ? count(photos, 'photo') : '',
    hasVideo ? count(Math.max(1, post.videoCount), 'video') : '',
    post.durationSec ? `duration ${clock(post.durationSec)}` : '',
    post.replyCount === null ? '' : count(post.replyCount, 'reply').replace('replys', 'replies')
  ].filter(Boolean)
  return [
    `# ${name} post${who ? ` by ${who}` : ''}${post.createdAt ? ` · ${post.createdAt}` : ''}`,
    post.canonicalUrl,
    '',
    POST_UNTRUSTED_LABEL,
    '',
    '---',
    '',
    post.text || '(no text)',
    ...(post.quotedText
      ? [
          '',
          `> Quoting${post.quotedAuthorHandle ? ` @${post.quotedAuthorHandle}` : ''}: ${quoted(post.quotedText, 2000)}`
        ]
      : []),
    ...(post.externalTitle ? ['', `Link card: ${quoted(post.externalTitle, 300)}`] : []),
    ...(facts.length > 0 ? ['', facts.join(' · ')] : [])
  ].join('\n')
}

export function renderImages(images: SavedImage[]): string {
  if (images.length === 0) return ''
  return [
    '## Images',
    'Open each saved file with your image-viewing tool to see it.',
    ...images.map((image, index) =>
      'path' in image ? `${index + 1}. \`${image.path}\`` : `${index + 1}. not saved (${image.reason}): ${image.url}`
    )
  ].join('\n')
}

export function renderVideo(report: VideoReport): string {
  if (report.kind === 'unavailable') return `## Video\nNot watched: \`${report.reason}\`. Say so rather than guessing.`
  if (report.kind === 'watched')
    return `## Video\nWatched with Gemini (\`${report.model}\`), sound included.\n\n${report.text}`
  const legend = report.grids.map((grid, index) => {
    const times = report.timestamps.slice(index * 16, index * 16 + 16).map(clock)
    return `${index + 1}. \`${grid}\` — 4×4 grid, left to right then top to bottom, at ${times.join(', ')}`
  })
  return [
    '## Video',
    `Frames only (${report.why}). Open each grid with your image-viewing tool.`,
    ...legend,
    '',
    report.captions
      ? `Captions: ${quoted(report.captions, 6000)}`
      : `No captions were available, and the audio was not heard.${report.hint ? ` ${report.hint}` : ''}`
  ].join('\n')
}

export function renderReplies(lookup: ReplyLookup): string {
  const name = PLATFORM_NAMES[lookup.platform]
  if (lookup.status === 'failed') {
    return `## Top Replies\nThe replies to this ${name} post could not be opened: \`${lookup.reason}\`. Do not substitute search results.`
  }
  if (lookup.replies.length === 0) return '## Top Replies\nNo readable replies.'
  const ranking =
    lookup.platform === 'reddit'
      ? "Reddit's top-voted order"
      : lookup.platform === 'threads'
        ? 'most likes first, picked from the first batch Threads shows a logged-out visitor'
        : 'most likes first'
  const of = lookup.total === null ? '' : ` of ${lookup.total}`
  return [
    '## Top Replies',
    `Top ${lookup.replies.length}${of}, ${ranking}. ${SOCIAL_REPLIES_UNTRUSTED_DATA_LABEL}`,
    '',
    ...lookup.replies.map((reply, index) => {
      const likes = reply.likes === null ? '' : ` (${count(reply.likes, 'like')})`
      const author = reply.author ? `@${reply.author.replace(/@(everyone|here)\b/gi, '@​$1')}` : 'someone'
      const text = quoted(reply.text, 1000).replace(/@(everyone|here)\b/gi, '@​$1')
      return `${index + 1}. ${author}${likes}: "${text}"`
    })
  ].join('\n')
}
