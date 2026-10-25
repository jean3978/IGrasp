---
igrasp: tutorial-chapter
tutorial: unreal-the-action-system-how-actions-effects-and-attributes-work-together-2026-10-25
chapter: c1
---

# 1. RogueActionComponent.cpp: the hub that owns Actions and the AttributeSet

> **Hoot:** Every actor that fights in ActionRoguelike carries one URogueActionComponent, and this chapter shows what that hub holds and how it dispatches actions.

## 1. One component per actor, in Source/ActionRoguelike/ActionSystem

The action system lives in `Source/ActionRoguelike/ActionSystem`, and `URogueActionComponent` is its hub. It is an `UActorComponent` marked `BlueprintSpawnableComponent`, so players and monsters get it as a component. It holds three things: the actions an actor can perform (`URogueAction`), the actor's numbers (a `URogueAttributeSet`), and a set of gameplay tags describing its current state. Other code finds it from any actor through `URogueActionComponent::GetActionComponent`, which just forwards to `URogueGameplayFunctionLibrary`.

Sources: [`Source/ActionRoguelike/ActionSystem/RogueActionComponent.h:21-45`](../../../Source/ActionRoguelike/ActionSystem/RogueActionComponent.h#L21-L45) — Class declaration and the public action API · [`Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp:272-275`](../../../Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp#L272-L275) — GetActionComponent delegates to the function library

## 2. Walking the component's state in the header

```igrasp-code-tour
stops:
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.h
  lines: 26-38
  annotation: '`ActiveGameplayTags` is the actor''s current status, a `Transient` `FGameplayTagContainer`. Actions add tags here while running, and `GetActiveTags` exposes it.'
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.h
  lines: 95-100
  annotation: '`AttributeSet` is an `Instanced` `URogueAttributeSet` that can be swapped per actor (Health, MoveSpeed, ...). It replicates and calls `OnRep_AttributeSet` on clients.'
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.h
  lines: 123-132
  annotation: '`DefaultActions` is the designer-edited list of classes granted at start. `Actions` holds the live instances and is replicated. `CachedActions` is a non-replicated map from `FGameplayTag` to action, used for quick lookups.'
```

## 3. `Actions` is replicated but `CachedActions` is not. How does a client end up with a usable `CachedActions` map?

```igrasp-quiz
kind: multipleChoice
choices:
- OnRep_Actions clears and rebuilds it from Actions, keyed by each ActivationTag
- It is copied across the network by a Server RPC
- Each client builds it in BeginPlay from DefaultActions
- It is saved to disk and loaded by the save game system
answer: 0
hint: Look at the RepNotify declared next to the Actions property and at its body near the end of the .cpp.
explanation: '`OnRep_Actions` runs on clients when the array arrives, empties `CachedActions` and re-adds every action under `GetActivationTag()`. The host does the same work inside `AddAction`/`RemoveAction`, so the map never needs to travel over the network.'
sources:
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp
  lines: 505-517
  why: OnRep_Actions rebuilds the cache
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.h
  lines: 127-132
  why: Replicated Actions vs. Transient CachedActions
```

## 4. InitializeComponent guarantees an AttributeSet

`InitializeComponent` runs before `BeginPlay`. If no `AttributeSet` was assigned (via `SetDefaultAttributeSet` in an actor constructor or in the Blueprint details panel), it creates a bare `URogueAttributeSet` and logs a warning naming the owner. It then calls `InitAttributeSet`, which fills the tag-keyed attribute cache. On the server it registers the set with `AddReplicatedSubObject`. The nullptr check deliberately sits before `Super::` because of an engine check on double initialization.

Sources: [`Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp:28-46`](../../../Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp#L28-L46) — InitializeComponent fallback and subobject registration · [`Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp:262-269`](../../../Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp#L262-L269) — SetDefaultAttributeSet is only allowed during init

## 5. Where DefaultActions become server-only

```igrasp-spot-it
prompt: Click the line that restricts granting DefaultActions to the server.
path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp
lines: 48-60
answerLine: 53
explanation: '`GetOwner()->HasAuthority()` gates the loop that calls `AddAction` for each entry of `DefaultActions`. Clients get their `Actions` array through replication rather than creating their own copies.'
```

## 6. StartActionByName, step by step

```igrasp-put-in-order
prompt: Put the path of StartActionByName in order, as it runs on the server.
items:
- Find the action in CachedActions using the ActionName tag
- Check whether the owner has authority
- Ask the action's CanStart(Instigator)
- Call Action->StartAction(Instigator)
- Return true
explanation: The tag is the key into `CachedActions`. A client does not run the action but forwards `ServerStartAction` and lets the server judge `CanStart`. On the server, a failed `CanStart` prints an on-screen message and returns false. Otherwise `StartAction` runs.
sources:
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp
  lines: 398-440
  why: Full StartActionByName body
```

## 7. Find every user of CachedActions

```igrasp-try-it
instruction: In your IDE, run Find All References on `CachedActions` in `RogueActionComponent.cpp`. Compare the hits with `AddAction`, `RemoveAction`, `StartActionByName` and `OnRep_Actions`, and note which ones write to the map and which only read it.
where: ide
expected: Writes in AddAction, RemoveAction and OnRep_Actions. A read in StartActionByName.
sources:
- path: Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp
  lines: 330-352
  why: Cache writes in AddAction and RemoveAction
```

## 8. Recap

- URogueActionComponent owns Actions, CachedActions, AttributeSet, ActiveGameplayTags and the DefaultActions list.
- BeginPlay grants DefaultActions only when HasAuthority, and InitializeComponent guarantees an AttributeSet exists.
- StartActionByName looks up CachedActions by ActivationTag and forwards to ServerStartAction on clients.

Sources: [`Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp:398-440`](../../../Source/ActionRoguelike/ActionSystem/RogueActionComponent.cpp#L398-L440) — Dispatch by ActivationTag
