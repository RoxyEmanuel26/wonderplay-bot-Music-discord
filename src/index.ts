import dotenv from 'dotenv';
import express from 'express';
import { logger } from './utils/logger';
import { AureliaClient } from './structures/AureliaClient';

dotenv.config();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  logger.error('No DISCORD_TOKEN provided in .env');
  process.exit(1);
}

const client = new AureliaClient();

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Rejection at Promise');
});

process.on('uncaughtException', (err) => {
  logger.fatal(err, 'Uncaught Exception thrown');
  process.exit(1);
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down...');
  client.destroy();
  const { db } = await import('./database/db');
  await db.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.start(token).catch((err) => {
  logger.error(err, 'Failed to start client');
});

// Minimal Web Dashboard / API
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/stats', (req, res) => {
  res.json({
    bot: {
      ping: client.ws.ping,
      uptime: process.uptime(),
      guilds: client.guilds.cache.size,
      users: client.users.cache.size,
    },
    lavalink: Array.from(client.shoukaku.nodes.values()).map(n => ({
      name: n.name,
      state: n.state,
      players: n.stats?.players || 0,
    })),
    queues: client.queues.size,
  });
});

app.get('/', (req, res) => {
  res.send('<h1>AURELIA Music Bot is running!</h1><p>Check <a href="/api/stats">/api/stats</a> for live statistics.</p>');
});

app.listen(PORT, () => {
  logger.info(`Web Dashboard is running on port ${PORT}`);
});

