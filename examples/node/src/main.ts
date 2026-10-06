// Telemetry starts before anything it instruments is loaded: express and http are imported after it.
import { startTelemetry } from './telemetry.js';

const telemetry = startTelemetry('notes');
const { config } = await import('./config.js');
const { startApplication } = await import('./app.js');

const application = await startApplication(config);
application.app.get('/metrics', (request, response) => telemetry.prometheus.getMetricsRequestHandler(request, response));
const server = application.app.listen(config.port, () => console.log(`Notes on http://localhost:${config.port}`));

async function stop() {
  server.close();
  await application.close();
  await telemetry.shutdown();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
