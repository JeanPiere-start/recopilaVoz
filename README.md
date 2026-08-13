# RecopilaVoz

Plataforma web de recopilacion de audio espectral para el experimento de separabilidad H7 del proyecto controlVoz.

## Descripcion

RecopilaVoz es una aplicacion web full-stack que permite:
- **Participantes:** Grabar comandos de voz, visualizar su espectrograma en tiempo real y escuchar sus propias grabaciones.
- **Administrador:** Gestionar el corpus completo, configurar los comandos, escuchar todos los audios, exportar metadatos y descargar los archivos de audio.

El audio se graba a **16 000 Hz** usando `OfflineAudioContext` para garantizar compatibilidad con el experimento H7.

---

## Requisitos previos

- Node.js >= 18
- npm >= 9
- Una cuenta en [Supabase](https://supabase.com) (nivel gratuito es suficiente)

---

## Configuracion inicial

### 1. Instalar dependencias

```bash
cd recopilaVoz
npm install
```

### 2. Crear proyecto en Supabase

1. Crear un nuevo proyecto en https://supabase.com
2. Ir a **Storage > Buckets** y crear un bucket llamado `audios` (sin acceso publico)
3. Ir a **SQL Editor** y ejecutar el contenido de `supabase-setup.sql`
4. Ir a **Settings > API** y copiar:
   - `URL` del proyecto
   - `anon` public key
   - `service_role` secret key

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus valores reales:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu_clave_anon
SUPABASE_SERVICE_KEY=tu_clave_service_role
ADMIN_TOKEN=elige_una_clave_segura
PUERTO=3000
```

**IMPORTANTE:** Nunca compartas ni commitees tu `.env`.

---

## Ejecutar en desarrollo

```bash
npm run dev
```

O en produccion:

```bash
npm start
```

La aplicacion estara disponible en `http://localhost:3000`.

---

## Estructura de la aplicacion

```
http://localhost:3000/            -> Vista de participante
http://localhost:3000/admin.html  -> Panel de administrador
```

---

## Guia de uso

### Para participantes

1. Abre `http://localhost:3000` en tu navegador (o celular en la misma red)
2. Escribe un alias (ej: `Hablante_A`) — no uses tu nombre real
3. Selecciona un comando de la lista
4. Pulsa **Grabar** y pronuncia la palabra en voz normal
5. Revisa el espectrograma y los descriptores espectrales
6. Pulsa **Confirmar y guardar** para subir la grabacion
7. Repite para cada comando
8. En la seccion **Mis grabaciones** puedes escuchar lo que grabaste

### Para el administrador

1. Abre `http://localhost:3000/admin.html`
2. Ingresa tu `ADMIN_TOKEN` (el que configuraste en `.env`)
3. Navega entre las secciones:
   - **Resumen:** estadisticas globales del corpus y exportacion
   - **Grabaciones:** lista completa con reproductor, espectrograma y filtros
   - **Comandos:** gestiona que palabras deben grabar los participantes

---

## Compartir con participantes

Si quieres que otros puedan acceder desde su celular en la misma red:

1. Encuentra tu IP local:
   - Windows: `ipconfig` -> busca `IPv4`
2. Comparte la URL: `http://192.168.X.X:3000`

Para acceso externo (internet), considera:
- [ngrok](https://ngrok.com) para un tunel temporal: `ngrok http 3000`
- Despliegue en un servicio como Railway, Render o Vercel

---

## API REST

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | /api/comandos | Lista de comandos activos |
| GET | /api/mis-audios?alias=X | Grabaciones del alias |
| POST | /api/grabar | Subir nueva grabacion |
| POST | /api/admin/verificar | Verificar token de admin |
| GET | /api/admin/audios | Todas las grabaciones (admin) |
| GET | /api/admin/stats | Estadisticas (admin) |
| GET | /api/admin/comandos | Todos los comandos (admin) |
| POST | /api/admin/comandos | Crear comando (admin) |
| PUT | /api/admin/comandos/:id | Editar comando (admin) |
| DELETE | /api/admin/comandos/:id | Eliminar comando (admin) |
| DELETE | /api/admin/grabaciones/:id | Eliminar grabacion (admin) |
| GET | /api/admin/exportar | Exportar CSV/JSON (admin) |
| GET | /api/admin/descargar-zip | Descargar audios ZIP (admin) |

---

## Notas tecnicas

- El audio se captura con la tasa nativa del dispositivo y se remuestrea a **16 000 Hz** en el cliente usando `OfflineAudioContext`.
- Los archivos WAV se suben directamente a **Supabase Storage** con rutas de la forma `{alias}/{comando}_{timestamp}.wav`.
- El espectrograma usa **STFT con ventana Hann**, implementado en `dsp.js` sin dependencias externas.
- El servidor Node.js nunca escribe audio en disco (cumple la regla D-004 del proyecto).
- Los 4 descriptores espectrales del experimento H7 son: HF/LF Ratio, Energia Alta, Energia Baja, ZCR.

---

## Documentacion del proyecto

- [PLANIFICACION.md](./PLANIFICACION.md) — Arquitectura y diseno del sistema
- [DECISIONES.md](./DECISIONES.md) — Decisiones de alcance y metodologia
- [supabase-setup.sql](./supabase-setup.sql) — Script SQL de configuracion inicial
