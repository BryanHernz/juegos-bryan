# Sala Uno · portal 1.2.0

Implementación HTML, CSS y JavaScript del portal de Nova Star y Cartón Lleno. No es una imagen de la página ni un proyecto Flutter nuevo. Conserva los módulos de publicaciones y movimiento del portal 1.1.0.

## Ejecutar

Node.js 22 o superior. No hay dependencias de npm que instalar.

```powershell
npm test
npm run check
npm run build
npm run preview
```

Vista previa: http://127.0.0.1:4173/ . El servidor solo escucha en la máquina local. `Ctrl+C` lo detiene.

## Implementado

- Portada alta y secciones de producto de al menos 1060 px en escritorio; adaptación propia para móvil.
- Botones planos, sin contorno ni bisel y radio de 8 px. No hay tarjetas decorativas con bordes alrededor de las secciones.
- Capturas reales del usuario dentro de los dispositivos. Las interfaces no se regeneraron con IA.
- Teléfono de Nova Star más abajo que el monitor, completamente visible. Usa `1000092031.jpg` rotado 180 grados: cabeza del micrófono hacia arriba. Solo se retiró la barra inferior del sistema antes de rotarlo.
- Galerías de biblioteca/canto/torneo/fiesta y bingo 75/90/comprobación/celebración. Se pueden ampliar, cerrar con Escape y navegar sus pestañas con teclado.
- Ejemplos originales PDF de cartones de 75 y 90 bolas, con vistas previas derivadas de esos PDF.
- Navegación móvil, enlaces a secciones, progreso de lectura, parallax limitado a los fondos y control de movimiento. Se desactiva con movimiento reducido y en pantallas pequeñas.
- Versiones y archivos desde los dos repositorios de publicaciones existentes. Windows instalador y portátil, Android teléfono/TV y otras variantes realmente publicadas.
- Sin nombre personal visible en los textos del portal. Se cubrió el nombre de cuenta en las capturas de biblioteca y modos de juego.

## Configuración que se conserva

`config.mjs` guarda los repositorios de publicaciones, direcciones web y datos de respaldo. El aplicador NO sobrescribe ese archivo si ya existe en el clon.

La PWA de Nova Star enlazada es el micrófono y catálogo: no se anuncia como una partida completa en navegador. La URL web de Cartón Lleno está vacía hasta confirmar una dirección real. El botón lo comunica y no inventa un destino.

```powershell
node .\tools\configurar-web.mjs carton-lleno https://DIRECCION-REAL/
```

Sustituir esa dirección por la publicación real, no por la URL del repositorio fuente.

## Logos

La entrega incluye un recorte del logo visible en la captura original de Nova Star para poder abrir el portal sin conectarse a una cuenta privada. `Aplicar-SalaUno.ps1` importa automáticamente el PNG original desde el clon hermano `NovaStar/assets/branding/nova_star_logo.png` cuando está disponible, sustituyendo únicamente ese recurso. También se puede ejecutar `tools/importar-logo.ps1`.

La marca «22» se recortó de la pantalla de inicio enviada por el usuario. No se dibujó un cartón nuevo ni se rediseñaron las cuadrículas. `assets/sources.json` documenta la procedencia y transformaciones de las capturas.

## Publicaciones y caché

El navegador consulta cada `/releases/latest` de manera independiente. Los enlaces se validan contra el repositorio esperado. No se incluye token de GitHub en el cliente. Las notas se insertan como texto, nunca como HTML.

Si falla la consulta, se informa que se usan datos guardados. Se conserva la caché validada por hasta siete días y, en su defecto, la instantánea incluida. El respaldo inicial conoce Nova Star v1.0.24 y Cartón Lleno v1.0.36: NO significa que se haya comprobado hoy su disponibilidad. El instalador nuevo de Nova Star aparecerá cuando la API lo devuelva como archivo subido.

## Publicación del portal

`npm run build` genera `_site/` con una lista explícita de archivos públicos. No copia scripts de desarrollo, pruebas ni credenciales. El workflow conserva las versiones de acciones del proyecto y solo despliega desde `main`. Un pull request ejecuta pruebas y prepara el sitio, pero no despliega.

La entrega no habilita Pages, no hace merge a `main` ni sube instaladores. El aplicador prepara un commit local en una rama nueva. Tras revisar, puedes subir esa rama y abrir un PR.

## Validación de esta entrega

- Pruebas Node: 27 casos (descargas, URLs, caché, movimiento, privacidad de textos, procedencia de recursos y estructura).
- Sintaxis de JavaScript y generación del sitio estático.
- Renderizado y comportamiento en Chromium: 1440, 1024, 768, 390 y 320 px, sin desbordamiento horizontal, teléfonos dentro de su sección y galerías sin taparlos.
- Navegación de pestañas, menú móvil, ampliación de imagen y Escape.
- Movimiento reducido y aparición del instalador tras una respuesta simulada de la API.

Las pruebas visuales se realizaron con recursos embebidos en memoria y respuestas de API simuladas debido a las restricciones de navegación del entorno. NO prueban el despliegue público, el acceso real a Firebase/GitHub desde el navegador ni la instalación de EXE/APK. El script PowerShell se entrega para Windows; no se ejecutó aquí.
