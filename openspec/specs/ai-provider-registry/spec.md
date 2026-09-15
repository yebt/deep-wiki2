# AI Provider Registry Specification

## Purpose

Provides a single hexagonal abstraction over five inference providers (Anthropic,
OpenAI, Google Gemini, DeepSeek, OpenRouter) through the Vercel AI SDK, plus a
checked-in per-model capability registry so a caller never guesses whether a model
supports tools, structured output, vision, or prompt caching. A model absent from the
registry is refused rather than called optimistically.

## Requirements

### Requirement: Provider Abstraction via a Core Port

The system MUST expose a single `ChatModel` port in `packages/core` that every provider
adapter implements. Anthropic, OpenAI and Google Gemini MUST be integrated natively;
DeepSeek MUST be integrated through an OpenAI-compatible adapter; OpenRouter MUST serve
as the catch-all for models not natively wired. All SDK-specific adapter code MUST live
outside `packages/core`.

#### Scenario: Provider call routes through the port

- GIVEN a workspace configured with a native provider
- WHEN a chat call is issued
- THEN the call is dispatched through the `ChatModel` port, and the calling code holds
  no reference to a provider-specific SDK type

#### Scenario: Core stays framework-free

- GIVEN `packages/core/src/ai/`
- WHEN its imports are inspected
- THEN it contains no Vercel AI SDK import and no other non-relative dependency

### Requirement: Per-Model Capability Registry

The system MUST maintain a checked-in registry recording, for every offered model,
whether it supports tools, its structured-output level (`schema` | `tool-call` |
`prompted` | `none`), prompt caching, vision, its context window, and whether it
supports embeddings. A model absent from the registry MUST be refused rather than
invoked.

#### Scenario: Registered model exposes its capabilities

- GIVEN a model present in the registry
- WHEN its capabilities are queried
- THEN the declared structured-output level, tool support, and context window are
  returned

#### Scenario: Unregistered model is refused

- GIVEN a model identifier with no registry entry
- WHEN a caller requests a chat completion against it
- THEN the system refuses the call with an error naming the missing registry entry, and
  no provider request is issued

### Requirement: Structured-Output Graceful Degradation

When a model's declared `structuredOutput` level is below native schema support, the
system MUST degrade in the fixed order native schema → tool-call coercion → prompted
JSON with a repair pass, and MUST NOT attempt a level higher than the model's declared
capability.

#### Scenario: Native schema model uses the native path

- GIVEN a model registered at `structuredOutput: schema`
- WHEN a structured object is requested
- THEN the native schema mode is used and no repair pass runs

#### Scenario: Tool-call-only model still returns conforming output

- GIVEN a model registered at `structuredOutput: tool-call`
- WHEN a structured object is requested
- THEN the system coerces the request through a tool call and returns an object
  conforming to the requested schema

#### Scenario: Prompted-only model uses the repair pass

- GIVEN a model registered at `structuredOutput: prompted`
- WHEN the first JSON response fails schema validation
- THEN the system issues one repair pass and returns a conforming object, or a typed
  failure if the repair also fails

### Requirement: Normalized Provider Errors

Rate-limit and invalid-credential responses from any wired provider MUST be mapped to a
normalized, provider-agnostic error type before reaching calling code, and MUST NOT
include the raw credential or the raw upstream payload.

#### Scenario: Provider rate limit

- GIVEN a provider call that receives an HTTP 429 response
- WHEN the error propagates to the caller
- THEN it is surfaced as a normalized rate-limit error, not the raw provider payload

#### Scenario: Invalid credential

- GIVEN a provider rejects a call for an invalid API key
- WHEN the error propagates to the caller
- THEN it is surfaced as a normalized authentication error, and the credential value
  does not appear anywhere in the error
