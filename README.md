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
- Versiones y archivos desde los repositorios oficiales de publicaciones. Opciones principales: Web, Windows (instalador EXE), Android y Android TV / Google TV; Nova Star incluye además Micrófono / Companion. Los ZIP, aliases duplicados y variantes técnicas no aparecen en la interfaz de descargas.
- Sin nombre personal visible en los textos del portal. Se cubrió el nombre de cuenta en las capturas de biblioteca y modos de juego.

## Configuración que se conserva

`config.mjs` usa `BryanHernz/nova-star-versiones` y `BryanHernz/carton-lleno-versiones`. También se conservan Firebase Auth, la URL del backend, Functions y la configuración multisite de Nexo.

Las URLs Web de ambos juegos están vacías hasta confirmar direcciones oficiales; sus opciones muestran «Web · Próximamente», sin enlace. `companion` es una configuración independiente de Nova Star que conserva `https://nova-star-bd0d9.web.app/` como Micrófono / Companion. Ese origen se rechaza como destino Web, también en la herramienta de configuración.

```powershell
node .\tools\configurar-web.mjs carton-lleno https://DIRECCION-REAL/
```

Sustituir esa dirección por la publicación real, no por la URL del repositorio fuente.

## Logos

Se conserva el logo de Nova Star incluido en el rescue. `tools/importar-logo.ps1` permite importar el PNG original desde el clon hermano `NovaStar/assets/branding/nova_star_logo.png` cuando está disponible, sustituyendo únicamente ese recurso.

La marca «22» se recortó de la pantalla de inicio enviada por el usuario. No se dibujó un cartón nuevo ni se rediseñaron las cuadrículas. `assets/sources.json` documenta la procedencia y transformaciones de las capturas.

## Publicaciones y caché

El navegador consulta cada `/releases/latest` de manera independiente. Los enlaces se validan contra el repositorio esperado. No se incluye token de GitHub en el cliente. Las notas se insertan como texto, nunca como HTML.

Si falla la consulta, se informa que se usan datos guardados. Se conserva la caché validada por hasta siete días, siempre que su versión no sea inferior al snapshot; en su defecto se usa la instantánea incluida. Los fallbacks se comprobaron contra las releases públicas oficiales el 2026-10-01: Nova Star v1.0.27 y Cartón Lleno v1.0.42. Mantienen la estructura de snapshots, las notas oficiales y los nombres/tamaños reales de los assets.

| Plataforma | Nova Star 1.0.27 | Cartón Lleno 1.0.42 |
| --- | --- | --- |
| Web | Próximamente, sin URL | Próximamente, sin URL |
| Windows | `NovaStar-1.0.27-windows-installer.exe` | `CartonLleno-windows-instalador.exe` |
| Android | `NovaStar-telefono.apk` | `CartonLleno-telefono.apk` |
| Android TV / Google TV | `NovaStar-tele.apk` | `CartonLleno-tele.apk` |
| Companion | `https://nova-star-bd0d9.web.app/` | No aplica |

`selectDownloads()` prioriza los aliases oficiales de teléfono/TV frente a los APK versionados. Si falta un alias, conserva el fallback existente por arquitectura ARM64/ARMv7. Windows sólo admite un instalador EXE; no sustituye un instalador ausente por ZIP o MSI. Los enlaces apuntan al tag de la release consultada. Los ZIP y otros archivos continúan en GitHub sin cambios: no se modifica ninguna release ni el updater. Nova Star 1.0.27 incluye un ZIP; Cartón Lleno 1.0.42 no lo publica.

## Publicación del portal

`npm run build` genera `_site/` con una lista explícita de archivos públicos, incluyendo `experience.mjs`, `motion.mjs` y todos los archivos de pairing. Copia todos los assets y verifica automáticamente los archivos requeridos, las cuatro capturas principales y la igualdad de cada asset entre origen y build. No copia Functions, scripts de desarrollo, pruebas ni credenciales.

El workflow de `main` ejecuta exclusivamente CI (`npm ci`, pruebas, check y build), sin publicar a GitHub Pages. Firebase conserva el target `portal` asociado a `nexo-hub` y la reescritura `/pair/**` a `/pair.html`. Esta integración no realiza deploy ni merge.

## Validación

- Pruebas Node de descargas, URLs, caché, movimiento, privacidad, recursos, estructura, branding, build y pairing.
- Sintaxis de JavaScript y generación del sitio estático.
- El rescue documenta validación visual en Chromium de 1920 a 320 px. Se conserva su CSS; el motion mantiene sus efectos y accesibilidad, sin controles manuales de pausa.
- Desplazamientos de profundidad distintos comprobados en escritorio y móvil; flotación y cambios en vivo de movimiento reducido. La antigua preferencia de pausa manual ya no desactiva las animaciones.
- Navegación de pestañas, menú móvil, ampliación de imagen y Escape.
- Respuestas de API simuladas como no disponibles: se conserva el respaldo existente de las publicaciones.

Las pruebas de pairing usan dobles de Auth/API; no crean ni consumen pairings en producción. La comprobación local y el build no equivalen a un deploy público ni validan la instalación de EXE/APK.

## Vinculación web de TV en Nexo

La pantalla `/pair/:pairingId` usa la identidad NEXO y conserva los colores del portal. El identificador es el valor opaco de 48 caracteres hexadecimales que entrega el backend. La pantalla no crea pairings: solicita el código de seis dígitos de la TV y aprueba el pairing existente.

`pair-config.mjs` contiene la configuración **pública** de Firebase del proyecto existente `nova-star-bd0d9` (obtenida de su configuración pública de Hosting), el dominio Auth `nova-star-bd0d9.firebaseapp.com` y la URL de API `https://api-jfqflryoka-tl.a.run.app`. No contiene secretos. Se carga Firebase Web SDK modular 12.19.0 desde el CDN oficial, sin dependencias de producción de npm.

El único inicio de sesión ofrecido es email/password para cuentas existentes; no hay registro ni autenticación anónima. Firebase Auth restaura y mantiene la sesión mediante IndexedDB, con persistencia de sesión o memoria como respaldo. La aplicación no guarda contraseñas ni ID tokens en localStorage ni los escribe en logs. La contraseña se vacía al enviar el formulario. Para aprobar se obtiene un ID token actualizado y se envía exclusivamente en `Authorization: Bearer …`, junto con `{ "code": "123456" }`, a `POST /api/v1/tv/pairings/:pairingId/approve`. Cerrar sesión devuelve al login y descarta respuestas pendientes.

La pantalla contempla éxito, sesión inválida (401), código incorrecto o falta de acceso (403), enlace inexistente (404), ya aprobado/consumido (409), expirado (410), bloqueo por intentos (429) y errores de red. Solo distingue los errores 403 si recibe los códigos conocidos `incorrect_code` o `app_access_denied`; otros 403 muestran un mensaje neutro. El backend conserva la decisión sobre los permisos de cada app.

`npm run build` copia exclusivamente los archivos públicos a `_site/`. `firebase.json` prepara únicamente el sitio **nexo-hub**, con la reescritura `/pair/**` a `/pair.html`; no se ha ejecutado ningún deploy. La configuración de Functions permanece igual y el Hosting de Nova Star no se modifica. La ruta de vinculación está destinada a `https://nexo-hub.web.app`, origen permitido por el backend; una vista previa local puede mostrar la interfaz, pero las pruebas de aprobación usan dobles de Auth/API para evitar CORS y operaciones en producción. No se deben enviar credenciales reales para estas pruebas locales.
