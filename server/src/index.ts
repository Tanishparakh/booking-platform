import fs from 'fs';
import http from 'http';
import https from 'https';
import { createApp } from './app';
import { config } from './config';
import { migrate } from './db/migrate';
import { runJobs } from './services/bookings';

async function main() {
  await migrate();
  const app = createApp();
  let server: http.Server | https.Server;
  if (config.tls.keyFile && config.tls.certFile) {
    // HTTPS with TLS 1.3 only
    server = https.createServer({ key: fs.readFileSync(config.tls.keyFile), cert: fs.readFileSync(config.tls.certFile), minVersion: 'TLSv1.3' }, app);
  } else {
    server = http.createServer(app);
  }
  server.listen(config.port, () => console.log(`API listening on ${config.tls.keyFile ? 'https' : 'http'}://localhost:${config.port}`));
  if (!config.isTest) {
    setInterval(() => runJobs().catch((e) => console.error('Background job failed', e)), 60_000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
