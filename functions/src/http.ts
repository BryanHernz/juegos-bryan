import express, { ErrorRequestHandler, Request } from 'express';
import { PairingService } from './tv/pairing';
import { ReleaseService } from './releases/service';
import { authorizedPortal } from './releases/portal';
import { VoiceService } from './voices/service';
import {
  ApiError, approvalCode, bearerToken, BODY_LIMIT, creationApp, pairingId, pollToken,
} from './tv/validation';

export interface HttpOptions {
  releases?: ReleaseService;
  voices?: VoiceService;
  portalTemplate?: () => string;
  // Plug in an App Check/distributed limiter here. Default is explicitly unthrottled.
  beforeCreate?: (request: Request) => Promise<void>;
}

export function createHttpApp(service: PairingService, options: HttpOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    const origin = req.get('Origin');
    res.vary('Origin');
    if (origin && origin !== service.portalUrl) return next(new ApiError(403, 'origin_denied'));
    if (origin) res.set('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.status(204).end();
      return;
    }
    // Functions may parse JSON before Express runs. Check its original raw bytes too.
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const length = Number(req.get('Content-Length') ?? 0);
    if ((rawBody && rawBody.length > BODY_LIMIT) || length > BODY_LIMIT) {
      return next(new ApiError(413, 'body_too_large'));
    }
    if (req.method === 'POST') {
      if (!req.is('application/json')) return next(new ApiError(415, 'json_required'));
      if (req.get('Content-Encoding') && req.get('Content-Encoding') !== 'identity') {
        return next(new ApiError(415, 'content_encoding_unsupported'));
      }
    }
    next();
  });
  app.use(express.json({ limit: BODY_LIMIT, strict: true, inflate: false }));

  app.post('/api/v1/tv/pairings', async (req, res, next) => {
    try {
      const appId = creationApp(req.body);
      await options.beforeCreate?.(req);
      res.status(201).json(await service.create(appId));
    } catch (error) { next(error); }
  });

  app.post('/api/v1/tv/pairings/:pairingId/approve', async (req, res, next) => {
    try {
      const uid = await service.verifyUser(bearerToken(req.get('Authorization')));
      const id = pairingId(req.params.pairingId);
      await service.approve(id, uid, approvalCode(req.body));
      res.json({ status: 'approved' });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/tv/pairings/:pairingId/metadata', async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new ApiError(400, 'query_forbidden');
      res.json(await service.metadata(pairingId(req.params.pairingId)));
    } catch (error) { next(error); }
  });

  app.get('/api/v1/tv/pairings/:pairingId', async (req, res, next) => {
    try {
      if (Object.hasOwn(req.query, 'pollToken')) throw new ApiError(400, 'poll_token_query_forbidden');
      const token = pollToken(req.get('Authorization'));
      res.json(await service.poll(pairingId(req.params.pairingId), token));
    } catch (error) { next(error); }
  });

  app.get('/api/v1/portal', async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new ApiError(400, 'query_forbidden');
      if (!options.releases || !options.portalTemplate) throw new ApiError(503, 'portal_unavailable');
      const apps = await options.releases.authorizePortal(bearerToken(req.get('Authorization')));
      res.json({ apps, html: authorizedPortal(options.portalTemplate(), apps) });
    } catch (error) { next(error); }
  });
  app.use('/api/v1/releases', (req, _res, next) => {
    if (Object.keys(req.query).length) return next(new ApiError(400, 'query_forbidden'));
    if (!options.releases) return next(new ApiError(503, 'releases_unavailable'));
    next();
  });
  app.get('/api/v1/releases/:app/:version', async (req, res, next) => {
    try {
      const appId = await options.releases!.authorize(bearerToken(req.get('Authorization')), req.params.app);
      res.json(await options.releases!.manifest(appId, String(req.params.version)));
    } catch (error) { next(error); }
  });
  app.post('/api/v1/releases/:app/:version/download/:assetId', async (req, res, next) => {
    try {
      const appId = await options.releases!.authorize(bearerToken(req.get('Authorization')), req.params.app);
      if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length) throw new ApiError(400, 'invalid_body');
      res.json(await options.releases!.download(appId, String(req.params.version), req.params.assetId));
    } catch (error) { next(error); }
  });

  app.use('/api/v1/apps/cartonLleno/voices', (req, _res, next) => {
    if (Object.keys(req.query).length) return next(new ApiError(400, 'query_forbidden'));
    if (!options.voices || !options.releases) return next(new ApiError(503, 'voices_unavailable'));
    next();
  });
  app.get('/api/v1/apps/cartonLleno/voices', async (req, res, next) => {
    try {
      await options.releases!.authorize(bearerToken(req.get('Authorization')), 'cartonLleno');
      res.json(await options.voices!.catalog());
    } catch (error) { next(error); }
  });
  app.post('/api/v1/apps/cartonLleno/voices/:voiceId/download', async (req, res, next) => {
    try {
      await options.releases!.authorize(bearerToken(req.get('Authorization')), 'cartonLleno');
      if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length) throw new ApiError(400, 'invalid_body');
      res.json(await options.voices!.download(req.params.voiceId));
    } catch (error) { next(error); }
  });

  app.use((_req, _res, next) => next(new ApiError(404, 'route_not_found')));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    void _next; // Express identifies error middleware by its four-argument signature.
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.code });
    } else if (typeof error === 'object' && error !== null && 'type' in error &&
      error.type === 'entity.too.large') {
      res.status(413).json({ error: 'body_too_large' });
    } else if (typeof error === 'object' && error !== null && 'status' in error &&
      (error.status === 400 || error.status === 415)) {
      res.status(error.status).json({ error: 'invalid_json' });
    } else {
      // Never serialize/log the request, headers, body, token, or provider error.
      res.status(500).json({ error: 'internal_error' });
    }
  };
  app.use(errors);
  return app;
}
