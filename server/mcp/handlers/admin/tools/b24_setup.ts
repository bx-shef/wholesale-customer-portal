import { z } from 'zod'
import { runSetup } from '../../../../../shared/b24SetupRun'

// Настройка CRM под ЛК токеном приложения: показать недостающее или создать (apply).
// Установка приложения делает то же сама; инструмент — для повтора и проверки (make b24-setup).
export default defineMcpTool({
  name: 'b24_setup',
  description: 'Проверить (или с apply — создать) поля, смарт-процессы и воронку ЛК в CRM коробки',
  inputSchema: { apply: z.boolean().optional() },
  handler: async ({ apply }) => mcpJson(() => runSetup(useB24Call(), apply === true)),
})
