# Security Policy

## Supported Versions

Security fixes target the latest release and the current `main` branch. Older
releases may be asked to upgrade before a fix is provided.

## Reporting a Vulnerability

Use GitHub's private **Report a vulnerability** flow for this repository. Do not
open a public issue with exploit details, tokens, personal paths, or captured
operator data.

If private vulnerability reporting is unavailable, open a minimal public issue
asking the maintainer for a private contact channel. Include no sensitive detail
until that channel is established.

Useful reports include:

- affected version or commit;
- the smallest safe reproduction;
- expected and actual security boundary;
- impact and data exposed;
- a suggested fix, if known.

## Deployment Boundary

Rei Ops Room binds to `127.0.0.1` by default and does not implement user
authentication. Wider network exposure requires an authenticated reverse proxy
and explicit access control.

Safe Demo is designed for public evaluation: it serves simulated fixtures and
blocks local-data inspection and write actions. A production operator should
still review configuration, webhook secrets, GitHub token scope, runtime
permissions, and workspace access before enabling live execution.

## Secrets

Never commit `.env*`, `rei.config.json`, runtime state, memory, chat, cost logs,
or agent output. The Git and Docker ignore rules cover these files, but the
maintainer remains responsible for checking every release artifact.
