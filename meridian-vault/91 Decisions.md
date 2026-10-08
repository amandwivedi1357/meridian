# Decisions

This note is for informal decisions. Formal architecture decisions live in `docs/adr`.

## Current Decisions

- Use TypeScript across the repo.
- Use Redis Streams for internal event flow.
- Use TimescaleDB for historical time-series storage.
- Use `Decimal` for money and quantities.
- Keep Obsidian vault local and ignored by Git.
- Use Docker-isolated Git setup for personal GitHub pushes on this machine.

Related:

- [[01 Project Vision]]
- [[02 Architecture Map]]

