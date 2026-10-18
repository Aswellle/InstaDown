import { describe, expect, it } from 'vitest'
import { Repos } from '../../src/main/db/repos'
import { openDatabase } from '../../src/main/db/database'
import type { MediaRow } from '../../src/shared/types'

/**
 * 媒体库查询语义：只列**已归档到本机**的媒体。
 *
 * 曾经 library:list 走的是 listMedia()，即"所有解析过的媒体"——
 * 用户在主页滑一遍就会把整个 feed 写进 media 表，媒体库里随即出现
 * 一堆从未下载的条目，且没有落盘路径（点开只能依赖会过期的 CDN 链接）。
 */

function media(over: Partial<MediaRow> & { id: string }): MediaRow {
  return {
    platform: 'instagram',
    shortcode: 'ABC',
    author: 'example_author',
    url: 'https://cdn.example/a.jpg',
    thumb_url: null,
    type: 'image',
    width: 1080,
    height: 1080,
    duration: null,
    caption: null,
    taken_at: 1_700_000_000,
    created_at: 1_700_000_000_000,
    ...over
  }
}

function freshRepos(): Repos {
  return new Repos(openDatabase(':memory:'))
}

describe('媒体库只包含已归档媒体', () => {
  it('解析过但未下载的媒体不出现在媒体库', () => {
    const repos = freshRepos()
    repos.upsertMedia(media({ id: 'parsed-only' }))

    expect(repos.listMedia()).toHaveLength(1)
    expect(repos.listArchivedMedia()).toEqual([])
  })

  it('已归档媒体带出落盘路径与文件大小', () => {
    const repos = freshRepos()
    repos.upsertMedia(media({ id: 'archived' }))
    repos.insertHistory({
      task_id: 't1',
      media_id: 'archived',
      author: 'example_author',
      path: 'D:/downloads/example_author/2026-10-12/images/a.jpg',
      size: 2048,
      created_at: 1_700_000_000_000
    })

    const rows = repos.listArchivedMedia()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('archived')
    expect(rows[0].path).toBe('D:/downloads/example_author/2026-10-12/images/a.jpg')
    expect(rows[0].file_size).toBe(2048)
  })

  it('同一媒体多次下载时取最新一次路径', () => {
    const repos = freshRepos()
    repos.upsertMedia(media({ id: 'again' }))
    repos.insertHistory({
      task_id: 't1',
      media_id: 'again',
      author: 'example_author',
      path: 'D:/old/a.jpg',
      size: 100,
      created_at: 1_700_000_000_000
    })
    repos.insertHistory({
      task_id: 't2',
      media_id: 'again',
      author: 'example_author',
      path: 'D:/new/a-2.jpg',
      size: 100,
      created_at: 1_700_000_500_000
    })

    const rows = repos.listArchivedMedia()
    expect(rows).toHaveLength(1)
    expect(rows[0].path).toBe('D:/new/a-2.jpg')
  })

  it('按作者过滤只返回该作者的归档', () => {
    const repos = freshRepos()
    for (const [id, author] of [
      ['m1', 'alice'],
      ['m2', 'bob']
    ] as const) {
      repos.upsertMedia(media({ id, author }))
      repos.insertHistory({
        task_id: `t-${id}`,
        media_id: id,
        author,
        path: `D:/dl/${author}/${id}.jpg`,
        size: 10,
        created_at: 1_700_000_000_000
      })
    }

    expect(repos.listArchivedMedia().map((r) => r.id).sort()).toEqual(['m1', 'm2'])
    expect(repos.listArchivedMedia('alice').map((r) => r.id)).toEqual(['m1'])
  })
})
