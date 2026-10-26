---
igrasp: tutorial-chapter
tutorial: fastapi-full-stack-template-authentication-and-authorization-end-to-end-from-the-login-form-to-a-protected-api-route-2026-10-25
chapter: c1
---

# 1. Credentials in: the login endpoint and password hashing

> **Hoot:** Every session in this template starts at one endpoint, POST /login/access-token, so let's follow a password from the form post to a signed JWT.

## 1. Four files, one login

The backend lives in `backend/app`. The login route is `api/routes/login.py`; it delegates the password check to `crud.authenticate` in `crud.py`, which uses the hashing helpers in `core/security.py`. The signing key and token lifetime come from `Settings` in `core/config.py`. The route itself stays thin: it only turns a result into an HTTP answer.

Sources: [`backend/app/api/routes/login.py:23-42`](../../../backend/app/api/routes/login.py#L23-L42) — The endpoint that ties the other files together · [`backend/app/core/security.py:11-36`](../../../backend/app/core/security.py#L11-L36) — Hashing and token helpers

## 2. Walking the login path

```igrasp-code-tour
stops:
- path: backend/app/api/routes/login.py
  lines: 23-42
  annotation: '`OAuth2PasswordRequestForm` reads form fields `username` and `password`. In this project `username` carries the email. A bad login or an inactive user gives a 400; otherwise a `Token` is returned.'
- path: backend/app/crud.py
  lines: 45-60
  annotation: '`authenticate` looks the user up by email, verifies the password, and returns the `User` or `None`. If the hasher says the stored hash is outdated, it saves the new one.'
- path: backend/app/core/security.py
  lines: 11-36
  annotation: '`password_hash` is a pwdlib `PasswordHash` with Argon2 first and Bcrypt second. `verify_password` calls `verify_and_update`, returning `(ok, new_hash_or_None)`. `create_access_token` signs `exp` and `sub` with `SECRET_KEY` using HS256.'
- path: backend/app/core/config.py
  lines: 22-25
  annotation: '`SECRET_KEY` has no default, so it must come from the environment. `ACCESS_TOKEN_EXPIRE_MINUTES` defaults to 8 days, which login.py turns into a `timedelta`.'
```

## 3. Same work for unknown emails

```igrasp-spot-it
prompt: Click the line that runs a password verification even though no user was found.
path: backend/app/crud.py
lines: 45-60
answerLine: 50
explanation: Line 50 verifies the submitted password against `DUMMY_HASH` when the email is unknown. Response time then looks the same whether or not the account exists, which the comment calls timing attack prevention.
```

## 4. What the token carries: a signed JWT

> [!NOTE]
> **Concept:** A JWT is a signed, base64-encoded set of claims. With HS256 the same secret signs and verifies it, so anyone holding the secret can mint valid tokens, and nobody else can alter one undetected.
> Official docs: <https://pyjwt.readthedocs.io/en/stable/usage.html>

`create_access_token` in `security.py` puts two claims in the token: `exp` (now plus `expires_delta`) and `sub` (the user id as a string). It signs them with `settings.SECRET_KEY` and `ALGORITHM = "HS256"`. The server stores no session: the token is the session, and later requests are checked by decoding it.

Sources: [`backend/app/core/security.py:19-26`](../../../backend/app/core/security.py#L19-L26) — Claims and signing · [`backend/app/api/routes/login.py:37-42`](../../../backend/app/api/routes/login.py#L37-L42) — Subject is user.id and lifetime comes from settings

## 5. Hashing: Argon2 now, Bcrypt tolerated

`PasswordHash((Argon2Hasher(), BcryptHasher()))` makes Argon2 the hasher for new passwords and keeps Bcrypt only to verify old ones. When someone with a Bcrypt hash logs in, `verify_and_update` returns a fresh Argon2 hash and `authenticate` writes it back. So legacy users migrate silently, with no reset campaign. Settings also refuse the `changethis` placeholder for `SECRET_KEY` outside development.

Sources: [`backend/app/core/security.py:11-16`](../../../backend/app/core/security.py#L11-L16) — Hasher order · [`backend/app/crud.py:52-60`](../../../backend/app/crud.py#L52-L60) — Rehash on login · [`backend/app/core/config.py:68-88`](../../../backend/app/core/config.py#L68-L88) — Default-secret guard

## 6. A user whose stored hash starts with `$2` (Bcrypt) logs in with the right password. What does the test suite expect afterwards?

```igrasp-quiz
kind: multipleChoice
choices:
- The stored hash now starts with `$argon2` and the login still returns 200
- The login fails with 400 until the user resets the password
- The stored hash stays Bcrypt, since only new users get Argon2
- The user is marked inactive until an admin approves the change
answer: 0
hint: Read the two tests near the end of test_login.py that compare `user.hashed_password` before and after.
explanation: '`test_login_with_bcrypt_password_upgrades_to_argon2` asserts a 200, then that the hash starts with `$argon2` and that verifying again needs no further update. The Argon2 counterpart test asserts the hash is unchanged.'
sources:
- path: backend/tests/api/routes/test_login.py
  lines: 129-162
  why: The upgrade test
```

## 7. Order of a successful login

```igrasp-put-in-order
prompt: Put the server-side steps of POST /login/access-token in order.
items:
- '`OAuth2PasswordRequestForm` delivers `username` and `password`'
- '`crud.authenticate` fetches the user by email'
- '`verify_password` checks the hash and may return an upgraded one'
- '`login_access_token` rejects inactive users with a 400'
- '`security.create_access_token` signs `sub` and `exp` with `SECRET_KEY`'
- The route returns a `Token` holding `access_token`
explanation: The route receives the form, authenticate verifies (and may rehash), the route checks `is_active`, then the JWT is signed and wrapped in `Token`. The activity check lives in the route, not in `authenticate`.
sources:
- path: backend/app/api/routes/login.py
  lines: 23-42
  why: The sequence in code
- path: backend/app/crud.py
  lines: 45-60
  why: authenticate
```

## 8. Recap

- POST /login/access-token in login.py takes form fields, delegates to crud.authenticate, and returns a Token with a JWT signed with SECRET_KEY (HS256, sub and exp).
- crud.authenticate runs verify_password against DUMMY_HASH for unknown emails, so timing does not reveal which accounts exist.
- security.py hashes with Argon2 and still verifies Bcrypt, upgrading old hashes on successful login.
