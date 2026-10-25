---
igrasp: tutorial
id: platformer-how-this-platformer-is-structured-scenes-nodes-and-signals-2026-10-25
title: 'Platformer 2D: scenes, nodes and signals'
intro: You will be able to trace how Platformer 2D is assembled from instanced scenes (Game, Level, Player, PauseMenu), follow a coin pickup from Coin to the HUD counter through signals, and explain how the same Player and Level scenes are reused for singleplayer and splitscreen.
project: Platformer 2D
subject: 'How this platformer is structured: scenes, nodes and signals'
familiarity: newHere
domainGap: I know Unity but not Godot
length: quick
generated: 2026-10-25T15:55:10Z
provider: claude-cli
model: sonnet
generationCommit: b761b4c
materialNote: 'Docs gap: README.md mentions a default game.tscn and a src/level/ folder, but the project runs game_singleplayer.tscn (project.godot) and level/ is at the root. It also never mentions splitscreen mode or the signal wiring.'
docsNote: The README refers to a default game.tscn and a src/level/ folder that do not exist here (the main scene is game_singleplayer.tscn and level/ is at the root), and it does not explain the Game/Level/Player/PauseMenu composition.
chapters:
- id: c1
  title: 'Game scenes: Level, Player and the interface layer'
  goal: Explain how game_singleplayer.tscn composes Level, Player and PauseMenu by instancing, what game.gd (class Game) does as the root script, and why the project autoloads Music from music.tscn.
  minutes: 5
  file: 01-game-scenes-level-player-and-the-interface-layer.md
- id: c2
  title: 'Signals in practice: from Coin to the pause menu counter'
  goal: Trace coin_collected from Coin._on_body_entered through Player's signal and the connection in game_singleplayer.tscn to PauseMenu._on_coin_collected and CoinsCounter.collect_coin, and tell editor-wired connections from code calls.
  minutes: 5
- id: c3
  title: 'One Player scene, two modes: splitscreen reuse'
  goal: Explain how game_splitscreen.tscn and game_splitscreen.gd extend Game, reuse player.tscn with action_suffix _p1/_p2, share one world_2d between two SubViewports, and how both players feed the same PauseMenu signal.
  minutes: 5
sources:
- path: project.godot
  lines: '22'
  sha256: b90e4503bb8067ad312ba8eaa36dc50153ac2d7d5b09e2332cc0416e2c317013
- path: game_singleplayer.tscn
  lines: 1-24
  sha256: 0c203df13e14602e11398c5f7375650a169e668a3c39d3bdeba482983702dd15
- path: game_singleplayer.tscn
  lines: 3-22
  sha256: e29fde3728b57f508b98cd8d67822cefd12f15165089608482c869337a18fb86
- path: game_singleplayer.tscn
  lines: 8-22
  sha256: a0c554b421335987547f92da4b8662e5e0285109ca7f97e93d647c9db7eb40aa
- path: game.gd
  lines: 1-6
  sha256: 7c3dec9eb8c8106ef50c86c395fb9ae91786862e6e9f7d89f7682897f809f0c1
- path: game.gd
  lines: 8-16
  sha256: 227a378fbed66a37af0b671f0dd02ffa9cedb8b6b534611e13b693e8a5aba9a2
- path: game.gd
  lines: 18-25
  sha256: e3b0de680a41b46323a01ab403d7ad20b628a421417ab66dddefac75dc245ead
- path: game_singleplayer.tscn
  lines: 8-17
  sha256: 4360c59c10e0054ea52b859791644f24a9f2cc7ef144cf5b0e8c3e2ed46117c5
- path: project.godot
  lines: 26-28
  sha256: 47cad002ee791cc8bbe26e91c85a42def21d107e68430dbeb6f58177c485c9dc
---

# Platformer 2D: scenes, nodes and signals

You will be able to trace how Platformer 2D is assembled from instanced scenes (Game, Level, Player, PauseMenu), follow a coin pickup from Coin to the HUD counter through signals, and explain how the same Player and Level scenes are reused for singleplayer and splitscreen.

**Project:** Platformer 2D · **Subject:** How this platformer is structured: scenes, nodes and signals · **For:** developers new to the project · **New to:** I know Unity but not Godot · **Length:** quick (~5 min) · **Written:** 2026-10-25 by Hoot with sonnet

## Chapters

1. [Game scenes: Level, Player and the interface layer](01-game-scenes-level-player-and-the-interface-layer.md) — Explain how game_singleplayer.tscn composes Level, Player and PauseMenu by instancing, what game.gd (class Game) does as the root script, and why the project autoloads Music from music.tscn. (5 min)
2. Signals in practice: from Coin to the pause menu counter — Trace coin_collected from Coin._on_body_entered through Player's signal and the connection in game_singleplayer.tscn to PauseMenu._on_coin_collected and CoinsCounter.collect_coin, and tell editor-wired connections from code calls. (not written yet)
3. One Player scene, two modes: splitscreen reuse — Explain how game_splitscreen.tscn and game_splitscreen.gd extend Game, reuse player.tscn with action_suffix _p1/_p2, share one world_2d between two SubViewports, and how both players feed the same PauseMenu signal. (not written yet)

## Hoot's notes

- Material: Docs gap: README.md mentions a default game.tscn and a src/level/ folder, but the project runs game_singleplayer.tscn (project.godot) and level/ is at the root. It also never mentions splitscreen mode or the signal wiring.
- Documentation: The README refers to a default game.tscn and a src/level/ folder that do not exist here (the main scene is game_singleplayer.tscn and level/ is at the root), and it does not explain the Game/Level/Player/PauseMenu composition.

<sub>Written by IGrasp's Academy. Open this folder in IGrasp to take the tutorial; the 9 cited ranges are checked against the files when it opens.</sub>
