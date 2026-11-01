import { describe, expect, it } from 'vitest'
import {
  SongPackageError,
  beatInterval,
  formatTime,
  packageFiles,
  parseSongPackage,
  snapToBeat,
  songSlug,
  stemLabel,
} from '../src/song/model.js'

const minimal = {
  format: 1,
  title: 'Ochi Chornya',
  stems: [{ id: 'guitar', file: 'stems/guitar.mp3', role: 'lead' }],
}

describe('parseSongPackage', () => {
  it('fills the defaults for a minimal package', () => {
    const pkg = parseSongPackage(minimal)
    expect(pkg.title).toBe('Ochi Chornya')
    expect(pkg.beatsPerBar).toBe(4)
    expect(pkg.bars).toEqual([])
    expect(pkg.beatCandidates).toEqual([])
    expect(pkg.sections).toEqual([])
    expect(pkg.charts).toEqual({})
    expect(pkg.stems[0]).toEqual({ id: 'guitar', file: 'stems/guitar.mp3', role: 'lead' })
  })

  it('keeps the optional fields it is given', () => {
    const pkg = parseSongPackage({
      ...minimal,
      artist: 'Chet Atkins',
      year: 1955,
      key: 'Dm',
      beatsPerBar: 3,
      tempoBpm: 96,
      bars: [0, 1.875, 3.75],
      beatCandidates: [0, 0.625, 1.25],
      sections: [{ name: 'chorus', bars: [1, 8], chart: 'chorus' }],
      charts: { chorus: '| Dm | A7 |' },
      scan: { pages: [{ image: 'scan/p1.png', boxes: [{ bar: 3, x: 1, y: 2, w: 3, h: 4 }] }] },
    })
    expect(pkg.artist).toBe('Chet Atkins')
    expect(pkg.beatsPerBar).toBe(3)
    expect(pkg.tempoBpm).toBe(96)
    expect(pkg.sections[0]!.bars).toEqual([1, 8])
    expect(pkg.scan!.pages[0]!.boxes[0]!.bars).toEqual([3])
  })

  it('says what is wrong, in words', () => {
    const bad = (json: unknown, message: string) => {
      expect(() => parseSongPackage(json)).toThrow(SongPackageError)
      expect(() => parseSongPackage(json)).toThrow(message)
    }
    bad({ ...minimal, format: 2 }, 'song format 2')
    bad({ ...minimal, title: '  ' }, 'needs a title')
    bad({ ...minimal, stems: [] }, 'at least one stem')
    bad(
      { ...minimal, stems: [...minimal.stems, { id: 'guitar', file: 'x.mp3' }] },
      'appears twice',
    )
    bad({ ...minimal, bars: [0, 2, 1] }, 'bars must increase')
    bad({ ...minimal, beatsPerBar: 2.5 }, 'whole number')
    bad({ ...minimal, sections: [{ name: 'a', bars: [4, 2] }] }, 'bars [first, last]')
    bad({ ...minimal, sections: [{ name: 'a', bars: [1, 2], chart: 'nope' }] }, 'not in charts')
    bad('text', 'must be an object')
  })
})

describe('package helpers', () => {
  it('lists every file once', () => {
    const pkg = parseSongPackage({
      ...minimal,
      stems: [
        { id: 'guitar', file: 'stems/guitar.mp3' },
        { id: 'bass', file: 'stems/bass.mp3' },
      ],
      scan: { pages: [{ image: 'scan/p1.png' }, { image: 'scan/p1.png' }] },
    })
    expect(packageFiles(pkg)).toEqual(['stems/guitar.mp3', 'stems/bass.mp3', 'scan/p1.png'])
  })

  it('makes a folder-safe slug', () => {
    expect(songSlug({ artist: 'Chet Atkins', title: 'Ochi Chornya (Les Yeux Noirs)' })).toBe(
      'chet-atkins-ochi-chornya-les-yeux-noirs',
    )
    expect(songSlug({ title: '***' })).toBe('song')
  })

  it('labels a stem from its id when no label is given', () => {
    expect(stemLabel({ id: 'bass', file: 'b.mp3' })).toBe('Bass')
    expect(stemLabel({ id: 'guitar', file: 'g.mp3', label: 'Chet' })).toBe('Chet')
  })
})

describe('beatInterval', () => {
  it('prefers a stated tempo', () => {
    expect(beatInterval({ tempoBpm: 120, beatCandidates: [0, 1, 2] })).toBe(0.5)
  })

  it('takes the median gap so one missed beat does not matter', () => {
    expect(beatInterval({ beatCandidates: [0, 0.5, 1.0, 2.0, 2.5] })).toBe(0.5)
  })

  it('has no answer without data', () => {
    expect(beatInterval({ beatCandidates: [] })).toBeNull()
    expect(beatInterval({ beatCandidates: [3] })).toBeNull()
  })
})

describe('snapToBeat', () => {
  const beats = [0, 0.5, 1.0, 1.5, 2.0]

  it('snaps to the nearest beat within tolerance', () => {
    expect(snapToBeat(1.04, beats)).toBe(1.0)
    expect(snapToBeat(1.46, beats)).toBe(1.5)
    expect(snapToBeat(2.1, beats)).toBe(2.0)
  })

  it('leaves a time alone when nothing is close', () => {
    expect(snapToBeat(1.25, beats)).toBe(1.25)
    expect(snapToBeat(5, beats)).toBe(5)
    expect(snapToBeat(1.25, [])).toBe(1.25)
  })
})

describe('formatTime', () => {
  it('reads like a practice clock', () => {
    expect(formatTime(0)).toBe('0:00.0')
    expect(formatTime(65.37)).toBe('1:05.3')
    expect(formatTime(-2)).toBe('0:00.0')
  })
})
