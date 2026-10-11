/**
 * База ЛК на процесс. Файл — `${DATA_DIR}/wholesale.sqlite`; в проде DATA_DIR=/data — том
 * (docker-compose.prod.yml), локально — `.data` в корне проекта.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../db/sqlite'

let db: DatabaseSync | undefined

export function useDb(): DatabaseSync {
  if (!db) {
    const dir = readServerEnv().dataDir
    mkdirSync(dir, { recursive: true })
    db = openDatabase(join(dir, 'wholesale.sqlite'))
  }
  return db
}
