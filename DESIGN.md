# Nexo · implementación 1.2.1

La marca visible es Nexo; no incluye un nombre personal. Se mantiene el nombre del repositorio y los orígenes de los instaladores para no romper enlaces.

La integración conserva exactamente `styles.css`, galerías y assets del rescue 1.2.1. El HTML adapta el nombre visible y los metadatos a Nexo y elimina los controles manuales de animación. El motion conserva efectos, timings y accesibilidad. La pantalla de vinculación mantiene sus estilos de `main` en `pair-base.css` para evitar cambios por las variables y reglas del portal recuperado.

## Fuente visual

Capturas originales de Nova Star y Cartón Lleno enviadas en esta conversación, incluyendo las vistas de teléfono y los PDF 75.pdf y 90.pdf. Los recursos son copias optimizadas WebP y recortes de esas capturas/PDF, no pantallas reconstruidas mediante un generador de imágenes.

El micrófono es la captura 1000092031.jpg girada 180 grados; no se sustituyó el diseño del micrófono. No se usa la captura que tiene encima la barra flotante de la herramienta de captura del teléfono.

## Composición

Portada más alta, con las dos pantallas y dos teléfonos originales. Dos secciones de producto altas. El monitor de Nova Star queda arriba y el teléfono se superpone más abajo, sin salirse de la sección. Cartón Lleno mantiene fondo cálido, amarillo y negro, y usa las cuadrículas originales en las capturas. Los contornos internos de la app se preservan: el portal no añade contornos decorativos a botones, tarjetas o secciones.

Los marcos de dispositivo solo representan el hardware. Las pantallas no se recortan para fingir contenido que no existe. Cada captura grande puede ampliarse.

## Tipografía y botones

Una familia de sistema sans-serif, sin cambio de fuente en la última palabra de un título. No se redistribuyen archivos de fuentes. Botones planos y rectangulares con radio 8 px; sin gradientes CSS, bordes o efecto abultado.

## Movimiento

Capas con velocidades distintas sobre las pantallas y los teléfonos, sin reemplazar sus transformaciones de perspectiva. Flotación suave en un contenedor interior, entradas al llegar a cada sección y luces ambientales discretas. El scroll sigue siendo nativo; los controles de descarga no son capas parallax.

La amplitud se reduce en móvil. Las animaciones permanecen activas normalmente, sin controles manuales de pausa. Movimiento reducido del sistema detiene las animaciones sin ocultar contenido y muestra un aviso accesible; el trabajo de animación se pausa fuera de la escena visible y al ocultar la pestaña.

## Diferencia frente a las imágenes conceptuales

La implementación usa contenido verdadero y textos verificables. No reproduce los textos deformados, números inventados, cifras de canciones no verificadas ni enlaces de Términos/Contacto/redes sin destino de los bocetos generados. Web permanece pendiente de URL oficial para ambos juegos. Micrófono / Companion es una opción independiente de Nova Star; no representa Nova Star Web. Descargas mantiene los estilos existentes y sólo muestra Web, Windows, Android y Android TV / Google TV, con el companion opcional de Nova Star.
