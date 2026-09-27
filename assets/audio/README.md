# Audio

This folder is intentionally empty.

Every sound in the game is synthesised at runtime by `js/game/audio.js` using
the Web Audio API — the engine note is built from a firing-pulse oscillator
bank whose frequency is derived directly from the simulation's crank rpm, plus
filtered noise for induction rasp, turbo whistle, tyre squeal and clutch slip.

That means:

* there are no sample files to download, so the game starts instantly;
* the engine note tracks rpm, load, throttle, gear and boost exactly, because
  it *is* the rpm rather than a recording pitched up and down;
* there is no copyrighted music or audio anywhere in the project.

If you want to add your own sound effects later, drop them here and load them
in `AudioEngine._build()`. Only use audio you have the rights to.
