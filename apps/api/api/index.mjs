// Vercel Function: serves the Nest API (compiled to dist/) for every request.
// vercel.json sends all paths here; the Nest app is built once per instance.
import 'reflect-metadata';
import { createApp } from '../dist/bootstrap.js';
import { loadApiConfig } from '../dist/config/api-config.js';

let server;

const getServer = async () => {
  if (!server) {
    server = (async () => {
      const app = await createApp(loadApiConfig());
      await app.init();
      return app.getHttpAdapter().getInstance();
    })().catch((err) => {
      server = undefined; // try again on the next request
      throw err;
    });
  }
  return server;
};

// The web app forwards the visitor's IP with a shared secret, because every request
// reaches this project from the web app's servers. Only then is that IP trusted.
const useForwardedClientIp = (req) => {
  const secret = process.env.PROXY_SHARED_SECRET;
  const ip = req.headers['x-erp-client-ip'];
  if (secret && req.headers['x-erp-proxy-secret'] === secret && typeof ip === 'string' && ip) {
    req.headers['x-forwarded-for'] = ip;
  }
  delete req.headers['x-erp-proxy-secret'];
  delete req.headers['x-erp-client-ip'];
};

export default async function handler(req, res) {
  useForwardedClientIp(req);
  const app = await getServer();
  app(req, res);
}
