/**
 * server.js — Backend principal de recopilaVoz
 * Servidor Express que actúa como proxy entre el cliente y Supabase,
 * con fallback a memoria local en Modo Demo si Supabase no está configurado.
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const archiver = require('archiver');
const path = require('path');
const { Readable } = require('stream');

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
const PUERTO = process.env.PUERTO || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const isSupabaseConfigured = SUPABASE_URL.startsWith('http') && 
    !SUPABASE_URL.includes('tu-proyecto') && 
    SUPABASE_SERVICE_KEY.length > 20 && 
    !SUPABASE_SERVICE_KEY.includes('tu_clave');

let supabase = null;
if (isSupabaseConfigured) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    console.log('[recopilaVoz] Modo Supabase activado.');
} else {
    console.log('[recopilaVoz] Modo Demo (Memoria Local) activado. Configura .env para usar Supabase.');
}

const BUCKET = 'audios';

// ---------------------------------------------------------------------------
// Almacenamiento Fallback en Memoria (Modo Demo)
// ---------------------------------------------------------------------------
let memoriaComandos = [
    { id: '1', nombre: 'Adelante', descripcion: 'Pronuncia la palabra "Adelante" en voz normal de conversación', activo: true, orden: 1 },
    { id: '2', nombre: 'Atras', descripcion: 'Pronuncia la palabra "Atras" en voz normal de conversación', activo: true, orden: 2 },
    { id: '3', nombre: 'Derecha', descripcion: 'Pronuncia la palabra "Derecha" en voz normal de conversación', activo: true, orden: 3 },
    { id: '4', nombre: 'Izquierda', descripcion: 'Pronuncia la palabra "Izquierda" en voz normal de conversación', activo: true, orden: 4 },
    { id: '5', nombre: 'Encender', descripcion: 'Pronuncia la palabra "Encender" en voz normal de conversación', activo: true, orden: 5 },
    { id: '6', nombre: 'Apagar', descripcion: 'Pronuncia la palabra "Apagar" en voz normal de conversación', activo: true, orden: 6 }
];

let memoriaGrabaciones = [];

// ---------------------------------------------------------------------------
// App Express
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos de public/
app.use(express.static(path.join(__dirname, 'public')));

// Multer: almacenamiento en memoria
const almacen = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// ---------------------------------------------------------------------------
// Middleware de autenticación de admin
// ---------------------------------------------------------------------------
function verificarAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token || token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Acceso no autorizado. Token de administrador inválido.' });
    }
    next();
}

// ---------------------------------------------------------------------------
// RUTAS PÚBLICAS (participante)
// ---------------------------------------------------------------------------

/**
 * GET /api/comandos
 */
app.get('/api/comandos', async (req, res) => {
    try {
        if (supabase) {
            const { data, error } = await supabase
                .from('comandos')
                .select('id, nombre, descripcion, orden')
                .eq('activo', true)
                .order('orden', { ascending: true });
            
            if (!error && data && data.length > 0) {
                return res.json({ comandos: data });
            }
        }

        // Fallback memoria
        const activos = memoriaComandos
            .filter(c => c.activo)
            .sort((a, b) => a.orden - b.orden);
        res.json({ comandos: activos });
    } catch (err) {
        console.error('[WARN /api/comandos - Usando fallback]', err.message);
        const activos = memoriaComandos.filter(c => c.activo);
        res.json({ comandos: activos });
    }
});

/**
 * POST /api/grabar
 */
app.post('/api/grabar', almacen.single('audio'), async (req, res) => {
    try {
        const { alias, comando, duracion_s } = req.body;

        if (!alias || !comando) {
            return res.status(400).json({ error: 'Faltan campos: alias y comando son obligatorios.' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No se recibió archivo de audio.' });
        }

        const aliasSanitizado = alias.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        const comandoSanitizado = comando.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        const timestamp = Date.now();
        const rutaStorage = `${aliasSanitizado}/${comandoSanitizado}_${timestamp}.wav`;

        if (supabase) {
            try {
                const { error: errorSubida } = await supabase.storage
                    .from(BUCKET)
                    .upload(rutaStorage, req.file.buffer, {
                        contentType: 'audio/wav',
                        upsert: false
                    });

                if (!errorSubida) {
                    const { data: urlData } = await supabase.storage
                        .from(BUCKET)
                        .createSignedUrl(rutaStorage, 365 * 24 * 60 * 60);

                    const { data: grabacion, error: errorDB } = await supabase
                        .from('grabaciones')
                        .insert({
                            alias: aliasSanitizado,
                            comando: comando,
                            url_audio: urlData ? urlData.signedUrl : '',
                            ruta_storage: rutaStorage,
                            tasa_hz: 16000,
                            duracion_s: parseFloat(duracion_s) || null
                        })
                        .select()
                        .single();

                    if (!errorDB) {
                        return res.json({ exito: true, grabacion });
                    }
                }
            } catch (errDb) {
                console.warn('[WARN Supabase fallo, guardando en memoria local]', errDb.message);
            }
        }

        // Fallback modo demo en memoria (usar data URI para reproducción inmediata)
        const base64Audio = req.file.buffer.toString('base64');
        const dataUri = `data:audio/wav;base64,${base64Audio}`;

        const nuevaGrab = {
            id: `demo-${timestamp}`,
            alias: aliasSanitizado,
            comando: comando,
            url_audio: dataUri,
            ruta_storage: rutaStorage,
            tasa_hz: 16000,
            duracion_s: parseFloat(duracion_s) || 3.0,
            created_at: new Date().toISOString(),
            buffer: req.file.buffer
        };

        memoriaGrabaciones.unshift(nuevaGrab);
        console.log(`[INFO Demo] Grabación registrada en memoria: alias=${aliasSanitizado}, comando=${comando}`);

        res.json({ 
            exito: true, 
            grabacion: {
                id: nuevaGrab.id,
                alias: nuevaGrab.alias,
                comando: nuevaGrab.comando,
                url_audio: nuevaGrab.url_audio,
                tasa_hz: nuevaGrab.tasa_hz,
                duracion_s: nuevaGrab.duracion_s,
                created_at: nuevaGrab.created_at
            } 
        });

    } catch (err) {
        console.error('[ERROR /api/grabar]', err.message);
        res.status(500).json({ error: 'Error al guardar la grabación: ' + err.message });
    }
});

/**
 * GET /api/mis-audios?alias=Hablante_A
 */
app.get('/api/mis-audios', async (req, res) => {
    try {
        const { alias } = req.query;
        if (!alias) {
            return res.status(400).json({ error: 'Parámetro alias es obligatorio.' });
        }

        const aliasSanitizado = alias.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('grabaciones')
                    .select('id, alias, comando, url_audio, tasa_hz, duracion_s, created_at')
                    .eq('alias', aliasSanitizado)
                    .order('created_at', { ascending: false });

                if (!error) return res.json({ grabaciones: data });
            } catch (errSup) {
                console.warn('[WARN /api/mis-audios fallback a memoria]', errSup.message);
            }
        }

        // Fallback memoria
        const misGrab = memoriaGrabaciones.filter(g => g.alias === aliasSanitizado);
        res.json({ grabaciones: misGrab });
    } catch (err) {
        console.error('[ERROR /api/mis-audios]', err.message);
        res.status(500).json({ error: 'Error al obtener grabaciones.' });
    }
});

// ---------------------------------------------------------------------------
// RUTAS DE ADMINISTRADOR (requieren token)
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/verificar
 */
app.post('/api/admin/verificar', (req, res) => {
    const { token } = req.body;
    if (token === ADMIN_TOKEN) {
        res.json({ valido: true });
    } else {
        res.status(401).json({ valido: false, error: 'Token inválido.' });
    }
});

/**
 * GET /api/admin/audios
 */
app.get('/api/admin/audios', verificarAdmin, async (req, res) => {
    try {
        const { alias, comando, limite = 200, pagina = 0 } = req.query;

        if (supabase) {
            try {
                let consulta = supabase
                    .from('grabaciones')
                    .select('id, alias, comando, url_audio, ruta_storage, tasa_hz, duracion_s, created_at', { count: 'exact' })
                    .order('created_at', { ascending: false })
                    .range(pagina * limite, (pagina + 1) * limite - 1);

                if (alias) consulta = consulta.ilike('alias', `%${alias}%`);
                if (comando) consulta = consulta.eq('comando', comando);

                const { data, error, count } = await consulta;
                if (!error) return res.json({ grabaciones: data, total: count });
            } catch (errSup) {
                console.warn('[WARN /api/admin/audios fallback]', errSup.message);
            }
        }

        // Fallback memoria
        let resultado = [...memoriaGrabaciones];
        if (alias) resultado = resultado.filter(g => g.alias.toLowerCase().includes(alias.toLowerCase()));
        if (comando) resultado = resultado.filter(g => g.comando === comando);

        res.json({ grabaciones: resultado, total: resultado.length });
    } catch (err) {
        console.error('[ERROR /api/admin/audios]', err.message);
        res.status(500).json({ error: 'Error al obtener audios.' });
    }
});

/**
 * GET /api/admin/stats
 */
app.get('/api/admin/stats', verificarAdmin, async (req, res) => {
    try {
        if (supabase) {
            try {
                const { count: totalGrabaciones } = await supabase.from('grabaciones').select('*', { count: 'exact', head: true });
                const { data: participantesData } = await supabase.from('grabaciones').select('alias');
                const participantesUnicos = [...new Set(participantesData.map(g => g.alias))];
                const { data: porComando } = await supabase.from('grabaciones').select('comando');
                
                const conteoComandos = {};
                porComando.forEach(g => { conteoComandos[g.comando] = (conteoComandos[g.comando] || 0) + 1; });

                const grabacionesPorParticipante = {};
                participantesData.forEach(g => { grabacionesPorParticipante[g.alias] = (grabacionesPorParticipante[g.alias] || 0) + 1; });

                const { data: comandosActivos } = await supabase.from('comandos').select('nombre').eq('activo', true);

                return res.json({
                    totalGrabaciones,
                    totalParticipantes: participantesUnicos.length,
                    participantes: participantesUnicos,
                    grabacionesPorComando: conteoComandos,
                    grabacionesPorParticipante,
                    comandosActivos: comandosActivos.map(c => c.nombre)
                });
            } catch (errSup) {
                console.warn('[WARN /api/admin/stats fallback]', errSup.message);
            }
        }

        // Fallback memoria
        const participantesUnicos = [...new Set(memoriaGrabaciones.map(g => g.alias))];
        const conteoComandos = {};
        memoriaGrabaciones.forEach(g => { conteoComandos[g.comando] = (conteoComandos[g.comando] || 0) + 1; });
        const grabacionesPorParticipante = {};
        memoriaGrabaciones.forEach(g => { grabacionesPorParticipante[g.alias] = (grabacionesPorParticipante[g.alias] || 0) + 1; });

        res.json({
            totalGrabaciones: memoriaGrabaciones.length,
            totalParticipantes: participantesUnicos.length,
            participantes: participantesUnicos,
            grabacionesPorComando: conteoComandos,
            grabacionesPorParticipante,
            comandosActivos: memoriaComandos.filter(c => c.activo).map(c => c.nombre)
        });
    } catch (err) {
        console.error('[ERROR /api/admin/stats]', err.message);
        res.status(500).json({ error: 'Error al calcular estadísticas.' });
    }
});

/**
 * GET /api/admin/comandos
 */
app.get('/api/admin/comandos', verificarAdmin, async (req, res) => {
    try {
        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('comandos')
                    .select('*')
                    .order('orden', { ascending: true });
                if (!error) return res.json({ comandos: data });
            } catch (errSup) {
                console.warn('[WARN /api/admin/comandos fallback]', errSup.message);
            }
        }

        res.json({ comandos: memoriaComandos });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener comandos.' });
    }
});

/**
 * POST /api/admin/comandos
 */
app.post('/api/admin/comandos', verificarAdmin, async (req, res) => {
    try {
        const { nombre, descripcion, activo, orden } = req.body;
        if (!nombre) return res.status(400).json({ error: 'El campo nombre es obligatorio.' });

        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('comandos')
                    .insert({ nombre, descripcion: descripcion || '', activo: activo !== false, orden: orden || 0 })
                    .select()
                    .single();
                if (!error) return res.status(201).json({ comando: data });
            } catch (errSup) {
                console.warn('[WARN POST /api/admin/comandos fallback]', errSup.message);
            }
        }

        const nuevoCmd = {
            id: String(Date.now()),
            nombre,
            descripcion: descripcion || '',
            activo: activo !== false,
            orden: parseInt(orden) || memoriaComandos.length + 1
        };
        memoriaComandos.push(nuevoCmd);
        res.status(201).json({ comando: nuevoCmd });
    } catch (err) {
        res.status(500).json({ error: 'Error al crear comando.' });
    }
});

/**
 * PUT /api/admin/comandos/:id
 */
app.put('/api/admin/comandos/:id', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, activo, orden } = req.body;

        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('comandos')
                    .update({ nombre, descripcion, activo, orden })
                    .eq('id', id)
                    .select()
                    .single();
                if (!error) return res.json({ comando: data });
            } catch (errSup) {
                console.warn('[WARN PUT /api/admin/comandos fallback]', errSup.message);
            }
        }

        const idx = memoriaComandos.findIndex(c => c.id === id);
        if (idx !== -1) {
            memoriaComandos[idx] = { ...memoriaComandos[idx], nombre, descripcion, activo, orden };
            return res.json({ comando: memoriaComandos[idx] });
        }
        res.status(404).json({ error: 'Comando no encontrado.' });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar comando.' });
    }
});

/**
 * DELETE /api/admin/comandos/:id
 */
app.delete('/api/admin/comandos/:id', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        if (supabase) {
            try {
                const { data: cmd } = await supabase.from('comandos').select('nombre').eq('id', id).single();
                if (cmd) {
                    const { count } = await supabase.from('grabaciones').select('*', { count: 'exact', head: true }).eq('comando', cmd.nombre);
                    if (count > 0) {
                        return res.status(409).json({ error: `No se puede eliminar: el comando tiene ${count} grabación(es) asociada(s).` });
                    }
                    await supabase.from('comandos').delete().eq('id', id);
                    return res.json({ exito: true });
                }
            } catch (errSup) {
                console.warn('[WARN DELETE /api/admin/comandos fallback]', errSup.message);
            }
        }

        memoriaComandos = memoriaComandos.filter(c => c.id !== id);
        res.json({ exito: true });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar comando.' });
    }
});

/**
 * DELETE /api/admin/grabaciones/:id
 */
app.delete('/api/admin/grabaciones/:id', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        if (supabase) {
            try {
                const { data: grab } = await supabase.from('grabaciones').select('ruta_storage').eq('id', id).single();
                if (grab) {
                    await supabase.storage.from(BUCKET).remove([grab.ruta_storage]);
                    await supabase.from('grabaciones').delete().eq('id', id);
                    return res.json({ exito: true });
                }
            } catch (errSup) {
                console.warn('[WARN DELETE /api/admin/grabaciones fallback]', errSup.message);
            }
        }

        memoriaGrabaciones = memoriaGrabaciones.filter(g => g.id !== id);
        res.json({ exito: true });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar grabación.' });
    }
});

/**
 * GET /api/admin/exportar
 */
app.get('/api/admin/exportar', verificarAdmin, async (req, res) => {
    try {
        const { formato = 'json' } = req.query;
        let datos = memoriaGrabaciones;

        if (supabase) {
            try {
                const { data } = await supabase.from('grabaciones').select('id, alias, comando, tasa_hz, duracion_s, created_at').order('created_at', { ascending: false });
                if (data) datos = data;
            } catch (errSup) {
                console.warn('[WARN exportar fallback]', errSup.message);
            }
        }

        if (formato === 'csv') {
            const encabezado = 'id,alias,comando,tasa_hz,duracion_s,created_at';
            const filas = datos.map(g => `"${g.id}","${g.alias}","${g.comando}",${g.tasa_hz},${g.duracion_s || ''},"${g.created_at}"`);
            const csv = [encabezado, ...filas].join('\n');
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="grabaciones.csv"');
            res.send(csv);
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="grabaciones.json"');
            res.json(datos);
        }
    } catch (err) {
        res.status(500).json({ error: 'Error al exportar datos.' });
    }
});

/**
 * GET /api/admin/descargar-zip
 */
app.get('/api/admin/descargar-zip', verificarAdmin, async (req, res) => {
    try {
        const { alias, comando } = req.query;

        let lista = [...memoriaGrabaciones];
        if (alias) lista = lista.filter(g => g.alias.toLowerCase().includes(alias.toLowerCase()));
        if (comando) lista = lista.filter(g => g.comando === comando);

        const nombreZip = `grabaciones_${Date.now()}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreZip}"`);

        const archivo = archiver('zip', { zlib: { level: 6 } });
        archivo.pipe(res);

        for (const grab of lista) {
            let buffer = grab.buffer;
            if (!buffer && supabase && grab.ruta_storage) {
                try {
                    const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(grab.ruta_storage, 60);
                    if (urlData?.signedUrl) {
                        const resp = await fetch(urlData.signedUrl);
                        if (resp.ok) buffer = Buffer.from(await resp.arrayBuffer());
                    }
                } catch (e) {}
            }

            if (buffer) {
                const nombreArchivo = `${grab.alias}/${grab.comando}_${new Date(grab.created_at).getTime()}.wav`;
                archivo.append(buffer, { name: nombreArchivo });
            }
        }

        await archivo.finalize();
    } catch (err) {
        console.error('[ERROR /api/admin/descargar-zip]', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Error al generar ZIP.' });
    }
});

// Redirección SPA
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Inicio servidor
app.listen(PUERTO, () => {
    console.log(`[recopilaVoz] Servidor corriendo en http://localhost:${PUERTO}`);
    console.log(`[recopilaVoz] Panel de admin en http://localhost:${PUERTO}/admin.html`);
});
