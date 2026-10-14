import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { authRouter } from './routes/auth';
import { professionalRouter } from './routes/professional';
import { publicRouter } from './routes/public';
import { bookingsRouter } from './routes/bookings';
import { downloadRouter, accountRouter } from './routes/misc';
import { staffRouter } from './routes/staff';
import { adminRouter } from './routes/admin';
import { errorHandler, notFoundHandler } from './middleware/error';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'img-src': ["'self'", 'data:', 'https:', 'blob:'],
          'media-src': ["'self'", 'https:', 'blob:', 'data:'],
        },
      },
    })
  );
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(['/api', '/'], rateLimit({ windowMs: 60_000, limit: config.isTest ? 100_000 : 600, standardHeaders: true, legacyHeaders: false }));

  app.get(['/api/health', '/health'], (_req, res) => res.json({ status: 'ok' }));
  app.use(['/api/auth', '/auth'], authRouter);
  app.use(['/api/public', '/public'], publicRouter);
  app.use(['/api/professional', '/professional'], professionalRouter);
  app.use(['/api/bookings', '/bookings'], bookingsRouter);
  app.use(['/api/download', '/download'], downloadRouter);
  app.use(['/api/account', '/account'], accountRouter);
  app.use(['/api/staff', '/staff'], staffRouter);
  app.use(['/api/admin', '/admin'], adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
