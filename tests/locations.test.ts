import { describe, expect, it } from 'vitest'
import type { Location } from '../shared/types.ts'
import { resolveActiveLocationId } from '../src/lib/locations.ts'

const location = (id: string): Location => ({
  id,
  name: id,
  reorderPoint: 40,
  createdAt: 0,
  updatedAt: 0,
  deviceId: 'test',
})

describe('resolveActiveLocationId', () => {
  it('keeps the stored location when it belongs to the baby', () => {
    expect(
      resolveActiveLocationId('home-2', 'default:baby-1', [
        location('default:baby-1'),
        location('home-2'),
      ])
    ).toBe('home-2')
  })

  it('falls back to the new baby default instead of another baby location', () => {
    expect(
      resolveActiveLocationId('default:baby-1', 'default:baby-2', [
        location('default:baby-2'),
        location('grandparents'),
      ])
    ).toBe('default:baby-2')
  })

  it('uses the first available location when the default is not present', () => {
    expect(
      resolveActiveLocationId('missing', 'default:baby-1', [
        location('grandparents'),
        location('nursery'),
      ])
    ).toBe('grandparents')
  })
})
