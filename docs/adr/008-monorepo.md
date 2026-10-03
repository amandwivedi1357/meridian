# ADR-008: Monorepo

## Status

Proposed

## Context

Meridian has several services that share domain types, schemas, config, and observability code.

## Decision

Use a pnpm + Turborepo TypeScript monorepo.

## Consequences

Shared contracts can evolve atomically. CI and package boundaries must stay disciplined as the codebase grows.
