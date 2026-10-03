# ADR-002: Protobuf For Internal Events

## Status

Proposed

## Context

Internal events need versioned schemas while browser-facing APIs should remain easy to inspect.

## Decision

Use Protobuf for internal events and JSON at API/UI boundaries.

## Consequences

Schema evolution is explicit and CI can enforce compatibility. Frontend and external clients stay JSON-first.
