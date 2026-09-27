<template>
  <section class="comments">
    <div class="comments__head">
      <div class="md-body-medium comments__lead">
        共 {{ totalCount }} 条
        <span class="comments__hint">仅保存在你的浏览器里，不会同步到 B 站</span>
      </div>

      <div class="comments__sort">
        <v-chip
          :variant="sort === 'hot' ? 'flat' : 'tonal'"
          :color="sort === 'hot' ? 'primary' : undefined"
          size="small"
          @click="sort = 'hot'"
        >
          <v-icon start size="14">mdi-fire</v-icon>最热
        </v-chip>
        <v-chip
          :variant="sort === 'new' ? 'flat' : 'tonal'"
          :color="sort === 'new' ? 'primary' : undefined"
          size="small"
          @click="sort = 'new'"
        >
          <v-icon start size="14">mdi-clock-outline</v-icon>最新
        </v-chip>
      </div>
    </div>

    <!-- Top-level composer (anonymous — no account needed) -->
    <div class="composer">
      <IdentityAvatar :name="identity" :size="44" />

      <div class="composer__body">
        <v-textarea
          v-model="newComment"
          class="composer__input"
          placeholder="发条评论吧~"
          variant="outlined"
          rows="2"
          auto-grow
          hide-details
          @keydown.ctrl.enter="submitComment"
        />

        <div class="composer__actions">
          <v-menu :close-on-content-click="true" location="bottom start">
            <template #activator="{ props: activatorProps }">
              <v-btn
                v-bind="activatorProps"
                icon="mdi-emoticon-outline"
                variant="text"
                size="small"
                aria-label="表情"
              />
            </template>
            <v-card class="emoji-card" rounded="lg">
              <button
                v-for="emoji in EMOJIS"
                :key="emoji"
                type="button"
                class="emoji-card__item"
                @click="newComment += emoji"
              >
                {{ emoji }}
              </button>
            </v-card>
          </v-menu>

          <span class="md-body-small composer__hint">
            以 <strong>{{ identity }}</strong> 的身份评论 · Ctrl + Enter 快速发布
          </span>
          <v-spacer />
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            :disabled="!newComment.trim()"
            @click="submitComment"
          >
            发布
          </v-btn>
        </div>
      </div>
    </div>

    <v-divider class="my-2" />

    <template v-if="comments.length">
      <article v-for="(comment, index) in sortedComments" :key="comment.id" class="comment">
        <IdentityAvatar :name="comment.userName" :size="46" class="comment__avatar" />

        <div class="comment__body">
          <div class="comment__head">
            <span class="comment__name md-label-large">{{ comment.userName }}</span>
            <span class="comment__time md-body-small">{{ relativeTime(comment.time) }}</span>
            <v-spacer />
            <v-menu v-if="comment.userName === identity" location="bottom end">
              <template #activator="{ props: activatorProps }">
                <v-btn
                  v-bind="activatorProps"
                  icon="mdi-dots-horizontal"
                  variant="text"
                  size="x-small"
                  aria-label="更多操作"
                />
              </template>
              <v-list density="compact" min-width="120">
                <v-list-item
                  prepend-icon="mdi-delete-outline"
                  title="删除"
                  base-color="error"
                  @click="removeComment(comment)"
                />
              </v-list>
            </v-menu>
          </div>

          <p class="comment__text">{{ comment.text }}</p>

          <div class="comment__actions">
            <v-btn
              :color="commentLikes[comment.id] ? 'primary' : undefined"
              :prepend-icon="commentLikes[comment.id] ? 'mdi-thumb-up' : 'mdi-thumb-up-outline'"
              variant="text"
              size="small"
              @click="like(comment)"
            >
              {{ comment.likes || '' }}
            </v-btn>
            <v-btn
              prepend-icon="mdi-reply-outline"
              variant="text"
              size="small"
              @click="openReply(comment)"
            >
              回复
            </v-btn>
          </div>

          <!-- Nested replies -->
          <div v-if="comment.commentList.length" class="replies">
            <article v-for="reply in pagedReplies(comment, index)" :key="reply.id" class="reply">
              <IdentityAvatar :name="reply.userName" :size="30" />
              <div class="reply__body">
                <div class="reply__head">
                  <span class="reply__name md-label-large">{{ reply.userName }}</span>
                  <span class="comment__time md-body-small">{{ relativeTime(reply.time) }}</span>
                  <v-spacer />
                  <v-btn
                    v-if="reply.userName === identity"
                    icon="mdi-delete-outline"
                    variant="text"
                    size="x-small"
                    color="error"
                    aria-label="删除回复"
                    @click="removeComment(reply)"
                  />
                </div>
                <p class="reply__text">{{ reply.text }}</p>
                <v-btn
                  prepend-icon="mdi-reply-outline"
                  variant="text"
                  size="x-small"
                  @click="openReply(comment, reply)"
                >
                  回复
                </v-btn>
              </div>
            </article>

            <div v-if="comment.commentList.length > REPLY_PAGE_SIZE" class="replies__pagination">
              <v-pagination
                v-model="pages[index]"
                :length="Math.ceil(comment.commentList.length / REPLY_PAGE_SIZE)"
                :total-visible="5"
                density="compact"
                rounded="circle"
                size="small"
              />
            </div>
          </div>

          <!-- Inline reply composer -->
          <transition name="reply-fade">
            <div v-if="replyTarget && replyTarget.commentId === comment.id" class="reply-composer">
              <IdentityAvatar :name="identity" :size="34" />
              <v-textarea
                v-model="replyText"
                class="reply-composer__input"
                :placeholder="replyTarget.placeholder"
                variant="outlined"
                rows="1"
                auto-grow
                hide-details
                autofocus
                @keydown.ctrl.enter="submitReply(comment)"
              />
              <div class="reply-composer__actions">
                <v-btn variant="text" size="small" @click="replyTarget = null">取消</v-btn>
                <v-btn
                  color="primary"
                  variant="flat"
                  size="small"
                  rounded="lg"
                  :disabled="!replyText.trim()"
                  @click="submitReply(comment)"
                >
                  发布
                </v-btn>
              </div>
            </div>
          </transition>
        </div>
      </article>

      <div class="comments__end md-body-medium">没有更多评论了~</div>
    </template>

    <EmptyState
      v-else
      icon="mdi-comment-outline"
      title="还没有评论"
      hint="在这里留个脚印，只有你自己能看到（保存在本地）"
    />

    <!-- Fixed bottom composer, revealed after scrolling -->
    <transition name="reply-fade">
      <div v-show="showBottomComposer" class="bottom-composer">
        <div class="page-container bottom-composer__inner">
          <IdentityAvatar :name="identity" :size="40" />
          <v-textarea
            v-model="bottomText"
            class="bottom-composer__input"
            placeholder="发条评论吧~"
            variant="solo"
            rounded="lg"
            rows="1"
            auto-grow
            hide-details
            density="compact"
          />
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            :disabled="!bottomText.trim()"
            @click="submitBottom"
          >
            发布
          </v-btn>
        </div>
      </div>
    </transition>
  </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import IdentityAvatar from './IdentityAvatar.vue'
import EmptyState from './EmptyState.vue'
import { relativeTime } from '@/utils/format'
import {
  addComment,
  getComments,
  likeComment,
  removeComment as removeCommentEntry,
} from '@/store/comments'
import { identity, toast } from '@/store/app'
import { ui } from '@/store/ui'

const props = defineProps({
  bvid: { type: String, required: true },
})

const emit = defineEmits(['update:count'])

const REPLY_PAGE_SIZE = 3
const EMOJIS = ['😀', '😂', '🥰', '😭', '🤔', '👍', '🎉', '🔥', '❤️', '✨', '😮', '🙏', '💯', '🍜', '🎬', '🎵']

const comments = ref([])
const sort = ref('hot')
const pages = ref([])
const commentLikes = ref({})

const newComment = ref('')
const bottomText = ref('')
const replyTarget = ref(null)
const replyText = ref('')

const showBottomComposer = ref(false)

const totalCount = computed(() =>
  comments.value.reduce((sum, c) => sum + 1 + (c.commentList?.length || 0), 0),
)

const sortedComments = computed(() => {
  const list = [...comments.value]
  if (sort.value === 'hot') return list.sort((a, b) => (b.likes || 0) - (a.likes || 0))
  return list.sort((a, b) => String(b.time).localeCompare(String(a.time)))
})

watch(totalCount, (value) => emit('update:count', value))

function reload() {
  comments.value = getComments(props.bvid)
  pages.value = comments.value.map(() => 1)
}

function pagedReplies(comment, index) {
  const page = pages.value[index] || 1
  return comment.commentList.slice((page - 1) * REPLY_PAGE_SIZE, page * REPLY_PAGE_SIZE)
}

function submitComment() {
  const text = newComment.value.trim()
  if (!text) return
  const res = addComment({ bvid: props.bvid, text, userName: identity.value })
  if (res.success === 'true') {
    newComment.value = ''
    bottomText.value = ''
    toast('发布成功!')
    reload()
  } else if (res.reason === 'WordsForbidden') {
    toast('评论包含敏感词汇!', 'error')
  }
}

function submitBottom() {
  newComment.value = bottomText.value
  submitComment()
}

function openReply(comment, reply = null) {
  replyTarget.value = {
    commentId: comment.id,
    userName: reply ? reply.userName : comment.userName,
    placeholder: `@${reply ? reply.userName : comment.userName}`,
  }
  replyText.value = ''
}

function submitReply(comment) {
  const text = replyText.value.trim()
  if (!text || !replyTarget.value) return
  const res = addComment({
    bvid: props.bvid,
    text: `@${replyTarget.value.userName} ${text}`,
    userName: identity.value,
    parentId: comment.id,
  })
  if (res.success === 'true') {
    replyText.value = ''
    replyTarget.value = null
    toast('发布成功!')
    reload()
  } else if (res.reason === 'WordsForbidden') {
    toast('评论包含敏感词汇!', 'error')
  }
}

function like(comment) {
  const liked = !commentLikes.value[comment.id]
  commentLikes.value = { ...commentLikes.value, [comment.id]: liked }
  comment.likes = likeComment({ bvid: props.bvid, id: comment.id, liked })
}

function removeComment(comment) {
  const res = removeCommentEntry({ bvid: props.bvid, id: comment.id })
  if (res.success === 'true') {
    toast('已删除评论')
    reload()
  }
}

function onScroll() {
  showBottomComposer.value = document.documentElement.scrollTop > 520
}

watch(
  () => props.bvid,
  () => reload(),
)

onMounted(() => {
  reload()
  window.addEventListener('scroll', onScroll, { passive: true })
  // Reserve room for the fixed composer for as long as this component exists,
  // so the footer never has to grow while the reader is already at the bottom
  // (which would leave the copyright line under the composer).
  ui.bottomComposer = true
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  ui.bottomComposer = false
})
</script>

<style scoped>
.comments {
  padding: 20px 0 60px;
}

.comments__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.comments__lead {
  color: rgb(var(--v-theme-on-surface-variant));
}

.comments__hint {
  opacity: 0.75;
  margin-left: 6px;
}

.comments__sort {
  display: flex;
  gap: 8px;
}

.comments__note {
  margin: 0 0 16px;
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.85;
  line-height: 18px;
}

.composer {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.composer__body {
  flex: 1;
  min-width: 0;
}

.composer__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}

.composer__hint {
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.8;
}

.composer__hint strong {
  color: rgb(var(--v-theme-primary));
}

.emoji-card {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  padding: 8px;
  max-width: 300px;
}

.emoji-card__item {
  border: none;
  background: transparent;
  font-size: 18px;
  padding: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s linear;
}

.emoji-card__item:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.comment {
  display: flex;
  gap: 14px;
  padding: 16px 0;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}

.comment__avatar {
  flex: none;
}

.comment__body {
  flex: 1;
  min-width: 0;
}

.comment__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.comment__name {
  color: rgb(var(--v-theme-primary));
}

.comment__time {
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.8;
}

.comment__text {
  margin: 6px 0 0;
  font-size: 15px;
  line-height: 24px;
  white-space: pre-wrap;
  word-break: break-word;
}

.comment__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  margin-left: -8px;
}

.replies {
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-low));
}

.reply {
  display: flex;
  gap: 10px;
  padding: 8px 0;
}

.reply__body {
  min-width: 0;
  flex: 1;
}

.reply__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.reply__name {
  color: rgb(var(--v-theme-primary));
}

.reply__text {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  word-break: break-word;
}

.replies__pagination {
  display: flex;
  justify-content: center;
  padding-top: 6px;
}

.reply-composer {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-top: 10px;
}

.reply-composer__input {
  flex: 1;
}

.reply-composer__actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.reply-fade-enter-active,
.reply-fade-leave-active {
  transition: all 0.25s cubic-bezier(0.2, 0, 0, 1);
}

.reply-fade-enter-from,
.reply-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.comments__end {
  padding: 24px 0 8px;
  text-align: center;
  color: rgb(var(--v-theme-on-surface-variant));
}

.bottom-composer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1100;
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.08);
}

.bottom-composer__inner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 8px;
  padding-bottom: 8px;
}

.bottom-composer__input {
  flex: 1;
}

@media (max-width: 600px) {
  .comment__text {
    font-size: 14px;
  }

  .composer__hint {
    display: none;
  }
}
</style>
