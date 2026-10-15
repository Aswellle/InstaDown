import { describe, expect, it } from 'vitest'
import { classifyIgUrl, isProbablyIgUrl } from '@shared/ig-url'

describe('classifyIgUrl', () => {
  it('帖子链接', () => {
    expect(classifyIgUrl('https://www.instagram.com/p/B1LbfVPlwIA/')).toEqual({
      kind: 'post',
      shortcode: 'B1LbfVPlwIA'
    })
    expect(
      classifyIgUrl('https://instagram.com/p/CxAbCdEfGhI/?img_index=2&utm=share')
    ).toEqual({ kind: 'post', shortcode: 'CxAbCdEfGhI' })
  })

  it('Reels / TV 链接', () => {
    expect(classifyIgUrl('https://www.instagram.com/reel/CxYz1234567/')).toEqual({
      kind: 'reel',
      shortcode: 'CxYz1234567'
    })
    expect(classifyIgUrl('instagram.com/reels/CxYz1234567')).toEqual({
      kind: 'reel',
      shortcode: 'CxYz1234567'
    })
    expect(classifyIgUrl('https://www.instagram.com/tv/B1LbfVPlwIA')).toEqual({
      kind: 'tv',
      shortcode: 'B1LbfVPlwIA'
    })
  })

  it('Stories / Highlights', () => {
    expect(classifyIgUrl('https://www.instagram.com/stories/natgeo/1234567/')).toEqual({
      kind: 'story',
      username: 'natgeo'
    })
    expect(classifyIgUrl('https://www.instagram.com/stories/highlights/1798/')).toEqual({
      kind: 'highlight',
      username: '1798'
    })
  })

  it('主页与裸用户名', () => {
    expect(classifyIgUrl('https://www.instagram.com/instagram/')).toEqual({
      kind: 'profile',
      username: 'instagram'
    })
    expect(classifyIgUrl('natgeo')).toEqual({ kind: 'profile', username: 'natgeo' })
  })

  it('非 Instagram 输入拒绝', () => {
    expect(classifyIgUrl('https://youtube.com/watch?v=1').kind).toBe('unknown')
    expect(classifyIgUrl('hello world!').kind).toBe('unknown')
    expect(classifyIgUrl('').kind).toBe('unknown')
    expect(classifyIgUrl('https://www.instagram.com/explore/').kind).toBe('unknown')
  })

  it('isProbablyIgUrl', () => {
    expect(isProbablyIgUrl('https://www.instagram.com/p/abc12/')).toBe(true)
    expect(isProbablyIgUrl('someuser')).toBe(true)
    expect(isProbablyIgUrl('https://google.com')).toBe(false)
    expect(isProbablyIgUrl('not a url')).toBe(false)
  })
})
