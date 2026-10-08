import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseRedditFeedPost } from '../src/redditFeed.js'
import { parseSocialPostUrl } from '../src/urls.js'

const target = parseSocialPostUrl('https://www.reddit.com/r/osugame/comments/1x0b7lo/sample/')!
const IMAGE_POST = readFileSync(new URL('./fixtures/reddit-post.rss', import.meta.url), 'utf8')

function selfPostFeed(body: string): string {
  const content = `&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;${body}&lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/poster_two&quot;&gt; /u/poster_two &lt;/a&gt;`
  return `<feed><entry><author><name>/u/poster_two</name></author><category term="osugame" label="r/osugame"/><content type="html">${content}</content><id>t3_1x0b7lo</id><published>2026-10-06T10:00:00+00:00</published><title>Is HDHR worth learning?</title></entry></feed>`
}

describe('parseRedditFeedPost', () => {
  // yt-dlp only extracts Reddit video posts; image and text posts are readable from the comment feed's first entry.
  it('reads an image post from the comment feed', () => {
    expect(parseRedditFeedPost(IMAGE_POST, target, 1500)).toMatchObject({
      platform: 'reddit',
      id: '1x0b7lo',
      authorHandle: 'poster_one',
      authorName: 'r/osugame',
      createdAt: '2026-10-07',
      text: 'cryshina | toromi hearts 2 +DT 99.02% 7xMiss & 1264pp if ranked 💖',
      imageUrl: 'https://preview.redd.it/sample.jpeg?width=640&crop=smart',
      photoCount: 1,
      videoCount: 0,
      replyCount: null
    })
  })

  it('reads a text post with its body and no image', () => {
    expect(
      parseRedditFeedPost(selfPostFeed('&lt;p&gt;I keep missing &amp;amp; it&amp;#39;s rough.&lt;/p&gt;'), target, 1500)
    ).toMatchObject({
      authorHandle: 'poster_two',
      text: "Is HDHR worth learning? — I keep missing & it's rough.",
      imageUrl: null,
      photoCount: 0
    })
  })

  it('marks a post whose link is a Reddit-hosted video', () => {
    const videoPost = IMAGE_POST.replace('https://i.redd.it/sample.jpeg', 'https://v.redd.it/sample')

    expect(parseRedditFeedPost(IMAGE_POST, target, 1500)?.videoCount).toBe(0)
    expect(parseRedditFeedPost(videoPost, target, 1500)?.videoCount).toBe(1)
  })

  it('caps the text and returns null without a post entry', () => {
    expect(parseRedditFeedPost(IMAGE_POST, target, 8)?.text).toBe('cryshina')
    expect(parseRedditFeedPost('<feed></feed>', target, 1500)).toBeNull()
    expect(parseRedditFeedPost('<html>blocked</html>', target, 1500)).toBeNull()
  })
})
