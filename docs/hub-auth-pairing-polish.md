# Revisión visual del Hub y pairing

Base: `f214e15a832b672e7aaf3f6ee07de8b2b8f3e43d`.
Rama de implementación: `feature/nexo-hub-auth-pairing-polish`.

## Presentación

- Login dividido: capturas reales a la izquierda, cuenta Nexo a la derecha;
  formulario primero en móvil. No se publica catálogo, metadata de releases,
  enlaces de descarga ni permisos en el HTML inicial: sólo arte promocional.
- Navbar sin “Explorar aplicaciones”; logout secundario, navegación conservada.
- Windows/Android en dos columnas y TV centrado debajo con el mismo ancho.
  A 420 px o menos se apilan los tres. Destinos y firma no cambian.
- Pairing independiente con identidad completa de cada app: Cartón usa crema,
  Nunito/Fredoka, contornos negros, amarillo y sombras duras; Nova usa su fondo
  real, panel translúcido, campos sin borde y botones ámbar. Los estilos se
  tomaron de los temas/login reales de las apps, sin modificarlas.
  Nexo queda como cuenta común secundaria. App desconocida o metadata no
  disponible mantiene tema neutro; nunca se infiere la app de la URL.
- Estados de carga, login, código, vinculación, éxito, aprobado, consumido,
  expirado y error. `prefers-reduced-motion` desactiva el nuevo movimiento.

## Extensión de metadata autorizada durante la revisión

El GET antiguo es un polling privado de TV que puede consumir y devolver un
custom token. Nunca debe utilizarse para tematizar el portal.

Se añadió exclusivamente `GET /api/v1/tv/pairings/:pairingId/metadata`:

```json
{"app":"novaStar","status":"pending","expiresAt":"2026-10-02T20:05:00.000Z"}
```

Estados: `pending`, `approved`, `consumed`, `expired`. Consumed prevalece sobre
el vencimiento. La lectura usa el documento real, con id aleatorio de 192 bits,
sin login; permite reconocer la app antes del formulario. Rechaza query params,
id inválido y orígenes ajenos; documentos inexistentes retornan 404.
Respuesta `no-store`, allowlist de tres campos. Nunca devuelve UID, código,
hash, token o información de acceso. No escribe ni firma, no lee `security`
ni `access`, no concede acceso. Aprobar sigue exigiendo ID token y código;
consumir sigue exigiendo el poll token original. Rules/Auth/IAM no cambian.

La vista espera metadata antes de permitir aprobar; fallos quedan cerrados y
permiten recargar. Se requiere desplegar **api antes del frontend** cuando
se publique esta revisión. La publicación aprobada usa exclusivamente
`functions:nexo:api` y, después, `hosting:portal`, en `nova-star-bd0d9`.
No incluye cleanup, Scheduler, Rules, Auth config ni otros sitios Hosting.

## Revisión local reproducible

Con Node 22: `node tools/preview-polish.mjs` (puerto 8088).
Rutas visuales `/__review/login`, `/__review/portal`, `/__review/pair-nova`,
`/__review/pair-carton`, `/__review/pair-neutral`. Pairing acepta `?phase=`
**sólo en este servidor de fixtures** para revisar estados. No se usan estos
parámetros en `/pair/:pairingId` ni para determinar su app.
El preview no inicializa Firebase, no llama a producción y no descarga.
Está excluido del build/Hosting y no permite login real.

Validaciones: raíz test/check/build; Functions test/build/lint. Revisión con
Chrome a 1920/1366/1024/768/390/320 px, teclado, overflow, assets y layout 2+1.

Resultado local: 139 tests del portal y 151 de Functions aprobados;
check/build del portal y build/lint de Functions correctos. Las 24 combinaciones
de login, pairing Nova, pairing Cartón y portal en seis anchos pasaron sin
overflow horizontal ni imágenes fallidas. Los previews/capturas usan fixtures.

## Archivos de esta revisión (18)

UI: `index.html`, `styles.css`, `app.js`, `portal-gate.mjs`, `pair.html`, `pair.css`,
`pair.mjs`, `pairing.mjs`.

Metadata autorizada: `functions/src/http.ts`, `functions/src/tv/pairing.ts`,
`functions/tests/pairing.test.ts`.

Pruebas: `tests/hub-polish.test.mjs`, `tests/portal-fixture.mjs`,
`tests/private-portal.test.mjs`, `tests/portal-integration.test.mjs`,
`tests/visual-polish.test.mjs`.

Revisión: `tools/preview-polish.mjs`, `docs/hub-auth-pairing-polish.md`.

La revisión visual y sus microajustes fueron aprobados para integración y
publicación. El servidor de fixtures es únicamente una herramienta local:
el login de producción conserva Firebase Auth y el gate del backend.

Microajustes tras revisión: el icono Cartón del login recorta sólo el fondo
blanco exterior mediante CSS, sin cambiar el asset. Las dos capturas del login
reutilizan el motor de parallax del portal, con velocidades opuestas y límite
de 16 px; al montar el portal se recrea su controlador para incluir sus escenas.
Se conservan suspensión automática y reduced motion, además de los bordes de
los inputs aprobados. El preview aclara que no autentica y ofrece “Ver el portal”.

Corrección posterior: los inputs del login general Nexo permanecen iguales;
los de `/pair` usan la apariencia nativa de la app. Los recursos nuevos en
`assets/pairing` son copias del fondo Nova y las fuentes de Cartón, con sus
licencias OFL. No se usan fuentes remotas. La metadata de `api` se publica
antes de `hosting:portal`; los temas de app se limitan exclusivamente a `/pair`.
El login general Nexo y los contratos de descargas se conservan.
