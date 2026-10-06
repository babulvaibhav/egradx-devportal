import express, { Router, type RequestHandler } from 'express';
import type { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { authenticateWith, egradxRoutes, errorHandler, requestContext } from '@babulvaibhav/egradx-sdk/express';
import { config } from './config.js';
import { customerRoutes } from './customers.js';
import { dashboardRoutes } from './dashboard.js';
import { entryPoint, oimErrors, signedInOrOpen, unmatched } from './http.js';
import { InventoryOperations, inventoryRoutes } from './inventory.js';
import type { Oim } from './oim.js';
import { orderRoutes } from './orders.js';
import { productRoutes } from './products.js';
import { warehouseRoutes } from './warehouses.js';

/** As the Java backend's CORS configuration: its origins, methods and exposed header, no credentials. */
function cors(origins: readonly string[]): RequestHandler {
  const any = origins.length === 1 && origins[0] === '*';
  return (request, response, next) => {
    const origin = request.get('Origin');
    if (origin && (any || origins.includes(origin))) {
      response.set('Access-Control-Allow-Origin', origin);
      response.set('Vary', 'Origin');
      response.set('Access-Control-Expose-Headers', 'X-Request-ID');
      if (request.method === 'OPTIONS' && request.get('Access-Control-Request-Method')) {
        response.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        response.set('Access-Control-Allow-Headers', request.get('Access-Control-Request-Headers') ?? '*');
        response.status(200).end();
        return;
      }
    } else if (origin && request.method === 'OPTIONS' && request.get('Access-Control-Request-Method')) {
      response.status(403).send('Invalid CORS request');
      return;
    }
    next();
  };
}

/**
 * The OIM backend's HTTP surface, under /api as the Java one serves it: the SDK's endpoints (auth, audit,
 * notifications) and OIM's own under /api/v1. Business routes answer in the Java backend's error envelope.
 */
export function oimApp(oim: Oim, options: { prometheus?: PrometheusExporter } = {}): express.Express {
  const app = express();
  // As server.forward-headers-strategy=native: the client's address from a proxy on the local network.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');
  const api = Router();
  // docs:region identity-chain
  api.use(requestContext());
  api.use(cors(config.corsOrigins));
  api.use(authenticateWith(oim.auth));
  api.use(signedInOrOpen());
  // docs:end
  api.get('/actuator/health', (_request, response) => {
    response.json({ status: 'UP' });
  });
  api.get('/actuator/info', (_request, response) => {
    response.json({});
  });
  const { prometheus } = options;
  if (prometheus) {
    // What Prometheus scrapes, at the Java backend's path (observability/prometheus.yml).
    api.get('/actuator/prometheus', (request, response) => prometheus.getMetricsRequestHandler(request, response));
  }
  api.use(egradxRoutes(oim, { maxPageSize: config.pageable.maxSize }));

  const business = Router();
  business.use('/v1', express.json({ limit: '1mb' }));
  const inventory = new InventoryOperations(oim);
  business.use(productRoutes(oim));
  business.use(warehouseRoutes(oim));
  business.use(customerRoutes(oim));
  business.use(inventoryRoutes(oim, inventory));
  business.use(orderRoutes(oim, inventory));
  business.use(dashboardRoutes(oim));
  business.use(entryPoint());
  business.use(oimErrors());
  api.use(business);

  api.use(unmatched(api));
  api.use(errorHandler({ log: (message, fields) => oim.log.error(message, fields) }));
  app.use(config.contextPath, api);
  return app;
}
