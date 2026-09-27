/**
 * Tiny reactive store — no Pinia needed for an app this size.
 *
 * There is no account system: the only "identity" is an anonymous nickname
 * generated once per browser, and favourites are kept locally (by bvid).
 */
import { computed, reactive } from 'vue'

const THEME_KEY = 'm37_theme'
const IDENTITY_KEY = 'm37_identity'
const FAVORITES_KEY = 'm37_favorites'

const ADJECTIVES = ['深夜', '午后', '安静', '好奇', '路过', '划水', '认真', '摸鱼']
const NOUNS = ['观众', '旅人', '看客', '路人', '邻居', '影迷']

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw
  } catch (err) {
    return fallback
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch (err) {
    /* storage unavailable — ignore */
  }
}

function makeNickname() {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  const suffix = String(Math.floor(Math.random() * 90) + 10)
  return `${adjective}${noun}${suffix}`
}

function loadFavorites() {
  try {
    const parsed = JSON.parse(readStorage(FAVORITES_KEY, '[]'))
    // bvids are strings; anything else is a leftover from an older dataset
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch (err) {
    return []
  }
}

export const state = reactive({
  theme: readStorage(THEME_KEY, 'light') === 'dark' ? 'dark' : 'light',
  identity: readStorage(IDENTITY_KEY, '') || '',
  favorites: loadFavorites(),
  snackbar: {
    show: false,
    text: '',
    color: 'success',
    timeout: 2600,
  },
})

if (!state.identity) {
  state.identity = makeNickname()
  writeStorage(IDENTITY_KEY, state.identity)
}

/** Anonymous display name used for local comments. */
export const identity = computed(() => state.identity)

/** Material-free toast — a single global v-snackbar. */
export function toast(text, color = 'success', timeout = 2600) {
  state.snackbar.text = text
  state.snackbar.color = color
  state.snackbar.timeout = timeout
  state.snackbar.show = true
}

export function setTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light'
  writeStorage(THEME_KEY, state.theme)
}

export function toggleTheme() {
  setTheme(state.theme === 'dark' ? 'light' : 'dark')
  return state.theme
}

/* ---------------- local favourites (by bvid) ---------------- */

export function isFavorite(bvid) {
  return state.favorites.includes(String(bvid))
}

export function toggleFavorite(bvid) {
  const id = String(bvid)
  const index = state.favorites.indexOf(id)
  if (index === -1) state.favorites.unshift(id)
  else state.favorites.splice(index, 1)
  writeStorage(FAVORITES_KEY, JSON.stringify(state.favorites))
  return index === -1
}

/** Drop favourites whose videos are no longer in the library. */
export function pruneFavorites(existingIds) {
  const existing = new Set(existingIds.map(String))
  const next = state.favorites.filter((id) => existing.has(id))
  if (next.length !== state.favorites.length) {
    state.favorites.splice(0, state.favorites.length, ...next)
    writeStorage(FAVORITES_KEY, JSON.stringify(state.favorites))
  }
}
