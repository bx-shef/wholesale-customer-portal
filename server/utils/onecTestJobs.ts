// Фоновые прогоны стенда 1С (`/api/onec-test`): один реестр на процесс.
import { createStandJobs } from './standJobs'

export const standJobs = createStandJobs<unknown>()
