<!--
  Изометрическая стройплощадка для экрана загрузки (#78): дом растёт этажами, кран опускает груз,
  экскаватор роет котлован, самосвал возит землю, в бассейне рябит вода. Сцена — чистый SVG без
  случайностей (одинакова на сервере и в браузере, #76); `prefers-reduced-motion` — стоп-кадр.
-->
<script setup lang="ts">
import { isoBox, isoPoint, isoRect } from '../../utils/iso'

type Shade = [string, string, string]
const box = (x: number, y: number, z: number, w: number, d: number, h: number, c: Shade) => ({ ...isoBox(x, y, z, w, d, h), c })
const p = (x: number, y: number, z = 0) => isoPoint(x, y, z).join(',')

const WALL: Shade = ['#fff3e0', '#ffcc80', '#f0a85a']
const FLOORS = [0, 1, 2].map(i => box(9, 2, i * 1.6, 4, 4, 1.6, WALL))
// Окна на фасаде к зрителю: по два на этаж.
const WINDOWS = [0, 1, 2].map(i => [9.8, 11.6].map(x => box(x, 6, i * 1.6 + 0.5, 0.8, 0.02, 0.7, ['#90caf9', '#64b5f6', '#42a5f5'])))
const ROOF = {
  left: [p(9, 6, 4.8), p(13, 6, 4.8), p(13, 4, 6.4), p(9, 4, 6.4)].join(' '),
  right: [p(13, 2, 4.8), p(13, 6, 4.8), p(13, 4, 6.4)].join(' '),
}
const MAST = box(6.6, 0.6, 0, 0.8, 0.8, 10, ['#ffe082', '#ffca28', '#f9a825'])
const JIB = box(3, 0.7, 10, 10, 0.6, 0.5, ['#ffe082', '#ffca28', '#f9a825'])
const CAB = box(6.4, 0.4, 9.2, 1.2, 1.2, 0.8, ['#90a4ae', '#607d8b', '#455a64'])
const HOOK_TOP = isoPoint(11, 1, 10)
const LOAD = box(10.5, 0.5, 6.2, 1, 1, 0.6, ['#bcaaa4', '#a1887f', '#8d6e63'])
const PIT = isoRect(1, 4, 4, 3, -0.6)
const PILE = [p(5.6, 9.5), p(7.2, 9.5), p(6.4, 8.6, 1.1)].join(' ')
const DIGGER = box(2.2, 8.2, 0.3, 2, 1.6, 1.1, ['#ffd54f', '#ffb300', '#ff8f00'])
const TRACKS = box(2, 8, 0, 2.4, 2, 0.35, ['#757575', '#424242', '#212121'])
const ARM_PIVOT = isoPoint(2.4, 8.6, 1.2)
const ARM_ELBOW = isoPoint(1.6, 6.4, 2.4)
const ARM_BUCKET = isoPoint(2.2, 5.4, 0.2)
const TRUCK = [box(-3, 14.4, 0.3, 2.6, 1.4, 1.1, ['#ef9a9a', '#e57373', '#c62828']), box(-0.4, 14.4, 0.3, 1, 1.4, 1.4, ['#e0e0e0', '#bdbdbd', '#9e9e9e'])]
const POOL = isoRect(10, 9.5, 4.5, 3, -0.2)
const POOL_RIM = isoRect(9.6, 9.1, 5.3, 3.8, 0.02)
const TREES = [[1, 1], [15, 6], [15.2, 13], [0.6, 12.6]].map(([x, y]) => ({ trunk: [isoPoint(x!, y!, 0), isoPoint(x!, y!, 1.2)], crown: isoPoint(x!, y!, 2) }))
const WORKERS = [[8, 7.2], [14, 8]].map(([x, y]) => ({ body: isoPoint(x!, y!, 0.5), head: isoPoint(x!, y!, 1.15) }))
</script>

<template>
  <svg class="iso-site" viewBox="-185 -95 370 300" role="img" aria-hidden="true">
    <polygon :points="isoRect(0, 0, 16, 16, 0)" fill="#aed581" />
    <polygon :points="[p(0, 16), p(16, 16), p(16, 16, -0.8), p(0, 16, -0.8)].join(' ')" fill="#8d6e63" />
    <polygon :points="[p(16, 0), p(16, 16), p(16, 16, -0.8), p(16, 0, -0.8)].join(' ')" fill="#6d4c41" />
    <polygon :points="isoRect(0, 14.2, 16, 1.8, 0.01)" fill="#9e9e9e" />
    <polygon :points="isoRect(0, 15.05, 16, 0.1, 0.02)" fill="#eeeeee" class="iso-dash" />
    <polygon :points="isoRect(8.6, 1.6, 4.8, 4.8, 0.01)" fill="#bcaaa4" />
    <polygon :points="PIT" fill="#8d6e63" />
    <polygon :points="POOL_RIM" fill="#eceff1" />
    <polygon :points="POOL" fill="#4fc3f7" />
    <g class="iso-ripple">
      <polygon :points="isoRect(10.8, 10.2, 1.6, 0.15, 0)" fill="#e1f5fe" />
      <polygon :points="isoRect(12.4, 11.4, 1.4, 0.15, 0)" fill="#e1f5fe" />
    </g>
    <!-- кран: мачта, стрела, кабина, трос с грузом -->
    <g v-for="(b, i) in [MAST, JIB, CAB]" :key="`c${i}`">
      <polygon :points="b.left" :fill="b.c[1]" /><polygon :points="b.right" :fill="b.c[2]" /><polygon :points="b.top" :fill="b.c[0]" />
    </g>
    <g class="iso-hook">
      <line :x1="HOOK_TOP[0]" :y1="HOOK_TOP[1]" :x2="HOOK_TOP[0]" :y2="isoPoint(11, 1, 6.8)[1]" stroke="#455a64" stroke-width="1.2" />
      <polygon :points="LOAD.left" :fill="LOAD.c[1]" /><polygon :points="LOAD.right" :fill="LOAD.c[2]" /><polygon :points="LOAD.top" :fill="LOAD.c[0]" />
    </g>
    <!-- дом растёт этажами, затем крыша -->
    <g v-for="(f, i) in FLOORS" :key="`f${i}`" class="iso-floor" :style="{ animationDelay: `${i * 0.8}s` }">
      <polygon :points="f.left" :fill="f.c[1]" /><polygon :points="f.right" :fill="f.c[2]" /><polygon :points="f.top" :fill="f.c[0]" />
      <polygon v-for="(w, j) in WINDOWS[i]" :key="`w${j}`" :points="w.left" :fill="w.c[1]" />
    </g>
    <g class="iso-roof">
      <polygon :points="ROOF.left" fill="#e57373" /><polygon :points="ROOF.right" fill="#c62828" />
    </g>
    <!-- экскаватор и куча земли -->
    <polygon :points="PILE" fill="#a1887f" class="iso-pile" />
    <g v-for="(b, i) in [TRACKS, DIGGER]" :key="`d${i}`">
      <polygon :points="b.left" :fill="b.c[1]" /><polygon :points="b.right" :fill="b.c[2]" /><polygon :points="b.top" :fill="b.c[0]" />
    </g>
    <g class="iso-arm" :style="{ transformOrigin: `${ARM_PIVOT[0]}px ${ARM_PIVOT[1]}px` }">
      <polyline :points="[ARM_PIVOT, ARM_ELBOW, ARM_BUCKET].map(q => q.join(',')).join(' ')" fill="none" stroke="#ff8f00" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" />
      <circle :cx="ARM_BUCKET[0]" :cy="ARM_BUCKET[1]" r="4" fill="#5d4037" />
    </g>
    <!-- деревья и рабочие -->
    <g v-for="(t, i) in TREES" :key="`t${i}`" class="iso-tree" :style="{ animationDelay: `${i * 0.4}s`, transformOrigin: `${t.trunk[0]![0]}px ${t.trunk[0]![1]}px` }">
      <line :x1="t.trunk[0]![0]" :y1="t.trunk[0]![1]" :x2="t.trunk[1]![0]" :y2="t.trunk[1]![1]" stroke="#6d4c41" stroke-width="3" />
      <circle :cx="t.crown[0]" :cy="t.crown[1]" r="10" fill="#66bb6a" />
      <circle :cx="t.crown[0] - 3" :cy="t.crown[1] - 3" r="5" fill="#81c784" />
    </g>
    <g v-for="(w, i) in WORKERS" :key="`m${i}`" class="iso-worker" :style="{ animationDelay: `${i * 0.6}s` }">
      <rect :x="w.body[0] - 2.5" :y="w.body[1] - 7" width="5" height="8" rx="1.5" fill="#ff7043" />
      <circle :cx="w.head[0]" :cy="w.head[1]" r="3" fill="#ffd54f" />
    </g>
    <!-- самосвал едет по дороге -->
    <g class="iso-truck">
      <g v-for="(b, i) in TRUCK" :key="`k${i}`">
        <polygon :points="b.left" :fill="b.c[1]" /><polygon :points="b.right" :fill="b.c[2]" /><polygon :points="b.top" :fill="b.c[0]" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.iso-site { width: 100%; height: auto; overflow: visible; }
.iso-site g { transform-box: view-box; }
.iso-floor, .iso-roof { transform-box: fill-box; transform-origin: 50% 100%; animation: iso-grow 6s ease-out infinite both; }
.iso-roof { animation-delay: 2.4s; }
@keyframes iso-grow {
  0% { transform: scaleY(0); opacity: 0; }
  12%, 85% { transform: scaleY(1); opacity: 1; }
  100% { transform: scaleY(1); opacity: 0; }
}
.iso-hook { animation: iso-hook 3s ease-in-out infinite; }
@keyframes iso-hook { 0%, 100% { transform: translateY(-22px); } 50% { transform: translateY(0); } }
.iso-arm { animation: iso-dig 2.4s ease-in-out infinite; }
@keyframes iso-dig { 0%, 100% { transform: rotate(-14deg); } 50% { transform: rotate(10deg); } }
.iso-pile { transform-box: fill-box; transform-origin: 50% 100%; animation: iso-pile 2.4s ease-in-out infinite; }
@keyframes iso-pile { 0%, 100% { transform: scale(1); } 60% { transform: scale(1.12); } }
.iso-truck { animation: iso-drive 7s linear infinite; }
@keyframes iso-drive { from { transform: translate(-30px, -17px); } to { transform: translate(210px, 121px); } }
.iso-ripple { animation: iso-ripple 1.8s ease-in-out infinite; }
@keyframes iso-ripple { 0%, 100% { opacity: .3; transform: translateX(0); } 50% { opacity: 1; transform: translateX(4px); } }
.iso-tree { animation: iso-sway 3s ease-in-out infinite; }
@keyframes iso-sway { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.iso-worker { animation: iso-step .8s ease-in-out infinite; }
@keyframes iso-step { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
.iso-dash { opacity: .8; }
@media (prefers-reduced-motion: reduce) {
  .iso-site * { animation: none !important; }
}
</style>
