---
igrasp: tutorial
id: compass-app-the-big-picture-how-the-app-is-layered-and-how-a-screen-gets-its-data-2026-10-25
title: 'compass_app: layers, wiring and how the Home screen gets its data'
intro: You will be able to place any file of compass_app in its layer (ui, domain, data), explain how the development and staging entry points swap Local and Remote repositories, and trace the Home screen from the go_router route to ApiClient and back into a ListenableBuilder. You will also know how the tests substitute fakes at the same seams.
project: compass_app
subject: 'The big picture: how the app is layered and how a screen gets its data'
familiarity: newHere
length: standard
generated: 2026-10-25T16:01:28Z
provider: claude-cli
model: sonnet
generationCommit: 21c7190
docsNote: The README only mentions architecture in passing and never describes the ui/domain/data folders. A short architecture page mapping each folder to its role would help newcomers.
chapters:
- id: c1
  title: 'The layer map: ui, domain, data'
  goal: 'Place files of app/lib in the ui, domain or data layer, and say what each layer owns: screens and view models, models and use cases, repositories and services (ApiClient, LocalDataService).'
  minutes: 4
  file: 01-the-layer-map-ui-domain-data.md
- id: c2
  title: 'One interface, two implementations: Local vs Remote'
  goal: Explain how BookingRepository is implemented by BookingRepositoryLocal (LocalDataService, JSON assets) and BookingRepositoryRemote (ApiClient plus BookingApiModel mapping to BookingSummary), and why the ui never sees the difference.
  minutes: 4
- id: c3
  title: 'Wiring it up: entry points and dependencies.dart'
  goal: Show how main_development.dart and main_staging.dart choose providersLocal or providersRemote in config/dependencies.dart, and how context.read() resolves a repository by its abstract type for the router and use cases.
  minutes: 4
- id: c4
  title: 'Following the Home screen: route, ViewModel, Command, widget'
  goal: Trace /home from the GoRoute in router.dart through HomeScreenContainer and HomeViewModel.load (Command0, Result) to the ListenableBuilder in HomeScreen, and explain how the same screen is tested with FakeBookingRepository in home_screen_test.dart.
  minutes: 5
sources:
- path: README.md
  lines: 8-13
  sha256: 3eb9556c9a0feb46333db25619fd11fe1e19a901b7699234d1f571d0e5111f6e
- path: app/lib/ui/home/view_models/home_viewmodel.dart
  lines: 10-15
  sha256: da2a5be4235954be52a8b11f2e2722773b4553806238ed9db5e500c4fedb71a3
- path: app/lib/ui/home/widgets/home_screen.dart
  lines: 19-33
  sha256: 802ac29367c13c2f2befbb3a127e4c9001eadf7f18ff364324936d98b864280a
- path: app/lib/ui/home/view_models/home_viewmodel.dart
  lines: 17-34
  sha256: 35c1ca5a8358b96f2a9f48bc93e724f37a1e4d7511720d8b51bb4b1a48863c9a
- path: app/lib/domain/models/booking/booking_summary.dart
  lines: 10-34
  sha256: 6d0501fc8def6671620c6a85db744067b0a8c751fe2a6c5d805086b56829e799
- path: app/lib/data/repositories/booking/booking_repository.dart
  lines: 9-21
  sha256: ae747797f1cda073e99f4eacf637d41f7994a06b1a6cbe90fd31794961c0f2d5
- path: app/lib/data/services/local/local_data_service.dart
  lines: 49-62
  sha256: 6ef60047733404768dbd2ba3977ecab9aec4363c3472a93f9eeaeddf1463e3f1
- path: app/lib/domain/use_cases/booking/booking_create_use_case.dart
  lines: 16-95
  sha256: bf0a15f13f377245c5c5c51b051b7351b91e7adb6e643eb9937b3fe0007cbcdb
- path: app/lib/data/services/api/api_client.dart
  lines: 112-133
  sha256: 7a273036aa5318d09c82b21032d67d9f501ce51e5f72e419b2e653caacb7f9d2
- path: app/lib/data/repositories/booking/booking_repository_remote.dart
  lines: 14-38
  sha256: 4a8010185b65947e4cfdc6c18f5af6d08e2c0a79043c04ce0adaca23d7eea223
---

# compass_app: layers, wiring and how the Home screen gets its data

You will be able to place any file of compass_app in its layer (ui, domain, data), explain how the development and staging entry points swap Local and Remote repositories, and trace the Home screen from the go_router route to ApiClient and back into a ListenableBuilder. You will also know how the tests substitute fakes at the same seams.

**Project:** compass_app · **Subject:** The big picture: how the app is layered and how a screen gets its data · **For:** developers new to the project · **Length:** standard (~15 min) · **Written:** 2026-10-25 by Hoot with sonnet

## Chapters

1. [The layer map: ui, domain, data](01-the-layer-map-ui-domain-data.md) — Place files of app/lib in the ui, domain or data layer, and say what each layer owns: screens and view models, models and use cases, repositories and services (ApiClient, LocalDataService). (4 min)
2. One interface, two implementations: Local vs Remote — Explain how BookingRepository is implemented by BookingRepositoryLocal (LocalDataService, JSON assets) and BookingRepositoryRemote (ApiClient plus BookingApiModel mapping to BookingSummary), and why the ui never sees the difference. (not written yet)
3. Wiring it up: entry points and dependencies.dart — Show how main_development.dart and main_staging.dart choose providersLocal or providersRemote in config/dependencies.dart, and how context.read() resolves a repository by its abstract type for the router and use cases. (not written yet)
4. Following the Home screen: route, ViewModel, Command, widget — Trace /home from the GoRoute in router.dart through HomeScreenContainer and HomeViewModel.load (Command0, Result) to the ListenableBuilder in HomeScreen, and explain how the same screen is tested with FakeBookingRepository in home_screen_test.dart. (not written yet)

## Hoot's notes

- Documentation: The README only mentions architecture in passing and never describes the ui/domain/data folders. A short architecture page mapping each folder to its role would help newcomers.

<sub>Written by IGrasp's Academy. Open this folder in IGrasp to take the tutorial; the 10 cited ranges are checked against the files when it opens.</sub>
