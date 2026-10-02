# Nexo: backend común de vinculación de TV

Cloud Functions v2, TypeScript, Node.js 22 y Firebase Admin SDK. Una única
Function HTTP pública, `api`, sirve a `cartonLleno` y `novaStar` en el proyecto
`nova-star-bd0d9`. El frontend existente no se mueve ni se modifica.
Esta entrega no configura Hosting, no despliega recursos y no crea secretos reales.

## Desarrollo y comprobación local

Desde `functions/`, con Node.js 22 actualizado:

```sh
npm ci
npm test
npm run build
npm run lint
```

Las pruebas HTTP ejecutan el router real y el adaptador real de Firestore contra
un doble local con escrituras atómicas, rollback, reintentos y solicitudes
concurrentes; Auth también está inyectado. No inicializan Firebase ni necesitan
credenciales, secretos reales, emuladores o acceso a producción.
Los tests del frontend se ejecutan por separado con `npm test` desde la raíz.
No se agregan scripts ni dependencias al `package.json` del frontend.

`lib/`, `node_modules/`, `.env*` y `.secret.local` están ignorados. El lockfile
fija las dependencias. El override `gaxios -> uuid ^11.1.1` conserva la corrección
de seguridad y la API CommonJS `v4` usada por ese cliente transitivo del Admin SDK.
El selector de `gaxios` no incluye versión: con el selector anterior
`gaxios@6.7.1`, npm 10 rechazaba el lockfile durante `npm ci` por un supuesto
`uuid@9.0.1` ausente, aunque npm 11 aceptaba las mismas resoluciones.
Se verificaron instalaciones con `node_modules` ausente bajo Node.js 22.23.3,
npm 10.9.9 y npm 11.17.0. Las versiones resueltas se mantienen: `uuid 11.1.1`
y `gaxios 6.7.1`, `7.1.3` y `7.3.1`. Para regenerar el lockfile sin depender de
una instalación anterior, retirar `node_modules` y ejecutar
`npm install --package-lock-only --ignore-scripts`, seguido de `npm ci`.
No editar el lockfile manualmente ni retirar el override para volver a `uuid 9`.

## Contrato HTTP

Las rutas son relativas a la URL de la Function `api`. Por ejemplo:
`<URL-DE-LA-FUNCTION-api>/api/v1/tv/pairings`. No hay rewrites de Hosting.
Todos los resultados incluyen `Cache-Control: no-store`; errores JSON tienen
la forma `{ "error": "codigo_estable" }`, sin detalles del proveedor.
Los POST requieren `Content-Type: application/json`, un objeto JSON y un body
de hasta 1024 bytes. No se aceptan propiedades ajenas al contrato ni cuerpos
comprimidos. También se valida `rawBody` para el JSON preprocesado por Functions.

### `POST /api/v1/tv/pairings`

Sin login. Body: `{ "app": "cartonLleno" }` o `{ "app": "novaStar" }`.
Cualquier otro valor devuelve 400. Respuesta 201:

```json
{
  "pairingId": "<identificador aleatorio de 48 caracteres hexadecimales>",
  "code": "482913",
  "pollToken": "<secreto base64url de 256 bits>",
  "app": "cartonLleno",
  "pairUrl": "<NEXO_PORTAL_URL>/pair/<pairingId>",
  "expiresAt": "<fecha ISO-8601: ahora + 5 minutos>"
}
```

La TV muestra un QR con `pairUrl` y el código. El teléfono debe pedir ese código
incluso al entrar por QR: el identificador por sí solo no permite aprobar.
El QR no contiene el pollToken ni el código. La pantalla `/pair/:pairingId`
todavía no se implementa. Para una entrada manual, el portal debe recibir tanto
el identificador como el código; esta versión no ofrece búsqueda sólo por código.
Los códigos de seis dígitos pueden coincidir entre pairings y no son identificadores.

### `POST /api/v1/tv/pairings/:pairingId/approve`

Header: `Authorization: Bearer <Firebase ID token>`.
Body obligatorio: `{ "code": "482913" }` (string de seis dígitos).
Admin Auth ejecuta `verifyIdToken()`. En una transacción se consulta `access/{uid}`
y se exige `active === true` y `apps[app] === true` para la app del pairing.
Una aprobación válida cambia `pending` a `approved`, fija `approvedUid` y escribe
`approvedAt` con timestamp del servidor. Respuesta 200: `{ "status": "approved" }`.

- 401: Firebase token ausente o inválido.
- 403: acceso ausente/inactivo, permiso de app ausente o código incorrecto.
- 404: pairing inexistente.
- 410: pairing expirado, incluido el instante exacto de vencimiento.
- 429 `pairing_locked`: quinto intento incorrecto y solicitudes posteriores.
- 409: pairing ya aprobado o consumido. No se permite reaprobación, incluso
  por el mismo usuario; otro usuario nunca reemplaza al primero.

El contador se incrementa sólo para un usuario autenticado con acceso a la app.
Un código ausente o mal formado dentro de un body válido también cuenta como
intento incorrecto. El contador y las modificaciones del pairing son atómicos.
Tras cinco fallos se bloquean aprobación y polling hasta que se cree otro pairing.
La respuesta de error se emite después de confirmar el contador, para evitar
que un error lanzado dentro de la transacción deshaga el incremento.

### `GET /api/v1/tv/pairings/:pairingId`

Header obligatorio: `Authorization: Pairing <pollToken>`.
Nunca enviar el pollToken por query string. La API rechaza expresamente
`?pollToken=...`, incluso cuando se incluye también el header válido.
La TV debe mantener el pollToken en memoria/almacenamiento privado y evitar logs.

- Pending: 200 `{ "status": "pending" }`. Polling recomendado cada 2–3 segundos,
  con espera progresiva ante errores temporales; detenerlo al vencer `expiresAt`.
- Approved: una transacción valida el hash del pollToken, vigencia, bloqueo,
  estado y UID, y marca `consumed` con timestamp del servidor. Después del commit
  se ejecuta `createCustomToken(approvedUid)` y se responde 200:
  `{ "status": "approved", "customToken": "..." }`.
- 401: secreto ausente/incorrecto o pairing inexistente.
- 410: expirado, también cuando estaba aprobado.
- 429: bloqueado por cinco intentos de código incorrecto.
- 409 `pairing_consumed`: ya consumido; crear otro pairing.

La TV llama a `signInWithCustomToken(customToken)`. El token identifica al usuario
aprobador; esta entrega no crea claims de juego, acceso independiente ni una
identidad permanente separada para el dispositivo. Los permisos posteriores
siguen dependiendo de las reglas y del modelo de acceso existente.

**Consumo de una sola vez:** si se pierde la respuesta después del commit, o falla
la firma, el pairing sigue consumido. La TV debe crear uno nuevo. No hay replay,
rollback de consumo ni persistencia del custom token. La firma se realiza fuera
de la transacción porque Firestore puede volver a ejecutar su callback.

## Datos y seguridad

`tvPairings/{pairingId}` contiene exclusivamente:

| Campo | Contenido |
| --- | --- |
| app | `cartonLleno` o `novaStar` |
| codeHash | HMAC-SHA-256 de `pairingId:app:code` con secreto del servidor |
| pollTokenHash | SHA-256 del secreto de polling de 32 bytes |
| status | `pending`, `approved` o `consumed` |
| createdAt | Timestamp del servidor |
| expiresAt | Timestamp con vencimiento a cinco minutos |
| approvedUid | UID del aprobador; sólo después de aprobar |
| approvedAt | Timestamp del servidor; sólo después de aprobar |
| consumedAt | Timestamp del servidor; sólo después de consumir |

`tvPairings/{pairingId}/security/approval` contiene sólo `failedAttempts`.
Este documento separado mantiene el esquema máximo del pairing y conserva el
bloqueo entre instancias; no hay un estado adicional `blocked` ni bloqueo en memoria.
Ambos documentos deben permanecer inaccesibles a clientes. Todas las operaciones
de aprobación/consumo validan expiración; no se necesita borrado inmediato.

No se guardan códigos, pollTokens ni Firebase custom tokens en claro. Los hashes
se comparan con `timingSafeEqual` cuando su formato/longitud es válido. No se
registran códigos, headers, tokens, bodies ni errores crudos del proveedor.
No se incluye ninguna cuenta de servicio, clave privada o secreto real.

**Reglas:** este checkout de `main` no contiene `firestore.rules`. No se crea ni
modifica ese archivo y `firebase.json` sólo añade Functions. Antes de un futuro
deploy hay que verificar las reglas efectivamente desplegadas: el deny por
default debe cubrir la colección y su subcolección; un wildcard que conceda
acceso global anularía esa protección. Admin SDK opera por IAM, fuera de esas reglas.

## Configuración necesaria para un futuro deploy

`.firebaserc` apunta únicamente a `nova-star-bd0d9`. No se ha hecho deploy.

| Nombre | Tipo | Requisito |
| --- | --- | --- |
| `TV_PAIRING_CODE_SECRET` | Secret Manager (`defineSecret`) | Secreto aleatorio de al menos 32 bytes, recomendado 32 bytes aleatorios codificados como hex; enlazado sólo a `api` |
| `NEXO_PORTAL_URL` | Parámetro `defineString` | Origen HTTPS real del portal, sin ruta, credenciales, query ni fragmento; obligatorio, sin URL predeterminada |
| `NEXO_FUNCTIONS_REGION` | Parámetro `defineString` | Default `southamerica-west1`, donde está el Firestore real; sigue configurable |

El secret sólo se lee al inicializar el router en la primera solicitud de `api`,
después de discovery, y nunca se escribe en el repositorio. La limpieza programada
no enlaza ni lee ese secret. Una rotación invalida los códigos pendientes durante sus cinco
minutos de vida; crear pairings nuevos. No usar claves privadas ni JSON de cuentas
de servicio: `initializeApp()` usa las credenciales administradas del entorno.

La cuenta de servicio de runtime necesita permisos de lectura/escritura de
Firestore, acceso al secret enlazado y `iam.serviceAccounts.signBlob` para firmar
custom tokens con la cuenta elegida. Revisar la API IAM Service Account Credentials
y el rol Service Account Token Creator concedido sobre esa cuenta. Confirmar la
cuenta efectiva de Functions v2 y los permisos mínimos antes de desplegar.
El invocador HTTP es público para permitir TVs sin login; la aprobación se
autentica dentro del endpoint y el polling exige su secreto.

CORS permite sólo el origen configurado del portal y solicitudes sin Origin
(TV nativa). Se permite preflight con Authorization y Content-Type; no se usan
cookies. Si una TV web necesita otro origen, hay que añadir una allowlist explícita.
CORS no sustituye autenticación ni evita abuso desde clientes que omiten Origin.

Referencias oficiales: [configuración y Secret Manager](https://firebase.google.com/docs/functions/config-env?gen=2nd),
[custom tokens y permisos de firma](https://firebase.google.com/docs/auth/admin/create-custom-tokens),
[runtime Node.js](https://firebase.google.com/docs/functions/manage-functions#set_nodejs_version).

## Limitaciones y decisiones pendientes

- **Creación sin rate limit por IP en esta entrega.** En una Function pública no
  se asume que `X-Forwarded-For` sea una IP confiable y `trust proxy` permanece
  desactivado. Contar en memoria no sería fiable entre instancias. El hook async
  `createHttpApp(..., { beforeCreate })` permite añadir App Check o un limiter
  distribuido sin cambiar las rutas. Antes de abrirlo al público, definir la fuente
  confiable de IP y un gateway/almacén compartido o política de App Check compatible
  con ambas TVs. El límite temporal `maxInstances: 3` sólo limita escalamiento/costo
  durante las pruebas; no sustituye rate limiting. Quedan riesgos de abuso, costes
  y carga por creación/polling.
- Confirmar host definitivo del portal, región y cuenta de servicio/IAM.
- Implementar `/pair/:pairingId` con login y entrada del código en una tarea posterior;
  decidir cómo transportará una entrada manual tanto identificador como código.
- Confirmar deny de Firestore para pairings y contador en el proyecto real.

## Retención diaria de tvPairings

`cleanupTvPairingsDaily` usa Cloud Functions v2 `onSchedule`, cron `0 4 * * *`
y timezone `UTC`: una ejecución diaria a las 04:00 UTC, sin cambios de horario
de verano. Usa `NEXO_FUNCTIONS_REGION`, cuyo default es `southamerica-west1`,
Node 22, 256 MiB, timeout de 300 segundos, cero instancias mínimas, una instancia
máxima, concurrencia 1 y sin reintentos de Scheduler (`retryCount: 0`).
Una repetición manual o ejecución solapada también es segura por las transacciones.
La Function y el job ya están desplegados. La Function reside en
`southamerica-west1`; el job reside en `southamerica-east1` (ver procedimiento
de deploy abajo). La limpieza no configura TTL ni cambia reglas o IAM.

| Estado | Condición de eliminación |
| --- | --- |
| `pending` o `approved`, vigente | Conservar |
| `pending` o `approved`, expirado sin consumir | `now >= expiresAt + 24 horas` |
| `consumed` | `now >= consumedAt + 7 días` **y** `now >= expiresAt` |
| Desconocido, campos faltantes/tipos inválidos o estructura inesperada | Omitir y contar como inválido |

Escanea exclusivamente `tvPairings` en páginas de 200, ordenadas por ID y sin
cargar campos durante el escaneo. No necesita índices nuevos. Para cada documento,
una transacción relee el padre y vuelve a evaluar su estado y timestamps actuales.
Si es elegible, lee `security` y elimina sus documentos junto con el padre en el
mismo commit. Un conflicto provoca la relectura automática de Firestore; un fallo
no deja un borrado parcial. Un padre ya eliminado se omite sin error.

Se conservan pairings incompletos (incluidos hashes ausentes), campos desconocidos,
subcolecciones distintas de `security`, documentos `security` con subcolecciones
anidadas (incluso si falta su documento padre) y más de 100 documentos `security`, para evitar pérdida de datos ajenos
o exceder un commit acotado. No se usa borrado recursivo ni se consultan otras
colecciones. Los errores individuales se cuentan y el recorrido continúa; un error
de escaneo detiene el recorrido. El job informa fallo si el resumen contiene errores.

Cada ejecución registra un único resumen `tv_pairings_cleanup` con `scanned`,
`deletedExpired`, `deletedConsumed`, `skippedActive`, `skippedInvalid` y `errors`.
También incluye `skippedRetention` (aún dentro de las 24 h/7 d) y `skippedMissing`
(eliminado concurrentemente), para contabilizar todos los documentos escaneados.
Los contadores de borrado se incrementan después de confirmar la transacción,
sin duplicarlos en reintentos. No se registran documentos, IDs, hashes, tokens,
secretos ni detalles de excepciones del proveedor.

El coste escala con la cantidad de pairings: aproximadamente una lectura del
escaneo y otra lectura transaccional por padre, más consultas/lecturas `security`
para los elegibles y una eliminación por documento borrado. Se suma un job diario
de Cloud Scheduler y la ejecución de Functions; sin dependencias adicionales.
La revisión de subcolecciones agrega llamadas de metadatos. El timeout de 300 s
es un límite por ejecución; errores o volumen que lo exceda requieren revisar el
resumen/estado del job antes de ampliar recursos. Los tests son exclusivamente
locales, incluidos límites exactos de retención, rollback, carreras y paginación.

Referencia: [funciones programadas de Firebase](https://firebase.google.com/docs/functions/schedule-functions).

## Procedimiento oficial de deploy y verificación del cleanup

**Function region != Scheduler location.** `cleanupTvPairingsDaily` permanece en
`southamerica-west1`, junto a Firestore. Cloud Scheduler no ofrece esa ubicación;
el job `firebase-schedule-cleanupTvPairingsDaily-southamerica-west1` reside en
`southamerica-east1` y envía un POST autenticado por OIDC a la Function de Santiago.
El sufijo del nombre identifica la región de la Function, no la ubicación del job.

La causa está en Firebase CLI 15.19.0:
`lib/deploy/functions/release/fabricator.js`, `upsertScheduleV2(endpoint)`, llama a
`scheduler.jobFromEndpoint(endpoint, endpoint.region, projectNumber)`.
`lib/gcp/cloudscheduler.js` usa esa ubicación para construir el nombre del job y
`createOrReplaceJob()` lo consulta/crea/actualiza allí. El SDK `onSchedule` no tiene
un parámetro independiente para la ubicación del Scheduler. Cambiar sólo
`NEXO_FUNCTIONS_REGION` también movería la Function; no es la solución.

Desde `functions/`, con **Node 22 y Google Cloud CLI autenticado**:

```sh
# Offline: muestra el plan; no usa credenciales, red, builds ni escrituras.
npm run deploy:cleanup:dry-run

# Sólo lectura de Function, permiso de invocación y Scheduler.
npm run verify:cleanup

# Sólo cuando el deploy esté autorizado:
npm run deploy:cleanup
```

El script versionado `deploy-cleanup.mjs` usa los CLIs/APIs oficiales de Google:

1. Instala con `npm ci` y exige lint, tests y build locales. Comprueba el manifest
   compilado (`0 4 * * *`, UTC) y los archivos que se van a subir.
2. Verifica que exista la Function Gen 2 activa, Node 22, entry point correcto,
   cuenta de runtime aprobada y recursos actuales. Nunca recrea una Function
   ausente, cambia su nombre/región ni despliega `api` u otras Functions.
3. Verifica que `roles/run.invoker` ya permita invocar a la cuenta aprobada y que
   cleanup no sea público. No otorga, elimina ni modifica bindings IAM. Si falta
   un permiso, aborta y exige revisión explícita.
4. Actualiza **únicamente** `cleanupTvPairingsDaily` con `gcloud functions deploy
   --gen2 --trigger-http --entry-point=cleanupTvPairingsDaily --region=southamerica-west1`.
   `onSchedule` Gen 2 ya es una Function HTTP con un job separado; no se modifica
   su export, callback, schedule, timezone ni lógica de retención. Esto evita el
   administrador de Scheduler de Firebase CLI. Conserva la cuenta de build cuando
   está especificada y vuelve a comprobar cuenta de runtime e invocadores.
5. Usa la API oficial de Cloud Scheduler para consultar el job exacto en
   `southamerica-east1`: crea si falta, corrige únicamente los campos aprobados
   que difieran y no escribe si ya coincide. No reemplaza otros tipos de targets
   ni reactiva un job pausado. Una configuración cambiada concurrentemente
   durante el deploy hace abortar la reconciliación.
6. Verifica `ENABLED`, POST/OIDC al URI actual, cuenta de servicio, `0 4 * * *`,
   UTC, deadline 300 s, cero reintentos y próxima ejecución a las 04:00 UTC.
   `scheduleTime` puede incluir segundos/fracciones dentro del minuto programado;
   se valida ese minuto y se informa el timestamp completo que devuelve Google.
   Devuelve un resumen con los identificadores, ubicaciones y `nextExecution`.
   Cualquier fallo aborta con salida distinta de cero; no trata un deploy parcial
   como éxito y no borra recursos para corregirlo.

`.gcloudignore` permite subir sólo `package.json`, `package-lock.json` y el runtime
compilado `lib/`. Excluye `.env*`, secretos locales, `node_modules`, tests y tooling.
`GOOGLE_NODE_RUN_SCRIPTS=` evita recompilar TypeScript sin sus fuentes en Cloud
Build, igual que Firebase CLI; el build ya se validó localmente. No cambian las
dependencias ni el lockfile. Tokens de Google sólo se mantienen en memoria y no
se muestran en logs; nunca se leen secretos del backend. El script no invoca
cleanup, no consulta datos Firestore ni toca Authentication, reglas o TTL.

La reconciliación del job es idempotente: sucesivas ejecuciones no crean jobs
duplicados ni actualizan un job correcto. Cada `--deploy` sí publica nuevamente
el código de la Function; `--verify` y `--dry-run` no publican nada.

Para inspeccionar directamente el estado y la próxima ejecución:

```sh
gcloud functions describe cleanupTvPairingsDaily --gen2 \
  --region=southamerica-west1 --project=nova-star-bd0d9 \
  --format='yaml(name,state,buildConfig.runtime,serviceConfig.uri)'

gcloud scheduler jobs describe firebase-schedule-cleanupTvPairingsDaily-southamerica-west1 \
  --location=southamerica-east1 --project=nova-star-bd0d9 \
  --format='yaml(name,state,schedule,timeZone,scheduleTime)'
```

**El proceso normal cambia sólo para cleanup.** No usar `firebase deploy --only
functions` ni `functions:nexo:cleanupTvPairingsDaily`: volverían a intentar
administrar el job en la ubicación incorrecta. Para futuros cambios autorizados
de `api`, Firebase CLI sigue siendo válido con el selector explícito
`firebase deploy --only functions:nexo:api --project nova-star-bd0d9`.
Una actualización futura de Firebase CLI/SDK que soporte ubicaciones separadas
debe verificarse antes de retirar esta excepción; no parchear su instalación.

Referencias: [ubicaciones de Scheduler](https://cloud.google.com/scheduler/docs/locations),
[gcloud functions deploy](https://cloud.google.com/sdk/gcloud/reference/functions/deploy),
[autenticación HTTP de Scheduler](https://cloud.google.com/scheduler/docs/http-target-auth),
[scripts de build de Node](https://cloud.google.com/docs/buildpacks/nodejs).

No se toca Cartón Lleno, Nova Star, Storage, releases, actualizadores, panel admin,
diseño web ni configuración de Hosting.
# API de distribución privada (implementación local, sin deploy)

`api` añade `GET /api/v1/portal`, `GET /api/v1/releases/:app/latest`,
`GET /api/v1/releases/:app/:version` y
`POST /api/v1/releases/:app/:version/download/:assetId`.
Usan Firebase ID tokens, revocación/estado de Auth y `access/{uid}` leído en cada
solicitud. `NEXO_RELEASES_BUCKET` es un parámetro Functions oficial nuevo;
default vacío conserva releases cerrados hasta provisionar un bucket privado.
El contenido del portal se copia a lib en el build y se filtra por permisos en
el servidor. No se escribe Firestore, no se modifica pairing/cleanup ni se
transmiten binarios desde Functions. URLs GCS V4 de cinco minutos.

Ver [contrato multiasset, estructura, IAM real y publicador](../docs/private-release-distribution.md).
Bucket privado, IAM mínimo e importación inicial completados; parámetro local ignorado configurado.
No hubo deploy; no se modificaron secretos, reglas ni Authentication.
