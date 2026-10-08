import { isIP } from 'node:net'

export type SocialPlatform = 'x' | 'bluesky' | 'youtube' | 'tiktok' | 'reddit' | 'instagram' | 'bilibili'

export interface SocialPostTarget {
  platform: SocialPlatform
  id: string
  lookupKey: string
  canonicalUrl: string
  extractorUrl: string
  profile?: string
  startSec?: number
}

const HOSTS: Record<SocialPlatform, string[]> = {
  x: ['x.com', 'twitter.com', 'fxtwitter.com', 'fixupx.com', 'vxtwitter.com', 'fixvx.com'],
  bluesky: ['bsky.app'],
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'],
  reddit: ['reddit.com', 'redd.it'],
  instagram: ['instagram.com'],
  bilibili: ['bilibili.com']
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function platformForHost(host: string): SocialPlatform | null {
  for (const [platform, domains] of Object.entries(HOSTS) as Array<[SocialPlatform, string[]]>) {
    if (domains.some((domain) => hostMatches(host, domain))) return platform
  }
  return null
}

function target(platform: SocialPlatform, id: string, canonicalUrl: string, profile?: string): SocialPostTarget {
  return { platform, id, lookupKey: `${platform}:${id}`, canonicalUrl, extractorUrl: canonicalUrl, profile }
}

const YOUTUBE_CLOCK_TIME = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/

function youtubeStartSec(url: URL): number | undefined {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start') ?? url.hash.match(/^#t=(.*)$/)?.[1]
  if (raw === undefined) return undefined
  if (/^\d+$/.test(raw)) return Number(raw)
  const match = raw.match(YOUTUBE_CLOCK_TIME)
  if (!match || match.slice(1).every((part) => part === undefined)) return undefined
  const [, hours = '0', minutes = '0', seconds = '0'] = match
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

export function parseSocialPostUrl(value: string): SocialPostTarget | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }

  const authority = value.trim().match(/^https:\/\/([^/?#]+)/i)?.[1]
  if (
    url.protocol !== 'https:' ||
    !authority ||
    authority.includes('@') ||
    authority.includes(':') ||
    isIP(url.hostname.replace(/^\[|\]$/g, ''))
  ) {
    return null
  }

  const host = url.hostname.toLowerCase()
  const platform = platformForHost(host)
  if (!platform) return null

  if (platform === 'x') {
    const match = url.pathname.match(/^\/([\w]+)\/status\/(\d+)(?:\/.*)?$/i)
    if (!match) return null
    const [, profile, id] = match
    return target('x', id, `https://x.com/i/status/${id}`, profile)
  }

  if (platform === 'bluesky') {
    const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([a-z0-9]+)\/?$/i)
    if (!match) return null
    const [, profile, id] = match
    return target('bluesky', id, `https://bsky.app/profile/${profile}/post/${id}`, profile)
  }

  if (platform === 'youtube') {
    const id = hostMatches(host, 'youtu.be')
      ? url.pathname.match(/^\/([\w-]+)\/?$/)?.[1]
      : url.pathname === '/watch'
        ? url.searchParams.get('v')
        : url.pathname.match(/^\/shorts\/([\w-]+)\/?$/)?.[1]
    if (!id || !/^[\w-]+$/.test(id)) return null
    const canonicalUrl = `https://www.youtube.com/watch?v=${id}`
    return { ...target('youtube', id, canonicalUrl), startSec: youtubeStartSec(url) }
  }

  if (platform === 'tiktok') {
    const match = url.pathname.match(/^\/@([\w.-]+)\/video\/(\d+)\/?$/i)
    if (!match) return null
    const [, profile, id] = match
    return target('tiktok', id, `https://www.tiktok.com/@${profile}/video/${id}`, profile)
  }

  if (platform === 'reddit') {
    const id = hostMatches(host, 'redd.it')
      ? url.pathname.match(/^\/([a-z0-9]+)\/?$/i)?.[1]
      : (url.pathname.match(/^\/r\/[\w-]+\/comments\/([a-z0-9]+)(?:\/[^/]*)?\/?$/i)?.[1] ??
        url.pathname.match(/^\/comments\/([a-z0-9]+)\/?$/i)?.[1])
    if (!id) return null
    return target('reddit', id, `https://www.reddit.com/comments/${id}/`)
  }

  if (platform === 'instagram') {
    const match = url.pathname.match(/^\/(?:p|reel)\/([\w-]+)\/?$/i)
    if (!match) return null
    const [, id] = match
    const kind = url.pathname.toLowerCase().startsWith('/reel/') ? 'reel' : 'p'
    return target('instagram', id, `https://www.instagram.com/${kind}/${id}/`)
  }

  const id = url.pathname.match(/^\/video\/(BV[\da-z]+|av\d+)\/?$/i)?.[1]
  if (!id) return null
  const normalizedId = id.startsWith('av') ? id.toLowerCase() : `BV${id.slice(2)}`
  return target('bilibili', normalizedId, `https://www.bilibili.com/video/${normalizedId}`)
}

export function findSocialPostTarget(text: string): SocialPostTarget | null {
  const urls = text.match(/https?:\/\/[^\s<>()[\]{}]+/gi) ?? []
  for (const candidate of urls) {
    const cleaned = candidate.replace(/[.,!?;:'"`]+$/g, '')
    const parsed = parseSocialPostUrl(cleaned)
    if (parsed) return parsed
  }
  return null
}
