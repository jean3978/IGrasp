---
igrasp: tutorial
id: fastapi-full-stack-template-authentication-and-authorization-end-to-end-from-the-login-form-to-a-protected-api-route-2026-10-25
title: 'fastapi-full-stack-template: authentication and authorization from login form to protected route'
intro: 'You will follow one login through fastapi-full-stack-template: the React form in frontend/src/routes/login.tsx, the OAuth2 password endpoint, the JWT, the Authorization header, and the FastAPI dependencies that guard routes. Afterwards you can trace a request through both halves, explain who may see what, and add a protected route correctly.'
project: fastapi-full-stack-template
subject: 'Authentication and authorization, end to end: from the login form to a protected API route'
familiarity: newHere
length: standard
generated: 2026-10-25T16:00:54Z
provider: claude-cli
model: sonnet
generationCommit: b1125d8
docsNote: The READMEs only list "JWT authentication" and "secure password hashing"; no page describes the token flow, the localStorage choice, or the superuser/owner rules. A short auth section in backend/README.md would help.
chapters:
- id: c1
  title: 'Credentials in: the login endpoint and password hashing'
  goal: Explain how POST /login/access-token in backend/app/api/routes/login.py verifies credentials via crud.authenticate, hashes with pwdlib (Argon2 plus legacy Bcrypt) and issues an HS256 JWT from security.create_access_token.
  minutes: 9
  file: 01-credentials-in-the-login-endpoint-and-password-hashing.md
- id: c2
  title: 'Guarding routes: OAuth2PasswordBearer and the deps chain'
  goal: Trace how backend/app/api/deps.py turns a Bearer token into a User through reusable_oauth2, get_current_user and the CurrentUser alias, and name the status codes each failure produces (403, 404, 400).
  minutes: 9
- id: c3
  title: 'Authorization: superusers, ownership and the Items rules'
  goal: 'Distinguish authentication from the two authorization patterns used here: get_current_active_superuser as a route dependency (users.py, utils.py) and the is_superuser/owner_id checks inside backend/app/api/routes/items.py.'
  minutes: 9
- id: c4
  title: 'The browser side: form, token storage and route guards'
  goal: 'Follow the React flow: the zod-validated form in frontend/src/routes/login.tsx, useAuth.login storing access_token in localStorage, client.setConfig in main.tsx attaching it, and beforeLoad guards in _layout.tsx and admin.tsx plus the 401/403 logout handler.'
  minutes: 10
- id: c5
  title: 'Proving it: token reset flow and the tests that exercise auth'
  goal: Explain how the password-reset JWT (generate_password_reset_token in utils.py, /reset-password/) reuses the SECRET_KEY, and how pytest (user_authentication_headers) and Playwright (auth.setup.ts storageState) log in to test protected routes.
  minutes: 8
sources:
- path: backend/app/api/routes/login.py
  lines: 28-47
  sha256: af826c280a9f8cd792cb396775cb50b1a374fd56105aec68c1d4dec778c619fd
- path: backend/app/core/security.py
  lines: 11-36
  sha256: ebfd5a61c0123b315bfd8b33d1bb43d38de9bd9fd626cffb42cf49eecef04aa4
- path: backend/app/crud.py
  lines: 45-60
  sha256: 0ac10e6a4154806be220bd2b8d390a6c61061f330b1432d924cd59bb5a69520d
- path: backend/app/core/config.py
  lines: 22-25
  sha256: 5d1a272537fc2513b96c9bd51afe3917c9b7473020c9ede1b2b0e22218ff1dbf
- path: backend/app/core/security.py
  lines: 19-26
  sha256: f544cbd79e94c91022bda1d9e9cbe491636aea23111d159c0c16266540e63723
- path: backend/app/api/routes/login.py
  lines: 42-47
  sha256: 9289bc07e0a782518f1d99979bfe8b733266e4a14090832c63d42e6ec9b5fd4b
- path: backend/app/core/security.py
  lines: 11-16
  sha256: 729c991eb6a3f4026cbc275e457e6bbd62a668beba5c61e3d554635260f47590
- path: backend/app/crud.py
  lines: 52-60
  sha256: 7fb0dd311f037a5c0ffe790eabd4a4ff675491248d8b446f1375b0ef86f864c1
- path: backend/app/core/config.py
  lines: 68-88
  sha256: 8a255d640c8b2cfa40ca52a9c4c027c0a654f0771d75c690a3257b27e472d8df
- path: backend/tests/api/routes/test_login.py
  lines: 129-162
  sha256: 7abd27863f8f4653d8f6f7b6f0cec6cc0fe69be7fe0d035722da602c33dd93a2
---

# fastapi-full-stack-template: authentication and authorization from login form to protected route

You will follow one login through fastapi-full-stack-template: the React form in frontend/src/routes/login.tsx, the OAuth2 password endpoint, the JWT, the Authorization header, and the FastAPI dependencies that guard routes. Afterwards you can trace a request through both halves, explain who may see what, and add a protected route correctly.

**Project:** fastapi-full-stack-template · **Subject:** Authentication and authorization, end to end: from the login form to a protected API route · **For:** developers new to the project · **Length:** standard (~15 min) · **Written:** 2026-10-25 by Hoot with sonnet

## Chapters

1. [Credentials in: the login endpoint and password hashing](01-credentials-in-the-login-endpoint-and-password-hashing.md) — Explain how POST /login/access-token in backend/app/api/routes/login.py verifies credentials via crud.authenticate, hashes with pwdlib (Argon2 plus legacy Bcrypt) and issues an HS256 JWT from security.create_access_token. (9 min)
2. Guarding routes: OAuth2PasswordBearer and the deps chain — Trace how backend/app/api/deps.py turns a Bearer token into a User through reusable_oauth2, get_current_user and the CurrentUser alias, and name the status codes each failure produces (403, 404, 400). (not written yet)
3. Authorization: superusers, ownership and the Items rules — Distinguish authentication from the two authorization patterns used here: get_current_active_superuser as a route dependency (users.py, utils.py) and the is_superuser/owner_id checks inside backend/app/api/routes/items.py. (not written yet)
4. The browser side: form, token storage and route guards — Follow the React flow: the zod-validated form in frontend/src/routes/login.tsx, useAuth.login storing access_token in localStorage, client.setConfig in main.tsx attaching it, and beforeLoad guards in _layout.tsx and admin.tsx plus the 401/403 logout handler. (not written yet)
5. Proving it: token reset flow and the tests that exercise auth — Explain how the password-reset JWT (generate_password_reset_token in utils.py, /reset-password/) reuses the SECRET_KEY, and how pytest (user_authentication_headers) and Playwright (auth.setup.ts storageState) log in to test protected routes. (not written yet)

## Hoot's notes

- Documentation: The READMEs only list "JWT authentication" and "secure password hashing"; no page describes the token flow, the localStorage choice, or the superuser/owner rules. A short auth section in backend/README.md would help.

<sub>Written by IGrasp's Academy. Open this folder in IGrasp to take the tutorial; the 10 cited ranges are checked against the files when it opens.</sub>
