/**
 * The choices more than one screen offers: which guitar, which five frets.
 */

import { FENDER, GIBSON, SCALE_LENGTHS, guitar } from '../guitar/instrument.js'

export const GUITARS = [
  { name: 'Fender scale (25.5")', instrument: FENDER },
  { name: 'Gibson scale (24.75")', instrument: GIBSON },
  { name: 'Gretsch scale (24.6")', instrument: guitar('Gretsch', SCALE_LENGTHS.gretsch) },
]

/** Five-fret windows, the way a player thinks about position. */
export const POSITIONS: { label: string; range: [number, number] }[] = [
  { label: 'Open', range: [0, 4] },
  { label: '2nd', range: [2, 6] },
  { label: '5th', range: [5, 9] },
  { label: '7th', range: [7, 11] },
  { label: '9th', range: [9, 13] },
  { label: '12th', range: [12, 16] },
  { label: 'Whole neck', range: [0, 12] },
]
