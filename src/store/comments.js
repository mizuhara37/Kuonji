/**
 * Local comment layer.
 *
 * The real comment section lives on Bilibili, so this is a lightweight,
 * browser-local discussion thread keyed by bvid. There is no account system:
 * comments are signed with an anonymous nickname generated per browser.
 */
import { reactive } from 'vue'
import { formatDateTime } from '@/utils/format'

const KEY = 'm37_comments'

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    return {}
  }
}

export const commentsState = reactive({ all: readAll() })

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(commentsState.all))
  } catch (err) {
    /* quota exceeded — keep working in memory */
  }
}

function cloneThread(list) {
  return list.map((c) => ({ ...c, commentList: c.commentList.map((r) => ({ ...r })) }))
}

/** Newest thread first. */
export function getComments(bvid) {
  const list = commentsState.all[bvid] || []
  return cloneThread([...list].sort((a, b) => b.time.localeCompare(a.time)))
}

export function addComment({ bvid, text, userName, parentId = null }) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return { success: 'false', reason: 'Empty' }
  if (['敏感词', '违规词'].includes(trimmed)) {
    return { success: 'false', reason: 'WordsForbidden' }
  }

  const list = commentsState.all[bvid] || (commentsState.all[bvid] = [])
  const entry = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    userName,
    text: trimmed,
    time: formatDateTime(new Date()),
    likes: 0,
  }

  if (parentId) {
    const parent = list.find((c) => c.id === Number(parentId))
    if (parent) {
      parent.commentList.push(entry)
      persist()
      return { success: 'true', id: entry.id }
    }
  }

  list.unshift({ ...entry, commentList: [] })
  persist()
  return { success: 'true', id: entry.id }
}

export function removeComment({ bvid, id }) {
  const list = commentsState.all[bvid] || []
  const index = list.findIndex((c) => c.id === Number(id))
  if (index !== -1) {
    list.splice(index, 1)
    persist()
    return { success: 'true' }
  }
  for (const comment of list) {
    const replyIndex = comment.commentList.findIndex((r) => r.id === Number(id))
    if (replyIndex !== -1) {
      comment.commentList.splice(replyIndex, 1)
      persist()
      return { success: 'true' }
    }
  }
  return { success: 'false' }
}

export function likeComment({ bvid, id, liked }) {
  const list = commentsState.all[bvid] || []
  for (const comment of list) {
    if (comment.id === Number(id)) {
      comment.likes = Math.max(0, comment.likes + (liked ? 1 : -1))
      persist()
      return comment.likes
    }
    const reply = comment.commentList.find((r) => r.id === Number(id))
    if (reply) {
      reply.likes = Math.max(0, reply.likes + (liked ? 1 : -1))
      persist()
      return reply.likes
    }
  }
  return 0
}
