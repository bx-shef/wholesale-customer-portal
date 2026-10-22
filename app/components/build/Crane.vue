<!-- Башенный кран: груз на крюке поднимается и опускается (#78). -->
<template>
  <svg viewBox="0 0 64 48" class="size-14" aria-hidden="true">
    <rect x="16" y="6" width="5" height="40" fill="#f5a623" />
    <path d="M16 10 L21 14 M21 10 L16 14 M16 20 L21 24 M21 20 L16 24 M16 30 L21 34 M21 30 L16 34" stroke="#e08e0b" stroke-width="1" />
    <rect x="6" y="5" width="54" height="4" rx="1" fill="#f5a623" />
    <rect x="6" y="9" width="8" height="5" fill="#3b3f46" />
    <rect x="12" y="44" width="13" height="3" fill="#3b3f46" />
    <g class="cr-hook">
      <line x1="48" y1="9" x2="48" y2="24" stroke="#3b3f46" stroke-width="1.2" />
      <rect x="42" y="24" width="12" height="7" rx="1" fill="#c0563b" />
    </g>
  </svg>
</template>

<style scoped>
.cr-hook { animation: cr-lift 2s ease-in-out infinite; }
@keyframes cr-lift { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
@media (prefers-reduced-motion: reduce) { .cr-hook { animation: none; } }
</style>
