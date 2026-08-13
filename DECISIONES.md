# Decisiones de Alcance y Metodologia — recopilaVoz

## D-001: Identificacion de participantes por alias libre
**Fecha:** 2026-08-12
**Decision:** Los participantes se identifican solo con un alias elegido por ellos mismos (ej: Hablante_A). No se requiere registro ni contraseña.
**Justificacion:** Minimiza la friccion de acceso y protege la privacidad al no asociar grabaciones con identidad real. Consistente con el protocolo etico del equipo (Rol 9).
**Implicacion:** El alias es la unica llave de acceso a los propios audios. Si alguien conoce el alias de otro, podria verlos. Se acepta este riesgo en un entorno de laboratorio controlado.

## D-002: Remuestreo obligatorio a 16 000 Hz en el cliente
**Fecha:** 2026-08-12
**Decision:** El audio se captura con la tasa nativa del dispositivo y se remuestrea a 16 kHz en el cliente via OfflineAudioContext antes de subir.
**Justificacion:** Consistencia con el experimento H7 del proyecto controlVoz. Reduce el tamanio de archivo y garantiza uniformidad del corpus.
**Implicacion:** Funciona en iOS/Android aunque el microfono capture a 44100 Hz o 48000 Hz.

## D-003: Supabase como backend de datos y almacenamiento
**Fecha:** 2026-08-12
**Decision:** Se usa Supabase (PostgreSQL + Storage) como capa de persistencia, accedida desde el servidor Node.js con la clave service_role.
**Justificacion:** Gratuito en tier free, ofrece Storage integrado, API REST robusta y seguridad por RLS configurable. Evita necesidad de servidor de archivos propio.
**Implicacion:** El usuario debe crear un proyecto Supabase y configurar el bucket 'audios' como privado.

## D-004: Sin persistencia de audio crudo en el servidor
**Fecha:** 2026-08-12
**Decision:** El servidor Node.js actua como proxy: recibe el audio del cliente (en memoria via multer) y lo sube inmediatamente a Supabase. No se guarda en disco local.
**Justificacion:** Cumple con la regla del proyecto controlVoz: 'nunca persistir audio crudo por defecto'.

## D-005: Espectrograma STFT generado en el cliente
**Fecha:** 2026-08-12
**Decision:** El espectrograma se genera completamente en el cliente con Canvas 2D usando una implementacion STFT con ventana Hann.
**Justificacion:** Evita procesar audio en el servidor. Consistente con la arquitectura DSP del proyecto principal. Permite visualizacion en tiempo real durante la grabacion.

## D-006: Panel de admin protegido por token simple
**Fecha:** 2026-08-12
**Decision:** El acceso al panel de administrador se protege con un token fijo almacenado en .env y verificado por el servidor en cada peticion.
**Justificacion:** Suficiente para un laboratorio academico. No requiere sistema de usuarios/sesiones completo.
