# Sala Uno · diseño 1.1.0

Nombre creativo propuesto para el portal; no se ha comprobado disponibilidad de marca o dominio. El repositorio sigue llamándose juegos-bryan y no se cambia ninguna URL de las apps.

## Origen del diseño

- Nova Star: `BryanHernz/NovaStar/lib/app/theme/app_colors.dart`, blob `a9b1eb99686d8522a0bec0a78adedb0c6d8118ff`. Fondo #050A13, superficies #08111F, acento #FFB156 y texto blanco.
- Botones: `lib/app/theme/app_theme.dart`, blob `bc4ec95f28a7a83a34d89db18088ad84db6ec68a`, radio 12 y fondos sin bordes decorativos añadidos.
- Logo aprobado: `assets/branding/nova_star_logo.png`, blob `13ce5a05aa2e2eab72077585724208c0edabe5c6`. Es el logo transparente para interfaz, no el icono de instalación. Se importa sin modificar sus bytes desde el clon local con `tools/importar-logo.ps1`.
- Cartón Lleno: el conector sigue devolviendo 404 al consultar el repositorio fuente. Se retiraron TODOS los cartones, bolas y pantallas ficticias. El bloque neutro actual es composición del portal, NO identidad de la aplicación. Integración visual pendiente; el aviso permanece visible.

## Cambios

Una familia sans-serif para toda la web. Sin palabras en serif o cursiva, sin gradientes CSS, sin brillo ni blobs decorativos. Secciones amplias, descargas en filas, índice sticky con estado activo y progreso de lectura.

Parallax limitado a 44px en elementos de presentación. Nunca mueve botones, enlaces de descarga, texto informativo, foco ni altera la rueda del ratón. Se desactiva en pantallas de hasta 860px, con movimiento reducido del sistema o mediante el botón de cabecera. El contenido continúa accesible sin JavaScript.

No se han creado capturas ficticias de las aplicaciones. Las composiciones tipográficas de la portada no son pantallas de los juegos. El logo original, cuando está importado, se muestra sin filtros ni deformaciones.

## Validación y pendientes

Mantener Node >=22 y el módulo de releases existente. Los nuevos tests comprueban parallax, límites, ausencia de gradientes y eliminación de cartones inventados. La comprobación visual local usa las instantáneas ya incluidas de las releases; no debe presentarse como consulta en directo.

Antes de fusionar: importar el logo, permitir lectura de Cartón Lleno, revisar su tema, componentes y assets, e integrar su identidad original. La web de Cartón Lleno no se habilita con una URL adivinada.
