import type { ExposureRecord, ExposureRecorder } from "./types.js";

/** Test/local adapter. Production wiring should use append-only durable storage. */
export class InMemoryExposureRecorder implements ExposureRecorder {
  readonly exposures: ExposureRecord[] = [];
  readonly #seen = new Set<string>();

  async record(exposure: ExposureRecord): Promise<void> {
    if (this.#seen.has(exposure.evaluationId)) return;
    this.#seen.add(exposure.evaluationId);
    this.exposures.push(exposure);
  }
}
