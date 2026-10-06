import { metrics } from '@opentelemetry/api';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { config } from './config.js';

export interface Telemetry {
  /** Serves the Prometheus text at /api/actuator/prometheus, as the Java backend's Actuator does. */
  readonly prometheus: PrometheusExporter;
  shutdown(): Promise<void>;
}

/**
 * Metrics and tracing, as the Java backend's Actuator and Micrometer tracing give it (application.yml's `management`
 * block): every egradx timer, counter and gauge for Prometheus to scrape, and a span per request and per egradx
 * operation, sent over OTLP/HTTP to Jaeger. The `local` profile keeps the spans (trace ids still appear in log lines and
 * audit records) but sends them nowhere. Each part is set up here, not from OTEL_* variables, so nothing is exported
 * that the Java backend would not export. Started before anything it instruments is loaded: see main.ts.
 */
// docs:region telemetry
export function startTelemetry(): Telemetry {
  const { tracing } = config;
  // As management.observations.key-values.application: one Prometheus and one Jaeger can serve several applications.
  const resource = resourceFromAttributes({ 'service.name': config.applicationName, application: config.applicationName });
  const prometheus = new PrometheusExporter({ preventServerStart: true });
  const meterProvider = new MeterProvider({ resource, readers: [prometheus] });
  metrics.setGlobalMeterProvider(meterProvider);
  const tracerProvider = new NodeTracerProvider({
    resource,
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(tracing.samplingProbability) }),
    spanProcessors: tracing.exportEnabled ? [new BatchSpanProcessor(new OTLPTraceExporter({ url: tracing.otlpEndpoint }))] : [],
  });
  // The global tracer provider, the async context manager, and the W3C trace-context propagator.
  tracerProvider.register();
  registerInstrumentations({ instrumentations: [new HttpInstrumentation()], tracerProvider, meterProvider });
  return {
    prometheus,
    async shutdown() {
      await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
}
// docs:end
