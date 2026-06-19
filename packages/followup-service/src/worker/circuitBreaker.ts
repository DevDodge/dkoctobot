import { logger } from "../utils/logger";

export class CircuitOpenError extends Error {
  constructor(public url: string) {
    super(`Circuit breaker open for ${url}`);
    this.name = "CircuitOpenError";
  }
}

interface CircuitState {
  failures: number;
  openedAt: number;
  state: "closed" | "open" | "half-open";
  totalFailures: number;
  totalSuccesses: number;
}

/**
 * Circuit Breaker per webhook URL.
 * If an endpoint fails N times consecutively → open circuit, skip it for
 * RESET_MS. After RESET_MS → half-open (try one), then either close (success)
 * or open again (failure).
 *
 * This prevents one misbehaving endpoint from occupying all worker slots.
 */
export class CircuitBreaker {
  private circuits = new Map<string, CircuitState>();
  private readonly threshold: number;
  private readonly resetMs: number;

  constructor(
    threshold = parseInt(process.env.FOLLOWUP_CIRCUIT_BREAKER_THRESHOLD || "5", 10),
    resetMs = parseInt(process.env.FOLLOWUP_CIRCUIT_BREAKER_RESET_MS || "60000", 10)
  ) {
    this.threshold = threshold;
    this.resetMs = resetMs;
  }

  /** Execute fn(url). Throws CircuitOpenError if the circuit is open. */
  async call<T>(url: string, fn: () => Promise<T>): Promise<T> {
    let c = this.circuits.get(url);

    if (!c) {
      c = { failures: 0, openedAt: 0, state: "closed", totalFailures: 0, totalSuccesses: 0 };
      this.circuits.set(url, c);
    }

    if (c.state === "open") {
      if (Date.now() - c.openedAt < this.resetMs) {
        throw new CircuitOpenError(url);
      }
      // Transition: half-open — let one through.
      c.state = "half-open";
      logger.info(`[CircuitBreaker] half-open for ${url}`);
    }

    try {
      const result = await fn();
      // Success → close if it was open/half-open, reset failures.
      if (c.state !== "closed" || c.failures > 0) {
        logger.info(
          `[CircuitBreaker] closed for ${url} (state was ${c.state}, had ${c.failures} failures)`
        );
        c.failures = 0;
        c.state = "closed";
      }
      c.totalSuccesses++;
      return result;
    } catch (e) {
      if (e instanceof CircuitOpenError) throw e;
      c.failures++;
      c.totalFailures++;
      if (c.failures >= this.threshold && c.state === ("half-open" as const)) {
        c.state = "open";
        c.openedAt = Date.now();
        logger.warn(
          `[CircuitBreaker] OPEN for ${url} after ${c.failures} consecutive failures`
        );
      }
      throw e;
    }
  }

  /** Number of open circuits (for monitoring). */
  get stats(): { open: number; halfOpen: number; closed: number; total: number } {
    let open = 0,
      halfOpen = 0,
      closed = 0;
    for (const c of this.circuits.values()) {
      if (c.state === "open") open++;
      else if (c.state === "half-open") halfOpen++;
      else closed++;
    }
    return { open, halfOpen, closed, total: this.circuits.size };
  }

  /** Force-close a circuit (admin action). */
  reset(url: string): void {
    this.circuits.delete(url);
    logger.info(`[CircuitBreaker] manually reset for ${url}`);
  }

  /** Reset all circuits. */
  resetAll(): void {
    this.circuits.clear();
  }
}
