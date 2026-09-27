/**
 * Global player state.
 *
 * A cross-origin <iframe> loses its playback state as soon as it is moved or
 * re-created in the DOM, so the Bilibili player is mounted ONCE (in App.vue,
 * teleported to <body>) and never unmounted while a video is open. Navigating
 * away does not stop playback: the video page stops reporting its slot
 * rectangle, and the player falls back to the floating mini window.
 */
import { computed, reactive } from 'vue'

export const player = reactive({
  bvid: '',
  page: 1,
  pageCount: 1,
  title: '',
  poster: '',
  /** Where the player should dock, in document coordinates. Null = mini window. */
  slot: null,
  /**
   * Rendered height of the docked player (16:9 frame + its info bar). The page
   * slot reserves exactly this, otherwise the info bar would spill over the
   * next element.
   */
  height: 0,
})

/** A video is loaded in the global player. */
export const isActive = computed(() => Boolean(player.bvid))

/** Active, but no dock slot on screen → floating mini window. */
export const isMini = computed(() => Boolean(player.bvid) && !player.slot)

export function openVideo({ bvid, page = 1, pageCount = 1, title = '', poster = '' }) {
  const changed = player.bvid !== bvid
  if (changed) {
    player.bvid = bvid
    player.page = Math.max(1, Number(page) || 1)
  }
  player.pageCount = Math.max(1, Number(pageCount) || 1)
  if (title) player.title = title
  if (poster) player.poster = poster
}

/** Called by VideoView whenever the dock target moves or resizes. */
export function setSlot({ top, left, width }) {
  if (!player.bvid) return
  const previous = player.slot
  if (
    previous &&
    Math.abs(previous.top - top) < 0.5 &&
    Math.abs(previous.left - left) < 0.5 &&
    Math.abs(previous.width - width) < 0.5
  ) {
    return
  }
  player.slot = { top, left, width }
}

/** Called when the video page unmounts or its slot is not measurable yet. */
export function clearSlot() {
  player.slot = null
}

export function setPage(page) {
  player.page = Math.max(1, Number(page) || 1)
}

/** Published by the floating player so the page slot can reserve the space. */
export function setPlayerHeight(px) {
  const value = Math.max(0, Math.round(Number(px) || 0))
  if (player.height !== value) player.height = value
}

export function closePlayer() {
  player.bvid = ''
  player.slot = null
  player.title = ''
  player.poster = ''
  player.page = 1
  player.pageCount = 1
  player.height = 0
}
