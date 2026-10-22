<!-- Дерево на участке: крона качается (#78). -->
<template>
  <svg viewBox="0 0 64 48" class="size-14" aria-hidden="true">
    <rect x="29" y="28" width="6" height="18" fill="#8b5a2b" />
    <g class="tr-crown">
      <circle cx="32" cy="20" r="13" fill="#4caf50" />
      <circle cx="24" cy="24" r="8" fill="#43a047" /><circle cx="40" cy="24" r="8" fill="#43a047" />
    </g>
    <rect x="6" y="45" width="52" height="2" fill="#7cb342" />
  </svg>
</template>

<style scoped>
.tr-crown { transform-box: view-box; transform-origin: 32px 32px; animation: tr-sway 2.4s ease-in-out infinite; }
@keyframes tr-sway { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
@media (prefers-reduced-motion: reduce) { .tr-crown { animation: none; } }
</style>
