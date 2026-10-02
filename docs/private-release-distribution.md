# Distribución privada de Nexo · contrato v1

Rama: feature/private-release-distribution. Implementación sin commit, push ni deploy.
Bucket privado provisionado e importación oficial completada el 2026-10-02 UTC.

## Contrato de assets

Un manifiesto contiene schemaVersion: 1, app, version (X.Y.Z), build, releasedAt,
notes, recommendations y assets. Tanto el JSON privado como la respuesta autorizada
conservan el mismo contrato. No contienen signed URLs, tokens ni credenciales.

Cada asset tiene exactamente:

| Campo | Significado |
| --- | --- |
| id | Identidad estable y exclusiva de app/version; no es una plataforma |
| platform | windows o android |
| purpose | installer, updater o package |
| variant | standard, alias, phone o tv |
| architecture | x64, arm64-v8a, armeabi-v7a, x86_64 o universal |
| format | exe, zip o apk; explícito, no inferido del nombre |
| versionCode | Entero Android; null en Windows |
| filename | Nombre original de distribución |
| size / sha256 | Tamaño exacto y SHA256 de los bytes oficiales |
| generation | Generación inmutable de Storage |
| downloadEndpoint | Ruta relativa de descarga por assetId |

Los IDs se califican con app/version y son estables para ese artefacto concreto.
Ejemplo: novaStar-1.0.27-windows-updater-standard-x64. Se rechazan IDs y tuplas
platform/purpose/variant/architecture duplicadas, campos inesperados y combinaciones
incompatibles. El filename sólo se valida para evitar rutas inseguras; no determina
compatibilidad ni permisos. Un asset de otra app o versión nunca se firma.

recommendations contiene windows, phone y tv, cuyos valores son IDs del mismo
manifiesto. Windows siempre recomienda un installer, nunca updater. Teléfono y
TV apuntan a aliases oficiales independientes. Los updaters seleccionan la tupla
explícita y solicitan su ID exacto. Si una variante/ABI no existe, no hay fallback
silencioso a otra arquitectura. Todos los binarios están disponibles en la API,
pero el portal sólo muestra instalador Windows, teléfono y TV; no expone ZIP ni
listas técnicas. Los tres data-download actuales se conservan.

build identifica la release: Nova 1029, Cartón 44. No debe compararse directamente
con el versionCode del APK: Nova armv7/arm64/x86_64 = 2029/3029/5029; Cartón =
1044/2044/4044. Estos valores se verificaron en AndroidManifest.xml y libflutter.so
contenidos en los APK oficiales; no se recompiló ninguna app.

## Endpoints finales

Todos requieren Firebase ID token en Authorization: Bearer y releen access.

| Método | Ruta | Respuesta |
| --- | --- | --- |
| GET | /api/v1/portal | HTML filtrado según apps autorizadas |
| GET | /api/v1/releases/:app/latest | Manifest v1 |
| GET | /api/v1/releases/:app/:version | Manifest v1 |
| POST | /api/v1/releases/:app/:version/download/:assetId | url, expiresAt, filename, size, sha256 |

POST usa JSON vacío. Se elimina la ambigüedad download/:platform. El servidor
valida pertenencia exacta del ID al manifiesto leído para app/version, integridad
de SHA256/tamaño/generación y permisos antes de firmar. Respuestas no-store.
401 identidad inválida; 403 acceso denegado; 400 parámetros inválidos; 404 release
 o asset inexistente; 503 fallo de integridad/configuración/proveedor.
No hay signed URL persistida. Firma V4 GET durante cinco minutos, atada a
la generación y con descarga attachment. Storage transmite los bytes.

El enlace es una credencial temporal reutilizable: quien lo posea puede descargar
hasta su vencimiento. Cambiar access no revoca un enlace ya emitido. Los updaters
deben verificar size y sha256 antes de instalar. La verificación completa remota
se hace al importar/publicar, no transfiriendo el binario en cada petición de firma.

## Bucket real e IAM exacto

Bucket: gs://nova-star-bd0d9-nexo-releases, Standard, southamerica-west1.
Uniform bucket-level access habilitado; public access prevention enforced.
Sin allUsers, allAuthenticatedUsers, ACL públicas ni Firebase download tokens.
Se quitaron únicamente los grants legacy automáticos del bucket nuevo para que
los miembros básicos de proyecto no hereden lectura/escritura de sus objetos.
Ningún rol existente del proyecto ni roles/editor del runtime fue eliminado.
La política soft-delete de siete días es el valor automático de GCS; no se añadió
TTL, retención Firestore ni reglas de Storage.

Runtime: 870971438774-compute@developer.gserviceaccount.com.
Publicador sin claves: nexo-release-publisher@nova-star-bd0d9.iam.gserviceaccount.com.
Roles personalizados definidos en el proyecto y vinculados sólo a este bucket:

| Rol | Principal | Permisos | Alcance |
| --- | --- | --- | --- |
| nexoReleaseRead | runtime | storage.objects.get | prefijo releases/ |
| nexoReleasePublish | publicador | storage.objects.get, storage.objects.create | prefijo releases/ |
| nexoReleaseLatestReplace | publicador | storage.objects.delete | sólo releases/novaStar/latest.json y releases/cartonLleno/latest.json |
| nexoReleaseBucketInspect | publicador | storage.buckets.get, storage.buckets.getIamPolicy | este bucket |

Nombre completo de roles: projects/nova-star-bd0d9/roles/<nombre>.
Condición de prefijo: resource.name.startsWith('projects/_/buckets/nova-star-bd0d9-nexo-releases/objects/releases/').
La condición de latest compara resource.name exactamente con los dos objetos.
Actualizar un objeto de Storage requiere create y delete; por eso delete sólo se
concede para latest. No se concede list, borrado de versiones ni Storage Admin.
[Permisos oficiales de Storage](https://docs.cloud.google.com/storage/docs/access-control/iam-permissions).

El operador gcloud actual recibió roles/iam.serviceAccountTokenCreator únicamente
sobre la cuenta publicadora para impersonación. No se concedieron roles de proyecto.
El runtime ya tiene ese rol sobre sí mismo para signBlob; se comprobó y conservó.
El runtime no puede impersonar al publicador ni escribir con los nuevos grants.
Su rol histórico de Editor no aporta storage.objects.*; no se modificó.

La herramienta usa la identidad explícita del operador gcloud y la impersonación
del publicador. No modifica ADC global ni necesita claves. En Windows usa el
Python incluido con gcloud; NEXO_GCLOUD_SDK permite cambiar la ruta de instalación.
Tokens sólo en memoria; nunca se imprimen, persisten o pasan en argumentos.

## Parámetro local de Functions

Se añadió NEXO_RELEASES_BUCKET=nova-star-bd0d9-nexo-releases a
functions/.env.nova-star-bd0d9 mediante defineString y el mecanismo oficial de
parámetros. El archivo sigue ignorado por Git; portal URL y región no cambiaron.
No se leyó ni modificó TV_PAIRING_CODE_SECRET. Este parámetro no afecta al runtime
hasta desplegar api.

## Objetos e importación reproducible

- releases/{app}/latest.json
- releases/{app}/{version}/manifest.json
- releases/{app}/{version}/assets/{assetId}/{sha256}/{filename}
- releases/{app}/{version}/support/{sha256}/{filename}

Binarios, auxiliares y manifests se crean con ifGenerationMatch=0. latest usa
compare-and-swap contra su generación previa y fija hash/generación del manifest.
Se comprueban los bytes completos después de subirlos. Una repetición idéntica
verifica y reutiliza; un hash/manifiesto distinto o publicación concurrente aborta.
Los auxiliares originales se conservan privados sin exponerlos como assets de API.
No hay limpieza/borrado automático de versiones.

Input: app, version, build, releasedAt, notes, recommendations, assets con todos
los atributos explícitos y path local/sha256, compatibility con path/fileName/sha256.
No incluir generation: la publicación obtiene la generación real de GCS.
version.json original es obligatorio; Nova exige un asset purpose=updater.
Cartón no publica ZIP y la herramienta no inventa uno.

Comandos desde la raíz:

- npm run releases:dry-run -- input.json (offline; sin writes ni proveedores)
- npm run releases:import -- input.json nova-star-bd0d9-nexo-releases
- npm run releases:verify -- input.json nova-star-bd0d9-nexo-releases
- npm run releases:publish -- input.json nova-star-bd0d9-nexo-releases

Publicación exclusivamente privada (sin consultar, crear, subir, etiquetar ni
activar releases de GitHub):

- npm run releases:dry-run -- input.json
- npm run releases:publish:private -- input.json nova-star-bd0d9-nexo-releases
- npm run releases:verify:private -- input.json nova-star-bd0d9-nexo-releases

Estos modos usan el mismo contrato, verificación SHA256 local/remota, objetos y
manifest inmutables e `ifGenerationMatch` para actualizar `latest`. Una repetición
idéntica reutiliza todas las generaciones, incluido `latest`; `verify:private`
no escribe. No instancian el adaptador GitHub. Sólo cambia el puntero de la app
del input; no hay deploy, recompilación, IAM ni modificación de las otras apps.
Ante ECONNRESET/ETIMEDOUT/EPIPE durante el hash remoto, se reinicia la lectura
de la misma generación hasta tres intentos, descartando todos los bytes parciales.
CRC32C y SHA256 siguen siendo obligatorios; fallos de integridad o permisos abortan.

import verifica GitHub en modo sólo lectura y nunca ejecuta activate/upload/edit.
publish es para releases futuras aprobadas: puede preparar un draft y activarlo
sólo después de verificar Storage/latest. Sin clobber ni modificación de assets
ya existentes. GitHub se mantiene público durante la transición de updaters.

Importados exactamente los 18 archivos oficiales: Nova 1.0.27+1029 (7 binarios,
3 auxiliares) y Cartón 1.0.42+44 (7 binarios, 1 auxiliar). Se incluyen aliases y
APK x86_64, aunque no sean botones adicionales. Los manifiestos/latest están
publicados dentro del bucket privado. Ver imported-releases.json para nombres,
SHA256, generaciones, metadata explícita y resultados de descarga.
Las notas/fechas son las publicaciones reales de GitHub. Nova version.json contiene
URLs históricas novastar-versiones: se mantuvieron sus bytes intactos.

## Portal, Auth y límites de esta fase

Hosting sirve login, CSS, módulos y gráficos públicos. El HTML de apps vive en
functions/portal-content.html, filtrado por GET /api/v1/portal; el build Functions
lo incluye en lib y el de Hosting no lo copia a _site. Gate fail-closed sin caché
GitHub/offline de permisos ni releases. Email/password existente, sin registro o
Anonymous en Nexo. Firebase mantiene sesión; el código propio no persiste tokens
ni contraseñas. Token revocado, usuario deshabilitado/borrado o access denegado
rechazan contenido y descargas. Cada petición comprueba los permisos actuales.
/pair mantiene sus archivos, rewrite y flujo independientes. El contenido visual,
assets, motion y accesibilidad se conservan; no se modifica ninguna app o PWA.

Comprobaciones reales: bucket privado, SHA256 oficial local y remoto de los 18
archivos, latest/hash/generación, siete descargas V4 con hash, acceso sin firma 403,
enlace válido 200 antes y ExpiredToken después del vencimiento. Auth/access de la
cuenta real leído sin cambios: password, no deshabilitada, active=true y ambas apps.
GitHub conserva tags, notas, fechas y todos los assets; sólo incrementan naturalmente
sus contadores de descarga al verificarlos.

La firma probada usa la cuenta publicadora. La impersonación del runtime desde
el operador está denegada; no se amplió IAM para habilitar una prueba administrativa.
La lectura/firma ejecutada por el runtime y los GET/POST con ID token real se
verificarán después de aprobar y desplegar api. Los escenarios 401/403/404,
foreign asset/version, active=false y expiración del cliente se prueban localmente.
Las pruebas actuales no equivalen a validar los nuevos endpoints en producción.
Durante importación apareció MaxListenersExceededWarning en el SDK de Storage;
las transferencias y hashes finalizaron bien, pero el aviso queda documentado.

## Deploy pendiente, no ejecutado

Sólo api requiere publicación de Functions:
firebase deploy --only functions:nexo:api --project nova-star-bd0d9.
No usar deploy global functions: cleanup tiene un procedimiento independiente.
No se despliega Scheduler, cleanup, reglas, Auth, Storage Firebase ni apps/PWA.
El portal requerirá un deploy Hosting posterior y separado, todavía no autorizado.
No se cambió firebase.json, .firebaserc, workflow CI, lógica pairing/retención,
lockfiles ni secretos. No se necesitan índices Firestore ni Functions nuevas.

Mantener públicos GitHub Releases y updaters originales hasta validar versiones
puente futuras. Costes: almacenamiento, operaciones/egreso GCS, lecturas de access,
comprobación de Auth y llamadas API/signBlob. App Check/rate limiting distribuido
continúa pendiente. No se añadió limiter por IP.

## Validaciones finales

Node 22.23.3 / npm 10.9.9. Raíz: 97/97 tests; Functions: 130/130 tests.
Check/build de portal, build y lint Functions y git diff --check correctos.
El servicio TypeScript compilado leyó latest reales de ambas apps, resolvió y
firmó los 14 assets y rechazó ocho IDs ajenos/inexistentes contra manifests reales.
Esta comprobación local usa identidad publicadora, sin simular que se validó un
ID token real o que ya se desplegaron endpoints.
Windows x64 se verifica en el informe oficial VERIFICACION.json de Nova y en
la configuración del instalador de Cartón 1.0.42+44 (ArchitecturesAllowed y
ArchitecturesInstallIn64BitMode=x64compatible; payload windows/x64).
