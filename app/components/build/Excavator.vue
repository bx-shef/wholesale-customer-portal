<!-- Экскаватор копает: стрела с ковшом качается (#78). -->
<template>
  <svg viewBox="0 0 64 48" class="size-14" aria-hidden="true">
    <rect x="6" y="36" width="34" height="8" rx="4" fill="#3b3f46" />
    <circle cx="11" cy="40" r="2.5" fill="#9aa1ab" /><circle cx="23" cy="40" r="2.5" fill="#9aa1ab" /><circle cx="35" cy="40" r="2.5" fill="#9aa1ab" />
    <rect x="10" y="22" width="24" height="13" rx="2" fill="#f5a623" />
    <rect x="12" y="16" width="11" height="10" rx="1.5" fill="#f5a623" />
    <rect x="14" y="18" width="7" height="6" rx="1" fill="#cfe6ff" />
    <g class="ex-arm">
      <path d="M32 26 L46 14 L56 22" fill="none" stroke="#e08e0b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M53 21 L60 23 L58 31 L51 30 Z" fill="#3b3f46" />
    </g>
    <path class="ex-dirt" d="M48 44 q6 -6 12 0 z" fill="#8b5a2b" />
  </svg>
</template>

<style scoped>
/* view-box — точка вращения в единицах рисунка и в старом Safari. */
.ex-arm, .ex-dirt { transform-box: view-box; }
.ex-arm { transform-origin: 32px 26px; animation: ex-dig 1.6s ease-in-out infinite; }
.ex-dirt { transform-origin: 54px 44px; animation: ex-pile 1.6s ease-in-out infinite; }
@keyframes ex-dig { 0%, 100% { transform: rotate(-8deg); } 50% { transform: rotate(14deg); } }
@keyframes ex-pile { 0%, 100% { transform: scaleY(.6); } 50% { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) { .ex-arm, .ex-dirt { animation: none; } }
</style>
