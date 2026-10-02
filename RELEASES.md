# Publicación privada de aplicaciones y voces

El runtime usa exclusivamente Nexo. Los repositorios históricos
`BryanHernz/nova-star-versiones` y `BryanHernz/carton-lleno-versiones` son privados;
GitHub no es una fuente de instalación ni un fallback de las apps/portal.

Bucket `nova-star-bd0d9-nexo-releases`, región `southamerica-west1`: uniform IAM,
Public Access Prevention enforced, sin ACLs/principales públicos. Binarios y
manifests son inmutables. Nunca reemplazar bytes de una versión ya publicada.

## Contrato y publicación

### Runtime de publicación

Usar **Node 22.x** para publicar/verificar aplicaciones y voces. El flujo
integrado `tools/app-release.ps1` exige esa versión; el runtime comprobado es
Node 22.23.3 con npm 11.17.0. No usar el Node 24 del sistema para este flujo.
En este equipo se puede seleccionar el runtime existente sin reinstalar Node:

```powershell
$nexoRuntime = 'C:\Users\Bryan\.codex\.chatgpt-projects\g-p-6abd539839c4819180a510454646b37f\runtime'
$env:Path = "$nexoRuntime\npm11-bin;$nexoRuntime\node-v22.23.3-win-x64;$env:Path"
node --version
npm --version
```

El `engines >=22` de la raíz corresponde al portal; no amplía el contrato del
publicador integrado ni el runtime Node 22 de Functions. Los SDK instalados
`@google-cloud/storage` 8.2.0 y `teeny-request` 11.0.1 admiten Node >=22, pero
eso no demuestra la compatibilidad completa de publicación con Node 24 o
futuras versiones. Se mantiene Node 22 hasta validar ese flujo por separado.

```text
releases/{app}/{version}/assets/{assetId}/{sha256}/{filename}
releases/{app}/{version}/support/{sha256}/{filename}
releases/{app}/{version}/manifest.json
releases/{app}/latest.json
```

Manifest v1: `app`, `version`, `build`, `releasedAt`, `notes`, `assets[]` y
`recommendations.windows/phone/tv`. Cada asset declara `id`, `platform`,
`purpose`, `variant`, `architecture`, `format`, `versionCode`, `filename`,
`size`, `sha256`, `generation`, `downloadEndpoint`. La compatibilidad y los
permisos no se deducen del filename. Portal Windows recomienda installer EXE;
updater Nova Windows elige ZIP, Cartón Windows EXE. Android elige ABI explícita.
Aliases phone/TV conservan exactamente los bytes oficiales de arm64/armv7.

Preparar un `release-input.json` local aprobado con todos esos atributos,
`path` y SHA256 de cada archivo; omitir `generation`, que proviene de GCS.
Adjuntar auxiliares aprobados en `compatibility` (incluido `version.json`).
Comparar sus hashes con `VERIFICACION.json` / `SHA256-<version>.txt` antes de
ejecutar; no regenerar esas evidencias para encubrir una diferencia.
Usar las notas aprobadas, sin inventar fechas o recompilar en la publicación.
Contrato detallado: [docs/private-release-distribution.md](docs/private-release-distribution.md).

```powershell
gcloud auth login
gh auth login
npm run releases:dry-run -- C:\artefactos\release-input.json
npm run releases:publish:private -- C:\artefactos\release-input.json nova-star-bd0d9-nexo-releases
npm run releases:verify:private -- C:\artefactos\release-input.json nova-star-bd0d9-nexo-releases
```

El publicador impersona `nexo-release-publisher@nova-star-bd0d9.iam.gserviceaccount.com`
con la identidad gcloud del operador, sin claves, ADC nuevos ni tokens guardados.
Requiere permisos ya limitados al bucket: get/create en `releases/`, inspección
del bucket y delete únicamente sobre los dos objetos `latest.json`.
No conceder roles de proyecto ni borrar versiones para publicar.

Dry-run es offline y sin escrituras. Verify lee hashes completos fijando
generación. Publish crea con `ifGenerationMatch=0`, verifica bytes remotos y
actualiza únicamente latest de esa app mediante compare-and-swap. Repetir un
input idéntico reutiliza generaciones; concurrencia, diferencias o downgrade
abortan. No hay deploy de Functions/portal para publicar una app.

## Verificación del runtime y archivo histórico

Con cuenta real autorizada, consultar `GET /api/v1/releases/:app/latest` y
`GET /api/v1/releases/:app/:version`. Validar versión/build, recomendaciones,
generación/tamaño/hash de todos los assets y ausencia de signed URLs.
Solicitar `POST /api/v1/releases/:app/:version/download/:assetId` con JSON `{}`
y Firebase ID token; descargar instalador, updater cuando aplica, phone y TV
completos, comprobar tamaño/SHA256 y `x-goog-generation`. El firmante debe ser
el runtime real; una firma administrativa no reemplaza esta prueba.
No copiar tokens/URLs firmadas a shell, logs, archivos o chat.

Después de esas pruebas, opcionalmente archivar los mismos bytes en GitHub:

```powershell
npm run releases:publish -- C:\artefactos\release-input.json nova-star-bd0d9-nexo-releases
npm run releases:verify -- C:\artefactos\release-input.json nova-star-bd0d9-nexo-releases
```

El adaptador comprueba que el repositorio esperado sea privado antes de crear
un draft/subir y antes de activarlo. Nunca usa clobber ni cambia visibilidad.
Antes de crear un draft, lista todas las páginas de releases autenticadas y
busca por `tag_name`, incluyendo drafts. Un draft existente se reanuda; uno
publicado se reutiliza y verifica. La creación devuelve su ID, que se conserva
para verificar assets y publicar por ID: no se usa `/releases/tags/{tag}` para
localizar drafts. Un reintento tras una respuesta de creación interrumpida
vuelve a listar antes de crear. Si ya hay varios releases con el mismo tag,
se detiene para revisión manual; no elige uno ni borra duplicados. No borrar
ni sobrescribir assets históricos.
La API entrega URLs V4 válidas cinco minutos y atadas a generación. Se solicitan
nuevas al vencer; no se persisten en manifests, HTML, localStorage ni logs.
Referencia: [signed URLs de Cloud Storage](https://docs.cloud.google.com/storage/docs/access-control/signed-urls).

## Desde cada repo de app

Definir `$env:NEXO_REPO` una vez con el checkout de Nexo y usar
`tool/release_nexo.ps1` (Nova) o `tools/release_nexo.ps1` (Cartón). No es necesario
abrir Nexo ni cambiar de carpeta. El comando comparte `tools/app-release.ps1`:
valida Git limpio, versión/build, metadata original, SHA256, tres ABI/aliases;
ejecuta analyze/tests y publica/verifica sin compilar. Modos `DryRun`,
`PublishPrivate`, `VerifyPrivate`, `PublishHistory`. Este último exige
`-DownloadsVerified`, confirmación del operador tras comprobar la API real.
Ver `RELEASE.md` de cada app para comandos completos. No automatizamos el login
de la cuenta ni su aprobación de las descargas, ni almacenamos credenciales.
Si Flutter reescribe sólo los finales de línea de sus registrantes generados,
se restauran sus bytes iniciales desde memoria; cualquier cambio de contenido
permanece visible y detiene la publicación. No se restaura código de la app.

## Voces independientes

```text
releases/cartonLleno/voices/catalog.json
releases/cartonLleno/voices/<voiceId>/<sha256>.zip
```

No incluir voces en releases/versiones de app ni cambiar su latest. Catálogo
v1 conserva id, name/label, gender, version, language, clips, size/bytes, sha256,
filename, generation y downloadEndpoint, sin URL firmada. No reconstruir ZIPs.
API autorizada: GET `/api/v1/apps/cartonLleno/voices`, POST
`/api/v1/apps/cartonLleno/voices/:voiceId/download`.

```powershell
npm run voices:dry-run -- C:\voces\input.json
npm run voices:verify -- C:\voces\input.json nova-star-bd0d9-nexo-releases
npm run voices:publish -- C:\voces\input.json nova-star-bd0d9-nexo-releases
```

Para actualizar, fijar `expectedCatalogSha256` del catálogo vigente; ZIPs nuevos
son inmutables y el catálogo usa CAS. Verify tras publish y probar descarga
real desde la API. Una voz nueva no requiere recompilar/desplegar apps/backend.
Reemplazar el catálogo necesita delete **exclusivamente** en el objeto
`releases/cartonLleno/voices/catalog.json`, con condición `OnlyCartonVoiceCatalog`.
El binding fue aplicado y verificado el 2026-10-02. Los bindings de latest
conservan sus dos objetos exactos; el resto del bucket no recibió permisos
adicionales de reemplazo. No ampliar esas condiciones para publicar una voz.
Ver [docs/private-voices.md](docs/private-voices.md).

## Warning de streams del SDK

Con Node 22.23.3 se reproduce `MaxListenersExceededWarning` (11 listeners
`error`/`close` sobre `PassThrough`) leyendo objetos pequeños, antes de subir
ZIPs. El stack apunta a `teeny-request` 11.0.1, `build/src/index.js:194`, donde
su pipeline se combina con el pipeline de descarga/validación de
`@google-cloud/storage` 8.2.0. Las publicaciones son secuenciales y cada lectura
crea su propio stream; no reutilizamos streams de subida entre objetos.

Queda pendiente revisar una corrección del SDK y validar su actualización.
No se cambia el límite de listeners, no se suprimen warnings y no se retiran
handlers internos del proveedor. El warning no sustituye la comprobación de
tamaño, SHA256 y generación: cualquier fallo de esas comprobaciones aborta.
[Node documenta que pipeline puede conservar listeners tras completarse](https://nodejs.org/docs/latest-v22.x/api/stream.html#streampipelinesource-transforms-destination-callback).
