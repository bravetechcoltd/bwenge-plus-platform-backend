import dotenv from 'dotenv';
dotenv.config();

import 'reflect-metadata';
import app from './app';
import { DbConnection } from './database/db';
import { ensureTables } from './database/ensureTables';
import { logger } from './helpers/logger';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { initSocket } from "./socket/socket";

const PORT = process.env.PORT || 3003;
const httpServer = createServer(app);

const uploadsDir = path.join(__dirname, '../uploads/newsletter');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  logger.info('Created uploads/newsletter directory');
}

// Initialize socket with the HTTP server (single instance)
const io = initSocket(httpServer);

// Export io for use in controllers
export { io };

// Start server
(async () => {
  try {
    // Initialize database connection
    const dbConnection = DbConnection.instance;
    const ds = await dbConnection.initializeDb();
    await ensureTables(ds);
    logger.info('Database connection established successfully');

    logger.info('Session cleanup service initialized');

    logger.info('Socket.IO handlers initialized successfully');

    // Start HTTP server
    const server = httpServer.listen(PORT, () => {
      logger.info('='.repeat(60));
      logger.info(`🚀 Server Running`);
      logger.info('='.repeat(60));
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Port: ${PORT}`);
      logger.info(`API URL: http://localhost:${PORT}`);
      logger.info(`Socket.IO URL: http://localhost:${PORT}`);
      logger.info(`Socket.IO Path: /socket.io/`);
      logger.info(`SSO Enabled: Yes`);
      logger.info(`BwengePlus URL: ${process.env.BWENGE_PLUS_URL || 'Not configured'}`);
      logger.info('='.repeat(60));
    });

    // Handle server errors
    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
      } else {
        logger.error('Server error:', error);
      }
      process.exit(1);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully`);

      io.close(() => {
        logger.info('Socket.IO closed');
      });

      server.close(() => {
        logger.info('HTTP server closed');
        DbConnection.instance.disconnectDb().then(() => {
          process.exit(0);
        });
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Error starting server:', error);
    process.exit(1);
  }
})();