# Cierre de dependencias runtime a GitHub

Auditoría del 2026-10-02; inventario antes/después de privatizar mediante GitHub
API autenticada, paginando releases, assets y tags. Se compararon IDs, nombres,
notas, fechas, tamaños y metadata, omitiendo sólo contadores de descarga.

| Repositorio | Privado | Releases | Tags | Assets | Histórico |
| --- | --- | --- | --- | --- | --- |
| BryanHernz/nova-star-versiones | sí | 27 | 27 | 227 | idéntico |
| BryanHernz/carton-lleno-versiones | sí | 32 | 32 | 182 | idéntico |

No se borraron/publicaron releases, tags ni assets. Los clones de código siguen
con su visibilidad original. No hubo deploy, nueva release, modificación de
Storage/latest, IAM, reglas, Auth, PWA ni datos de usuarios durante este cierre.

## Clasificación

Se buscaron `github.com`, `releases/latest`, `releases/download`, los nombres
de ambos repositorios de releases, `REPO_VERSIONES`, `activaciones.txt` y
`voces.json` en los tres repositorios, incluidos archivos de tooling/documentación.

| Coincidencia | Clasificación y acción |
| --- | --- |
| Nexo `releases.mjs` y snapshots de tools | Legacy fuera del build, sin imports runtime; conservar evidencia/fixtures |
| Nexo `tools/publish-release.mjs`, publicación de voces, scripts `.github` | Publicación/CI autenticada, sin carga en portal/apps |
| Nova `tool/publicar.ps1`, auxiliares `version.json` | Preparación/metadata histórica privada; `-Publicar` directo bloqueado |
| Cartón `tools/repo_versiones.txt`, scripts de empaquetado | Publicación histórica; no dart-define ni fuente runtime |
| Cartón PuertaActivacion/activacion_*.dart/`carton/equipo` | Legacy inequívocamente muerto: eliminado con tests; no datos borrados |
| `activaciones.txt` del repo histórico | Histórico conservado, sin lector runtime |
| `voces.json` histórico / tooling de voces | Fuente histórica/publicación, catálogo runtime ahora Nexo |
| Tests con URLs falsas | Fixtures/pruebas negativas, sin conexiones reales |
| README/manuales/comentarios | Documentación, sin conexiones |
| Lockfiles, registrantes, licencias de fuentes/Flutter/plugins | Metadata externa, no se elimina |

Resultado: **cero dependencia funcional de GitHub en runtime propio**.
Nova `lib/` no contiene los patrones; Cartón sólo conserva comentarios del
contexto de migración, no lectores de GitHub. El gate de Nexo usa API autenticada
y el build no incluye el módulo/snapshots de releases legacy.

Se inspeccionaron `libapp.so` de los seis APK oficiales (tres ABI por app), el
ZIP Windows aprobado de Nova y módulos Windows de build/instalación actuales.
Sin referencias a repos propios, rutas de release, activaciones ni fallback.
Strings GitHub externas de motores/dependencias siguen siendo metadata.
Ambas rutas Nexo estables están embebidas en los APK oficiales.

## Comprobación posterior en producción

Latest y versiones específicas: Nova `1.0.30+1032`, Cartón `1.0.43+45`, siete
assets explícitos por app y recommendations windows/phone/tv correctas.
Cuenta real autorizada: portal presenta ambas apps; login y persistencia tras
refresh confirmados por el usuario en su navegador. Sin token, API devuelve 401.

Se descargaron completos por firma del runtime real: Windows/phone/TV de ambas
apps, updater ZIP de Nova y `es-MX-JorgeNeural.zip` (catálogo de nueve voces).
Los ocho coinciden en tamaño, SHA256 y generación; Storage sin firma devuelve
403. Manifests/catálogo y HTML Hosting no persisten URLs firmadas ni enlaces
GitHub de assets. Las pruebas locales cubren gate, URLs efímeras y rutas QR.
Pairing comprobado sin crear basura: POST incompleto devuelve 400; rewrite
`/pair/**` responde y se conserva. No se consumió ningún pairing real.

EXE instalados: Nova `1.0.30+1032`, Cartón `1.0.43+45`. Se verificaron metadata
de archivos y contratos de selección updater/QR mediante código/tests y la API
real. Tras privatizar, el usuario confirmó «Buscar actualizaciones» en ambas
instalaciones y catálogo/QR de Cartón sin errores. No se reinstalaron apps;
las transiciones Windows/TV/teléfono estaban verificadas previamente por el usuario.

## Cambios locales y límites

Manuales: DEPLOY.md/RELEASES.md/OPERATIONS.md y RELEASE.md en ambas apps.
Wrappers desde apps validan Git/versión/hashes/ABI, analyze/tests y usan el
publicador Nexo; creación del histórico sólo después de verificación real.
GitHub privado se comprueba antes de mutaciones; no se guardan credenciales.

Cartón: ayuda 25–35 MB, espera con tipografía normal sin subrayados y disposición
segura con movimiento reducido, limpieza EXE sólo tras ejecutar versión nueva.
El instalador legacy en raíz de TEMP existe: se conserva sin borrarlo por no
tener marcador verificable. Ajustes requieren una futura versión aprobada;
no se recompilaron/reemplazaron los artefactos vigentes.

Pendientes: aprobación del permiso de reemplazo limitado al catálogo de voces,
App Check/rate limiting distribuido, integración/release de los cambios locales
y revisión manual del EXE legacy. No confundir estos pendientes con una
dependencia runtime a GitHub ni con fallos de descargas actuales.
