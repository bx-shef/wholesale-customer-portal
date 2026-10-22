<!--
  Ожидание ответа учётной системы: 1С отвечает не мгновенно, и пустой экран выглядит как поломка.
  Сцена стройки (экскаватор копает, кран, дом) или дачи (дом, дерево, бассейн) — #78; под ней
  сменяются советы по стройке и ремонту. Держать экран не меньше 3 секунд — `useMinLoading`.
  `prefers-reduced-motion` — без прыжков, только смена подсказок.
-->
<script setup lang="ts">
import BuildCrane from './build/Crane.vue'
import BuildExcavator from './build/Excavator.vue'
import BuildHouse from './build/House.vue'
import BuildPool from './build/Pool.vue'
import BuildTree from './build/Tree.vue'

const props = withDefaults(defineProps<{ title?: string, compact?: boolean }>(), { title: 'Сверяем цены и остатки с учётной системой…', compact: false })

/** Сцены (#78): стройка — экскаватор копает, кран, дом; дача — дом, дерево, бассейн. */
const SCENES = {
  build: [BuildExcavator, BuildCrane, BuildHouse],
  dacha: [BuildHouse, BuildTree, BuildPool],
} as const
// На сервере — всегда стройка; дача выпадает только в браузере после монтирования (иначе гидратация, #76).
const scene = ref<keyof typeof SCENES>('build')

const TIPS = [
  'Плиточный клей разводят ровно по инструкции: лишняя вода снижает прочность.',
  'Перед шпатлёвкой стену грунтуют — смесь ляжет ровнее и не отслоится.',
  'Стяжку не сушат обогревателем: трещины появляются от быстрой сушки.',
  'Краску берут с запасом 10–15%: докупленная партия может отличаться тоном.',
  'Гипсовые смеси — для сухих комнат, цементные — для ванной и улицы.',
  'Мешки со смесью хранят на поддоне: от бетонного пола они набирают влагу.',
  'Между слоями штукатурки выдерживают время высыхания, указанное на мешке.',
  'Чашу бассейна гидроизолируют до облицовки: потом течь не найти.',
  'Фундамент под дачный дом заливают ниже глубины промерзания.',
]

// Первая подсказка одна и та же на сервере и в браузере, случайная — только после монтирования:
// иначе разметка расходится при гидратации (#76).
const tip = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  tip.value = Math.floor(Math.random() * TIPS.length)
  scene.value = Math.random() < 0.5 ? 'build' : 'dacha'
  timer = setInterval(() => { tip.value = (tip.value + 1) % TIPS.length }, 3500) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="flex flex-col items-center gap-3 text-center" :class="props.compact ? 'py-4' : 'py-10'" role="status" aria-live="polite">
    <div class="flex items-end gap-2" aria-hidden="true">
      <span v-for="(part, i) in SCENES[scene]" :key="`${scene}-${i}`" class="bl-hop flex items-end justify-center" :style="{ animationDelay: `${i * 0.2}s` }">
        <component :is="part" />
      </span>
    </div>
    <p class="font-medium">
      {{ props.title }}
    </p>
    <Transition name="bl-fade" mode="out-in">
      <p :key="tip" class="max-w-md text-sm text-(--ui-color-design-plain-na-content-secondary)">
        Совет: {{ TIPS[tip] }}
      </p>
    </Transition>
  </div>
</template>

<style scoped>
.bl-hop { animation: bl-hop 1.2s ease-in-out infinite; }
@keyframes bl-hop {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}
.bl-fade-enter-active, .bl-fade-leave-active { transition: opacity .3s ease; }
.bl-fade-enter-from, .bl-fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .bl-hop { animation: none; }
}
</style>
