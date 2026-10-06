"""Metrics and tracing, as the Java backend's Actuator and Micrometer tracing give it (application.yml's ``management``
block): every egradx timer, counter and gauge for Prometheus to scrape, and a span per request and per egradx operation,
sent over OTLP/HTTP to Jaeger. The ``local`` profile keeps the spans (trace ids still appear in log lines and audit
records) but sends them nowhere. Each part is set up here, not from OTEL_* variables, so nothing is exported that the
Java backend would not export."""

from dataclasses import dataclass

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.prometheus import PrometheusMetricReader
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from prometheus_client import CONTENT_TYPE_LATEST, REGISTRY, generate_latest

from .config import Config

# What /api/actuator/prometheus answers with, as the Java backend's Actuator: the Prometheus text format.
PROMETHEUS_CONTENT_TYPE = CONTENT_TYPE_LATEST


def prometheus_text() -> bytes:
    """Everything the Prometheus reader collected, with the process's own metrics."""
    return generate_latest(REGISTRY)


@dataclass
class Telemetry:
    meter_provider: MeterProvider
    tracer_provider: TracerProvider

    def shutdown(self) -> None:
        self.tracer_provider.shutdown()
        self.meter_provider.shutdown()


# docs:region telemetry
def start_telemetry(config: Config) -> Telemetry:
    """Registers the global meter and tracer providers the egradx libraries record through."""
    # As management.observations.key-values.application: one Prometheus and one Jaeger can serve several applications.
    resource = Resource.create({"service.name": config.application_name, "application": config.application_name})
    meter_provider = MeterProvider(resource=resource, metric_readers=[PrometheusMetricReader()])
    metrics.set_meter_provider(meter_provider)
    tracer_provider = TracerProvider(resource=resource, sampler=ParentBased(TraceIdRatioBased(config.tracing_sampling_probability)))
    if config.otlp_tracing_export_enabled:
        tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=config.otlp_tracing_endpoint)))
    trace.set_tracer_provider(tracer_provider)
    return Telemetry(meter_provider, tracer_provider)
# docs:end
