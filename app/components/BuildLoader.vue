<!--
  Ожидание ответа учётной системы: 1С отвечает не мгновенно, и пустой экран выглядит как поломка.
  Значки разделов «Алгены» по очереди подпрыгивают, под ними сменяются советы по стройке и ремонту.
  `prefers-reduced-motion` — без прыжков, только смена подсказок.
-->
<script setup lang="ts">
const props = withDefaults(defineProps<{ title?: string, compact?: boolean }>(), { title: 'Сверяем цены и остатки с учётной системой…', compact: false })

const ICONS = [
  { src: '/loader/mix.png', alt: 'Сухие смеси' },
  { emoji: '🧱' },
  { src: '/loader/paint.png', alt: 'Лакокрасочные материалы' },
  { emoji: '🔨' },
  { emoji: '🪣' },
] as const

const TIPS = [
  'Плиточный клей разводят ровно по инструкции: лишняя вода снижает прочность.',
  'Перед шпатлёвкой стену грунтуют — смесь ляжет ровнее и не отслоится.',
  'Стяжку не сушат обогревателем: трещины появляются от быстрой сушки.',
  'Краску берут с запасом 10–15%: докупленная партия может отличаться тоном.',
  'Гипсовые смеси — для сухих комнат, цементные — для ванной и улицы.',
  'Мешки со смесью хранят на поддоне: от бетонного пола они набирают влагу.',
  'Между слоями штукатурки выдерживают время высыхания, указанное на мешке.',
]

const tip = ref(Math.floor(Math.random() * TIPS.length))
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { tip.value = (tip.value + 1) % TIPS.length }, 3500) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="flex flex-col items-center gap-3 text-center" :class="props.compact ? 'py-4' : 'py-10'" role="status" aria-live="polite">
    <div class="flex items-end gap-3" aria-hidden="true">
      <span v-for="(ic, i) in ICONS" :key="i" class="bl-hop flex size-10 items-center justify-center" :style="{ animationDelay: `${i * 0.15}s` }">
        <img v-if="'src' in ic" :src="ic.src" alt="" class="size-10 object-contain">
        <span v-else class="text-3xl leading-none">{{ ic.emoji }}</span>
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
  30% { transform: translateY(-12px); }
}
.bl-fade-enter-active, .bl-fade-leave-active { transition: opacity .3s ease; }
.bl-fade-enter-from, .bl-fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .bl-hop { animation: none; }
}
</style>
