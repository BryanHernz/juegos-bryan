# Publicación privada de aplicaciones y voces

El runtime usa exclusivamente Nexo. Los repositorios históricos
`BryanHernz/nova-star-versiones` y `BryanHernz/carton-lleno-versiones` son privados;
GitHub no es una fuente de instalación ni un fallback de las apps/portal.

Bucket `nova-star-bd0d9-nexo-releases`, región `southamerica-west1`: uniform IAM,
Public Access Prevention enforced, sin ACLs/principales públicos. Binarios y
manifests son inmutables. Nunca reemplazar bytes de una versión ya publicada.

## Contrato y publicación

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
Un draft incompleto puede reanudarse; no borrar ni sobrescribir assets históricos.
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
`releases/cartonLleno/voices/catalog.json`; ese permiso aún requiere aprobación,
no se amplió IAM durante el cierre. Ver [docs/private-voices.md](docs/private-voices.md).
