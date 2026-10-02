# Nexo · portal 1.2.1

Portal de Nexo con el diseño final 1.2.1 recuperado de `rescue/nexo-portal-final` (`c8a310a724ce0100675cff250fecdbc2c84063eb`). Conserva la composición, capturas, galerías y motion originales; integra la vinculación de TV y la infraestructura vigente de `main`.

## Ejecutar

Node.js 22.23.3 validado. Las dependencias npm son únicamente para pruebas; el portal sigue siendo estático.

```powershell
npm ci
npm test
npm run check
npm run build
npm run preview
```

Vista previa: http://127.0.0.1:8080/ . El servidor solo escucha en la máquina local. `Ctrl+C` lo detiene.

## Implementado

- Portada más alta: mínimo de 1120 px o 112svh en escritorio, con las dos pantallas y los dos teléfonos originales. Las secciones de producto mantienen su composición aprobada.
- Botones planos, sin contorno ni bisel y radio de 8 px. No hay tarjetas decorativas con bordes alrededor de las secciones.
- Capturas reales del usuario dentro de los dispositivos. Las interfaces no se regeneraron con IA.
- Teléfono de Nova Star más abajo que el monitor, completamente visible. Usa `1000092031.jpg` rotado 180 grados: cabeza del micrófono hacia arriba. Solo se retiró la barra inferior del sistema antes de rotarlo.
- Galerías de biblioteca/canto/torneo/fiesta y bingo 75/90/comprobación/celebración. Se pueden ampliar, cerrar con Escape y navegar sus pestañas con teclado.
- Ejemplos originales PDF de cartones de 75 y 90 bolas, con vistas previas derivadas de esos PDF.
- Parallax por capas sobre pantallas, teléfonos y fondos, con velocidades diferentes y desplazamiento acotado. Entrada progresiva de contenido y flotación suave. En móvil se reduce la amplitud, sin desactivar todo el movimiento.
- Animaciones activas normalmente, sin controles manuales de pausa. Respeta movimiento reducido del sistema y muestra ese estado. No altera el scroll nativo ni desplaza los botones de descarga con el parallax.
- Portal autenticado con acceso por app. Descargas privadas mediante API Nexo: Windows (instalador EXE), Android y Android TV / Google TV. El micrófono de Nova Star conserva su acceso QR. No hay opciones Web, ZIP ni variantes técnicas públicas en el portal.
- Sin nombre personal visible en los textos del portal. Se cubrió el nombre de cuenta en las capturas de biblioteca y modos de juego.

## Distribución privada

[Arquitectura, contratos, publicación y decisiones antes de deploy](docs/private-release-distribution.md).

`index.html` entrega sólo el login Nexo. El contenido visual aprobado está en
`functions/portal-content.html`, servido por el backend después de verificar
Auth/access y filtrar productos. No se incluye ese contenido en `_site`.
`config.mjs` contiene únicamente identificadores de productos. Auth comparte
la configuración de pairing; la URL del backend permanece igual.

Los repositorios públicos `BryanHernz/nova-star-versiones` y
`BryanHernz/carton-lleno-versiones`, releases 1.0.27/1.0.42, aliases y updater
antiguo quedan intactos. Sus snapshots anteriores están en
`tools/legacy-releases.mjs`, fuera del build de Hosting. El portal no usa esos
snapshots ni caché de GitHub para saltarse permisos.

No hay versiones Web ni placeholders. El micrófono companion conserva su sitio
original y se abre desde el QR dentro de Nova Star. No se modificó el PWA.

## Logos

Se conserva el logo de Nova Star incluido en el rescue. `tools/importar-logo.ps1` permite importar el PNG original desde el clon hermano `NovaStar/assets/branding/nova_star_logo.png` cuando está disponible, sustituyendo únicamente ese recurso.

La marca «22» se recortó de la pantalla de inicio enviada por el usuario. No se dibujó un cartón nuevo ni se rediseñaron las cuadrículas. `assets/sources.json` documenta la procedencia y transformaciones de las capturas.

## Descargas autorizadas

Cada botón solicita una URL firmada de cinco minutos mediante el backend.
El ID token sólo viaja en Authorization; ningún token o enlace firmado se guarda
por código propio en localStorage. Ante falta de sesión/acceso/red, falla cerrado.
El bucket privado y las releases oficiales ya están provisionados/importados.
La nueva API y el portal privado aún no se desplegaron. No existe fallback público del portal.

| Plataforma | Nova Star | Cartón Lleno |
| --- | --- | --- |
| Windows | Instalador EXE | Instalador EXE |
| Android | NovaStar-telefono.apk | CartonLleno-telefono.apk |
| Android TV / Google TV | NovaStar-tele.apk | CartonLleno-tele.apk |

Para publicar artefactos ya compilados: `npm run releases:dry-run -- input.json`,
`npm run releases:verify -- input.json bucket` o, sólo tras aprobación,
`npm run releases:publish -- input.json bucket`. Ver contrato detallado arriba.

## Publicación del portal

`npm run build` genera `_site/` con una lista explícita de archivos públicos, incluyendo `experience.mjs`, `motion.mjs` y todos los archivos de pairing. Copia todos los assets y verifica automáticamente los archivos requeridos, las cuatro capturas principales y la igualdad de cada asset entre origen y build. No copia Functions, scripts de desarrollo, pruebas ni credenciales.

El workflow de `main` ejecuta exclusivamente CI (`npm ci`, pruebas, check y build), sin publicar a GitHub Pages. Firebase conserva el target `portal` asociado a `nexo-hub` y la reescritura `/pair/**` a `/pair.html`. Esta integración no realiza deploy ni merge.

## Validación

- Pruebas Node de gate, descargas privadas, publicador, compatibilidad GitHub, movimiento, recursos, branding, build y pairing; pruebas backend de Auth/access, integridad y firma.
- Sintaxis de JavaScript y generación del sitio estático.
- El rescue documenta validación visual en Chromium de 1920 a 320 px. Se conserva su CSS; el motion mantiene sus efectos y accesibilidad, sin controles manuales de pausa.
- Desplazamientos de profundidad distintos comprobados en escritorio y móvil; flotación y cambios en vivo de movimiento reducido. La antigua preferencia de pausa manual ya no desactiva las animaciones.
- Navegación de pestañas, menú móvil, ampliación de imagen y Escape.
- Respuestas de API simuladas como no disponibles: las descargas quedan cerradas sin fallback público.

Las pruebas de pairing usan dobles de Auth/API; no crean ni consumen pairings en producción. La comprobación local y el build no equivalen a un deploy público ni validan la instalación de EXE/APK.

## Vinculación web de TV en Nexo

La pantalla `/pair/:pairingId` usa la identidad NEXO y conserva los colores del portal. El identificador es el valor opaco de 48 caracteres hexadecimales que entrega el backend. La pantalla no crea pairings: solicita el código de seis dígitos de la TV y aprueba el pairing existente.

`pair-config.mjs` contiene la configuración **pública** de Firebase del proyecto existente `nova-star-bd0d9` (obtenida de su configuración pública de Hosting), el dominio Auth `nova-star-bd0d9.firebaseapp.com` y la URL de API `https://api-jfqflryoka-tl.a.run.app`. No contiene secretos. Se carga Firebase Web SDK modular 12.19.0 desde el CDN oficial, sin dependencias de producción de npm.

El único inicio de sesión ofrecido es email/password para cuentas existentes; no hay registro ni autenticación anónima. Firebase Auth restaura y mantiene la sesión mediante IndexedDB, con persistencia de sesión o memoria como respaldo. La aplicación no guarda contraseñas ni ID tokens en localStorage ni los escribe en logs. La contraseña se vacía al enviar el formulario. Para aprobar se obtiene un ID token actualizado y se envía exclusivamente en `Authorization: Bearer …`, junto con `{ "code": "123456" }`, a `POST /api/v1/tv/pairings/:pairingId/approve`. Cerrar sesión devuelve al login y descarta respuestas pendientes.

La pantalla contempla éxito, sesión inválida (401), código incorrecto o falta de acceso (403), enlace inexistente (404), ya aprobado/consumido (409), expirado (410), bloqueo por intentos (429) y errores de red. Solo distingue los errores 403 si recibe los códigos conocidos `incorrect_code` o `app_access_denied`; otros 403 muestran un mensaje neutro. El backend conserva la decisión sobre los permisos de cada app.

`npm run build` copia exclusivamente los archivos públicos a `_site/`. `firebase.json` prepara únicamente el sitio **nexo-hub**, con la reescritura `/pair/**` a `/pair.html`; no se ha ejecutado ningún deploy. La lógica de pairing y la configuración Hosting permanecen iguales y el Hosting de Nova Star no se modifica. La ruta de vinculación está destinada a `https://nexo-hub.web.app`, origen permitido por el backend; una vista previa local puede mostrar la interfaz, pero las pruebas de aprobación usan dobles de Auth/API para evitar CORS y operaciones en producción. No se deben enviar credenciales reales para estas pruebas locales.
