# Sala Uno

Portal de Nova Star y Cartón Lleno. Versión **1.1.0**. HTML, CSS y módulos JavaScript; Node **22 o superior** para pruebas y vista previa. No necesita `npm install` ni modifica las apps Flutter.

## Rama de revisión

Nombre creativo propuesto: Sala Uno. El repositorio y la URL de GitHub Pages siguen siendo `juegos-bryan`. No se ha comprobado disponibilidad de marca o dominio.

Diseño con una sola familia sans-serif, fondos sólidos, índice fijo, parallax limitado y controles de descarga inmóviles. Se desactiva el movimiento en móvil, con la preferencia del sistema o con el botón de cabecera.

La paleta de Nova Star proviene de su tema Dart. Cartón Lleno usa temporalmente un bloque neutral: el conector aún no permite leer su repositorio fuente. Se retiraron los cartones y bolas inventados; no se presentan composiciones del portal como capturas reales.

## Vista previa local

Desde el repositorio:

```powershell
.\tools\importar-logo.ps1
npm test
npm run preview
```

El importador copia, sin modificar sus bytes, `..\NovaStar\assets\branding\nova_star_logo.png` a `assets/nova-star-logo.png`. No copia código privado ni credenciales. Para otra ubicación, usar `-NovaStarPath`. El logo queda como archivo local nuevo hasta incorporarlo al commit; sin él aparece solo el nombre de la aplicación.

La consola indica la dirección de la vista previa. Se sirve únicamente en localhost. Referencias visuales y pendientes en `DESIGN.md`.

## Descargas

Se mantiene el módulo de releases: consultas independientes a `BryanHernz/novastar-versiones` y `BryanHernz/carton-lleno-versiones`, validación de URL, selección por plataforma, caché e instantáneas marcadas como información guardada. Los instaladores no se almacenan en este repo.

La instantánea de Nova Star corresponde a v1.0.24 y no incluye el nuevo EXE local; aparecerá cuando esté publicado y se consulte GitHub. Cartón Lleno conserva v1.0.36 como respaldo.

Nova Star web es micrófono y catálogo, no karaoke completo en navegador. No se ha confirmado la URL web de Cartón Lleno; su enlace permanece deshabilitado.

## Publicación

`npm test` también se ejecuta en pull requests. Solo `main` se despliega en Pages; esta rama de revisión no publica por sí sola.

Cuando el diseño esté aprobado, el logo incorporado y los cambios fusionados a main, se usa `tools/publicar.ps1` para la configuración inicial de Pages. Los pushes posteriores a main activan el workflow existente.

No fusionar esta revisión como integración visual final de Cartón Lleno hasta revisar sus fuentes, colores, cartones y recursos originales.
