/**
 * A best-effort operational-event port. It is deliberately separate from the
 * durable audit log: failure to publish diagnostics must not change business state.
 */
export interface OperationLog {
  info(
    name: string,
    attributes?: Record<string, string | number | boolean | null>,
    correlationId?: string,
  ): void;
  error(
    name: string,
    attributes?: Record<string, string | number | boolean | null>,
    correlationId?: string,
  ): void;
}

export const NOOP_OPERATION_LOG: OperationLog = {
  info: () => undefined,
  error: () => undefined,
};
