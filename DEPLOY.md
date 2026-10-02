# Desplegar Nexo

Proyecto `nova-star-bd0d9`. Usa Node 22, npm con los lockfiles y Firebase CLI
autenticado. Ejecuta desde la raíz de este checkout; nunca uses un deploy global.
Cada recurso se publica por separado y sólo después de aprobar sus cambios.

## Portal oficial

```powershell
npm ci
npm test
npm run check
npm run build
firebase deploy --only hosting:portal --project nova-star-bd0d9
```

El target `portal` de `.firebaserc` apunta únicamente a `nexo-hub`:
<https://nexo-hub.web.app>. Conserva `/pair/**` y `/download/**` independientes
del gate de la portada. Comprueba login, refresh, logout, apps autorizadas y las
rutas estables `/download/novaStar` y `/download/cartonLleno`.
No publicar el PWA del micrófono (`nova-star-bd0d9.web.app`).

## API exclusivamente

```powershell
npm test
Push-Location functions
npm ci
npm test
npm run build
npm run lint
Pop-Location
firebase deploy --only functions:nexo:api --project nova-star-bd0d9
```

API: <https://api-jfqflryoka-tl.a.run.app>. Runtime Node 22, región
`southamerica-west1`, codebase `nexo`. Confirma releases, portal, voces y pairing.
Los parámetros oficiales viven en `functions/.env.nova-star-bd0d9`, ignorado:

```ini
NEXO_PORTAL_URL=https://nexo-hub.web.app
NEXO_FUNCTIONS_REGION=southamerica-west1
NEXO_RELEASES_BUCKET=nova-star-bd0d9-nexo-releases
```

No leer, reemplazar ni rotar `TV_PAIRING_CODE_SECRET` durante un deploy rutinario.
No desplegar reglas, Authentication, Storage, cleanup o Hosting junto a la API.

## Cleanup y Scheduler

```powershell
Push-Location functions
npm run deploy:cleanup:dry-run
npm run deploy:cleanup
npm run verify:cleanup
Pop-Location
```

Usa siempre el script versionado `functions/deploy-cleanup.mjs` para cleanup.
Function `cleanupTvPairingsDaily`: `southamerica-west1`; Cloud Scheduler:
`southamerica-east1`. Scheduler no admite la ubicación de la Function; Firebase
CLI intenta derivarla de su región. El script conserva el endpoint HTTP y
administra/verifica el job en la ubicación soportada, con su identidad OIDC.
No cambiar IAM manualmente para un despliegue normal.

Job: `firebase-schedule-cleanupTvPairingsDaily-southamerica-west1`.
Cron `0 4 * * *`, timezone `UTC`. `verify:cleanup` falla si job, región, endpoint,
identidad o configuración discrepan. Para ver también próxima ejecución:

```powershell
gcloud scheduler jobs describe firebase-schedule-cleanupTvPairingsDaily-southamerica-west1 --location=southamerica-east1 --project=nova-star-bd0d9 --format=json
```

No usar `firebase deploy --only functions` para todas las Functions: podría
volver a gestionar este Scheduler en una ubicación incompatible. La política de
retención no cambia y no utiliza Firestore TTL. Ver [OPERATIONS.md](OPERATIONS.md).

Referencias: [deploys parciales de Firebase CLI](https://firebase.google.com/docs/cli#partial_deploys),
[ubicaciones admitidas por Cloud Scheduler](https://docs.cloud.google.com/scheduler/docs/locations).
