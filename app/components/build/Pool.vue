<!-- Бассейн на даче: волны бегут по воде (#78). -->
<template>
  <svg viewBox="0 0 64 48" class="size-14" aria-hidden="true">
    <rect x="6" y="22" width="52" height="20" rx="4" fill="#cfe6ff" stroke="#9aa1ab" stroke-width="1.5" />
    <g class="pl-wave">
      <path d="M2 30 q4 -3 8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0" fill="none" stroke="#0075ff" stroke-width="2" />
      <path d="M2 36 q4 -3 8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0" fill="none" stroke="#5aa6ff" stroke-width="2" />
    </g>
    <path d="M50 22 V12 M54 22 V12 M50 15 H54 M50 19 H54" stroke="#9aa1ab" stroke-width="1.5" />
  </svg>
</template>

<style scoped>
svg { overflow: hidden; }
.pl-wave { animation: pl-wave 1.8s linear infinite; }
@keyframes pl-wave { from { transform: translateX(0); } to { transform: translateX(-8px); } }
@media (prefers-reduced-motion: reduce) { .pl-wave { animation: none; } }
</style>
