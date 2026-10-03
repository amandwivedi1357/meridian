# ADR-004: SSE And WebSocket Transport

## Status

Proposed

## Context

The dashboard needs high-frequency one-way updates and a smaller set of bidirectional controls.

## Decision

Use SSE for one-way market/account streams and WebSockets only where bidirectional behavior is required.

## Consequences

The common live-data path remains simple and proxy-friendly. Control flows still have room for richer bidirectional interactions.
