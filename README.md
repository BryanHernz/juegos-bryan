# Juegos Bryan

Portal estático para Nova Star y Cartón Lleno. Versión del portal: **1.0.0**.
HTML, CSS y JavaScript sin dependencias de producción. No se modifican ni combinan los proyectos Flutter.

## Qué está implementado

- Portada responsive con dos áreas visuales: azul nocturno para karaoke y tonos cálidos para bingo.
- Descargas de Windows instalable, Windows portátil, Android ARM64, Android TV ARMv7 y otras variantes realmente publicadas.
- Consulta independiente de la última release estable de cada repositorio al abrir la página; botón para volver a consultar.
- Validación de dominios, repositorios y archivos; no inserta HTML procedente de GitHub.
- Caché local de hasta siete días e instantáneas iniciales como respaldo. Siempre se informa cuando se usa información guardada.
- Notas de la publicación, historial, tamaños y ayuda de instalación.
- Acceso web de Nova Star configurado con la dirección documentada en su proyecto.
- GitHub Actions para probar y publicar en GitHub Pages.

## Estado inicial verificado

Consulta de releases: 28-09-2026.

| Aplicación | Release | Estado |
|---|---|---|
| Nova Star | v1.0.24 | APK y ZIP publicados; el nuevo instalador EXE no figuraba en la release al crear el portal. |
| Cartón Lleno | v1.0.36 | Instalador, ZIP y APK publicados. |

Las instantáneas no se anuncian como datos en directo. Si GitHub responde, la página sustituye el respaldo por la respuesta recibida, incluyendo archivos añadidos a una release existente.

## Lo que NO se ha publicado ni inventado

- Este repositorio es un portal; no contiene builds Flutter web ni instaladores.
- La PWA actual de Nova Star es micrófono y catálogo, **no karaoke completo en el navegador**. Dirección tomada de `NovaStar/REVISION_IPHONE_PWA.md`; su disponibilidad en vivo debe comprobarse al abrirla.
- La URL web de Cartón Lleno no estaba disponible para revisión. Su botón permanece deshabilitado hasta configurarla.
- Las ilustraciones CSS son decorativas, no capturas de las aplicaciones. La identidad de Cartón es una propuesta provisional: no se tuvo acceso de lectura a su repositorio fuente y no se copiaron sus logos ni capturas.
- No se ha cambiado ninguna dirección de Firebase Hosting ni se ha publicado código privado.

## Primera publicación

El repositorio remoto ya contiene el portal. Desde la carpeta local inicialmente vacía:

```powershell
git pull --ff-only origin main
git branch --set-upstream-to=origin/main main
.\tools\publicar.ps1
```

`publicar.ps1` utiliza tu autenticación local de `gh`: crea Pages si falta, selecciona el modo workflow e inicia `pages.yml`. No almacena tokens. Para esta configuración inicial necesitas permisos de administración de Pages. El script informa que el despliegue fue solicitado, no que ya terminó.

Revisa el resultado en `https://github.com/BryanHernz/juegos-bryan/actions/workflows/pages.yml`.
La dirección prevista tras un despliegue exitoso es `https://bryanhernz.github.io/juegos-bryan/`.
Los pushes posteriores a `main` vuelven a publicar el portal.

## Vista previa y pruebas

Node.js 22 o superior. Las dependencias son únicamente para las pruebas.

```powershell
npm ci
npm test
npm run check
npm run build
npm run preview
```

Abre `http://127.0.0.1:8080/`. El servidor escucha únicamente en el equipo local. No abras index.html mediante file://, porque utiliza módulos JavaScript.

## Vinculación web de TV en Nexo

La pantalla `/pair/:pairingId` usa la identidad NEXO y conserva los colores del portal. El identificador es el valor opaco de 48 caracteres hexadecimales que entrega el backend. La pantalla no crea pairings: solicita el código de seis dígitos de la TV y aprueba el pairing existente.

`pair-config.mjs` contiene la configuración **pública** de Firebase del proyecto existente `nova-star-bd0d9` (obtenida de su configuración pública de Hosting), el dominio Auth `nova-star-bd0d9.firebaseapp.com` y la URL de API `https://api-jfqflryoka-tl.a.run.app`. No contiene secretos. Se carga Firebase Web SDK modular 12.19.0 desde el CDN oficial, sin dependencias de producción de npm.

El único inicio de sesión ofrecido es email/password para cuentas existentes; no hay registro ni autenticación anónima. Firebase Auth restaura y mantiene la sesión mediante IndexedDB, con persistencia de sesión o memoria como respaldo. La aplicación no guarda contraseñas ni ID tokens en localStorage ni los escribe en logs. La contraseña se vacía al enviar el formulario. Para aprobar se obtiene un ID token actualizado y se envía exclusivamente en `Authorization: Bearer …`, junto con `{ "code": "123456" }`, a `POST /api/v1/tv/pairings/:pairingId/approve`. Cerrar sesión devuelve al login y descarta respuestas pendientes.

La pantalla contempla éxito, sesión inválida (401), código incorrecto o falta de acceso (403), enlace inexistente (404), ya aprobado/consumido (409), expirado (410), bloqueo por intentos (429) y errores de red. Solo distingue los errores 403 si recibe los códigos conocidos `incorrect_code` o `app_access_denied`; otros 403 muestran un mensaje neutro. El backend conserva la decisión sobre los permisos de cada app.

`npm run build` copia exclusivamente los archivos públicos a `_site/`. `firebase.json` prepara únicamente el sitio **nexo-hub**, con la reescritura `/pair/**` a `/pair.html`; no se ha ejecutado ningún deploy. La configuración de Functions permanece igual y el Hosting de Nova Star no se modifica. La ruta de vinculación está destinada a `https://nexo-hub.web.app`, origen permitido por el backend; una vista previa local puede mostrar la interfaz, pero las pruebas de aprobación usan dobles de Auth/API para evitar CORS y operaciones en producción. No se deben enviar credenciales reales para estas pruebas locales.

## Subir el instalador ya probado de Nova Star

Desde el portal y sin reemplazar archivos existentes:

```powershell
gh release upload v1.0.24 "..\NovaStar\dist\NovaStar-1.0.24-windows-installer.exe" --repo BryanHernz/novastar-versiones
```

No uses `--clobber` ni reemplaces el ZIP publicado: puede estar referenciado por su hash en `version.json`. El portal detectará el EXE en la siguiente consulta, sin cambiar su código. Si el archivo ya existe, GitHub CLI lo indica y no lo sobrescribe.

## Configurar la web de Cartón Lleno

Cuando exista una URL HTTPS real de su despliegue:

```powershell
node tools/configurar-web.mjs carton-lleno https://TU-SITIO/
git add config.mjs
git commit -m "feat: configurar acceso web de Carton Lleno"
git push origin main
```

El comando solo modifica `config.mjs`. No sube un build Flutter, no despliega Firebase ni garantiza que esa aplicación sea compatible con navegador. Para publicar cada aplicación se debe usar el proceso de su propio proyecto.

## Seguridad y mantenimiento

`config.mjs` es público: no guardes credenciales ni repositorios privados allí. Los enlaces de descarga solo se aceptan desde los repositorios públicos configurados. No se autoejecutan instaladores ni se solicita desactivar protecciones de Windows.

Las consultas se hacen desde el navegador y están sujetas a la disponibilidad y límites de GitHub. El portal usa enlaces directos como respaldo e informa de las limitaciones; no promete actualización instantánea cuando no hay conexión.

## Fuentes revisadas

- https://github.com/BryanHernz/NovaStar/blob/main/PROPUESTA_PORTAL.md
- https://github.com/BryanHernz/NovaStar/blob/main/REVISION_IPHONE_PWA.md
- https://github.com/BryanHernz/novastar-versiones/releases/tag/v1.0.24
- https://github.com/BryanHernz/carton-lleno-versiones/releases/tag/v1.0.36
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/rest/pages/pages
