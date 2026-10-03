# ADR-001: Event-Driven Services Over Redis Streams

## Status

Proposed

## Context

Meridian needs durable market, signal, order, and control events with replay and explicit consumer acknowledgement.

## Decision

Use Redis Streams and consumer groups as the internal event bus for v1.

## Consequences

Services can crash and resume from group offsets. Handlers must be idempotent, and stream retention must be configured deliberately.
