---
igrasp: tutorial-chapter
tutorial: compass-app-the-big-picture-how-the-app-is-layered-and-how-a-screen-gets-its-data-2026-10-25
chapter: c1
---

# 1. The layer map: ui, domain, data

> **Hoot:** Under app/lib, Compass splits into ui, domain and data folders, and each file's imports tell you which layer it belongs to.

## 1. Three folders, three jobs

The README says this app exists to explain Flutter architecture. `app/lib` reflects that with `ui/`, `domain/` and `data/` folders, plus `config/` (dependencies.dart, assets.dart), `routing/` (router.dart, routes.dart), `utils/` (Result, Command) and the entry points `main*.dart`. The ui layer holds screens (`widgets/`) and view models (`view_models/`) per feature. The domain layer holds models and use cases. The data layer holds repositories and services.

Sources: [`README.md:3-8`](../../../README.md#L3-L8) — States the app is used to explain architecture · [`app/lib/ui/home/view_models/home_viewmodel.dart:10-15`](../../../app/lib/ui/home/view_models/home_viewmodel.dart#L10-L15) — Imports show ui depending on data repositories and domain models

## 2. Place the files

```igrasp-match
prompt: Match each file to the layer folder it lives in.
pairs:
- left: ui/home/widgets/home_screen.dart
  right: 'ui layer: a screen widget'
- left: ui/home/view_models/home_viewmodel.dart
  right: 'ui layer: a view model (ChangeNotifier)'
- left: domain/models/booking/booking_summary.dart
  right: 'domain layer: a model'
- left: domain/use_cases/booking/booking_create_use_case.dart
  right: 'domain layer: a use case'
- left: data/repositories/booking/booking_repository.dart
  right: 'data layer: repository interface'
- left: data/services/api/api_client.dart
  right: 'data layer: a service talking HTTP'
explanation: 'The folder tells the layer, and the sub-folder tells the role: widgets and view_models in ui, models and use_cases in domain, repositories and services in data.'
sources:
- path: app/lib/ui/home/widgets/home_screen.dart
  lines: 19-33
  why: HomeScreen takes a HomeViewModel
```

## 3. Reading the layers through imports

```igrasp-code-tour
stops:
- path: app/lib/ui/home/view_models/home_viewmodel.dart
  lines: 17-34
  annotation: A ui class. HomeViewModel is a `ChangeNotifier` that receives `BookingRepository` and `UserRepository` and exposes `load` and `deleteBooking` commands. It holds screen state, not fetching code.
- path: app/lib/domain/models/booking/booking_summary.dart
  lines: 10-34
  annotation: 'A domain model: a freezed class with id, name, startDate, endDate. Its doc says it carries just what the home screen needs; the full `Booking` comes from the repository.'
- path: app/lib/data/repositories/booking/booking_repository.dart
  lines: 9-21
  annotation: A data-layer contract. The abstract `BookingRepository` returns domain types wrapped in `Result`, never API or JSON types.
- path: app/lib/data/services/local/local_data_service.dart
  lines: 49-62
  annotation: 'A service: LocalDataService loads JSON assets via `rootBundle` and decodes them into domain models like Activity and Destination.'
```

## 4. What the domain layer owns

Domain holds the app's vocabulary: freezed models such as `BookingSummary`, `Booking`, `Destination`, `Activity` and `User`, with generated `.freezed.dart` and `.g.dart` files you never edit. It also holds use cases. `BookingCreateUseCase` takes `DestinationRepository`, `ActivityRepository` and `BookingRepository`, checks the `ItineraryConfig` for destination, activities and dates, then builds and saves a `Booking`. This is logic that spans several repositories, so it fits neither one repository nor a view model.

Sources: [`app/lib/domain/use_cases/booking/booking_create_use_case.dart:16-95`](../../../app/lib/domain/use_cases/booking/booking_create_use_case.dart#L16-L95) — Use case combining three repositories

## 5. Where the data layer touches the network

```igrasp-spot-it
prompt: Click the line that makes ApiClient return a failure result instead of throwing when a request errors.
path: app/lib/data/services/api/api_client.dart
lines: 112-133
answerLine: 129
explanation: Each ApiClient method wraps its work in try/catch and returns `Result.error(error)`. Callers in repositories and view models then switch on Ok/Error instead of handling exceptions.
```

## 6. BookingRepositoryRemote converts a BookingApiModel into domain types. Which layer does BookingApiModel belong to?

```igrasp-quiz
kind: multipleChoice
choices:
- Data, under services/api/model, next to ApiClient
- Domain, under models/booking, next to Booking
- Ui, under home/view_models, next to HomeViewModel
- Config, under config, next to dependencies.dart
answer: 0
hint: Look at the folder path of booking_api_model.freezed.dart.
explanation: BookingApiModel lives in `data/services/api/model/booking`. It is the wire shape; the repository maps it to domain models so the layers above never see it.
sources:
- path: app/lib/data/repositories/booking/booking_repository_remote.dart
  lines: 14-38
  why: Repository builds a BookingApiModel from a domain Booking
```

## 7. Recap

- ui owns screens (widgets/) and view models like HomeViewModel; it depends on repository interfaces and domain models.
- domain owns models such as BookingSummary and use cases such as BookingCreateUseCase.
- data owns repositories (BookingRepository) and services (ApiClient, LocalDataService), including API models such as BookingApiModel.
