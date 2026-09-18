/**
 * The shell.
 *
 * Two screens so far, both views on the same fretboard: the decoder names what
 * you are holding, and the calibration session teaches the app about your hands
 * so that everything else it says is true of them.
 */

import { useState } from 'react'
import Decoder from './Decoder.js'
import Calibration from './Calibration.js'
import Dictionary from './Dictionary.js'
import Improv from './Improv.js'

const SCREENS = [
  { id: 'decoder', label: 'Decoder' },
  { id: 'dictionary', label: 'Dictionary' },
  { id: 'improv', label: 'Improv' },
  { id: 'calibration', label: 'Calibration' },
] as const

type ScreenId = (typeof SCREENS)[number]['id']

export default function App() {
  const [screen, setScreen] = useState<ScreenId>('decoder')

  return (
    <main>
      <header>
        <h1>{SCREENS.find((s) => s.id === screen)!.label}</h1>
        <nav className="tabs">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === screen ? 'tab active' : 'tab'}
              onClick={() => setScreen(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      {screen === 'decoder' ? <Decoder /> : null}
      {screen === 'dictionary' ? <Dictionary /> : null}
      {screen === 'improv' ? <Improv /> : null}
      {screen === 'calibration' ? <Calibration /> : null}
    </main>
  )
}
