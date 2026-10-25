---
igrasp: tutorial
id: unreal-the-action-system-how-actions-effects-and-attributes-work-together-2026-10-25
title: 'ActionRoguelike''s Action System: URogueActionComponent, URogueAction and URogueAttributeSet'
intro: You'll be able to trace how URogueActionComponent ties together URogueAction, URogueActionEffect and URogueAttributeSet. That covers how URogueGameplayFunctionLibrary::ApplyDamage becomes a Health change, how URogueActionEffect_Thorns and URogueActionEffect_StunFromDamage react to it, and how the server and clients stay in sync. You'll also know where to add a new attribute or effect.
project: ActionRoguelike
subject: 'The action system: how actions, effects and attributes work together'
familiarity: newHere
length: standard
generated: 2026-10-25T15:56:42Z
provider: claude-cli
model: sonnet
generationCommit: 31bd384
materialNote: README lists the Action System only as a feature bullet and still mentions an AttributeComponent that no longer exists. The tutorial relies on the code in Source/ActionRoguelike/ActionSystem.
chapters:
- id: c1
  title: 'RogueActionComponent.cpp: the hub that owns Actions and the AttributeSet'
  goal: Explain, from RogueActionComponent.h and RogueActionComponent.cpp, what URogueActionComponent owns (Actions, CachedActions, AttributeSet, ActiveGameplayTags, DefaultActions), how BeginPlay grants DefaultActions on the server, and how StartActionByName finds an action by ActivationTag.
  minutes: 4
  file: 01-rogueactioncomponent-cpp-the-hub-that-owns-actions-and-the-a.md
- id: c2
  title: 'URogueAction lifecycle: CanStart, GrantsTags, BlockedTags and cooldown'
  goal: Describe the URogueAction lifecycle (CanStart, StartAction, StopAction) and how GrantsTags, BlockedTags and CooldownUntil gate it, using URogueAction_ProjectileAttack and the Status.* tags in DefaultGameplayTags.ini as examples.
  minutes: 4
- id: c3
  title: 'RogueAttributeSet.h: FRogueAttribute, Base vs Modifier and ApplyAttributeChange'
  goal: Explain, from RogueAttributeSet.h and RogueGameplayFunctionLibrary.cpp, how FRogueAttribute combines Base and Modifier in GetValue, how FillAttributeCache builds the 'Attribute.<VarName>' tag map, and how ApplyAttributeChange, PostAttributeChanged and ApplyDamage drive the Health attribute set.
  minutes: 4
- id: c4
  title: 'RogueActionEffect.cpp: Duration, Period, stacking, Thorns and StunFromDamage'
  goal: Show, from RogueActionEffect.cpp, RogueActionEffect_Thorns.cpp and RogueActionEffect_StunFromDamage.cpp, how URogueActionEffect adds Duration, Period and StackCount to URogueAction, and how Thorns and StunFromDamage listen to Attribute.Health.
  minutes: 4
- id: c5
  title: Replication in RogueActionComponent.cpp and RogueAction.cpp
  goal: 'Explain, from RogueActionComponent.cpp, RogueAction.cpp and RogueAttributeSet.cpp, which parts run on the server only and what replicates: Actions, AttributeSet, Health via OnRep_Health, RepData and CooldownUntil. Also how ServerStartAction forwards client requests.'
  minutes: 4
sources:
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.h
  lines: 21-45
  sha256: eacb82d6f4078bb11d07d7498e9b3618e3825683aaec8f3815bb46b86bf386a5
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp
  lines: 272-275
  sha256: 8b00746f5def4bb8551207217a739106504e994c3149a98a0e9f5e3348b1be90
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.h
  lines: 26-38
  sha256: 3e4c2035de5c930294f607dac552c427315aeec00f8db852a033afbbeb83803b
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.h
  lines: 95-100
  sha256: 57226b200a4ca3a53ab34438d88b11d76bed22088e93deb615d6dbf303c28bdb
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.h
  lines: 123-132
  sha256: 131ad636576ce04222a1bfe574c9a902b51ea95e98a7d3d7480a9f123364e7ee
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp
  lines: 505-517
  sha256: 3ff8656b9acf5727a92f970b78ae40f45b6632e99405fcebb22fcc7e3d609ff8
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.h
  lines: 127-132
  sha256: 6ecd20b63f3c0ffe07118dc1aa17f824120a35f316a69746b471e969ac9d2b15
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp
  lines: 28-46
  sha256: a93d5eee821726a9117b1b862e530e926e9c521b69a568bc4ff4c1204d8781e9
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp
  lines: 262-269
  sha256: c99727f68ee43d7dc8aae27d8c53d17e11ce910f008f0aa17841fb4efe36d22d
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp
  lines: 48-60
  sha256: 4477c3f9f34088ece98854dcc1b19e589bd078eac474f9251f1b32b8e68d225f
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp
  lines: 398-440
  sha256: daaf43b9b557decd4082b8c8effa9ca9431924a45edd87dac15df49f4a6b5ee1
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp
  lines: 330-352
  sha256: 220e8ea4f21e2280c5cb197a9dd1a137e6761b237896358513392087320f8fb1
---

# ActionRoguelike's Action System: URogueActionComponent, URogueAction and URogueAttributeSet

You'll be able to trace how URogueActionComponent ties together URogueAction, URogueActionEffect and URogueAttributeSet. That covers how URogueGameplayFunctionLibrary::ApplyDamage becomes a Health change, how URogueActionEffect_Thorns and URogueActionEffect_StunFromDamage react to it, and how the server and clients stay in sync. You'll also know where to add a new attribute or effect.

**Project:** ActionRoguelike · **Subject:** The action system: how actions, effects and attributes work together · **For:** developers new to the project · **Length:** standard (~15 min) · **Written:** 2026-10-25 by Hoot with sonnet

## Chapters

1. [RogueActionComponent.cpp: the hub that owns Actions and the AttributeSet](01-rogueactioncomponent-cpp-the-hub-that-owns-actions-and-the-a.md) — Explain, from RogueActionComponent.h and RogueActionComponent.cpp, what URogueActionComponent owns (Actions, CachedActions, AttributeSet, ActiveGameplayTags, DefaultActions), how BeginPlay grants DefaultActions on the server, and how StartActionByName finds an action by ActivationTag. (4 min)
2. URogueAction lifecycle: CanStart, GrantsTags, BlockedTags and cooldown — Describe the URogueAction lifecycle (CanStart, StartAction, StopAction) and how GrantsTags, BlockedTags and CooldownUntil gate it, using URogueAction_ProjectileAttack and the Status.* tags in DefaultGameplayTags.ini as examples. (not written yet)
3. RogueAttributeSet.h: FRogueAttribute, Base vs Modifier and ApplyAttributeChange — Explain, from RogueAttributeSet.h and RogueGameplayFunctionLibrary.cpp, how FRogueAttribute combines Base and Modifier in GetValue, how FillAttributeCache builds the 'Attribute.<VarName>' tag map, and how ApplyAttributeChange, PostAttributeChanged and ApplyDamage drive the Health attribute set. (not written yet)
4. RogueActionEffect.cpp: Duration, Period, stacking, Thorns and StunFromDamage — Show, from RogueActionEffect.cpp, RogueActionEffect_Thorns.cpp and RogueActionEffect_StunFromDamage.cpp, how URogueActionEffect adds Duration, Period and StackCount to URogueAction, and how Thorns and StunFromDamage listen to Attribute.Health. (not written yet)
5. Replication in RogueActionComponent.cpp and RogueAction.cpp — Explain, from RogueActionComponent.cpp, RogueAction.cpp and RogueAttributeSet.cpp, which parts run on the server only and what replicates: Actions, AttributeSet, Health via OnRep_Health, RepData and CooldownUntil. Also how ServerStartAction forwards client requests. (not written yet)

## Hoot's notes

- Material: README lists the Action System only as a feature bullet and still mentions an AttributeComponent that no longer exists. The tutorial relies on the code in Source/ActionRoguelike/ActionSystem.

<sub>Written by IGrasp's Academy. Open this folder in IGrasp to take the tutorial; the 12 cited ranges are checked against the files when it opens.</sub>
