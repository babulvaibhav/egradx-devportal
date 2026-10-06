import pino from 'pino';
import { EgradxLogShipper, egradxPinoOptions, egradxShippingDestination, type EgradxLog } from '@babulvaibhav/egradx-sdk';
import type { Events } from '@babulvaibhav/egradx-events';

// docs:region log-shipping
/**
 * Every log line to the console and, as an egradx.log.record.v1 event, over the events transport, with its request,
 * person and organization. Best effort: a full queue drops lines (and counts them) rather than slow the application.
 * The SDK logs through it too (createEgradx's `log`).
 */
export function createLogging(events: Events, service: string) {
  const shipper = new EgradxLogShipper(events.logSink, { service, minimumLevel: 'INFO' });
  const logger = pino({ ...egradxPinoOptions() }, pino.multistream([{ stream: process.stdout }, { stream: egradxShippingDestination(shipper) }]));
  const egradxLog: EgradxLog = {
    info: (message, fields) => logger.info(fields ?? {}, message),
    warn: (message, fields) => logger.warn(fields ?? {}, message),
    error: (message, fields) => logger.error(fields ?? {}, message),
  };
  return { logger, egradxLog, close: () => shipper.close() };
}
// docs:end
