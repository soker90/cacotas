/** §9.7 safeguard: the server holds a different baby than this device.
 *  Mixing the data would make things worse — stop and tell the user. */
export class BabyMismatchError extends Error {
  constructor () {
    super('another baby detected on the server')
    this.name = 'BabyMismatchError'
  }
}
