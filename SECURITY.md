# Security Policy

## Supported versions

Only the latest release of IGrasp receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/jean3978/IGrasp/security/advisories/new).
Include the IGrasp version, your operating system, the steps to reproduce, and the impact you
observed.

You can expect an acknowledgement within a week. Once the problem is confirmed, a fix is prepared
and released, and the advisory is published with credit to the reporter (unless you prefer to stay
anonymous).

## Scope

IGrasp is a local desktop application. It runs no network service and only reads the folder you
open. Relevant reports include, for example:

- markdown content that executes script or escapes the HTML sanitizer;
- reading files outside the opened folder through the app;
- remote content loaded in a way the documented policy forbids (for example plain `http:` media).
