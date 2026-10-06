import { metrics } from '@opentelemetry/api';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

// docs:region telemetry
/**
 * Metrics and traces. The SDK records through the OpenTelemetry API and stays silent until an application registers
 * an OpenTelemetry SDK: this one serves every egradx.* timer and counter to Prometheus at /metrics, and sends a span per
 * request and per SDK operation to Jaeger over OTLP (OTLP_TRACING_ENDPOINT).
 */
export function startTelemetry(service: string) {
  const resource = resourceFromAttributes({ 'service.name': service });
  const prometheus = new PrometheusExporter({ preventServerStart: true });
  const meterProvider = new MeterProvider({ resource, readers: [prometheus] });
  metrics.setGlobalMeterProvider(meterProvider);
  const tracerProvider = new NodeTracerProvider({
    resource,
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(Number(process.env.TRACING_SAMPLING_PROBABILITY ?? 1)) }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: process.env.OTLP_TRACING_ENDPOINT ?? 'http://localhost:4318/v1/traces' })),
    ],
  });
  tracerProvider.register(); // the global tracer, the async context, and W3C trace propagation
  registerInstrumentations({ instrumentations: [new HttpInstrumentation()], tracerProvider, meterProvider });
  return {
    prometheus,
    async shutdown() {
      await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
}
// docs:end
