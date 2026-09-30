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
fija las dependencias. El override limitado a `gaxios@6.7.1` sustituye su
dependencia `uuid` vulnerable por `^11.1.1`, que conserva la API CommonJS `v4`
usada por ese cliente transitivo del Admin SDK.

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

El secret sólo se lee durante `onInit`, después de discovery, y nunca se escribe
en el repositorio. Una rotación invalida los códigos pendientes durante sus cinco
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
- Añadir después TTL/limpieza. Borrar un pairing no borra automáticamente su
  subcolección `security`; cualquier limpieza deberá eliminar también el contador.

No se toca Cartón Lleno, Nova Star, Storage, releases, actualizadores, panel admin,
diseño web ni configuración de Hosting.
