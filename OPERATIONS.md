# Operación y comprobaciones de Nexo

Estado auditado al cierre: Nova Star `1.0.30+1032`, Cartón Lleno `1.0.43+45`,
nueve voces; repositorios de releases privados con su historial intacto.
Las versiones vigentes se consultan en la API, no se infieren de esta nota.

## Supervisión sin modificar datos

- Portal <https://nexo-hub.web.app>: sin sesión muestra login email/password;
  refresh recupera Firebase Auth normal; `/api/v1/portal` relee acceso actual y
  sólo presenta apps autorizadas. Sin signup ni anonymous en el portal.
- Rutas de QR estables `/download/novaStar`, `/download/cartonLleno`: validan
  acceso y entregan recommendation.phone; ningún QR lleva APK/GitHub/signed URL.
- API <https://api-jfqflryoka-tl.a.run.app>: comprobar latest/version específicos,
  descargar bytes completos, validar SHA256/tamaño/generación. Sin token 401,
  sin acceso 403; Storage sin firma 403. No modificar access real para probar
  denegaciones: usar tests/mocks. `/pair/:pairingId` tiene login independiente.
- Conservar el PWA del micrófono, Anonymous provider, datos/perfiles/access de
  la cuenta real y outbox. No introducir borrados durante una verificación.

## Retención de pairing

`cleanupTvPairingsDaily`: Function `southamerica-west1`, Scheduler
`southamerica-east1`, `0 4 * * * UTC`. Usa `npm run verify:cleanup` desde
`functions` para verificar job, identidad/endpoint y próxima ejecución.
Procedimiento reproducible en [DEPLOY.md](DEPLOY.md).

Pending/approved vigentes se conservan. Expirados sin consumo se eliminan
sólo después de 24 horas desde expiresAt. Consumed necesita siete días desde
consumedAt **y** estar expirado. Antes de borrar se relee en transacción;
security se elimina junto al padre. Estados desconocidos/incompletos se omiten.
No TTL ni borrado de otras colecciones. Revisar resumen scanned, deletedExpired,
deletedConsumed, skippedActive, skippedInvalid, errors.

## Logs y fallos

Consultar logs de `api`/cleanup sin publicar payloads completos. No registrar
ID tokens, contraseñas, códigos/hashes de pairing, secretos ni URLs firmadas.
Nombre de archivo/versión/assetId/SHA256 de release son metadata permitida.
Si hay 401 renovar sesión; 403 releer acceso vía backend; 503 de integridad
detener publicación y comparar manifest/metadata/bytes, sin relajar validación.
Nunca reparar un asset inmutable con otros bytes ni desactivar privacidad.

Si una publicación falla antes de latest, los objetos huérfanos no se anuncian;
reintentar el mismo input con precondiciones. Si latest cambió concurrentemente,
detenerse y revisar. Rollback no se automatiza: requiere aprobación y el mismo
CAS; el publicador normal rechaza downgrade. No borrar el historial.

## Deuda y límites explícitos

- App Check/rate limiting distribuido continúa pendiente; maxInstances no lo
  sustituye. No añadir un limiter local por IP improvisado.
- Las URLs firmadas son credenciales reutilizables hasta vencimiento; cambiar
  access no revoca las ya emitidas. No almacenarlas ni reutilizarlas vencidas.
- Permiso de reemplazo del catálogo de voces pendiente, limitado a un objeto;
  no conceder Storage Admin ni ampliar borrado a todo el bucket.
- GitHub ya no sostiene runtime. Se conserva para publicación histórica privada,
  documentación, dependencias/licencias externas y metadata antigua archivada.
- Cosméticos y limpieza Windows de Cartón requieren **futura versión aprobada**;
  los binarios publicados `1.0.43+45` y sus hashes permanecen intactos.

Manuales estables: [RELEASES.md](RELEASES.md), [DEPLOY.md](DEPLOY.md).
Los documentos `docs/private-*` conservan evidencia histórica de la migración;
sus párrafos "pendiente" describen esa fase, no el estado de producción actual.
