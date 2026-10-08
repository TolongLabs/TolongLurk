export async function resolveBlueskyDid(
  profile: string,
  fetcher: typeof fetch,
  signal: AbortSignal
): Promise<{ did: string } | { reason: string }> {
  let did = profile
  if (!did.startsWith('did:')) {
    const identityUrl = new URL('https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle')
    identityUrl.searchParams.set('handle', did)
    const identity = await fetcher(identityUrl, { signal })
    if (!identity.ok) return { reason: `http_${identity.status}` }
    did = String(((await identity.json()) as { did?: unknown }).did ?? '')
  }
  if (!/^did:[a-z]+:[a-z0-9.:-]+$/i.test(did)) return { reason: 'invalid_did' }
  return { did }
}
