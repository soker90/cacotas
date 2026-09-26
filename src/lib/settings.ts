import type { HouseholdSettings } from '../../shared/types.ts'

const KEY = 'cacotas.householdSettings'
const WARNING_KEY = 'cacotas.warningDays'
const COVERAGE_KEY = 'cacotas.coverageDays'
const STAY_KEY = 'cacotas.stayMode'

export const DEFAULT_WARNING_DAYS = 7
export const DEFAULT_COVERAGE_DAYS = 21

const readInt = (key: string, fallback: number): number => {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback
}

const readRecord = (): HouseholdSettings | null => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const r = parsed as Record<string, unknown>
    if (
      !Number.isInteger(r.warningDays) || (r.warningDays as number) < 1 ||
      !Number.isInteger(r.coverageDays) || (r.coverageDays as number) < 1 ||
      typeof r.stayMode !== 'boolean' ||
      !Number.isInteger(r.updatedAt) || (r.updatedAt as number) < 0 ||
      typeof r.deviceId !== 'string'
    ) return null
    return {
      warningDays: r.warningDays as number,
      coverageDays: r.coverageDays as number,
      stayMode: r.stayMode as boolean,
      updatedAt: r.updatedAt as number,
      deviceId: r.deviceId as string,
    }
  } catch {
    return null
  }
}

const writeRecord = (settings: HouseholdSettings): void => {
  localStorage.setItem(KEY, JSON.stringify(settings))
  localStorage.setItem(WARNING_KEY, String(settings.warningDays))
  localStorage.setItem(COVERAGE_KEY, String(settings.coverageDays))
  if (settings.stayMode) localStorage.setItem(STAY_KEY, '1')
  else localStorage.removeItem(STAY_KEY)
}

const currentValues = (): Omit<HouseholdSettings, 'updatedAt' | 'deviceId'> => {
  const stored = readRecord()
  return stored === null
    ? {
        warningDays: readInt(WARNING_KEY, DEFAULT_WARNING_DAYS),
        coverageDays: readInt(COVERAGE_KEY, DEFAULT_COVERAGE_DAYS),
        stayMode: localStorage.getItem(STAY_KEY) === '1',
      }
    : {
        warningDays: stored.warningDays,
        coverageDays: stored.coverageDays,
        stayMode: stored.stayMode,
      }
}

export const getWarningDays = (): number => currentValues().warningDays
export const getCoverageDays = (): number => currentValues().coverageDays
export const isStayMode = (): boolean => currentValues().stayMode

export const getHouseholdSettings = (deviceId: string): HouseholdSettings => {
  const stored = readRecord()
  if (stored !== null) return stored
  return { ...currentValues(), updatedAt: 0, deviceId }
}

const update = (patch: Partial<Omit<HouseholdSettings, 'updatedAt' | 'deviceId'>>, deviceId: string): void => {
  const current = currentValues()
  writeRecord({
    ...current,
    ...patch,
    updatedAt: Date.now(),
    deviceId,
  })
}

export const setWarningDays = (days: number, deviceId: string): void => {
  if (Number.isInteger(days) && days >= 1) update({ warningDays: days }, deviceId)
}

export const setCoverageDays = (days: number, deviceId: string): void => {
  if (Number.isInteger(days) && days >= 1) update({ coverageDays: days }, deviceId)
}

export const setStayMode = (active: boolean, deviceId: string): void => {
  update({ stayMode: active }, deviceId)
}

export const applyHouseholdSettings = (settings: HouseholdSettings): void => {
  writeRecord(settings)
}
