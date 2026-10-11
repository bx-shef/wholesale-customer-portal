export default defineAppConfig({
  // Тема Bitrix24 UI: useColorMode() читает эти ключи из app.config, без них он ничего не делает
  // (так же устроено в bx-shef/skills-site и client-bank-alfa-by). По умолчанию — как в системе.
  colorMode: true,
  colorModeInitialValue: 'auto',
})
