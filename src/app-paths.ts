import { homedir } from 'os'
import { join } from 'path'
import {
  HAMMER_GLOBAL_HOME_DIR_NAME,
  HAMMER_HOME_ENV,
  HAMMER_LEGACY_ENV_ALIASES,
} from './hammer-identity/index.js'

const LEGACY_HOME_ENV = HAMMER_LEGACY_ENV_ALIASES.home

function resolveAppRoot(): string {
  const canonicalHome = process.env[HAMMER_HOME_ENV]
  if (canonicalHome) {
    process.env[LEGACY_HOME_ENV] ??= canonicalHome
    return canonicalHome
  }

  const legacyHome = process.env[LEGACY_HOME_ENV]
  if (legacyHome) {
    process.env[HAMMER_HOME_ENV] = legacyHome
    process.stderr.write(`[hammer] Using legacy ${LEGACY_HOME_ENV} alias; set ${HAMMER_HOME_ENV} instead.\n`)
    return legacyHome
  }

  const defaultHome = join(homedir(), HAMMER_GLOBAL_HOME_DIR_NAME)
  process.env[HAMMER_HOME_ENV] = defaultHome
  process.env[LEGACY_HOME_ENV] ??= defaultHome
  return defaultHome
}

export const appRoot = resolveAppRoot()
export const agentDir = join(appRoot, 'agent')
export const sessionsDir = join(appRoot, 'sessions')
export const authFilePath = join(agentDir, 'auth.json')
export const webPidFilePath = join(appRoot, 'web-server.pid')
export const webPreferencesPath = join(appRoot, 'web-preferences.json')
