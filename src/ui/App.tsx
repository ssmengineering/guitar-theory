/**
 * The shell.
 *
 * Learn comes first on purpose. The tools all label things in vocabulary the
 * reading material explains, so the reading is the way in rather than an
 * appendix.
 */

import { useState } from 'react'
import Learn from './Learn.js'
import Decoder from './Decoder.js'
import Dictionary from './Dictionary.js'
import Improv from './Improv.js'
import Calibration from './Calibration.js'

const SCREENS = [
  { id: 'learn', label: 'Learn' },
  { id: 'decoder', label: 'Decoder' },
  { id: 'dictionary', label: 'Dictionary' },
  { id: 'improv', label: 'Improv' },
  { id: 'calibration', label: 'Calibration' },
] as const

type ScreenId = (typeof SCREENS)[number]['id']

export default function App() {
  const [screen, setScreen] = useState<ScreenId>('learn')
  const [lessonId, setLessonId] = useState<string | null>(null)

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

      {screen === 'learn' ? (
        <Learn
          lessonId={lessonId}
          onSelect={setLessonId}
          onGo={(target) => setScreen(target)}
        />
      ) : null}
      {screen === 'decoder' ? <Decoder /> : null}
      {screen === 'dictionary' ? <Dictionary /> : null}
      {screen === 'improv' ? <Improv /> : null}
      {screen === 'calibration' ? <Calibration /> : null}
    </main>
  )
}
