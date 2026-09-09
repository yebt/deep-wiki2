/**
 * Tracks every currently open presence SSE stream so the server-shutdown
 * path can close them deliberately (design.md Decision 5, "Termination")
 * rather than leaving connections dangling until the OS tears down the
 * process. Client disconnect is handled separately, per stream, through
 * `SSEStreamingApi.onAbort` — this registry exists only for the shutdown
 * direction: the server initiating closure, not the client.
 */
export type CloseStream = () => void;

export class PresenceStreamRegistry {
  private readonly streams = new Set<CloseStream>();

  /** Registers `close` for this stream's lifetime; returns a function that removes it without closing it. */
  register(close: CloseStream): () => void {
    this.streams.add(close);
    return () => this.streams.delete(close);
  }

  /** Closes every currently registered stream. Each stream is expected to remove itself once its own `finally` block runs. */
  closeAll(): void {
    for (const close of this.streams) close();
  }
}
