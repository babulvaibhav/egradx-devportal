"""Metrics and traces. The SDK records through the OpenTelemetry API and stays silent until an application registers an
OpenTelemetry SDK: this one serves every egradx.* timer and counter to Prometheus at /metrics, and sends a span per request
and per SDK operation to Jaeger over OTLP (OTLP_TRACING_ENDPOINT)."""

import os

from fastapi import FastAPI, Response
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.prometheus import PrometheusMetricReader
from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from prometheus_client import CONTENT_TYPE_LATEST, REGISTRY, generate_latest


# docs:region telemetry
def start_telemetry(service: str) -> None:
    resource = Resource.create({"service.name": service})
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[PrometheusMetricReader()]))
    tracer_provider = TracerProvider(resource=resource, sampler=ParentBased(TraceIdRatioBased(
        float(os.environ.get("TRACING_SAMPLING_PROBABILITY", "1")))))
    tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
        endpoint=os.environ.get("OTLP_TRACING_ENDPOINT", "http://localhost:4318/v1/traces"))))
    trace.set_tracer_provider(tracer_provider)


def instrument(app: FastAPI):
    """/metrics for Prometheus, and a span per request."""
    app.add_api_route("/metrics", lambda: Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST), include_in_schema=False)
    return OpenTelemetryMiddleware(app)
# docs:end
