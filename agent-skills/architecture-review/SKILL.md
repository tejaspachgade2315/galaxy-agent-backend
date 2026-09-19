---
name: architecture-review
description: Comprehensive guidance for inspecting distributed multi-agent systems, idempotency keys, durable state machines, and relational data models.
version: 1.0.0
---

# Architecture Review Skill

This skill teaches the Galaxy Agent how to critique and design resilient agent architectures.

## Core Principles
1. **Durable Source of Truth**: Relational databases (PostgreSQL) own authoritative state. Real-time transports (SSE, WebSockets) are delivery layers.
2. **Idempotency Guarantees**: Prevent double-charging and duplicate tool execution with unique turn tokens.
3. **Graceful Degraded States**: Always provide user-safe explanations and recovery paths when third-party services fail or rate-limit.
