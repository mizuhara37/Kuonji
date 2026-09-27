<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#9FE0B8" />
        <stop offset="1" stop-color="#3E8F63" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" :fill="`url(#${gradientId})`" />
    <path d="M12.5 9.5l10 6.5-10 6.5z" fill="#fff" />
  </svg>
</template>

<script setup>
// Reused by the app bar, footer, video channel card and the upload page, so the
// gradient needs a unique id per instance.
let counter = 0

defineProps({
  size: { type: [Number, String], default: 28 },
})

const gradientId = `brand-mark-gradient-${(counter += 1)}`
</script>
