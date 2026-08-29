import type { ComponentType } from 'react'

/**
 * Fit-check visual guide (§8.9). Original line-art — the four checks of the
 * manufacturer's fitting guide, drawn from scratch: NO manufacturer images
 * are copied (they are copyrighted material).
 */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const WaistBelowNavel = () => (
  <svg viewBox='0 0 48 48' width='72' height='72' aria-hidden='true' {...stroke}>
    {/* navel mark */}
    <circle cx='24' cy='14' r='1.5' />
    {/* waistband sits below the navel */}
    <path d='M12 20 h24' strokeDasharray='3 3' />
    {/* diaper front */}
    <path d='M12 20 c0 8 4 10 4 16 v6 h16 v-6 c0 -6 4 -8 4 -16' />
    {/* tape tabs */}
    <path d='M12 20 h-4 M36 20 h4' />
  </svg>
)

const NoLegGaps = () => (
  <svg viewBox='0 0 48 48' width='72' height='72' aria-hidden='true' {...stroke}>
    {/* thigh */}
    <circle cx='14' cy='30' r='8' />
    {/* leg cuff hugging the thigh, no gap */}
    <path d='M22 12 c8 0 14 6 14 14 v14 h-14 c-4 0 -6 -2 -8 -6' />
    <path d='M21 26 a5 5 0 0 0 8 2' />
  </svg>
)

const TwoFingers = () => (
  <svg viewBox='0 0 48 48' width='72' height='72' aria-hidden='true' {...stroke}>
    {/* closed waistband */}
    <path d='M8 22 h32' />
    {/* diaper below */}
    <path d='M8 22 c0 8 4 10 4 18 h24 c0 -8 4 -10 4 -18' />
    {/* two fingers slipped under the band */}
    <path d='M20 22 v-8 M26 22 v-8' />
    <path d='M17 14 a3 3 0 0 1 6 0 M23 14 a3 3 0 0 1 6 0' />
  </svg>
)

const NoRedMarks = () => (
  <svg viewBox='0 0 48 48' width='72' height='72' aria-hidden='true' {...stroke}>
    {/* clean thigh */}
    <path d='M12 10 v18 c0 6 4 10 10 10 h14' />
    {/* waistband */}
    <path d='M12 10 h14' />
    {/* check mark */}
    <path d='M22 24 l5 5 10 -12' />
  </svg>
)

const CHECKS: Array<{ icon: ComponentType, label: string }> = [
  { icon: WaistBelowNavel, label: 'La cintura queda justo bajo el ombligo' },
  { icon: NoLegGaps, label: 'Las piernas no dejan huecos' },
  { icon: TwoFingers, label: 'Caben dos dedos bajo la cintura cerrada' },
  { icon: NoRedMarks, label: 'No deja marcas rojas en la piel' },
]

export const FitGuide = () => (
  <ul className='fit-guide'>
    {CHECKS.map(({ icon: Icon, label }) => (
      <li key={label}>
        <Icon />
        <span>{label}</span>
      </li>
    ))}
  </ul>
)
