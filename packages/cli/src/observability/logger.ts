// The CLI consumes the shared telemetry package; this module keeps the local
// import path stable while adapters are migrated.
export {
  createFilteredSink,
  createHttpSink,
  createJsonLinesSink,
  createLocalFileSink,
  createTelemetry,
  type EventAttributes,
  type EventSink,
  type LocalFileSystem,
  type OperationalEvent,
  type Telemetry,
} from "@edu-service/observability";
