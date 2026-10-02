# Voces privadas de Cartón Lleno

> Evidencia de la importación inicial. API y cliente Cartón 1.0.43 ya usan Nexo;
> GitHub es privado. Estado y procedimiento vigente: [RELEASES.md](../RELEASES.md).
> El permiso de reemplazo del catálogo se aplicó el 2026-10-02,
> limitado exclusivamente a ese objeto.

Las voces tienen su propio catálogo; no pertenecen a una versión de la app y
no se incorporan a los manifests ni a los punteros `latest` de releases.

## Origen auditado

La release pública [`voces`](https://github.com/BryanHernz/carton-lleno-versiones/releases/tag/voces)
es una prerelease independiente. Contiene `voces.json` y nueve ZIPs. Se importan
esos archivos exactos: sin ejecutar `render_voces.py` ni `publicar_voces.py`,
sin reconstruir paquetes y sin modificar GitHub. El inventario local de la
importación registra tamaño, SHA256, versión, generación y metadata. Se guarda
fuera del repo, en `audit-artifacts/private-carton-voices/`; el catálogo real
permanece en Storage privado y no se incluye en el build público de Hosting.

Cada paquete tiene 1.824 clips y `index.json`. La versión de voz es el valor
opaco `paquete` del índice (actualmente una huella de 12 caracteres), no semver
ni la versión de Cartón Lleno. `label`, `gender`, `bytes`, `clips` y `version`
se conservan. No hay idioma explícito en el catálogo o índices actuales:
`language` es `null`; no se deduce del prefijo del ID de una voz multilingüe.

## Storage

Bucket existente: `nova-star-bd0d9-nexo-releases`, `southamerica-west1`, con
Public Access Prevention `enforced`, uniform bucket-level access y sin
principales públicos. No se cambian ACLs, reglas Firestore ni reglas Storage.

```text
releases/cartonLleno/voices/
  catalog.json
  <voiceId>/<sha256>.zip
```

Se usa este prefijo equivalente a `apps/cartonLleno/voices/` para reutilizar
los permisos existentes, ya limitados a `releases/`. Sigue fuera de toda
carpeta de versión concreta. No requiere otro bucket ni ampliación de IAM
para la primera importación. Los ZIPs usan creación exclusiva y nunca se
sobrescriben; versiones anteriores se conservan. El catálogo es el único
objeto mutable de este subsistema.

## Contrato v1

```json
{
  "schemaVersion": 1,
  "app": "cartonLleno",
  "updatedAt": "2026-10-02T00:00:00.000Z",
  "voces": [{
    "id": "es-MX-JorgeNeural",
    "name": "Jorge · mexicano",
    "label": "Jorge · mexicano",
    "gender": "M",
    "version": "90f648d6d8ab",
    "language": null,
    "clips": 1824,
    "size": 28521499,
    "bytes": 28521499,
    "sha256": "1ccff628d2d45babeb13322eb592e567d8c7e86316875a8c68298be061ca45e9",
    "filename": "es-MX-JorgeNeural.zip",
    "generation": "123",
    "downloadEndpoint": "/api/v1/apps/cartonLleno/voices/es-MX-JorgeNeural/download"
  }]
}
```

`generation: "123"` y la fecha del ejemplo son ilustrativas; la importación
obtiene la generación real de GCS. `name == label` y `size == bytes` mantienen
los nombres canónicos y las claves legacy sin cambiar su significado.
El catálogo almacenado lleva SHA256 en metadata GCS. El contrato es estricto,
rechaza claves desconocidas/URLs, IDs duplicados y endpoints manipulados, y
limita el catálogo a 64 KiB y 100 voces. Los ZIPs están limitados a 512 MiB.

## API

```text
GET  /api/v1/apps/cartonLleno/voices
POST /api/v1/apps/cartonLleno/voices/:voiceId/download
```

Ambas requieren `Authorization: Bearer <Firebase ID token>`. POST recibe `{}`
y `Content-Type: application/json`. Cada llamada reutiliza la autorización
de releases: token con revocación comprobada, usuario existente/no deshabilitado,
cuenta email/password, sin identidad anónima, `access.active === true` y
`apps.cartonLleno === true`. No se reutiliza una copia local de access.

GET retorna el catálogo sin URLs firmadas. POST busca el ID exclusivamente
en el catálogo validado, comprueba tamaño/SHA256/generación del objeto y
firma una URL V4 de lectura por cinco minutos, fijando la generación y
`Content-Disposition: attachment`. La respuesta contiene `url`, `expiresAt`,
`id`, `version`, `filename`, `size`, `sha256` y `generation`. La URL vive sólo
en esa respuesta; nunca se escribe en catálogo, logs o almacenamiento.

Sin token/token inválido o revocado: 401. Cuenta/app no autorizada: 403.
Voz o catálogo inexistente: 404. ID, cuerpo o query inválidos: 400.
Integridad inválida/fallo de Storage o firma: 503, sin detalles del proveedor.
Las rutas de releases, portal y pairing conservan su contrato.

## Publicar sin recompilar

Crear un input local, junto a los ZIPs aprobados:

```json
{
  "schemaVersion": 1,
  "app": "cartonLleno",
  "updatedAt": "2026-10-02T00:00:00.000Z",
  "expectedCatalogSha256": null,
  "voces": [{
    "id": "es-MX-JorgeNeural",
    "label": "Jorge · mexicano",
    "gender": "M",
    "version": "90f648d6d8ab",
    "language": null,
    "clips": 1824,
    "size": 28521499,
    "sha256": "1ccff628d2d45babeb13322eb592e567d8c7e86316875a8c68298be061ca45e9",
    "filename": "es-MX-JorgeNeural.zip",
    "path": "es-MX-JorgeNeural.zip"
  }]
}
```

```powershell
npm run voices:dry-run -- input.json
npm run voices:verify -- input.json nova-star-bd0d9-nexo-releases
npm run voices:publish -- input.json nova-star-bd0d9-nexo-releases
```

Dry-run no accede a proveedores: verifica hashes, rutas y un ZIP32 plano,
leyendo su directorio/índice sin extraer, reconstruir ni modificar clips.
Rechaza paquetes cifrados, ZIP64, rutas anidadas/traversal, IDs/versiones/metadata
que no coincidan con el índice, y clips faltantes o duplicados. Los ZIPs
actuales son compatibles. Verify nunca escribe y vuelve a calcular SHA256
de los objetos remotos fijados por generación. Publish comprueba primero
la privacidad del bucket y el catálogo previo, sube sólo los ZIPs ausentes
con `ifGenerationMatch: 0`, verifica bytes remotos y finalmente publica
el catálogo usando compare-and-swap sobre su generación.

Para una voz nueva o una nueva versión, incluir sólo las entradas aprobadas
en el input; las demás se conservan. Usar el SHA256 del catálogo vigente como
`expectedCatalogSha256` y una fecha posterior en `updatedAt`. Se rechaza
reutilizar una versión de voz con otros bytes. Repetir un publish ya completado
no escribe ni modifica generaciones; puede reanudarse tras una subida
interrumpida. No se borran ZIPs ni se retiran voces automáticamente.
Una carrera o permiso insuficiente aborta el reemplazo del catálogo, sin
sobrescribir ZIPs ni exponer paquetes todavía no referenciados.

## IAM existente y permiso aprobado para actualizaciones

- Runtime `870971438774-compute@developer.gserviceaccount.com`: rol custom
  `nexoReleaseRead` (`storage.objects.get`) en este bucket, limitado a `releases/`.
  Firma con su permiso existente `iam.serviceAccounts.signBlob`. No requiere
  permisos de escritura ni nuevos permisos para voces.
- Publicador `nexo-release-publisher@nova-star-bd0d9.iam.gserviceaccount.com`:
  `nexoReleasePublish` (`storage.objects.get/create`) limitado a `releases/`,
  más `nexoReleaseBucketInspect` para verificar privacidad/IAM. Ya permite
  subir ZIPs inmutables y crear el catálogo por primera vez.
- Para reemplazar el catálogo existente, GCS necesita además
  `storage.objects.delete`, limitado **sólo** a `catalog.json`. La condición
  actual de `nexoReleaseLatestReplace` permite únicamente los dos latest de
  las apps; no se reutilizan ni modifican esos punteros.

Binding exacto aprobado. Antes de aplicarlo, leer la política vigente y verificar
que `nexoReleaseLatestReplace` contiene únicamente `storage.objects.delete`.
La sesión que ejecuta el cambio necesita `storage.buckets.getIamPolicy` y
`storage.buckets.setIamPolicy`; iniciar sesión no concede esos permisos.
El binding siguiente se aplicó y verificó el 2026-10-02:

```sh
gcloud storage buckets add-iam-policy-binding gs://nova-star-bd0d9-nexo-releases \
  --member="serviceAccount:nexo-release-publisher@nova-star-bd0d9.iam.gserviceaccount.com" \
  --role="projects/nova-star-bd0d9/roles/nexoReleaseLatestReplace" \
  --condition="title=OnlyCartonVoiceCatalog,expression=resource.name == 'projects/_/buckets/nova-star-bd0d9-nexo-releases/objects/releases/cartonLleno/voices/catalog.json'"
```

No roles amplios de proyecto, nuevas cuentas de servicio, secretos o claves.
Después, verificar que la condición se limita al objeto exacto y que todos los
bindings anteriores siguen iguales. No se otorga reemplazo a ningún otro
objeto. El publicador sigue usando impersonación, sin claves nuevas.

La cuenta operadora era propietaria del proyecto, pero el bucket no conservaba
el acceso adicional de los propietarios mediante convenience values. Owner
no incluye intrínsecamente los permisos IAM del bucket; iniciar sesión de
nuevo no solucionaba el rechazo. Para aplicar el binding se autorizó un rol
temporal con sólo `storage.buckets.getIamPolicy` y
`storage.buckets.setIamPolicy`, condicionado al bucket exacto y a una hora de
vigencia. Se retiró el binding temporal, se eliminó su rol y se comprobó que
IAM del proyecto volvió al estado anterior antes de publicar.
[Referencia oficial de roles básicos en Storage](https://docs.cloud.google.com/storage/docs/access-control/iam-roles#basic-roles).

## Activación inicial (histórico)

Después de revisar inventario/código: integrar y desplegar exclusivamente
`functions:nexo:api`. No se necesita Hosting, cleanup, Scheduler, Firestore
Rules, Auth config, TTL ni un nuevo parámetro de Functions. Se reutiliza
`NEXO_RELEASES_BUCKET` y el adaptador V4 vigente.

La API nueva se valida localmente con mocks de Auth/access; las comprobaciones
de hashes remotos, privacidad y descargas firmadas se hacen contra Storage real.
La primera importación verificó los nueve SHA256 remotos y generaciones. El
catálogo y un ZIP sin firma devolvieron 403; la descarga V4 completa devolvió
200 y coincidió en tamaño/SHA256. Una URL de prueba vencida fue rechazada por
Storage con 400 y `Request has expired`. Esta comprobación usa el servicio
compilado localmente y la identidad existente del publicador para firmar; la
firma con el runtime de producción se comprobará tras el deploy aprobado.
Las URLs y credenciales no se guardan en el inventario de verificación.
Hasta desplegar, no hay endpoints de voces nuevos en producción. Cartón Lleno
no se modifica en esta fase y sigue usando GitHub; será necesaria una fase
posterior de integración del cliente antes de privatizar ese repositorio.
