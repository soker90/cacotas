const KEY = 'cacotas.stayMode'

/** "Estamos en el hospital" — while active, the big button records EXTERNAL. */
export const isStayMode = (): boolean => localStorage.getItem(KEY) === '1'

export const setStayMode = (active: boolean): void => {
  if (active) localStorage.setItem(KEY, '1')
  else localStorage.removeItem(KEY)
}
