import { getHouseholdSettings, setStayMode as setHouseholdStayMode } from './settings.ts'
import { getDeviceId } from '../sync/device-id.ts'

export const isStayMode = (): boolean => getHouseholdSettings(getDeviceId()).stayMode

export const setStayMode = (active: boolean): void => {
  setHouseholdStayMode(active, getDeviceId())
}
