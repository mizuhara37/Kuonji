/**
 * Server API test suite (non-destructive).
 *
 * Exercises the whole HTTP surface — library, bvid publishing, admin auth and
 * the curated 分类 — against a running server, and restores whatever it changes.
 *
 *   npm run start
 *   npm run check:api
 *
 * Env: BASE=http://127.0.0.1:8787  ADMIN_TOKEN=...  (when the server requires it)
 */
import '../server/env.js' // pick up ADMIN_TOKEN from .env when present

const BASE = process.env.BASE || 'http://127.0.0.1:8787'
const TOKEN = process.env.ADMIN_TOKEN || ''

let passed = 0
let failed = 0
const notes = []

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ✔ ${name}`)
  } else {
    failed += 1
    console.log(`  ✘ ${name} ${detail}`)
  }
}

async function api(path, { method = 'GET', body, token = TOKEN, expect } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['X-Admin-Token'] = token
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (err) {
    data = { raw: text }
  }
  if (expect !== undefined && res.status !== expect) {
    throw new Error(`${method} ${path} → HTTP ${res.status} (expected ${expect}): ${text.slice(0, 200)}`)
  }
  return { status: res.status, data }
}

/* ---------------- health ---------------- */
console.log('→ health')
const health = (await api('/health')).data
check('health responds', health.ok === true)
check('reports the storage driver', typeof health.storage === 'string' && health.storage.length > 0, health.storage)
check('reports whether writes are possible', health.canWrite !== false, String(health.canWrite))
check('reports auth requirement', typeof health.authRequired === 'boolean')
console.log(`  ℹ storage=${health.storage} auth=${health.authRequired} library=${health.library}`)

/* ---------------- library + normalization ---------------- */
console.log('→ library')
const list = (await api('/videos')).data
check('library lists videos', Array.isArray(list.items), `total=${list.total}`)
check('returns first-level categories', Array.isArray(list.categories))
const sample = list.items[0]
if (!sample) {
  console.error('\n视频库为空：请先在 /admin 投稿一个视频再运行该脚本。')
  process.exit(1)
}
check(
  'records are normalized (pages/stat/owner always present)',
  Array.isArray(sample.pages) &&
    sample.pages.length > 0 &&
    typeof sample.stat.view === 'number' &&
    typeof sample.owner.name === 'string',
)
check('records carry an addedAt timestamp', Number(sample.addedAt) > 0, String(sample.addedAt))

const single = (await api(`/videos/${sample.bvid}`)).data
check('single video lookup works', single.item.bvid === sample.bvid)
const missing = await api('/videos/BV0000000000')
check('unknown bvid → 404', missing.status === 404, String(missing.status))

const categories = await api('/categories')
check(
  '/api/categories returns first-level partitions',
  categories.status === 200 && Array.isArray(categories.data.categories),
  `HTTP ${categories.status}`,
)

/* ---------------- auth ---------------- */
console.log('→ admin auth')
if (health.authRequired) {
  const denied = await api('/collections', { method: 'POST', body: { name: 'x' }, token: '' })
  check('write without token → 401', denied.status === 401, String(denied.status))
  const deniedDelete = await api(`/videos/${sample.bvid}`, { method: 'DELETE', token: '' })
  check('delete without token → 401', deniedDelete.status === 401, String(deniedDelete.status))
  check('health itself stays public', (await api('/health', { token: '' })).status === 200)
  if (!TOKEN) {
    notes.push('服务器要求 ADMIN_TOKEN，但未提供 → 跳过写操作相关断言（设置 ADMIN_TOKEN 环境变量可完整测试）')
    console.log(`\n${passed} passed, ${failed} failed`)
    notes.forEach((n) => console.log('ℹ ' + n))
    process.exit(failed ? 1 : 0)
  }
} else {
  check('writes are open when ADMIN_TOKEN is unset (local mode)', true)
  notes.push('未设置 ADMIN_TOKEN：写操作当前完全开放，公网部署前务必设置')
}

/* ---------------- collections ---------------- */
console.log('→ collections (分类)')
const name = `测试分类中文${Date.now() % 10000}`
const created = await api('/collections', { method: 'POST', body: { name }, expect: 200 })
const collection = created.data.item
check('creates a collection', collection?.name === name, JSON.stringify(collection))
check('chinese names round-trip as UTF-8', collection?.name === name, collection?.name)
const dup = await api('/collections', { method: 'POST', body: { name } })
check('duplicate name rejected', dup.status === 400, String(dup.status))
const empty = await api('/collections', { method: 'POST', body: { name: '   ' } })
check('blank name rejected', empty.status === 400, String(empty.status))

const assigned = await api(`/videos/${sample.bvid}`, {
  method: 'PATCH',
  body: { collectionId: collection.id },
  expect: 200,
})
check('assigns a video to a collection', assigned.data.item.collectionId === collection.id)

const filtered = (await api(`/videos?collection=${collection.id}`)).data
check('filters the library by collection', filtered.total === 1 && filtered.items[0].bvid === sample.bvid, `total=${filtered.total}`)

const collected = (await api('/collections')).data.items.find((c) => c.id === collection.id)
check('collection reports its video count', collected?.count === 1, String(collected?.count))

const renamed = await api(`/collections/${collection.id}`, {
  method: 'PATCH',
  body: { name: `${name}-改` },
  expect: 200,
})
check('renames a collection', renamed.data.item.name === `${name}-改`, renamed.data.item.name)

// refresh must not drop the curation
const refreshed = await api(`/videos/${sample.bvid}/refresh`, { method: 'POST', expect: 200 })
check('metadata refresh keeps the collection', refreshed.data.item.collectionId === collection.id, refreshed.data.item.collectionId)

const other = (await api('/collections', { method: 'POST', body: { name: `${name}-B` }, expect: 200 })).data.item
const reordered = await api('/collections/reorder', {
  method: 'POST',
  body: { ids: [other.id, collection.id] },
  expect: 200,
})
const orderIds = reordered.data.items.map((c) => c.id)
check('reorder applies the given order', orderIds.indexOf(other.id) < orderIds.indexOf(collection.id))

const removedCollection = await api(`/collections/${collection.id}`, { method: 'DELETE', expect: 200 })
check('deletes a collection', removedCollection.data.ok === true)
const afterDelete = (await api(`/videos/${sample.bvid}`)).data.item
check('deleting a collection keeps its videos (now uncategorized)', afterDelete.collectionId === '')
await api(`/collections/${other.id}`, { method: 'DELETE' })
check('cleanup: test collections removed', (await api('/collections')).data.items.every((c) => !c.name.startsWith(name)))

/* ---------------- publish by bvid (round trip) ---------------- */
console.log('→ publish by bvid')
const candidates = ['BV1JBaA6oEmA', 'BV1F5h86PEUH', 'BV17Eaw6DEMi', 'BV18fhb65EGs', 'BV1Deht6rEpZ']
const known = new Set((await api('/videos')).data.items.map((v) => v.bvid))
const temp = candidates.find((b) => !known.has(b))

if (!temp) {
  notes.push('所有候选 bvid 都已在库中 → 跳过「新增后删除」的往返测试')
} else {
  const added = await api('/videos', { method: 'POST', body: { input: temp }, expect: 200 })
  check('publishes a video from its bvid', added.data.added === 1, JSON.stringify(added.data.results?.[0]?.error || ''))
  const record = added.data.results[0].item
  check('metadata came from Bilibili (title + UP + cover)', Boolean(record.title && record.owner.name && record.cover), record.title)
  check('duration and pages are populated', record.duration >= 0 && record.pages.length >= 1)

  const again = await api('/videos', { method: 'POST', body: { input: temp }, expect: 200 })
  check('re-publishing refreshes instead of duplicating', again.data.refreshed === 1 && again.data.added === 0)

  const batch = await api('/videos', { method: 'POST', body: { input: `${temp} ${sample.bvid}` }, expect: 200 })
  check('batch input reports one result per id', batch.data.results.length === 2, JSON.stringify(batch.data.results.map((r) => r.input)))

  const bad = await api('/videos', { method: 'POST', body: { input: '这不是一个bv号' } })
  check('invalid input rejected with a reason', bad.status === 400 && /无法识别/.test(bad.data.results[0].error), JSON.stringify(bad.data))

  await api(`/videos/${temp}`, { method: 'DELETE', expect: 200 })
  check('cleanup: temp video removed', !(await api('/videos')).data.items.some((v) => v.bvid === temp))
}

/* ---------------- deferred metadata (B 站 412 fallback) ---------------- */
console.log('→ deferred metadata (待补齐)')
const deferredCandidates = ['BV1xx411c7mD', 'BV1Q541167Qg', 'BV1GJ411x7h8', 'BV1uv411q7Mv']
const deferredKnown = new Set((await api('/videos')).data.items.map((v) => v.bvid))
const pendingBvid = deferredCandidates.find((b) => !deferredKnown.has(b))
const totalBefore = (await api('/videos')).data.total

if (!pendingBvid) {
  notes.push('所有候选 bvid 都已在库中 → 跳过「延迟元数据」测试')
} else {
  // 「只存链接」: the bvid is stored without touching Bilibili at all
  const deferred = await api('/videos', {
    method: 'POST',
    body: { input: pendingBvid, deferMetadata: true },
    expect: 200,
  })
  const deferredItem = deferred.data.results[0]
  check('「只存链接」收录成功（不抓取元数据）', deferredItem.ok === true && deferredItem.created === true, JSON.stringify(deferredItem.error || ''))
  check('marks the record as pending', deferredItem.pending === true && deferredItem.item.metadataState === 'pending', String(deferredItem.item.metadataState))
  check('placeholder keeps the bvid as its title', deferredItem.item.title === pendingBvid, deferredItem.item.title)
  check('placeholder has no cover / UP 主 yet', !deferredItem.item.cover && !deferredItem.item.owner.mid)

  const stored = (await api(`/videos/${pendingBvid}`)).data.item
  check('GET reports the pending state', stored.metadataState === 'pending', String(stored.metadataState))

  // the retry endpoint is public — visitors trigger it when they open the video
  const hydrated = await api(`/videos/${pendingBvid}/hydrate`, { method: 'POST', token: '' })
  check('hydrate needs no admin token', hydrated.status === 200, String(hydrated.status))
  check(
    'hydrate fills in the metadata (or stays pending when B 站 refuses)',
    hydrated.data.hydrated === true
      ? hydrated.data.item.metadataState === 'complete' && Boolean(hydrated.data.item.cover)
      : hydrated.data.pending === true,
    JSON.stringify({ hydrated: hydrated.data.hydrated, error: hydrated.data.error }),
  )
  check('hydrate is throttled on an immediate retry', (await api(`/videos/${pendingBvid}/hydrate`, { method: 'POST', token: '' })).data.throttled === true)

  // a bvid B 站 cannot resolve must stay pending (and keep the reason) instead
  // of failing the request or losing the entry
  const ghost = 'BV1zzzzzzzzz'
  if (!deferredKnown.has(ghost)) {
    await api('/videos', { method: 'POST', body: { input: ghost, deferMetadata: true }, expect: 200 })
    const ghostRetry = await api(`/videos/${ghost}/hydrate`, { method: 'POST', token: '' })
    check(
      'hydrate keeps an unresolvable record pending',
      ghostRetry.data.hydrated === false && ghostRetry.data.pending === true,
      JSON.stringify({ hydrated: ghostRetry.data.hydrated, error: ghostRetry.data.error }),
    )
    check(
      'the failed attempt is recorded for the admin',
      Boolean((await api(`/videos/${ghost}`)).data.item.metadataError),
    )
    await api(`/videos/${ghost}`, { method: 'DELETE', expect: 200 })
  }

  // a complete record must never be downgraded by «只存链接»
  const keep = await api('/videos', { method: 'POST', body: { input: sample.bvid, deferMetadata: true }, expect: 200 })
  check(
    '「只存链接」never downgrades an existing complete record',
    keep.data.results[0].pending === false && keep.data.results[0].item.metadataState === 'complete',
    JSON.stringify(keep.data.results[0].pending),
  )

  await api(`/videos/${pendingBvid}`, { method: 'DELETE', expect: 200 })
  const afterDeferred = (await api('/videos')).data
  check('cleanup: deferred test video removed', afterDeferred.total === totalBefore, `${afterDeferred.total} vs ${totalBefore}`)
}

/* ---------------- import（本地补齐 → 上线） ---------------- */
console.log('→ import 接口（本地补齐后上传）')
const importCandidates = ['BV1Q541167Qg', 'BV1Deht6rEpZ', 'BV1uv411q7Mv']
const importKnown = new Set((await api('/videos')).data.items.map((v) => v.bvid))
const importBvid = importCandidates.find((b) => !importKnown.has(b))

if (!importBvid) {
  notes.push('跳过 import 测试：候选 bvid 都已在库中')
} else {
  const sampleRecord = {
    bvid: importBvid,
    aid: 12345,
    cid: 67890,
    title: '导入测试视频',
    desc: '本地补齐好的简介',
    cover: 'https://i0.hdslb.com/bfs/archive/import-test.jpg',
    duration: 100,
    pubdate: 1700000000,
    category: '单机游戏',
    categoryParent: '游戏',
    tags: ['导入'],
    owner: { mid: 42, name: '导入UP', face: '' },
    stat: { view: 1, danmaku: 2, reply: 3, like: 4, coin: 5, favorite: 6, share: 7 },
    pages: [{ page: 1, part: 'P1', duration: 100, cid: 67890 }],
    metadataSource: 'local',
  }

  const deniedImport = await api('/videos/import', {
    method: 'POST',
    body: { records: [sampleRecord] },
    token: '',
  })
  check('import without token → 401', deniedImport.status === 401, String(deniedImport.status))
  check('import rejects an empty list', (await api('/videos/import', { method: 'POST', body: { records: [] } })).status === 400)
  const noTitle = await api('/videos/import', {
    method: 'POST',
    body: { records: [{ bvid: importBvid }] },
  })
  check(
    'import refuses a record without a title（不能把占位记录标成完整）',
    noTitle.status === 400 && /标题/.test(noTitle.data.results[0].error),
    JSON.stringify(noTitle.data.results?.[0]),
  )
  check(
    'import rejects an illegal bvid',
    (await api('/videos/import', { method: 'POST', body: { records: [{ bvid: 'nope', title: 'x' }] } })).status === 400,
  )

  const imported = await api('/videos/import', { method: 'POST', body: { records: [sampleRecord] }, expect: 200 })
  check('import creates a record without touching Bilibili', imported.data.created === 1 && imported.data.imported === 1, JSON.stringify(imported.data.results?.[0]?.error || ''))
  const storedImport = (await api(`/videos/${importBvid}`)).data.item
  check(
    'imported fields survive the round trip',
    storedImport.title === sampleRecord.title &&
      storedImport.owner.mid === 42 &&
      storedImport.stat.like === 4 &&
      storedImport.pages[0].cid === 67890 &&
      storedImport.cover === sampleRecord.cover,
    JSON.stringify({ title: storedImport.title, up: storedImport.owner.mid, like: storedImport.stat.like }),
  )
  check(
    'import marks the record complete with its aid',
    storedImport.metadataState === 'complete' && storedImport.aid === 12345,
    `${storedImport.metadataState}/${storedImport.aid}`,
  )

  // 「本地补齐」不能覆盖线上后台做的分类
  const importCol = (await api('/collections', { method: 'POST', body: { name: `导入分类${Date.now() % 10000}` }, expect: 200 })).data.item
  await api(`/videos/${importBvid}`, { method: 'PATCH', body: { collectionId: importCol.id }, expect: 200 })
  await api('/videos/import', { method: 'POST', body: { records: [{ ...sampleRecord, title: '导入测试视频-二版' }] }, expect: 200 })
  const reimported = (await api(`/videos/${importBvid}`)).data.item
  check('import keeps the existing 分类 by default', reimported.collectionId === importCol.id, reimported.collectionId)
  check('import updates the other fields', reimported.title === '导入测试视频-二版', reimported.title)

  await api(`/collections/${importCol.id}`, { method: 'DELETE', expect: 200 })
  await api(`/videos/${importBvid}`, { method: 'DELETE', expect: 200 })
  check('cleanup: imported test video removed', !(await api('/videos')).data.items.some((v) => v.bvid === importBvid))
}

/* ---------------- image proxy ---------------- */
console.log('→ image proxy')
const good = await fetch(`${BASE}/api/image?url=${encodeURIComponent(sample.cover)}`)
check('proxies Bilibili CDN images', good.ok && (good.headers.get('content-type') || '').startsWith('image/'), good.status + ' ' + good.headers.get('content-type'))
const blocked = await fetch(`${BASE}/api/image?url=${encodeURIComponent('https://example.com/x.jpg')}`)
check('refuses non-Bilibili hosts', blocked.status === 403, String(blocked.status))

console.log(`\n${passed} passed, ${failed} failed`)
notes.forEach((n) => console.log('ℹ ' + n))
process.exit(failed ? 1 : 0)
