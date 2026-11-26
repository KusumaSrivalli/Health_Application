import { SymptomStore } from './db/symptomStore.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || undefined;

const store = new SymptomStore(DB_PATH);
const server = createApp({ store });

server.listen(PORT, HOST, () => {
  console.log(`HealthTrack server running at http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down HealthTrack...`);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
