# Planificación — RecopilaVoz: Plataforma Web de Recopilación de Audio Espectral

## 1. Visión General del Proyecto

**Nombre del sistema:** `recopilaVoz`
**Tipo:** Aplicación web full-stack
**Objetivo principal:** Recopilar grabaciones de voz de múltiples participantes para el experimento de separabilidad espectral (H7), mostrando su espectrograma en tiempo real, con panel de administrador para gestión y escucha de todos los audios.

---

## 2. Roles del Equipo Virtual Activos

| Rol | Contribución a esta app |
|---|---|
| **Rol 1 — Líder científico** | Definición del flujo experimental y comandos a grabar |
| **Rol 2 — Especialista DSP** | Remuestreo a 16 kHz via OfflineAudioContext, espectrograma STFT, descriptores |
| **Rol 4 — Audio y Hardware** | Compatibilidad de grabación en dispositivos móviles y de escritorio |
| **Rol 6 — HCI** | Diseño UX de la interfaz de participante y panel de admin |
| **Rol 7 — Ingeniero de software** | Arquitectura, API REST, Supabase, seguridad |
| **Rol 9 — Ética y datos** | Consentimiento, anonimización, política de almacenamiento |

---

## 3. Requerimientos Funcionales

### 3.1 Vista de Participante
- [x] Ingreso con alias libre (ej: Hablante_A) sin contraseña
- [x] Lista de comandos configurada por el admin (ej: Adelante, Atras, ...)
- [x] Grabacion de audio via Web Audio API a 16 000 Hz
- [x] Visualizacion del espectrograma STFT en tiempo real durante la grabacion
- [x] Reproductor de sus propios audios grabados
- [x] Indicador de progreso (cuantos comandos ya grabo / total)
- [x] Solo puede ver y escuchar SUS propias grabaciones

### 3.2 Panel de Administrador
- [x] Acceso protegido por clave (token fijo en .env)
- [x] Lista de todos los participantes y sus grabaciones
- [x] Reproduccion de cualquier audio con espectrograma
- [x] Descarga de audios individuales o en lote (ZIP)
- [x] Gestion de comandos: agregar, editar, eliminar
- [x] Estadisticas: total de participantes, total de grabaciones, comandos faltantes
- [x] Exportacion de metadatos en JSON/CSV

### 3.3 Caracteristicas Tecnicas
- [x] Remuestreo obligatorio a 16 000 Hz antes de enviar al servidor
- [x] Compatibilidad movil (grabacion a 16 kHz via OfflineAudioContext)
- [x] Almacenamiento en Supabase Storage (audio) + Supabase DB (metadatos)
- [x] Sin almacenamiento de nombre real: solo el alias que el usuario eligio
- [x] Espectrograma generado en el cliente con Canvas 2D (STFT + ventana Hann)

---

## 4. Requerimientos No Funcionales

| Categoria | Requisito |
|---|---|
| Seguridad | Admin solo por token; participante aislado por alias/sessionStorage |
| Privacidad | Sin registro de nombre real; alias elegido por el usuario |
| Compatibilidad | Chrome/Firefox/Safari en escritorio y movil |
| Rendimiento | Espectrograma no bloquea el hilo principal |
| Idioma | Todo en español |

---

## 5. Arquitectura del Sistema

```
+----------------------------------------------------------+
|                       CLIENTE                            |
|  +-------------------+    +---------------------------+  |
|  | Vista Participante|    |   Panel Administrador     |  |
|  | - Alias libre     |    |  - Token de acceso        |  |
|  | - Grabacion 16kHz |    |  - Lista completa         |  |
|  | - Espectrograma   |    |  - Descarga / Exportacion |  |
|  | - Mis audios      |    |  - Gestion de comandos    |  |
|  +--------+----------+    +-----------+---------------+  |
|           |                           |                  |
|           +---------- API REST -------+                  |
+-------------------------------+---------------------------+
                                |
+-------------------------------v---------------------------+
|                  BACKEND -- Node.js / Express            |
|  - POST /api/grabar        -> sube audio a Supabase      |
|  - GET  /api/mis-audios    -> filtra por alias           |
|  - GET  /api/admin/audios  -> todos (requiere token)     |
|  - GET  /api/admin/stats   -> estadisticas               |
|  - CRUD /api/admin/comandos-> gestion de comandos        |
+-------------------------------+---------------------------+
                                |
+-------------------------------v---------------------------+
|                   SUPABASE                               |
|  - Storage: bucket "audios" (archivos .wav)              |
|  - DB tabla "grabaciones" (alias, comando, url, ts)      |
|  - DB tabla "comandos"    (id, nombre, activo)           |
+----------------------------------------------------------+
```

---

## 6. Modelo de Datos

### Tabla `grabaciones`
| Campo | Tipo | Descripcion |
|---|---|---|
| id | UUID | Clave primaria |
| alias | TEXT | Alias elegido por el participante |
| comando | TEXT | Nombre del comando grabado |
| url_audio | TEXT | URL publica del archivo en Supabase Storage |
| tasa_hz | INT | Siempre 16000 |
| duracion_s | FLOAT | Duracion en segundos |
| created_at | TIMESTAMPTZ | Fecha de grabacion |

### Tabla `comandos`
| Campo | Tipo | Descripcion |
|---|---|---|
| id | UUID | Clave primaria |
| nombre | TEXT | Ej: "Adelante" |
| descripcion | TEXT | Instruccion para el participante |
| activo | BOOL | Si aparece en la lista actual |
| orden | INT | Orden de aparicion |

---

## 7. Stack Tecnologico

| Capa | Tecnologia | Justificacion |
|---|---|---|
| Frontend | HTML + CSS vanilla + JS | Sin frameworks; consistente con el proyecto principal |
| Backend | Node.js + Express | Ligero, sin compilacion; facil de correr localmente |
| Base de datos | Supabase (PostgreSQL) | Gratuito, con Storage integrado, acceso por REST |
| Almacenamiento | Supabase Storage | Bucket para archivos .wav |
| Audio | Web Audio API + OfflineAudioContext | Remuestreo a 16 kHz, compatible movil |
| Espectrograma | Canvas 2D + STFT JS | Sin dependencias externas |

---

## 8. Estructura de Archivos

```
recopilaVoz/
+-- PLANIFICACION.md          <- Este archivo
+-- DECISIONES.md             <- Decisiones de alcance
+-- README.md                 <- Instrucciones de uso
+-- .env.example              <- Variables de entorno de ejemplo
+-- .env                      <- Variables reales (NO commitear)
+-- package.json
+-- server.js                 <- Backend Express
+-- supabase-setup.sql        <- Script SQL para crear tablas
+-- public/
    +-- index.html            <- Pagina de participante
    +-- admin.html            <- Panel de administrador
    +-- css/
    |   +-- main.css          <- Estilos compartidos
    |   +-- participante.css  <- Estilos de la vista de participante
    |   +-- admin.css         <- Estilos del panel admin
    +-- js/
        +-- dsp.js            <- Modulo DSP: FFT, STFT, descriptores (puro)
        +-- espectrograma.js  <- Renderizado Canvas del espectrograma
        +-- grabador.js       <- Logica de grabacion y remuestreo 16kHz
        +-- participante.js   <- Controlador de la vista de participante
        +-- admin.js          <- Controlador del panel de administrador
```

---

## 9. Flujo de Usuario — Participante

```
1. Abre la URL
2. Escribe su alias (ej: "Hablante_A")
3. Ve la lista de comandos con indicador de progreso
4. Selecciona un comando -> lee instrucciones
5. Pulsa "Grabar" (3 segundos) -> espectrograma en vivo
6. Revisa el espectrograma resultado -> puede repetir o confirmar
7. Confirma -> audio sube al servidor
8. Repite para cada comando
9. Ve "Mis grabaciones" con reproductores individuales
```

---

## 10. Flujo de Usuario — Administrador

```
1. Navega a /admin.html
2. Ingresa token de administrador
3. Ve panel con estadisticas globales
4. Filtra por participante / comando / fecha
5. Reproduce cualquier audio con espectrograma
6. Descarga individualmente o en ZIP
7. Gestiona la lista de comandos (agregar/editar/eliminar)
8. Exporta metadatos CSV/JSON
```

---

## 11. Cronograma de Implementacion

| Fase | Tarea | Prioridad |
|---|---|---|
| 1 | Estructura de carpetas y archivos base | Alta |
| 2 | Modulo DSP puro (dsp.js) con FFT y STFT | Alta |
| 3 | Modulo de grabacion y remuestreo (grabador.js) | Alta |
| 4 | Espectrograma Canvas (espectrograma.js) | Alta |
| 5 | Vista de participante (index.html + participante.js) | Alta |
| 6 | Backend Express + rutas API (server.js) | Alta |
| 7 | Integracion Supabase | Alta |
| 8 | Panel de administrador (admin.html + admin.js) | Alta |
| 9 | Estilos responsivos completos (CSS) | Media |
| 10 | Pruebas en movil y escritorio | Media |
| 11 | README y documentacion | Baja |

---

## 12. Consideraciones Eticas y de Privacidad

- El participante elige su propio alias; no se registra nombre real ni correo.
- Los audios se almacenan en Supabase Storage bajo una carpeta {alias}/{comando}_{timestamp}.wav
- Solo el administrador (con token) puede acceder a todos los audios.
- El administrador debe informar a los participantes del proposito de la recopilacion.
- Los audios no se comparten publicamente; las URLs de Supabase Storage son privadas.
