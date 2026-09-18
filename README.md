# guitar-theory

Guitar theory as an engine. Intervals are shapes, chords are grips, and every
label the app prints is something you can put your fingers on.

```bash
npm run dev     # the app, at localhost:5173
npm test        # run the suite
npm run watch   # re-run on save
npm run demo       # a walkthrough of the fretboard layer
npm run demo:dict  # the generated chord dictionary
npm run demo:voice # voice leading through ii-V-I
npm run demo:bass  # walking and alternating bass
npm run demo:chart # progressions, numbers, transposition
npm run typecheck
```

## How it is organised

```
src/notes/    note arithmetic and scales - the adding machine, not the theory
src/guitar/   the theory: tuning, intervals as shapes, voicings, generation
src/hands/    hand profiles, the fingering solver, the dictionary, comping
src/ui/       the fretboard, and the screens built on it
```

`src/notes/` is the only part not expressed in strings and frets, and it is
deliberately small: spelling, interval arithmetic, chord construction. It is
plumbing. Everything a player would call *theory* lives in `src/guitar/`, where
an interval is a move and a chord is a shape.

Dependencies point one way only — `notes/` never imports `guitar/`, and neither
one imports `hands/`. That last separation matters: the theory stays universal,
and a hand profile is applied at the very end, when the question changes from
*what are the voicings of this chord* to *which of them can these hands play*.
`STANDARD_HAND` ships alongside `ALEX_HAND` and the suite tests both, so the
engine cannot quietly drift into assuming one player's hands.

## The one fact books leave out

On a piano an interval is an interval. On a guitar it is a shape, and the shape
depends which strings you are on, because the strings are not evenly tuned:

```
  string 6 to 5:  5 frets
  string 5 to 4:  5 frets
  string 4 to 3:  5 frets
  string 3 to 2:  4 frets   <- +1 fret
  string 2 to 1:  5 frets
```

Every shape that crosses the G and B strings needs one extra fret. That single
irregularity causes most of what makes the fretboard confusing, and `tuning.ts`
*derives* it rather than hard-coding it, so it stays correct in drop D, open G,
or anything else you tune to — in drop D the tests confirm it finds two
irregular pairs instead of one.

## Intervals as moves

```
  b3 - 3 frets
    from string 5:  3 frets up on the same string
    from string 5:  1 string toward the treble, 2 frets back
    from string 3:  1 string toward the treble, 1 fret back    (crosses G-B)
```

Same interval, different physical moves. `shapesFor()` returns them all;
`describeShape()` says them the way you would out loud. `intervalInFrets()`
prints `b3 - 3 frets`, because three frets is the number a player counts.

## The fretboard map

`fretboardMap()` labels every chord tone in a fret window by degree rather than
letter name — the degree is what tells you how a note will behave. This is the
primitive behind the improvisation HUD. G7 across the first five frets:

```
  1 |  . b7  .  R  .  .
  2 |  3  .  .  5  .  .
  3 |  R  .  .  .  3  .
  4 |  5  .  . b7  .  R
  5 |  .  .  3  .  .  5
  6 |  . b7  .  R  .  .
       0  1  2  3  4  5
```

## Reading a grip

`identifyChord()` takes the notes under your fingers and returns ranked
readings. Every pitch class is tried as a candidate root — *including ones that
are not sounding*, which is how rootless voicings get found. One grip, several
names: that is the premise of Chord Chemistry, so it returns a list rather than
a verdict.

A reading is discarded if it cannot account for every note actually sounding —
a wrong note is fatal, a missing note is only a cost. It also refuses readings
that drop the tone the name depends on: "Cadd9 with no 9" is not a reading of
anything, it is a C. Intermediate extensions stay droppable, because R-3-b7-13
with no 9th is an everyday 13th voicing.

## Generating your chord dictionary

`generateVoicings()` finds every way a chord can be played on the neck — 989
voicings of Cmaj7 across twelve frets. `chordDictionary()` runs each one through
the fingering solver for a given hand and ranks what survives.

This is the part a printed book cannot do. Chord Chemistry is about two thousand
voicings fingered for a conventional hand. Filtering it throws away most of the
book *and* misses everything a different hand can do that a conventional one
cannot. Generating has neither problem.

Two judgments are kept deliberately separate, because they are different
questions:

- **`handCost`** — can you play it?
- **`spacingPenalty`** — is it worth playing? Low interval limits, applied the
  way an arranger would: the same interval that rings clear between the top two
  voices turns to mud between the bottom two, and the lower you go the wider it
  has to be. `spacingOf()` holds those thresholds in one function so they can be
  argued with.

`moveableOnly` is worth turning on for most dictionary work. Open strings are
genuinely free for the fretting hand, so without it they sweep the top of every
ranking with shapes that only work in one key.

The same Cmaj7, for two hands, moveable shapes only:

```
Standard
 1.08   x x 9 9 x 8   7 3 R    top:R   1:1@8  2:3,4@9
 1.08   x x 9 9 8 x   7 3 5    top:5   1:2@8  2:3,4@9
 1.08   8 x 9 9 x x   R 7 3    top:3   1:6@8  2:3,4@9

Alex
 0.93   8 x 9 9 x x   R 7 3    top:3   T:6@8  2:3,4@9
 1.08   x x 9 9 x 8   7 3 R    top:R   1:1@8  2:3,4@9
```

Same shape at the top of both lists — C on string 6, B and E above it, a Cmaj7
shell with the 3rd in the melody. A conventional hand fingers it 1 and 2. Alex's
comes in cheaper because thumb-over is everyday technique for him rather than a
stretch, so one finger and a thumb hold the whole thing.

### The Chord Chemistry index

`stringSets` and `topDegree` reproduce how the book is organised — voicings on a
chosen string set, with a chosen tone in the melody. `byStringSet()` and
`byTopDegree()` build the index. Non-adjacent sets like 6-4-3-2 are generated as
readily as contiguous ones; for a flatpicker those are awkward, for fingerstyle
they are free.

### Finding something you can actually play

`findAlternatives()` takes the grip you were trying to hold and returns what
these hands can do instead, with `keepTopNote` as a hard constraint because in
chord melody the top voice is the tune. Each result carries `explain()`:

```
 0.93   8 x 9 9 x x   R 7 3    top:3   T:6@8  2:3,4@9
        - drops the 5 - the least functional tone in the chord
        - thumb takes the bass note, which frees a finger above it
        - middle-finger barre covers two voices with one finger
        - skips a string (6-4-3) to open up the spacing
        - sits 5 frets higher, where the same span asks less of the hand
        - keeps the same note in the melody
        - leaves the pinky free for a melody note
```

Which is where the accessibility feature turns out to be the teaching feature.
Every substitution arrives with the chord theory that justifies it — which tones
are structural, which are colour, which are expendable.

## Voice leading

The most useful thing the engine produces is a sentence:

```
Dm7 -> G7     the b3 becomes the b7 - held, no movement
              the R becomes the 5 - held, no movement
              the b7 falls a half step to the 3

G7  -> Cmaj7  the b7 falls a half step to the 3
              the 5 rises a whole step to the 3
              the 3 becomes the 7 - held, no movement
```

That is functional harmony in two lines, and it is invisible if you think of
chords as grips that replace each other rather than as voices that move. For
fingerstyle it is the whole game: the inner line moving under a held melody note
is the Chet and Ted Greene sound, and it is nearly always one voice shifting a
fret while everything around it stays put.

Voices are matched by an order-preserving alignment — lowest to lowest, on down
the line — which is both the musically correct model and the reason this is a
small dynamic program rather than a search over permutations. Voices are never
allowed to cross, because in real voice leading they do not.

A transition reports four numbers, and keeping them apart matters:

| | |
|---|---|
| `totalMotion` | semitones travelled by the voices that persist |
| `voicesChanged` | voices that appear or vanish |
| `handShift` | frets the hand itself has to travel |
| `effort` | the sort key, combining all three |

`totalMotion` alone is a trap. Measuring only the voices that survive means a
change that abandons the shape entirely and grabs a different one somewhere else
scores as *zero movement* — which is how the first version of the path search
ended up preferring to teleport across the neck. There is a regression test for
exactly that.

### Playing through changes

`smoothestPath()` is a shortest path, not a series of lookups. Choosing voicings
for a progression is a different problem from choosing a voicing for a chord: a
grip that is easy alone can be the wrong grip here, because reaching it means
throwing the whole hand down the neck, and a slightly harder shape that leaves
three fingers where they already are beats it every time.

Over ii-V-I it parks the hand at frets 7-9 and finds the b7-to-3 resolution
twice. Picking each chord independently jumps 3 -> 6 -> 8.

### Guide tones

`guideToneLine()` connects the 3rds and 7ths through a progression with the
least movement, solved as a shortest path over candidate positions. Over ii-V-I
it finds F held from the b3 of Dm7 into the b7 of G7, then falling a half step to
the 3rd of Cmaj7 — three notes, and the changes are already unmistakable. This is
most of bebop pedagogy in one function.

### Substitution

`substitutesFor()` ranks by *which* tones two chords share, not how many.
Counting gets this wrong in a way that matters: G7 and Db7 have only two notes in
common, but they are B and F — the tritone that makes a dominant sound like a
dominant. That is the entire mechanism of the tritone substitution, and a raw
count buries it under chords that happen to share a root and a fifth.

Same-root results rank below different-root ones, because Cmaj9 is a fine thing
to play instead of Cmaj7 but it is an extension, not a substitution.

## The app

`npm run dev`. The first screen is the decoder: put a shape on the neck and it
names every chord it could be, in degrees, and tells you whether your hands can
hold it.

Dots are coloured by **function, not note name** — root, third and seventh get
the three strong hues because those decide what a chord is, the fifth is
deliberately quiet because it is the one you drop first, and tensions get the
cool accent. Switching the labels to note names keeps the colours, so the degree
is still visible at a glance.

`src/ui/layout.ts` is pure arithmetic and tested like everything else. It draws
frets from `fretFromNut()` — the same function the hand model uses for reach — so
the board is in true proportion. Measured off the rendered SVG, the fret gaps run
83.7px at the first fret down to 47px at the twelfth. The shape that looks like a
stretch at the nut visibly stops looking like one at the ninth, which is the
argument for moving up the neck made in pixels rather than prose.

`Fretboard.tsx` takes dots and labels and nothing else. It knows about strings
and frets and not about chords, because the other screens are views on it.

`ChordDiagram.tsx` is the small vertical box, for browsing many voicings at
once. Note the deliberate difference: chord boxes are **evenly** spaced. Over the
four or five frets a box covers, true proportion buys nothing and costs
legibility, and every chord book ever printed uses even spacing — a box that did
otherwise would just look wrong. A box starts at its shape's own lowest fretted
note, with the position marked beside it, which is again how the books do it.

### The Dictionary screen

Type a chord and get every voicing the guitar allows, ranked by what it costs
your hands. The two filters are Ted Greene's two organising axes — which strings
you are on, and what is in the melody — because those are the questions you
actually have when harmonising a tune, and the reason his book is laid out the
way it is. The "on top" menu offers only the degrees the chord actually has.

Asking for Cmaj7 on strings 5-4-3-2 with the 3rd in the melody returns 14
voicings, 5 of them playable, each carrying the reason it works: *middle-finger
barre covers three voices with one finger*, *drops the 5 — the least functional
tone in the chord*, *leaves the pinky free for a melody note*.

### The Improv screen

Lock your hand to one position and watch the same frets change meaning as the
chords go by. That is the entire idea, and it teaches playing the changes better
than a chapter can, because the thing to internalise is not a set of scales — it
is that one note under your finger keeps changing its job.

Three frets on the D string, in 5th position, hand unmoved:

| | over Dm7 | over G7 |
|---|---|---|
| fret 5 (G) | 11 | **R** |
| fret 7 (A) | 5 | **9** |
| fret 9 (B) | 13 | **3** |

`toneRoles()` sorts every note of the chord's scale into chord tone, available
tension, or **avoid note**. The avoid rule is the one worth knowing: a scale tone
sitting a half step above a chord tone will fight it. That is why the 4th sounds
wrong held over a major chord — it is a semitone above the 3rd — and why the same
note is fine over the minor chord a third below, where nothing sits underneath
it. Avoid notes draw as dashed red circles and say what they are leaning on.

Four display modes: everything, chord tones only, guide tones (3rds and 7ths —
over G7 that is B and F, the tritone, and the changes are already unmistakable),
and target practice, which highlights one degree to land on every chord.

Transport steps through the changes by hand or auto-advances at a tempo, each
chord holding for its own beats — so a bar with two chords in it goes past twice
as fast, the way it would in the tune.

## Calibration

Every number in a hand profile started as a guess, and guesses about hands are
bad — neither of us can introspect a stretch into inches, and the values that
matter most here are ones no book would have reason to write down.

So the app asks. `npm run dev`, then the Calibration tab: 21 grips, and for each
one you play it and say whether it was comfortable, awkward, or not happening.

**Awkward counts as possible.** The model has one number per capability, not
two, so the honest reading of an awkward grip is *within reach and expensive* —
which is what a cost function is for. Only "can't do it" closes a door.

The design decision that makes fitting tractable is that each probe **isolates
one parameter**, in a graded series that gets harder. Fitting is then just
finding where each series stops working, rather than searching a model with six
knobs at once. The one exception is marked: whether the thumb reaches string 5
tells you nothing about string 6, so that group carries `graded: false` and is
fitted as independent questions.

Span probes sit at the 3rd fret on purpose — that is where frets are widest and a
limit actually bites — and the answer is recorded in **inches**, which is
position-independent. One series near the nut therefore tells the model what is
possible everywhere on the neck, and the same probe on a Gibson scale correctly
reports a shorter reach than on a Fender rather than both claiming "4 frets".

A finished session reports only what actually changed:

```
Maximum reach            4.60″ → 5.38″
  Wider than assumed — more voicings are within reach than the model allowed.
Middle-finger barre      4 strings → 3 strings
  Narrower than assumed. Voicings that needed a wider middle barre will disappear.
Thumb position           -1 to 1 frets → -2 to 1 frets
  A wider window than assumed, which frees up thumb-and-fingers arrangements.
```

...and hands back the fitted profile as something to paste into `ALEX_HAND`.
Answers persist in localStorage, because this is worth doing properly with a
guitar in your hands rather than rushed in one sitting.

## Progressions and numbers

A chart in letters tells you what to play in one key. A chart in numbers tells
you what the song *is*, and you can put it in any key on the stand. That is the
argument for the Nashville system, and it is also why numbers belong on screen
while you write: every chart you make quietly drills functional thinking.

Nothing stores a number. `nashville()` and `romanNumeral()` compute from the
chord and the key every time, so they cannot drift out of step with the chords
they describe — and transposition comes free, because a progression that knows
its numbers can be printed anywhere.

```
    Cmaj7    1maj7   Imaj7   diatonic
    A7       6(7)    VI7     secondary-dominant
             V of ii - a dominant aimed at D rather than at the key.
             It borrows the leading tone of ii for one chord.
    Bb       b7      bVII    borrowed
             the flat seven - borrowed from the parallel minor, and the
             backbone of most rock and folk
    Fm       4m      iv      borrowed
             the minor four - the classic sad turn on the way home
```

`analyze()` sorts every chord into diatonic, secondary dominant, tritone
substitute, borrowed, or plainly chromatic, and says why. `findCadences()` picks
out ii-V-I, ii-V, V-I, IV-I and the deceptive V-vi — once you can see ii-V-I you
see it everywhere, which is most of the reason to look.

### Numbering runs off the letter, not the sound

In C, `Bb` is the flat seven and `A#` is the sharp six. They sound identical and
they are different numbers, and a chart calling one the other reads wrong to
anybody playing from it. `degreeOf()` counts letter names, which is what all the
spelling work in `notes/pitch.ts` was for.

The same care shows up in transposition:

```
  numbers   | 1maj7 | 6m7 | 2m7 | 5(7) |
  C major   | Cmaj7  | Am7  | Dm7  | G7  |
  Eb major  | Ebmaj7 | Cm7  | Fm7  | Bb7 |
  F# major  | F#maj7 | D#m7 | G#m7 | C#7 |
```

F# major comes out in sharps, because that is how F# major spells itself.

`parseChart()` reads `| Cmaj7 | Dm7 G7 |` and splits each bar evenly.
`parseNashvilleChart()` reads the number form and builds it in any key. A
quality starting with a digit goes in brackets — `5(7)`, not `57`, which reads
as a number.

Diatonic qualities are derived from the scale rather than listed, so they stay
right in dorian and mixolydian without a second table: the tonic seventh chord
in G mixolydian comes back as `G7`, which is the point of the mode.

## Bass lines

You already play these. The chromatic walk-up into the next chord, the thumb
dropping to the 5th on beat two, the passing note between the root and the third
- those have been in your hands for years. What `bass.ts` does is put names on
them, so a move you make by instinct in G becomes one you can deliberately make
in Db.

Every note comes out labelled with what it is doing:

```
Dm7     1  4/ 0  R     the root - where the bar lands
        2  4/ 2  sc.   from the Dorian scale over this chord
        3  4/ 3  b3    a chord tone, so it is safe on any beat
        4  4/ 4  app.  a half step below the next root - the strongest way in
```

D-E-F-F# into G. `walkingBass()` puts the root on beat one, aims the last beat
at the chord that is coming, and fills the gap by step. `alternatingBass()` is
the Travis and Chet pattern - root on the strong beats, 5th (or 3rd) between,
and when the chord is about to change the last beat becomes a walk-up instead.
That substitution is what makes the pattern sound like music rather than a
metronome with a pitch.

`scaleForChord()` in `notes/scale.ts` decides which passing tones are available.
The chord says which notes are structural; the scale says which of the ones in
between you can move through without it sounding like a mistake.

### Two things the search had to be taught

**A bass line has direction.** Minimising movement alone produces a line that
oscillates between two adjacent notes forever - optimal by the numbers, dead to
the ear. The search state is a *pair* of notes rather than one, because
oscillation and direction are properties of three consecutive notes and one note
of memory cannot see them.

**The leading tone leans.** Approaching the next root from a half step below is
stronger than dropping onto it from above. The first version picked whichever
approach happened to sit closest to the hand, which is not a musical reason, and
turned a C-to-F walk-up into C-G-C-F# instead of C-G-C-E.

### Thumb and fingers

`arrangeThumbAndFingers()` chooses the bass line and the chord shapes *together*.
This is not optional. Generated separately they produce two things that cannot be
played at once: the comping search puts chords wherever they are easiest, the
bass search puts roots wherever they are lowest, and the hand cannot be in both
places. The first version of this demo failed on all four bars for exactly that
reason.

So the chord is confined to the upper strings and forbidden the thumb - the thumb
has a job already - and shapes are scored on whether the bar's bass notes are in
reach, not merely on whether the grip is easy:

```
C    fingers . . 2 0 . 0    works
     1  5/ 3  R     free-finger   finger 2 is idle and can get there
     2  6/ 3  5     thumb         the thumb comes over for it (bass-wrap)
     3  5/ 3  R     free-finger   finger 2 is idle and can get there
     4  6/ 0  app.  open-string   an open string the chord is not using
```

The fingers hold E-G-E - a rootless C, because the bass is supplying the root -
and the thumb alternates underneath. `reachFor()` reports the four ways a bass
note is free (already fretted by the chord, an unused open string, under a barre
the hand is already holding, or an idle finger) and the one way it costs
something, which is the thumb coming over for it.

## Reach, and why position matters

Frets are spaced exponentially, so the same shape asks less of the hand further
up the neck. On a 25.5" scale a four-fret span costs 4.97" at the 1st fret and
3.13" at the 9th — a 37% difference. That is why *try it somewhere else on the
neck* is a real answer to an unplayable chord and not just encouragement.

## Worked example: G at the 3rd fret

```
full 6-string / Standard
   2.65  1:1,2,6@3  2:3@4  3:4,5@5      {barre:1 barre:3}

full 6-string / Alex
   3.97  T:6@3  1:1,2@3  2:4,5@5  4:3@4 {barre:1 barre:2 thumb-bass}

four-note / Alex
   1.72  T:6@3  1:3@4  2:4,5@5          {barre:2 thumb-bass}
```

Playability is a cost, not a yes/no, which turns "find me an easier voicing"
into an ordinary sort. The six-string shape survives for the Alex profile but
costs 3.97, because it forces the pinky closer to the nut than the middle
finger. The four-note version comes in at 1.72: thumb on the root, index on the
3rd, middle barring strings 5 and 4. It sounds G–D–G–B, root in the bass, 3rd on
top, **and the pinky is never used**, so it stays free for a melody note. No
published fingering for G looks like that one, which is the argument for
generating a dictionary rather than filtering a book.

## Calibration

Every constant marked `CALIBRATE` in `hands/profiles.ts` is a placeholder, to be
fitted from marked example grips rather than guessed. Open questions:

- **`barreLimit`** — how much index barre survives while the thumb is wrapped?
  Strings 1–2, or 1–3? Currently guessed at 3.
- **`bass-wrap.strings`** — can the thumb reach string 5, or string 6 only?
  Currently 6 only. String 5 would unlock A-shape voicings the same way.
- **`maxSpanInches`** — specifically the middle-to-pinky span, which matters most
  when there is no ring finger between them.
- **`fingers[2].maxBarreStrings`** — how wide is a middle-finger barre? Now
  load-bearing: the generator reaches for three-string middle barres on some
  string sets, and currently assumes up to four.

## The Learn screen

Nine short pieces covering the vocabulary the rest of the app uses — half steps,
intervals, the major scale, how chords are built, what the 3rd and 7th decide,
why the dots show numbers instead of letters, voicings, keys, and what to play
over a chord.

Written under three rules, all of them reactions to why theory books do not stick:

**Every figure is generated by the engine.** The chord boxes come from
`chordDictionary`, the tone maps from `positionMap`, the interval tables from
`shapesFor`, the formula tables from the quality registry itself. None of it is
a picture. The reading therefore cannot drift away from what the tools say,
which is the usual failure of a manual written alongside software.

**It starts from the guitar.** Not "here is a minor third, now find one" but
"you already play this shape, and here is what the parts are called". The first
lesson's point is that every fret is a half step, which makes the guitar easier
than the piano — and almost no book says so.

**The claims are tested.** `tests/lessons.test.ts` asserts the numbers in the
prose against the engine that produces them. If a lesson says a major 3rd is
four frets, a test checks. If it says the 7 chord happens on exactly one degree
of a major key, a test builds the key and counts.

That last rule earned its keep immediately. The "3rd and 7th decide everything"
figure originally used Cmaj7 / C7 / Cm7 / **Cm7b5** under a caption saying
everything but those two notes stays put — but `m7b5` differs from `m7` in the
*fifth*, so the caption was false. Swapping in `CmMaj7` makes the four chords
the complete 2x2 grid of third against seventh, and the lesson now names
`m7b5` separately as the exception. A second test pins the figure down further:
the generator must place the root and 5th identically in all four boxes, or the
figure stops demonstrating its own caption.

## Deploying

The app has no backend — every voicing, fingering and chord name is computed in
the browser. That makes it a static site, which is why full offline works rather
than being a compromise: the whole thing is 88 KB gzipped and once cached it
needs the network never.

```bash
npm run build     # -> dist/, including the service worker
```

`vite-plugin-pwa` generates the manifest and service worker. Icons are built
from `assets/icon.svg` by `node assets/build-icons.mjs` — rerun that after
changing the source SVG.

Two notes on the icons, both of which bite if ignored. The **maskable** variant
is full-bleed with no corner radius, because the OS crops it to its own shape
and any radius of ours shows as a notch inside theirs; its content is scaled to
84% to stay inside the safe circle. And every icon is **flattened** onto the
background colour, because iOS refuses transparency on a home-screen icon.

iOS also ignores most of the manifest, so the standalone behaviour is asked for
with `apple-mobile-web-app-*` meta tags in `index.html` instead. It shows no
install prompt either — it is Share → Add to Home Screen.

`public/robots.txt` disallows indexing. The site is public but unlisted.

## Not built yet

The chart editor, and audio: playback, backing tracks, anything that makes a
sound. The Improv screen is built to take a backing track when there is one —
the transport already knows about beats and tempo.
