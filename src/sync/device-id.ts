const KEY = 'cacotas.deviceId'

/** UUID generated on first launch, persisted forever (§9.6). */
export const getDeviceId = (): string => {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
  }
  return id
}
