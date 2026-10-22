<!-- Дом строится: стены, затем крыша (#78). -->
<template>
  <svg viewBox="0 0 64 48" class="size-14" aria-hidden="true">
    <rect x="14" y="22" width="36" height="24" fill="#e7d3b0" stroke="#b08a57" stroke-width="1" />
    <rect x="20" y="28" width="8" height="8" fill="#cfe6ff" />
    <rect x="34" y="30" width="9" height="16" fill="#8b5a2b" />
    <path class="hs-roof" d="M10 23 L32 6 L54 23 Z" fill="#c0563b" />
  </svg>
</template>

<style scoped>
.hs-roof { animation: hs-roof 2.2s ease-in-out infinite; }
@keyframes hs-roof { 0%, 20% { transform: translateY(-10px); opacity: 0; } 50%, 100% { transform: translateY(0); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .hs-roof { animation: none; } }
</style>
