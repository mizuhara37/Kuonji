/**
 * Small cross-component UI flags.
 *
 * `bottomComposer` is raised by the local comment box on the video page; the
 * footer uses it to lift itself so the fixed composer never covers the
 * copyright line.
 */
import { reactive } from 'vue'

export const ui = reactive({
  bottomComposer: false,
})
