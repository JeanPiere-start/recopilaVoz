/**
 * server.js — Backend principal de RecopilaVoz
 * Servidor Express con integración completa a Supabase (PostgreSQL + Storage)
 * y modo fallback en memoria local (Modo Demo) totalmente operativo.
 *
 * Características implementadas:
 *   - Soporte Multi-Admin con roles jerárquicos (Super Admin y Admins).
 *   - Control y validación granular de audios (✓ Válido, ✗ Rechazado, ? Sin revisar).
 *   - Operaciones en lote de grabaciones y comandos (Bulk delete, Bulk validate, Bulk insert).
 *   - Estadísticas avanzadas del corpus espectral para el experimento H7 (controlVoz).
 *   - Exportación de metadatos (CSV/JSON) y descarga de dataset en ZIP con manifiesto estructurado.
 *   - Configuración centralizada de grabación (duración, tasa Hz, meta por comando).
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const archiver = require('archiver');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuración de Servidor y Multi-Admin
// ---------------------------------------------------------------------------
const PUERTO = process.env.PORT || process.env.PUERTO || 3000;

// Tokens de administración (separados por coma en ADMIN_TOKENS o token singular en ADMIN_TOKEN)
const adminTokensRaw = process.env.ADMIN_TOKENS || process.env.ADMIN_TOKEN || 'admin123';
const ADMIN_TOKENS = adminTokensRaw
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const isSupabaseConfigured = SUPABASE_URL.startsWith('http') &&
    !SUPABASE_URL.includes('tu-proyecto') &&
    SUPABASE_SERVICE_KEY.length > 20 &&
    !SUPABASE_SERVICE_KEY.includes('tu_clave');

let supabase = null;
if (isSupabaseConfigured) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    console.log('[recopilaVoz] Conectado exitosamente a Supabase (PostgreSQL + Storage).');
} else {
    console.log('[recopilaVoz] Modo Demo activo (Almacenamiento en Memoria). Para persistencia real en la nube, configura .env con Supabase.');
}

const BUCKET = 'audios';

// ---------------------------------------------------------------------------
// Almacenamiento en Memoria (Fallback / Modo Demo)
// ---------------------------------------------------------------------------
let memoriaComandos = [
    { id: '1', nombre: 'Adelante', descripcion: 'Pronuncia la palabra "Adelante" en voz normal de conversación', activo: true, orden: 1, limite_bloque: 40 },
    { id: '2', nombre: 'Atras', descripcion: 'Pronuncia la palabra "Atras" en voz normal de conversación', activo: true, orden: 2, limite_bloque: 40 },
    { id: '3', nombre: 'Derecha', descripcion: 'Pronuncia la palabra "Derecha" en voz normal de conversación', activo: true, orden: 3, limite_bloque: 40 },
    { id: '4', nombre: 'Izquierda', descripcion: 'Pronuncia la palabra "Izquierda" en voz normal de conversación', activo: true, orden: 4, limite_bloque: 40 },
    { id: '5', nombre: 'Encender', descripcion: 'Pronuncia la palabra "Encender" en voz normal de conversación', activo: true, orden: 5, limite_bloque: 40 },
    { id: '6', nombre: 'Apagar', descripcion: 'Pronuncia la palabra "Apagar" en voz normal de conversación', activo: true, orden: 6, limite_bloque: 40 }
];

let memoriaGrabaciones = [];

// Almacenamiento de perfiles de hablantes (registro opcional)
let memoriaPerfilesHablantes = new Map(); // alias -> { alias, nombres_apellidos, contacto, notas, created_at, updated_at }

// Mensaje / Anuncio configurable por administradores para los participantes
let memoriaAnuncio = {
    id: '1',
    mensaje: '',
    tipo: 'info', // 'info', 'importante', 'exito'
    activo: false,
    updated_at: new Date().toISOString()
};

// Configuración global de grabación
let configGrabacion = {
    duracion_s: 3,         // Duración de captura en segundos (1–10)
    tasa_hz: 16000,        // Tasa de muestreo estándar (16 kHz para experimento H7)
    meta_por_comando: 40   // Cantidad objetivo de grabaciones por comando por participante
};

/**
 * Verifica si un código de dispositivo es el propietario legítimo de un alias.
 * Un alias "no reclamado" (sin código guardado aún, p.ej. registros previos a esta
 * protección) se considera libre de reclamar por el primer dispositivo que lo use.
 * @returns {Promise<boolean>}
 */
async function verificarPropietarioAlias(aliasSanitizado, codigoDispositivo) {
    if (!codigoDispositivo) return false;

    if (supabase) {
        try {
            const { data } = await supabase
                .from('hablantes_perfil')
                .select('codigo_dispositivo')
                .eq('alias', aliasSanitizado)
                .maybeSingle();
            if (!data || !data.codigo_dispositivo) return true;
            return data.codigo_dispositivo === codigoDispositivo;
        } catch (e) {
            return true; // No bloquear por una falla transitoria de Supabase
        }
    }

    const mem = memoriaPerfilesHablantes.get(aliasSanitizado);
    if (!mem || !mem.codigo_dispositivo) return true;
    return mem.codigo_dispositivo === codigoDispositivo;
}

/**
 * Calcula el número de "toma" (repetición) siguiente para un alias+comando,
 * y construye el nombre de archivo estándar: Hablante_toma_comando.wav
 */
async function generarNombreArchivo(aliasSanitizado, comando, comandoSanitizado) {
    let tomaAnterior = 0;

    if (supabase) {
        try {
            const { count } = await supabase
                .from('grabaciones')
                .select('id', { count: 'exact', head: true })
                .eq('alias', aliasSanitizado)
                .eq('comando', comando);
            tomaAnterior = count || 0;
        } catch (e) {
            tomaAnterior = memoriaGrabaciones.filter(g => g.alias === aliasSanitizado && g.comando === comando).length;
        }
    } else {
        tomaAnterior = memoriaGrabaciones.filter(g => g.alias === aliasSanitizado && g.comando === comando).length;
    }

    const toma = tomaAnterior + 1;
    const tomaTexto = String(toma).padStart(2, '0');
    return { toma, nombreArchivo: `${aliasSanitizado}_${tomaTexto}_${comandoSanitizado}.wav` };
}

/**
 * Genera el contenido formateado del archivo TXT de información del hablante.
 */
function generarTextoInfoHablante(alias, perfil = {}, stats = {}) {
    const nombres = (perfil.nombres_apellidos && perfil.nombres_apellidos.trim()) || '(No especificado / Anónimo)';
    const contacto = (perfil.contacto && perfil.contacto.trim()) || '(No especificado)';
    const notas = (perfil.notas && perfil.notas.trim()) || '(Ninguna)';
    const fechaReg = perfil.created_at ? new Date(perfil.created_at).toLocaleString() : new Date().toLocaleString();

    let lineasComandos = '';
    if (stats.comandosGrabados && typeof stats.comandosGrabados === 'object') {
        lineasComandos = Object.entries(stats.comandosGrabados)
            .map(([cmd, c]) => `  - ${cmd.padEnd(16)} : ${c.total || 0} audios (${c.validados || 0} válidos, ${c.rechazados || 0} rechazados, ${c.sinRevisar || 0} sin revisar)`)
            .join('\n');
    }

    return [
        '================================================================================',
        'RECOPILAVOZ — FICHA DE REGISTRO E INFORMACIÓN DEL HABLANTE',
        'Proyecto: Laboratorio de Análisis Espectral y Reconocimiento de Voz (H7)',
        '================================================================================',
        `Alias / Identificador : ${alias}`,
        `Nombres y Apellidos   : ${nombres}`,
        `Forma de Contacto     : ${contacto}`,
        `Notas / Observaciones : ${notas}`,
        `Fecha de Registro     : ${fechaReg}`,
        '--------------------------------------------------------------------------------',
        'RESUMEN DE GRABACIONES:',
        `  - Total de Audios    : ${stats.total || stats.totalGrabaciones || 0}`,
        `  - Muestras Validadas : ${stats.validados || 0} (✓)`,
        `  - Muestras Rechazadas: ${stats.rechazados || 0} (✗)`,
        `  - Muestras Sin Revisar: ${stats.sinRevisar || 0} (?)`,
        `  - Duración Total     : ${stats.duracionTotalSegundos || 0}s`,
        ...(lineasComandos ? ['\nDESGLOSE POR COMANDO:', lineasComandos] : []),
        '================================================================================',
        `Documento generado automáticamente por RecopilaVoz [${new Date().toISOString()}]`
    ].join('\n');
}

// ---------------------------------------------------------------------------
// App Express & Middleware
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Servir frontend estático desde /public
app.use(express.static(path.join(__dirname, 'public')));

// Multer en memoria para archivos de audio
const almacenMulter = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } // Límite de 15MB
});

/**
 * Middleware para autenticar peticiones de administración.
 */
function verificarAdmin(req, res, next) {
    const tokenHeader = req.headers['x-admin-token'] || req.query.token;
    if (!tokenHeader || !ADMIN_TOKENS.includes(tokenHeader)) {
        return res.status(401).json({ error: 'Acceso no autorizado. Token de administrador inválido o expirado.' });
    }
    req.adminToken = tokenHeader;
    req.esSuperAdmin = tokenHeader === ADMIN_TOKENS[0];
    next();
}

// ---------------------------------------------------------------------------
// RUTAS PÚBLICAS (Participante)
// ---------------------------------------------------------------------------

/**
 * GET /api/config-grabacion
 * Retorna la configuración global de audio activa.
 */
app.get('/api/config-grabacion', (req, res) => {
    res.json({ config: configGrabacion });
});

/**
 * GET /api/anuncio
 * Retorna el anuncio o mensaje activo publicado por los administradores para los hablantes.
 */
app.get('/api/anuncio', async (req, res) => {
    try {
        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('anuncios')
                    .select('id, mensaje, tipo, activo, updated_at')
                    .order('updated_at', { ascending: false })
                    .limit(1)
                    .single();
                if (!error && data) {
                    return res.json({ anuncio: data });
                }
            } catch (errSup) {}
        }
        res.json({ anuncio: memoriaAnuncio });
    } catch (err) {
        res.json({ anuncio: memoriaAnuncio });
    }
});

/**
 * POST /api/participantes/ingresar
 * Reclama o verifica la propiedad de un alias mediante un código de dispositivo
 * generado en el navegador del participante (guardado en localStorage).
 * Evita que dos personas usen el mismo alias a la vez, o que alguien ajeno
 * entre a un alias existente y sabotee (grabe encima de) sus muestras.
 */
app.post('/api/participantes/ingresar', async (req, res) => {
    try {
        const { alias, codigoDispositivo } = req.body;
        if (!alias || typeof alias !== 'string' || !alias.trim()) {
            return res.status(400).json({ error: 'El alias es obligatorio.' });
        }
        if (!codigoDispositivo || typeof codigoDispositivo !== 'string') {
            return res.status(400).json({ error: 'Falta el código de dispositivo. Recarga la página e intenta de nuevo.' });
        }

        const aliasSanitizado = alias.trim().replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

        if (supabase) {
            try {
                const { data: existente } = await supabase
                    .from('hablantes_perfil')
                    .select('alias, codigo_dispositivo')
                    .eq('alias', aliasSanitizado)
                    .maybeSingle();

                if (!existente) {
                    await supabase.from('hablantes_perfil').insert({
                        alias: aliasSanitizado,
                        codigo_dispositivo: codigoDispositivo
                    });
                    return res.json({ exito: true, alias: aliasSanitizado });
                }

                if (!existente.codigo_dispositivo || existente.codigo_dispositivo === codigoDispositivo) {
                    await supabase.from('hablantes_perfil')
                        .update({ codigo_dispositivo: codigoDispositivo })
                        .eq('alias', aliasSanitizado);
                    return res.json({ exito: true, alias: aliasSanitizado });
                }

                return res.status(409).json({
                    error: `El alias "${aliasSanitizado}" ya está en uso por otro participante. Elige un alias distinto (por ejemplo, agrega tu inicial o un número).`
                });
            } catch (errSup) {
                console.warn('[WARN /api/participantes/ingresar fallback a memoria]', errSup.message);
            }
        }

        // Fallback en memoria
        const existenteMem = memoriaPerfilesHablantes.get(aliasSanitizado);
        if (!existenteMem) {
            memoriaPerfilesHablantes.set(aliasSanitizado, {
                alias: aliasSanitizado,
                nombres_apellidos: '',
                contacto: '',
                notas: '',
                codigo_dispositivo: codigoDispositivo,
                created_at: new Date().toISOString()
            });
            return res.json({ exito: true, alias: aliasSanitizado });
        }

        if (!existenteMem.codigo_dispositivo || existenteMem.codigo_dispositivo === codigoDispositivo) {
            existenteMem.codigo_dispositivo = codigoDispositivo;
            return res.json({ exito: true, alias: aliasSanitizado });
        }

        return res.status(409).json({
            error: `El alias "${aliasSanitizado}" ya está en uso por otro participante. Elige un alias distinto.`
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al verificar el alias: ' + err.message });
    }
});

/**
 * GET /api/participantes/perfil
 * Consulta los datos de registro/contacto del hablante (alias).
 */
app.get('/api/participantes/perfil', async (req, res) => {
    try {
        const alias = (req.query.alias || '').trim();
        if (!alias) return res.status(400).json({ error: 'Alias requerido' });
        const aliasSanitizado = alias.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('hablantes_perfil')
                    .select('alias, nombres_apellidos, contacto, notas, created_at, updated_at')
                    .eq('alias', aliasSanitizado)
                    .single();
                if (!error && data) {
                    return res.json({ perfil: data });
                }
            } catch (e) {}
        }

        const mem = memoriaPerfilesHablantes.get(aliasSanitizado) || {
            alias: aliasSanitizado,
            nombres_apellidos: '',
            contacto: '',
            notas: '',
            created_at: new Date().toISOString()
        };
        res.json({ perfil: mem });
    } catch (err) {
        res.status(500).json({ error: 'Error al consultar perfil: ' + err.message });
    }
});

/**
 * POST /api/participantes/perfil
 * Registra o actualiza los datos opcionales de contacto/perfil de un hablante.
 */
app.post('/api/participantes/perfil', async (req, res) => {
    try {
        const { alias, nombres_apellidos = '', contacto = '', notas = '', codigoDispositivo = '' } = req.body;
        if (!alias || typeof alias !== 'string') {
            return res.status(400).json({ error: 'Alias inválido o no proporcionado.' });
        }

        const aliasSanitizado = alias.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

        const esPropietario = await verificarPropietarioAlias(aliasSanitizado, codigoDispositivo);
        if (!esPropietario) {
            return res.status(403).json({ error: `El alias "${aliasSanitizado}" pertenece a otro participante.` });
        }

        const perfilObj = {
            alias: aliasSanitizado,
            nombres_apellidos: (nombres_apellidos || '').trim().substring(0, 150),
            contacto: (contacto || '').trim().substring(0, 150),
            notas: (notas || '').trim().substring(0, 500),
            updated_at: new Date().toISOString()
        };

        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('hablantes_perfil')
                    .upsert(perfilObj, { onConflict: 'alias' })
                    .select()
                    .single();
                if (!error && data) {
                    memoriaPerfilesHablantes.set(aliasSanitizado, data);
                    return res.json({ exito: true, perfil: data });
                }
            } catch (errSup) {
                console.warn('[WARN /api/participantes/perfil fallback]', errSup.message);
            }
        }

        const existing = memoriaPerfilesHablantes.get(aliasSanitizado);
        const finalObj = {
            ...perfilObj,
            created_at: existing ? existing.created_at : new Date().toISOString()
        };
        memoriaPerfilesHablantes.set(aliasSanitizado, finalObj);
        res.json({ exito: true, perfil: finalObj });
    } catch (err) {
        res.status(500).json({ error: 'Error al registrar datos del hablante: ' + err.message });
    }
});

/**
 * GET /api/comandos
 * Lista de comandos activos para los participantes con su respectivo límite de bloque.
 */
app.get('/api/comandos', async (req, res) => {
    try {
        if (supabase) {
            const { data, error } = await supabase
                .from('comandos')
                .select('id, nombre, descripcion, orden, limite_bloque')
                .eq('activo', true)
                .order('orden', { ascending: true });

            if (!error && data && data.length > 0) {
                const comandosFormateados = data.map(c => ({
                    ...c,
                    limite_bloque: c.limite_bloque || configGrabacion.meta_por_comando || 40
                }));
                return res.json({ comandos: comandosFormateados });
            } else if (error) {
                // Si la columna limite_bloque aún no existe en Supabase, reintentar sin ella
                console.warn('[WARN /api/comandos] Fallback a consulta estándar Supabase:', error.message);
                const { data: dataBase } = await supabase
                    .from('comandos')
                    .select('id, nombre, descripcion, orden')
                    .eq('activo', true)
                    .order('orden', { ascending: true });

                if (dataBase && dataBase.length > 0) {
                    const comandosBase = dataBase.map(c => ({
                        ...c,
                        limite_bloque: configGrabacion.meta_por_comando || 40
                    }));
                    return res.json({ comandos: comandosBase });
                }
            }
        }

        // Fallback memoria
        const activos = memoriaComandos
            .filter(c => c.activo)
            .sort((a, b) => a.orden - b.orden)
            .map(c => ({
                ...c,
                limite_bloque: c.limite_bloque || configGrabacion.meta_por_comando || 40
            }));
        res.json({ comandos: activos });
    } catch (err) {
        console.error('[ERROR /api/comandos]', err.message);
        const activos = memoriaComandos.filter(c => c.activo).map(c => ({
            ...c,
            limite_bloque: c.limite_bloque || configGrabacion.meta_por_comando || 40
        }));
        res.json({ comandos: activos });
    }
});

/**
 * POST /api/grabar
 * Sube una nueva grabación de audio WAV remuestreada a 16 kHz.
 */
app.post('/api/grabar', almacenMulter.single('audio'), async (req, res) => {
    try {
        const { alias, comando, duracion_s, codigoDispositivo = '' } = req.body;

        if (!alias || !comando) {
            return res.status(400).json({ error: 'El alias y el comando son campos obligatorios.' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No se recibió ningún archivo de audio válido.' });
        }

        const aliasSanitizado = alias.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        const comandoSanitizado = comando.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

        // Protección anti-suplantación/boicot: solo el dueño del alias puede subir grabaciones
        const esPropietario = await verificarPropietarioAlias(aliasSanitizado, codigoDispositivo);
        if (!esPropietario) {
            return res.status(403).json({ error: `No puedes grabar con el alias "${aliasSanitizado}" porque pertenece a otro participante.` });
        }

        const timestamp = Date.now();
        const duracionFloat = parseFloat(duracion_s) || configGrabacion.duracion_s;

        // Etiquetado estándar: Hablante_toma_comando.wav
        const { nombreArchivo } = await generarNombreArchivo(aliasSanitizado, comando, comandoSanitizado);
        const rutaStorage = `${aliasSanitizado}/${nombreArchivo}`;

        if (supabase) {
            try {
                // 1. Subir al bucket de Supabase Storage
                const { error: errorSubida } = await supabase.storage
                    .from(BUCKET)
                    .upload(rutaStorage, req.file.buffer, {
                        contentType: 'audio/wav',
                        upsert: false
                    });

                if (!errorSubida) {
                    // 2. Obtener URL firmada válida por 1 año (o pública)
                    const { data: urlData } = await supabase.storage
                        .from(BUCKET)
                        .createSignedUrl(rutaStorage, 365 * 24 * 60 * 60);

                    // 3. Registrar metadatos en la tabla grabaciones
                    const payloadGrabacion = {
                        alias: aliasSanitizado,
                        comando: comando,
                        url_audio: urlData ? urlData.signedUrl : '',
                        ruta_storage: rutaStorage,
                        nombre_archivo: nombreArchivo,
                        tasa_hz: configGrabacion.tasa_hz,
                        duracion_s: duracionFloat,
                        valido: null // Inicialmente sin revisar
                    };

                    let { data: grabacion, error: errorDB } = await supabase
                        .from('grabaciones')
                        .insert(payloadGrabacion)
                        .select()
                        .single();

                    if (errorDB && errorDB.message && errorDB.message.includes('nombre_archivo')) {
                        // Migración de nombre_archivo aún no aplicada en Supabase: reintentar sin ella
                        delete payloadGrabacion.nombre_archivo;
                        const retry = await supabase.from('grabaciones').insert(payloadGrabacion).select().single();
                        if (!retry.error && retry.data) {
                            return res.json({ exito: true, grabacion: { ...retry.data, nombre_archivo: nombreArchivo } });
                        }
                    }

                    if (!errorDB && grabacion) {
                        return res.json({ exito: true, grabacion });
                    }
                }
            } catch (errDb) {
                console.warn('[WARN Supabase falló, guardando en memoria local]:', errDb.message);
            }
        }

        // Fallback en Memoria (Modo Demo)
        const base64Audio = req.file.buffer.toString('base64');
        const dataUri = `data:audio/wav;base64,${base64Audio}`;

        const nuevaGrab = {
            id: `demo-${timestamp}`,
            alias: aliasSanitizado,
            comando: comando,
            url_audio: dataUri,
            ruta_storage: rutaStorage,
            nombre_archivo: nombreArchivo,
            tasa_hz: configGrabacion.tasa_hz,
            duracion_s: duracionFloat,
            valido: null,
            created_at: new Date().toISOString(),
            buffer: req.file.buffer
        };

        memoriaGrabaciones.unshift(nuevaGrab);
        console.log(`[INFO Demo] Audio registrado: alias=${aliasSanitizado}, comando=${comando}, duracion=${duracionFloat}s`);

        res.json({
            exito: true,
            grabacion: {
                id: nuevaGrab.id,
                alias: nuevaGrab.alias,
                comando: nuevaGrab.comando,
                url_audio: nuevaGrab.url_audio,
                nombre_archivo: nuevaGrab.nombre_archivo,
                tasa_hz: nuevaGrab.tasa_hz,
                duracion_s: nuevaGrab.duracion_s,
                valido: nuevaGrab.valido,
                created_at: nuevaGrab.created_at
            }
        });
    } catch (err) {
        console.error('[ERROR /api/grabar]', err.message);
        res.status(500).json({ error: 'Error al procesar y guardar la grabación: ' + err.message });
    }
});

/**
 * GET /api/mis-audios?alias=Hablante_A
 * Retorna las grabaciones del participante actual.
 */
app.get('/api/mis-audios', async (req, res) => {
    try {
        const { alias, codigoDispositivo = '' } = req.query;
        if (!alias) {
            return res.status(400).json({ error: 'El parámetro alias es obligatorio.' });
        }

        const aliasSanitizado = alias.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

        const esPropietario = await verificarPropietarioAlias(aliasSanitizado, codigoDispositivo);
        if (!esPropietario) {
            return res.status(403).json({ error: `El alias "${aliasSanitizado}" pertenece a otro participante.` });
        }

        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('grabaciones')
                    .select('id, alias, comando, url_audio, nombre_archivo, tasa_hz, duracion_s, valido, created_at')
                    .eq('alias', aliasSanitizado)
                    .order('created_at', { ascending: false });

                if (!error && data) {
                    return res.json({ grabaciones: data });
                }
            } catch (errSup) {
                console.warn('[WARN /api/mis-audios fallback a memoria]', errSup.message);
            }
        }

        const misGrab = memoriaGrabaciones.filter(g => g.alias === aliasSanitizado);
        res.json({ grabaciones: misGrab });
    } catch (err) {
        console.error('[ERROR /api/mis-audios]', err.message);
        res.status(500).json({ error: 'Error al obtener grabaciones del participante.' });
    }
});

// ---------------------------------------------------------------------------
// RUTAS DE ADMINISTRACIÓN (Protegidas por verificarAdmin)
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/verificar
 * Valida un token de administrador e identifica si es Super Admin.
 */
app.post('/api/admin/verificar', (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ valido: false, error: 'Token no proporcionado.' });
    }

    const index = ADMIN_TOKENS.indexOf(token.trim());
    if (index !== -1) {
        const esSuperAdmin = index === 0;
        res.json({
            valido: true,
            esSuperAdmin,
            tokenIndex: index + 1
        });
    } else {
        res.status(401).json({ valido: false, error: 'Token de administrador inválido.' });
    }
});

/**
 * GET /api/admin/admins
 * Retorna la lista de administradores configurados con tokens enmascarados.
 */
app.get('/api/admin/admins', verificarAdmin, (req, res) => {
    const currentToken = req.adminToken;
    const listaAdmins = ADMIN_TOKENS.map((tok, index) => {
        const esSuperAdmin = index === 0;
        const esActual = tok === currentToken;
        const visibleChars = Math.min(3, Math.floor(tok.length / 3));
        const prefijo = tok.substring(0, visibleChars);
        const sufijo = tok.substring(tok.length - Math.min(2, visibleChars));
        const masked = `${prefijo}${'*'.repeat(Math.max(4, tok.length - prefijo.length - sufijo.length))}${sufijo}`;

        return {
            id: index + 1,
            mascara: masked,
            rol: esSuperAdmin ? 'Super Administrador' : 'Administrador',
            esSuperAdmin,
            esActual
        };
    });

    res.json({
        admins: listaAdmins,
        total: listaAdmins.length,
        requiereSuperAdmin: req.esSuperAdmin
    });
});

/**
 * GET /api/admin/stats
 * Estadísticas completas y agregadas para el Dashboard.
 */
app.get('/api/admin/stats', verificarAdmin, async (req, res) => {
    try {
        let todasGrabaciones = [];
        let comandosActivos = [];

        if (supabase) {
            try {
                const { data: grabsData, error: errGrabs } = await supabase
                    .from('grabaciones')
                    .select('id, alias, comando, valido, duracion_s, created_at')
                    .order('created_at', { ascending: false });

                const { data: cmdsData, error: errCmds } = await supabase
                    .from('comandos')
                    .select('id, nombre, orden, limite_bloque, activo')
                    .order('orden', { ascending: true });

                if (errGrabs) {
                    console.error('[Supabase Error en grabaciones /stats]:', errGrabs.message);
                } else if (grabsData) {
                    todasGrabaciones = grabsData;
                }

                if (errCmds) {
                    console.error('[Supabase Error en comandos /stats]:', errCmds.message);
                } else if (cmdsData) {
                    comandosActivos = cmdsData;
                }
            } catch (errSup) {
                console.warn('[WARN /api/admin/stats fallback a memoria]', errSup.message);
                todasGrabaciones = memoriaGrabaciones;
                comandosActivos = memoriaComandos;
            }
        } else {
            todasGrabaciones = memoriaGrabaciones;
            comandosActivos = memoriaComandos;
        }

        const totalGrabaciones = todasGrabaciones.length;
        const participantesUnicos = [...new Set(todasGrabaciones.map(g => g.alias))].filter(Boolean);

        let validados = 0;
        let rechazados = 0;
        let sinRevisar = 0;
        let duracionTotalSegundos = 0;

        const grabacionesPorComando = {};
        const grabacionesPorParticipante = {};
        const validadosPorComando = {};
        const rechazadosPorComando = {};
        const sinRevisarPorComando = {};

        todasGrabaciones.forEach(g => {
            const esValido = g.valido === true || g.valido === 'true' || g.valido === 't';
            const esRechazado = g.valido === false || g.valido === 'false' || g.valido === 'f';

            if (esValido) {
                validados++;
                validadosPorComando[g.comando] = (validadosPorComando[g.comando] || 0) + 1;
            } else if (esRechazado) {
                rechazados++;
                rechazadosPorComando[g.comando] = (rechazadosPorComando[g.comando] || 0) + 1;
            } else {
                sinRevisar++;
                sinRevisarPorComando[g.comando] = (sinRevisarPorComando[g.comando] || 0) + 1;
            }

            if (g.duracion_s) duracionTotalSegundos += parseFloat(g.duracion_s);

            grabacionesPorComando[g.comando] = (grabacionesPorComando[g.comando] || 0) + 1;
            grabacionesPorParticipante[g.alias] = (grabacionesPorParticipante[g.alias] || 0) + 1;
        });

        const totalRevisados = validados + rechazados;
        const tasaAprobacion = totalRevisados > 0 ? Math.round((validados / totalRevisados) * 100) : 0;
        const promedioPorParticipante = participantesUnicos.length > 0
            ? (totalGrabaciones / participantesUnicos.length).toFixed(1)
            : 0;

        res.json({
            totalGrabaciones,
            totalParticipantes: participantesUnicos.length,
            participantes: participantesUnicos,
            validados,
            rechazados,
            sinRevisar,
            tasaAprobacion,
            duracionTotalSegundos: Math.round(duracionTotalSegundos),
            promedioPorParticipante: Number(promedioPorParticipante),
            grabacionesPorComando,
            grabacionesPorParticipante,
            validadosPorComando,
            rechazadosPorComando,
            sinRevisarPorComando,
            comandosActivos: comandosActivos.filter(c => c.activo !== false).map(c => c.nombre)
        });
    } catch (err) {
        console.error('[ERROR /api/admin/stats]', err.message);
        res.status(500).json({ error: 'Error al calcular estadísticas del sistema.' });
    }
});

/**
 * GET /api/admin/anuncio
 * Retorna el estado actual del mensaje/anuncio para los participantes.
 */
app.get('/api/admin/anuncio', verificarAdmin, async (req, res) => {
    try {
        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('anuncios')
                    .select('id, mensaje, tipo, activo, updated_at')
                    .order('updated_at', { ascending: false })
                    .limit(1)
                    .single();
                if (!error && data) {
                    return res.json({ anuncio: data });
                }
            } catch (errSup) {}
        }
        res.json({ anuncio: memoriaAnuncio });
    } catch (err) {
        res.json({ anuncio: memoriaAnuncio });
    }
});

/**
 * PUT /api/admin/anuncio
 * Actualiza el mensaje o anuncio publicado para todos los hablantes.
 */
app.put('/api/admin/anuncio', verificarAdmin, async (req, res) => {
    try {
        const { mensaje = '', tipo = 'info', activo = false } = req.body;
        const anuncioObj = {
            mensaje: (mensaje || '').trim(),
            tipo: ['info', 'importante', 'exito'].includes(tipo) ? tipo : 'info',
            activo: Boolean(activo),
            updated_at: new Date().toISOString()
        };

        if (supabase) {
            try {
                // Patrón singleton: reutilizar el id de la fila existente para no acumular
                // una fila nueva en cada actualización del anuncio.
                const { data: existente } = await supabase
                    .from('anuncios')
                    .select('id')
                    .order('updated_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const payloadAnuncio = existente ? { id: existente.id, ...anuncioObj } : anuncioObj;

                const { data, error } = await supabase
                    .from('anuncios')
                    .upsert(payloadAnuncio)
                    .select()
                    .single();
                if (!error && data) {
                    memoriaAnuncio = data;
                    return res.json({ exito: true, anuncio: data });
                }
            } catch (errSup) {
                console.warn('[WARN PUT /api/admin/anuncio fallback]', errSup.message);
            }
        }

        memoriaAnuncio = { ...memoriaAnuncio, ...anuncioObj };
        res.json({ exito: true, anuncio: memoriaAnuncio });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar anuncio: ' + err.message });
    }
});

/**
 * GET /api/admin/hablantes
 * Retorna la lista agregada de todos los participantes (hablantes) con perfiles y estadísticas desglosadas.
 */
app.get('/api/admin/hablantes', verificarAdmin, async (req, res) => {
    try {
        let todasGrabaciones = [];
        let comandosLista = [];
        let perfilesMap = new Map();

        if (supabase) {
            try {
                const { data: grabsData, error: errGrabs } = await supabase
                    .from('grabaciones')
                    .select('id, alias, comando, valido, duracion_s, created_at')
                    .order('created_at', { ascending: false });

                const { data: cmdsData, error: errCmds } = await supabase
                    .from('comandos')
                    .select('id, nombre, orden, limite_bloque, activo')
                    .eq('activo', true)
                    .order('orden', { ascending: true });

                const { data: perfsData } = await supabase
                    .from('hablantes_perfil')
                    .select('alias, nombres_apellidos, contacto, notas, created_at, updated_at');

                if (!errGrabs && grabsData) todasGrabaciones = grabsData;
                if (!errCmds && cmdsData) comandosLista = cmdsData;
                if (perfsData) {
                    perfsData.forEach(p => perfilesMap.set(p.alias, p));
                }
            } catch (errSup) {
                console.warn('[WARN /api/admin/hablantes fallback]', errSup.message);
                todasGrabaciones = memoriaGrabaciones;
                comandosLista = memoriaComandos.filter(c => c.activo);
                perfilesMap = memoriaPerfilesHablantes;
            }
        } else {
            todasGrabaciones = memoriaGrabaciones;
            comandosLista = memoriaComandos.filter(c => c.activo);
            perfilesMap = memoriaPerfilesHablantes;
        }

        // Metas de comandos
        const metaGlobal = configGrabacion.meta_por_comando || 40;
        const metasPorComando = {};
        let metaTotalGeneral = 0;

        comandosLista.forEach(c => {
            const m = c.limite_bloque || metaGlobal;
            metasPorComando[c.nombre] = m;
            metaTotalGeneral += m;
        });

        if (metaTotalGeneral === 0) metaTotalGeneral = Math.max(1, comandosLista.length * metaGlobal);

        // Agrupar por participante (alias)
        const hablantesMap = new Map();

        todasGrabaciones.forEach(g => {
            const alias = g.alias || 'Anonimo';
            if (!hablantesMap.has(alias)) {
                hablantesMap.set(alias, {
                    alias,
                    totalGrabaciones: 0,
                    validados: 0,
                    rechazados: 0,
                    sinRevisar: 0,
                    duracionTotalSegundos: 0,
                    comandosGrabados: {},
                    ultimaGrabacion: g.created_at
                });
            }

            const h = hablantesMap.get(alias);
            h.totalGrabaciones++;

            const esValido = g.valido === true || g.valido === 'true' || g.valido === 't';
            const esRechazado = g.valido === false || g.valido === 'false' || g.valido === 'f';

            if (esValido) h.validados++;
            else if (esRechazado) h.rechazados++;
            else h.sinRevisar++;

            if (g.duracion_s) h.duracionTotalSegundos += parseFloat(g.duracion_s);

            if (!h.comandosGrabados[g.comando]) {
                h.comandosGrabados[g.comando] = { total: 0, validados: 0, rechazados: 0, sinRevisar: 0 };
            }
            h.comandosGrabados[g.comando].total++;
            if (esValido) h.comandosGrabados[g.comando].validados++;
            else if (esRechazado) h.comandosGrabados[g.comando].rechazados++;
            else h.comandosGrabados[g.comando].sinRevisar++;

            if (new Date(g.created_at) > new Date(h.ultimaGrabacion)) {
                h.ultimaGrabacion = g.created_at;
            }
        });

        const listaHablantes = Array.from(hablantesMap.values()).map(h => {
            const comandosCubiertos = Object.keys(h.comandosGrabados).length;
            let sumaEfectiva = 0;

            Object.entries(h.comandosGrabados).forEach(([cmd, counts]) => {
                const target = metasPorComando[cmd] || metaGlobal;
                sumaEfectiva += Math.min(target, counts.total);
            });

            const porcentajeCompletitud = metaTotalGeneral > 0
                ? Math.min(100, Math.round((sumaEfectiva / metaTotalGeneral) * 100))
                : 0;

            const perfilHablante = perfilesMap.get(h.alias) || {
                nombres_apellidos: '',
                contacto: '',
                notas: ''
            };

            return {
                ...h,
                perfil: perfilHablante,
                duracionTotalSegundos: Math.round(h.duracionTotalSegundos),
                comandosCubiertos,
                totalComandosActivos: comandosLista.length,
                porcentajeCompletitud
            };
        });

        // Ordenar por total de grabaciones descendente por defecto
        listaHablantes.sort((a, b) => b.totalGrabaciones - a.totalGrabaciones);

        res.json({
            hablantes: listaHablantes,
            totalHablantes: listaHablantes.length,
            comandos: comandosLista.map(c => ({
                id: c.id,
                nombre: c.nombre,
                limite_bloque: c.limite_bloque || metaGlobal
            }))
        });
    } catch (err) {
        console.error('[ERROR /api/admin/hablantes]', err.message);
        res.status(500).json({ error: 'Error al obtener resumen de hablantes: ' + err.message });
    }
});

/**
 * GET /api/admin/hablantes/:alias
 * Retorna todos los audios y perfil de un hablante específico agrupados por comandos.
 */
app.get('/api/admin/hablantes/:alias', verificarAdmin, async (req, res) => {
    try {
        const { alias } = req.params;
        const aliasSanitizado = alias.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

        let grabaciones = [];
        let comandosLista = [];
        let perfil = null;

        if (supabase) {
            try {
                const { data: dataGrabs, error: errGrabs } = await supabase
                    .from('grabaciones')
                    .select('id, alias, comando, url_audio, ruta_storage, nombre_archivo, tasa_hz, duracion_s, valido, created_at')
                    .eq('alias', aliasSanitizado)
                    .order('created_at', { ascending: false });

                const { data: dataCmds, error: errCmds } = await supabase
                    .from('comandos')
                    .select('id, nombre, descripcion, orden, limite_bloque, activo')
                    .order('orden', { ascending: true });

                const { data: dataPerf } = await supabase
                    .from('hablantes_perfil')
                    .select('alias, nombres_apellidos, contacto, notas, created_at, updated_at')
                    .eq('alias', aliasSanitizado)
                    .single();

                if (!errGrabs && dataGrabs) grabaciones = dataGrabs;
                if (!errCmds && dataCmds) comandosLista = dataCmds;
                if (dataPerf) perfil = dataPerf;
            } catch (errSup) {
                console.warn('[WARN /api/admin/hablantes/:alias fallback]', errSup.message);
                grabaciones = memoriaGrabaciones.filter(g => g.alias === aliasSanitizado);
                comandosLista = memoriaComandos;
                perfil = memoriaPerfilesHablantes.get(aliasSanitizado);
            }
        } else {
            grabaciones = memoriaGrabaciones.filter(g => g.alias === aliasSanitizado);
            comandosLista = memoriaComandos;
            perfil = memoriaPerfilesHablantes.get(aliasSanitizado);
        }

        if (!perfil) {
            perfil = {
                alias: aliasSanitizado,
                nombres_apellidos: '',
                contacto: '',
                notas: '',
                created_at: grabaciones[0]?.created_at || new Date().toISOString()
            };
        }

        const metaGlobal = configGrabacion.meta_por_comando || 40;
        const grabacionesPorComando = {};

        // Inicializar estructura para todos los comandos
        comandosLista.forEach(c => {
            grabacionesPorComando[c.nombre] = {
                comando: c.nombre,
                descripcion: c.descripcion,
                orden: c.orden,
                activo: c.activo,
                limite_bloque: c.limite_bloque || metaGlobal,
                total: 0,
                validados: 0,
                rechazados: 0,
                sinRevisar: 0,
                audios: []
            };
        });

        let totalValidados = 0;
        let totalRechazados = 0;
        let totalSinRevisar = 0;
        let duracionTotalSegundos = 0;
        const comandosGrabadosResumen = {};

        grabaciones.forEach(g => {
            const esValido = g.valido === true || g.valido === 'true' || g.valido === 't';
            const esRechazado = g.valido === false || g.valido === 'false' || g.valido === 'f';

            if (esValido) totalValidados++;
            else if (esRechazado) totalRechazados++;
            else totalSinRevisar++;

            if (g.duracion_s) duracionTotalSegundos += parseFloat(g.duracion_s);

            if (!grabacionesPorComando[g.comando]) {
                grabacionesPorComando[g.comando] = {
                    comando: g.comando,
                    descripcion: '',
                    orden: 99,
                    activo: true,
                    limite_bloque: metaGlobal,
                    total: 0,
                    validados: 0,
                    rechazados: 0,
                    sinRevisar: 0,
                    audios: []
                };
            }

            const grupo = grabacionesPorComando[g.comando];
            grupo.total++;
            if (esValido) grupo.validados++;
            else if (esRechazado) grupo.rechazados++;
            else grupo.sinRevisar++;

            grupo.audios.push(g);

            if (!comandosGrabadosResumen[g.comando]) {
                comandosGrabadosResumen[g.comando] = { total: 0, validados: 0, rechazados: 0, sinRevisar: 0 };
            }
            comandosGrabadosResumen[g.comando].total++;
            if (esValido) comandosGrabadosResumen[g.comando].validados++;
            else if (esRechazado) comandosGrabadosResumen[g.comando].rechazados++;
            else comandosGrabadosResumen[g.comando].sinRevisar++;
        });

        const estadisticas = {
            total: grabaciones.length,
            validados: totalValidados,
            rechazados: totalRechazados,
            sinRevisar: totalSinRevisar,
            duracionTotalSegundos: Math.round(duracionTotalSegundos),
            comandosGrabados: comandosGrabadosResumen,
            tasaAprobacion: (totalValidados + totalRechazados) > 0
                ? Math.round((totalValidados / (totalValidados + totalRechazados)) * 100)
                : 0
        };

        const infoTxt = generarTextoInfoHablante(aliasSanitizado, perfil, estadisticas);

        res.json({
            alias: aliasSanitizado,
            perfil,
            infoTxt,
            estadisticas,
            grabacionesPorComando,
            comandos: comandosLista
        });
    } catch (err) {
        console.error('[ERROR /api/admin/hablantes/:alias]', err.message);
        res.status(500).json({ error: 'Error al obtener detalle del hablante: ' + err.message });
    }
});

/**
 * GET /api/admin/hablantes/:alias/info-txt
 * Descarga o visualiza la ficha de información del hablante en formato TXT.
 */
app.get('/api/admin/hablantes/:alias/info-txt', verificarAdmin, async (req, res) => {
    try {
        const { alias } = req.params;
        const aliasSanitizado = alias.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

        let perfil = null;
        let grabaciones = [];

        if (supabase) {
            try {
                const { data: dataPerf } = await supabase
                    .from('hablantes_perfil')
                    .select('*')
                    .eq('alias', aliasSanitizado)
                    .single();
                const { data: dataGrabs } = await supabase
                    .from('grabaciones')
                    .select('comando, valido, duracion_s')
                    .eq('alias', aliasSanitizado);
                if (dataPerf) perfil = dataPerf;
                if (dataGrabs) grabaciones = dataGrabs;
            } catch (e) {}
        }

        if (!perfil) perfil = memoriaPerfilesHablantes.get(aliasSanitizado) || { alias: aliasSanitizado };
        if (grabaciones.length === 0) grabaciones = memoriaGrabaciones.filter(g => g.alias === aliasSanitizado);

        let validados = 0, rechazados = 0, sinRevisar = 0, duracionTotal = 0;
        const comandosResumen = {};
        grabaciones.forEach(g => {
            const v = g.valido === true || g.valido === 'true' || g.valido === 't';
            const r = g.valido === false || g.valido === 'false' || g.valido === 'f';
            if (v) validados++;
            else if (r) rechazados++;
            else sinRevisar++;
            if (g.duracion_s) duracionTotal += parseFloat(g.duracion_s);

            if (!comandosResumen[g.comando]) comandosResumen[g.comando] = { total: 0, validados: 0, rechazados: 0, sinRevisar: 0 };
            comandosResumen[g.comando].total++;
            if (v) comandosResumen[g.comando].validados++;
            else if (r) comandosResumen[g.comando].rechazados++;
            else comandosResumen[g.comando].sinRevisar++;
        });

        const txt = generarTextoInfoHablante(aliasSanitizado, perfil, {
            total: grabaciones.length,
            validados,
            rechazados,
            sinRevisar,
            duracionTotalSegundos: Math.round(duracionTotal),
            comandosGrabados: comandosResumen
        });

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="info_${aliasSanitizado}.txt"`);
        res.send(txt);
    } catch (err) {
        res.status(500).send('Error al generar archivo de texto: ' + err.message);
    }
});

/**
 * GET /api/admin/audios
 * Listado filtrado y paginado de grabaciones recolectadas.
 */
app.get('/api/admin/audios', verificarAdmin, async (req, res) => {
    try {
        const {
            alias,
            comando,
            valido,
            busqueda,
            limite = 100,
            pagina = 0,
            ordenarPor = 'fecha_desc'
        } = req.query;

        const numLimite = Math.min(500, Math.max(1, parseInt(limite) || 100));
        const numPagina = Math.max(0, parseInt(pagina) || 0);

        if (supabase) {
            try {
                let consulta = supabase
                    .from('grabaciones')
                    .select('id, alias, comando, url_audio, ruta_storage, nombre_archivo, tasa_hz, duracion_s, valido, created_at', { count: 'exact' });

                if (alias) consulta = consulta.ilike('alias', `%${alias}%`);
                if (comando) consulta = consulta.eq('comando', comando);
                if (valido === 'true') consulta = consulta.eq('valido', true);
                if (valido === 'false') consulta = consulta.eq('valido', false);
                if (valido === 'null') consulta = consulta.is('valido', null);
                if (busqueda) {
                    consulta = consulta.or(`alias.ilike.%${busqueda}%,comando.ilike.%${busqueda}%`);
                }

                // Criterios de ordenamiento ampliados
                if (ordenarPor === 'fecha_asc') {
                    consulta = consulta.order('created_at', { ascending: true });
                } else if (ordenarPor === 'duracion_desc') {
                    consulta = consulta.order('duracion_s', { ascending: false });
                } else if (ordenarPor === 'duracion_asc') {
                    consulta = consulta.order('duracion_s', { ascending: true });
                } else if (ordenarPor === 'alias_asc') {
                    consulta = consulta.order('alias', { ascending: true }).order('created_at', { ascending: false });
                } else if (ordenarPor === 'alias_desc') {
                    consulta = consulta.order('alias', { ascending: false }).order('created_at', { ascending: false });
                } else if (ordenarPor === 'comando_asc') {
                    consulta = consulta.order('comando', { ascending: true }).order('created_at', { ascending: false });
                } else if (ordenarPor === 'comando_desc') {
                    consulta = consulta.order('comando', { ascending: false }).order('created_at', { ascending: false });
                } else {
                    consulta = consulta.order('created_at', { ascending: false });
                }

                consulta = consulta.range(numPagina * numLimite, (numPagina + 1) * numLimite - 1);

                const { data, error, count } = await consulta;
                if (!error && data) {
                    return res.json({ grabaciones: data, total: count ?? data.length });
                } else if (error) {
                    console.error('[Supabase error /api/admin/audios]:', error.message);
                }
            } catch (errSup) {
                console.warn('[WARN /api/admin/audios fallback a memoria]', errSup.message);
            }
        }

        // Fallback en Memoria
        let resultado = [...memoriaGrabaciones];

        if (alias) resultado = resultado.filter(g => g.alias.toLowerCase().includes(alias.toLowerCase()));
        if (comando) resultado = resultado.filter(g => g.comando === comando);
        if (valido === 'true') resultado = resultado.filter(g => g.valido === true);
        if (valido === 'false') resultado = resultado.filter(g => g.valido === false);
        if (valido === 'null') resultado = resultado.filter(g => g.valido === null);
        if (busqueda) {
            const b = busqueda.toLowerCase();
            resultado = resultado.filter(g => g.alias.toLowerCase().includes(b) || g.comando.toLowerCase().includes(b));
        }

        // Orden en memoria
        if (ordenarPor === 'fecha_asc') {
            resultado.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        } else if (ordenarPor === 'duracion_desc') {
            resultado.sort((a, b) => (b.duracion_s || 0) - (a.duracion_s || 0));
        } else if (ordenarPor === 'duracion_asc') {
            resultado.sort((a, b) => (a.duracion_s || 0) - (b.duracion_s || 0));
        } else if (ordenarPor === 'alias_asc') {
            resultado.sort((a, b) => a.alias.localeCompare(b.alias));
        } else if (ordenarPor === 'alias_desc') {
            resultado.sort((a, b) => b.alias.localeCompare(a.alias));
        } else if (ordenarPor === 'comando_asc') {
            resultado.sort((a, b) => a.comando.localeCompare(b.comando));
        } else if (ordenarPor === 'comando_desc') {
            resultado.sort((a, b) => b.comando.localeCompare(a.comando));
        } else {
            resultado.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }

        const total = resultado.length;
        const paginado = resultado.slice(numPagina * numLimite, (numPagina + 1) * numLimite);

        res.json({ grabaciones: paginado, total });
    } catch (err) {
        console.error('[ERROR /api/admin/audios]', err.message);
        res.status(500).json({ error: 'Error al obtener lista de grabaciones.' });
    }
});

/**
 * PUT /api/admin/grabaciones/:id/validar
 * Modifica el estado de validación de una grabación individual.
 */
app.put('/api/admin/grabaciones/:id/validar', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { valido } = req.body;

        let nuevoValido = null;
        if (valido === true || valido === 'true') nuevoValido = true;
        else if (valido === false || valido === 'false') nuevoValido = false;

        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('grabaciones')
                    .update({ valido: nuevoValido })
                    .eq('id', id)
                    .select()
                    .single();

                if (!error && data) {
                    return res.json({ grabacion: data });
                }
            } catch (errSup) {
                console.warn('[WARN PUT validar fallback]', errSup.message);
            }
        }

        const idx = memoriaGrabaciones.findIndex(g => g.id === id);
        if (idx !== -1) {
            memoriaGrabaciones[idx].valido = nuevoValido;
            return res.json({ grabacion: memoriaGrabaciones[idx] });
        }

        res.status(404).json({ error: 'Grabación no encontrada.' });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar estado de la grabación: ' + err.message });
    }
});

/**
 * PUT /api/admin/grabaciones/lote-validar
 * Valida, rechaza o desmarca un conjunto de grabaciones en lote.
 */
app.put('/api/admin/grabaciones/lote-validar', verificarAdmin, async (req, res) => {
    try {
        const { ids, valido } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Se requiere un arreglo de IDs no vacío.' });
        }

        let nuevoValido = null;
        if (valido === true || valido === 'true') nuevoValido = true;
        else if (valido === false || valido === 'false') nuevoValido = false;

        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('grabaciones')
                    .update({ valido: nuevoValido })
                    .in('id', ids)
                    .select('id, valido');

                if (!error) {
                    return res.json({ exito: true, actualizados: data ? data.length : ids.length });
                }
            } catch (errSup) {
                console.warn('[WARN PUT /lote-validar fallback]', errSup.message);
            }
        }

        let actualizados = 0;
        memoriaGrabaciones.forEach(g => {
            if (ids.includes(g.id)) {
                g.valido = nuevoValido;
                actualizados++;
            }
        });

        res.json({ exito: true, actualizados });
    } catch (err) {
        console.error('[ERROR /api/admin/grabaciones/lote-validar]', err.message);
        res.status(500).json({ error: 'Error al procesar validación en lote: ' + err.message });
    }
});

/**
 * DELETE /api/admin/grabaciones
 * Eliminación en lote de grabaciones (Storage + BD).
 */
app.delete('/api/admin/grabaciones', verificarAdmin, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Se requiere un arreglo de IDs no vacío.' });
        }

        if (supabase) {
            try {
                const { data: grabs } = await supabase
                    .from('grabaciones')
                    .select('ruta_storage')
                    .in('id', ids);

                if (grabs && grabs.length > 0) {
                    const rutas = grabs.map(g => g.ruta_storage).filter(r => r);
                    if (rutas.length > 0) {
                        await supabase.storage.from(BUCKET).remove(rutas);
                    }
                    await supabase.from('grabaciones').delete().in('id', ids);
                    return res.json({ exito: true, eliminados: ids.length });
                }
            } catch (errSup) {
                console.warn('[WARN DELETE bulk grabaciones fallback]', errSup.message);
            }
        }

        const lenInicial = memoriaGrabaciones.length;
        memoriaGrabaciones = memoriaGrabaciones.filter(g => !ids.includes(g.id));
        res.json({ exito: true, eliminados: lenInicial - memoriaGrabaciones.length });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar grabaciones en lote: ' + err.message });
    }
});

/**
 * DELETE /api/admin/grabaciones/:id
 * Eliminación individual de una grabación.
 */
app.delete('/api/admin/grabaciones/:id', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        if (supabase) {
            try {
                const { data: grab } = await supabase
                    .from('grabaciones')
                    .select('ruta_storage')
                    .eq('id', id)
                    .single();

                if (grab) {
                    if (grab.ruta_storage) {
                        await supabase.storage.from(BUCKET).remove([grab.ruta_storage]);
                    }
                    await supabase.from('grabaciones').delete().eq('id', id);
                    return res.json({ exito: true });
                }
            } catch (errSup) {
                console.warn('[WARN DELETE single grabacion fallback]', errSup.message);
            }
        }

        memoriaGrabaciones = memoriaGrabaciones.filter(g => g.id !== id);
        res.json({ exito: true });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar grabación: ' + err.message });
    }
});

// ---------------------------------------------------------------------------
// GESTIÓN DE COMANDOS (Admin)
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/comandos
 * Retorna todos los comandos enriquecidos con métricas de grabaciones asociadas y límite de bloque.
 */
app.get('/api/admin/comandos', verificarAdmin, async (req, res) => {
    try {
        let listaComandos = [];
        let conteoGrabs = {};
        let conteoValidos = {};
        const metaGlobal = configGrabacion.meta_por_comando || 40;

        if (supabase) {
            try {
                const { data: cmds, error } = await supabase
                    .from('comandos')
                    .select('*')
                    .order('orden', { ascending: true });

                const { data: grabs } = await supabase
                    .from('grabaciones')
                    .select('comando, valido');

                if (!error && cmds) {
                    listaComandos = cmds;
                    if (grabs) {
                        grabs.forEach(g => {
                            conteoGrabs[g.comando] = (conteoGrabs[g.comando] || 0) + 1;
                            const esValido = g.valido === true || g.valido === 'true' || g.valido === 't';
                            if (esValido) {
                                conteoValidos[g.comando] = (conteoValidos[g.comando] || 0) + 1;
                            }
                        });
                    }
                }
            } catch (errSup) {
                console.warn('[WARN /api/admin/comandos fallback]', errSup.message);
                listaComandos = memoriaComandos;
            }
        } else {
            listaComandos = memoriaComandos;
            memoriaGrabaciones.forEach(g => {
                conteoGrabs[g.comando] = (conteoGrabs[g.comando] || 0) + 1;
                const esValido = g.valido === true || g.valido === 'true' || g.valido === 't';
                if (esValido) {
                    conteoValidos[g.comando] = (conteoValidos[g.comando] || 0) + 1;
                }
            });
        }

        const enriquecidos = listaComandos.map(cmd => ({
            ...cmd,
            limite_bloque: cmd.limite_bloque || metaGlobal,
            totalMuestras: conteoGrabs[cmd.nombre] || 0,
            validadas: conteoValidos[cmd.nombre] || 0
        }));

        res.json({ comandos: enriquecidos });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener comandos: ' + err.message });
    }
});

/**
 * POST /api/admin/comandos
 * Crear un comando individual con su límite de bloque definido.
 */
app.post('/api/admin/comandos', verificarAdmin, async (req, res) => {
    try {
        const { nombre, descripcion, activo, orden, limite_bloque } = req.body;
        if (!nombre || !nombre.trim()) {
            return res.status(400).json({ error: 'El nombre del comando es obligatorio.' });
        }

        const nombreLimpio = nombre.trim();
        const ordenNum = parseInt(orden) || 1;
        const limiteBloqueNum = Math.max(1, parseInt(limite_bloque) || configGrabacion.meta_por_comando || 40);

        if (supabase) {
            try {
                // Intentar insertar con limite_bloque
                let payload = {
                    nombre: nombreLimpio,
                    descripcion: descripcion ? descripcion.trim() : '',
                    activo: activo !== false,
                    orden: ordenNum,
                    limite_bloque: limiteBloqueNum
                };

                let { data, error } = await supabase
                    .from('comandos')
                    .insert(payload)
                    .select()
                    .single();

                if (error && error.code === '23505') {
                    return res.status(409).json({ error: `Ya existe un comando registrado con el nombre "${nombreLimpio}".` });
                } else if (error && error.message && error.message.includes('limite_bloque')) {
                    // Si la columna aun no existe en Supabase, reintentar sin ella
                    delete payload.limite_bloque;
                    const resRetry = await supabase.from('comandos').insert(payload).select().single();
                    if (!resRetry.error && resRetry.data) {
                        return res.status(201).json({ comando: { ...resRetry.data, limite_bloque: limiteBloqueNum } });
                    }
                }

                if (!error && data) {
                    return res.status(201).json({ comando: { ...data, limite_bloque: limiteBloqueNum } });
                }
            } catch (errSup) {
                console.warn('[WARN POST /api/admin/comandos fallback]', errSup.message);
            }
        }

        // Fallback memoria
        const yaExiste = memoriaComandos.some(c => c.nombre.toLowerCase() === nombreLimpio.toLowerCase());
        if (yaExiste) {
            return res.status(409).json({ error: `Ya existe un comando con el nombre "${nombreLimpio}".` });
        }

        const nuevoCmd = {
            id: String(Date.now()),
            nombre: nombreLimpio,
            descripcion: descripcion ? descripcion.trim() : `Pronuncia la palabra "${nombreLimpio}" con voz clara y tono natural.`,
            activo: activo !== false,
            orden: ordenNum,
            limite_bloque: limiteBloqueNum
        };

        memoriaComandos.push(nuevoCmd);
        res.status(201).json({ comando: nuevoCmd });
    } catch (err) {
        res.status(500).json({ error: 'Error al crear comando: ' + err.message });
    }
});

/**
 * POST /api/admin/comandos/lote
 * Inserción masiva de comandos por bloque con límite de audios por bloque configurable.
 */
app.post('/api/admin/comandos/lote', verificarAdmin, async (req, res) => {
    try {
        const { comandos, limite_bloque: limiteBloqueGlobal } = req.body;
        if (!comandos || !Array.isArray(comandos) || comandos.length === 0) {
            return res.status(400).json({ error: 'Se requiere un arreglo de comandos no vacío.' });
        }

        const metaDefecto = Math.max(1, parseInt(limiteBloqueGlobal) || configGrabacion.meta_por_comando || 40);

        // Sanitización y preparación de la lista
        const comandosParaInsertar = comandos.map((c, i) => ({
            nombre: c.nombre.trim(),
            descripcion: c.descripcion ? c.descripcion.trim() : `Pronuncia la palabra "${c.nombre.trim()}" con voz clara y tono natural.`,
            activo: c.activo !== false,
            orden: parseInt(c.orden) || (i + 1),
            limite_bloque: Math.max(1, parseInt(c.limite_bloque) || metaDefecto)
        })).filter(c => c.nombre.length > 0);

        if (comandosParaInsertar.length === 0) {
            return res.status(400).json({ error: 'Ningún comando contiene un nombre válido.' });
        }

        if (supabase) {
            try {
                // Inserción en una única petición masiva (bulk insert / upsert)
                const { data, error } = await supabase
                    .from('comandos')
                    .upsert(comandosParaInsertar, { onConflict: 'nombre' })
                    .select();

                if (!error && data) {
                    return res.status(201).json({ exito: true, comandos: data, total: data.length });
                } else if (error && error.message && error.message.includes('limite_bloque')) {
                    // Fallback sin la columna si Supabase aún no tiene la migración
                    const sinLimite = comandosParaInsertar.map(({ limite_bloque, ...resto }) => resto);
                    const resRetry = await supabase.from('comandos').upsert(sinLimite, { onConflict: 'nombre' }).select();
                    if (!resRetry.error && resRetry.data) {
                        return res.status(201).json({ exito: true, comandos: resRetry.data, total: resRetry.data.length });
                    }
                }
            } catch (errSup) {
                console.warn('[WARN POST /comandos/lote fallback]', errSup.message);
            }
        }

        // Fallback memoria
        const nuevos = [];
        comandosParaInsertar.forEach(c => {
            const idxExistente = memoriaComandos.findIndex(x => x.nombre.toLowerCase() === c.nombre.toLowerCase());
            if (idxExistente !== -1) {
                memoriaComandos[idxExistente] = { ...memoriaComandos[idxExistente], ...c };
                nuevos.push(memoriaComandos[idxExistente]);
            } else {
                const creado = { id: String(Date.now() + Math.random()), ...c };
                memoriaComandos.push(creado);
                nuevos.push(creado);
            }
        });

        res.status(201).json({ exito: true, comandos: nuevos, total: nuevos.length });
    } catch (err) {
        console.error('[ERROR /api/admin/comandos/lote]', err.message);
        res.status(500).json({ error: 'Error al registrar comandos en lote: ' + err.message });
    }
});

/**
 * PUT /api/admin/comandos/:id
 * Actualizar comando existente incluyendo límite de audios por bloque.
 */
app.put('/api/admin/comandos/:id', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, activo, orden, limite_bloque } = req.body;

        if (supabase) {
            try {
                let payload = {
                    nombre: nombre ? nombre.trim() : undefined,
                    descripcion: descripcion !== undefined ? descripcion.trim() : undefined,
                    activo: activo !== undefined ? activo : undefined,
                    orden: orden !== undefined ? parseInt(orden) : undefined,
                    limite_bloque: limite_bloque !== undefined ? parseInt(limite_bloque) : undefined
                };

                // Limpiar campos undefined
                Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

                let { data, error } = await supabase
                    .from('comandos')
                    .update(payload)
                    .eq('id', id)
                    .select()
                    .single();

                if (error && error.message && error.message.includes('limite_bloque')) {
                    delete payload.limite_bloque;
                    const resRetry = await supabase.from('comandos').update(payload).eq('id', id).select().single();
                    if (!resRetry.error && resRetry.data) {
                        return res.json({ comando: resRetry.data });
                    }
                }

                if (!error && data) {
                    return res.json({ comando: data });
                }
            } catch (errSup) {
                console.warn('[WARN PUT /comandos/:id fallback]', errSup.message);
            }
        }

        const idx = memoriaComandos.findIndex(c => c.id === id);
        if (idx !== -1) {
            memoriaComandos[idx] = {
                ...memoriaComandos[idx],
                nombre: nombre ? nombre.trim() : memoriaComandos[idx].nombre,
                descripcion: descripcion !== undefined ? descripcion.trim() : memoriaComandos[idx].descripcion,
                activo: activo !== undefined ? activo : memoriaComandos[idx].activo,
                orden: orden !== undefined ? parseInt(orden) : memoriaComandos[idx].orden,
                limite_bloque: limite_bloque !== undefined ? parseInt(limite_bloque) : (memoriaComandos[idx].limite_bloque || 40)
            };
            return res.json({ comando: memoriaComandos[idx] });
        }

        res.status(404).json({ error: 'Comando no encontrado.' });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar comando: ' + err.message });
    }
});

/**
 * PUT /api/admin/comandos/:id/toggle
 * Activar o desactivar rápidamente un comando.
 */
app.put('/api/admin/comandos/:id/toggle', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        if (supabase) {
            try {
                const { data: cmd } = await supabase.from('comandos').select('activo').eq('id', id).single();
                if (cmd) {
                    const nuevoEstado = !cmd.activo;
                    const { data: actualizado } = await supabase
                        .from('comandos')
                        .update({ activo: nuevoEstado })
                        .eq('id', id)
                        .select()
                        .single();
                    return res.json({ exito: true, comando: actualizado });
                }
            } catch (errSup) {
                console.warn('[WARN PUT /toggle fallback]', errSup.message);
            }
        }

        const idx = memoriaComandos.findIndex(c => c.id === id);
        if (idx !== -1) {
            memoriaComandos[idx].activo = !memoriaComandos[idx].activo;
            return res.json({ exito: true, comando: memoriaComandos[idx] });
        }

        res.status(404).json({ error: 'Comando no encontrado.' });
    } catch (err) {
        res.status(500).json({ error: 'Error al cambiar estado del comando: ' + err.message });
    }
});

/**
 * DELETE /api/admin/comandos
 * Eliminación en lote de comandos con comprobación de integridad referencial.
 */
app.delete('/api/admin/comandos', verificarAdmin, async (req, res) => {
    try {
        const { ids, forzar } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Se requiere un arreglo de IDs no vacío.' });
        }

        if (supabase) {
            try {
                const { data: cmds } = await supabase.from('comandos').select('nombre').in('id', ids);
                if (cmds && cmds.length > 0 && !forzar) {
                    const nombres = cmds.map(c => c.nombre);
                    const { count } = await supabase
                        .from('grabaciones')
                        .select('*', { count: 'exact', head: true })
                        .in('comando', nombres);

                    if (count > 0) {
                        return res.status(409).json({
                            error: `No se pueden eliminar: existen ${count} grabaciones asociadas a estos comandos.`,
                            requiereConfirmacion: true,
                            conteoGrabaciones: count
                        });
                    }
                }

                const { error } = await supabase.from('comandos').delete().in('id', ids);
                if (!error) {
                    return res.json({ exito: true, eliminados: ids.length });
                }
            } catch (errSup) {
                console.warn('[WARN DELETE bulk comandos fallback]', errSup.message);
            }
        }

        const lenInicial = memoriaComandos.length;
        memoriaComandos = memoriaComandos.filter(c => !ids.includes(c.id));
        res.json({ exito: true, eliminados: lenInicial - memoriaComandos.length });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar comandos en lote: ' + err.message });
    }
});

/**
 * DELETE /api/admin/comandos/:id
 * Eliminar un comando individual.
 */
app.delete('/api/admin/comandos/:id', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        if (supabase) {
            try {
                const { data: cmd } = await supabase.from('comandos').select('nombre').eq('id', id).single();
                if (cmd) {
                    const { count } = await supabase
                        .from('grabaciones')
                        .select('*', { count: 'exact', head: true })
                        .eq('comando', cmd.nombre);

                    if (count > 0) {
                        return res.status(409).json({
                            error: `No se puede eliminar "${cmd.nombre}": contiene ${count} grabación(es) asociadas.`
                        });
                    }

                    await supabase.from('comandos').delete().eq('id', id);
                    return res.json({ exito: true });
                }
            } catch (errSup) {
                console.warn('[WARN DELETE /comandos/:id fallback]', errSup.message);
            }
        }

        memoriaComandos = memoriaComandos.filter(c => c.id !== id);
        res.json({ exito: true });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar comando: ' + err.message });
    }
});

// ---------------------------------------------------------------------------
// EXPORTACIÓN & DESCARGA DE CORPUS EN ZIP
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/exportar
 * Exporta metadatos completos en formato CSV o JSON.
 */
app.get('/api/admin/exportar', verificarAdmin, async (req, res) => {
    try {
        const { formato = 'json', valido } = req.query;
        let datos = memoriaGrabaciones;

        if (supabase) {
            try {
                let consulta = supabase
                    .from('grabaciones')
                    .select('id, alias, comando, tasa_hz, duracion_s, valido, created_at, url_audio, nombre_archivo')
                    .order('created_at', { ascending: false });

                if (valido === 'true') consulta = consulta.eq('valido', true);
                if (valido === 'false') consulta = consulta.eq('valido', false);
                if (valido === 'null') consulta = consulta.is('valido', null);

                const { data } = await consulta;
                if (data) datos = data;
            } catch (errSup) {
                console.warn('[WARN exportar fallback]', errSup.message);
            }
        }

        if (formato === 'csv') {
            const encabezado = 'id,alias,comando,tasa_hz,duracion_s,valido,created_at,url_audio';
            const filas = datos.map(g =>
                `"${g.id}","${g.alias}","${g.comando}",${g.tasa_hz || 16000},${g.duracion_s || ''},${g.valido === null ? '' : g.valido},"${g.created_at}","${g.url_audio || ''}"`
            );
            const csv = [encabezado, ...filas].join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="recopilaVoz_corpus_metadatos.csv"');
            res.send(csv);
        } else {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="recopilaVoz_corpus_metadatos.json"');
            res.json({
                corpus: 'RecopilaVoz H7',
                fecha_exportacion: new Date().toISOString(),
                total_registros: datos.length,
                grabaciones: datos
            });
        }
    } catch (err) {
        res.status(500).json({ error: 'Error al exportar metadatos: ' + err.message });
    }
});

/**
 * GET /api/admin/descargar-zip
 * Empaqueta y descarga un archivo ZIP estructurado con audios WAV y metadatos.
 */
app.get('/api/admin/descargar-zip', verificarAdmin, async (req, res) => {
    try {
        const { alias, comando, soloValidos, ids } = req.query;
        let lista = [];

        if (supabase) {
            try {
                let consulta = supabase
                    .from('grabaciones')
                    .select('id, alias, comando, tasa_hz, duracion_s, valido, created_at, ruta_storage, url_audio, nombre_archivo');

                if (ids) {
                    const arrayIds = ids.split(',').map(x => x.trim()).filter(x => x);
                    if (arrayIds.length > 0) consulta = consulta.in('id', arrayIds);
                }
                if (alias) consulta = consulta.ilike('alias', `%${alias}%`);
                if (comando) consulta = consulta.eq('comando', comando);
                if (soloValidos === 'true') consulta = consulta.eq('valido', true);

                const { data } = await consulta;
                if (data) lista = data;
            } catch (errSup) {
                console.warn('[WARN ZIP fallback]', errSup.message);
                lista = memoriaGrabaciones;
            }
        } else {
            lista = [...memoriaGrabaciones];
            if (ids) {
                const arrayIds = ids.split(',');
                lista = lista.filter(g => arrayIds.includes(g.id));
            }
            if (alias) lista = lista.filter(g => g.alias.toLowerCase().includes(alias.toLowerCase()));
            if (comando) lista = lista.filter(g => g.comando === comando);
            if (soloValidos === 'true') lista = lista.filter(g => g.valido === true);
        }

        const nombreZip = `recopilaVoz_corpus_${Date.now()}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreZip}"`);

        const zip = archiver('zip', { zlib: { level: 6 } });
        zip.pipe(res);

        // Nombre de archivo estándar Hablante_toma_comando.wav; con respaldo para
        // grabaciones creadas antes de que existiera la columna nombre_archivo.
        const nombreArchivoDe = (g) => {
            if (g.nombre_archivo) return g.nombre_archivo;
            const comandoSanitizado = (g.comando || '').replace(/[^a-zA-Z0-9_-]/g, '_');
            return `${g.alias}_00_${comandoSanitizado}.wav`;
        };

        // Generar manifiesto JSON interno
        const manifiesto = {
            proyecto: 'RecopilaVoz — Experimento de Separabilidad Espectral H7',
            generado: new Date().toISOString(),
            total_audios: lista.length,
            muestras: lista.map(g => ({
                id: g.id,
                alias: g.alias,
                comando: g.comando,
                duracion_s: g.duracion_s,
                tasa_hz: g.tasa_hz || 16000,
                valido: g.valido,
                archivo_relativo: `${g.alias}/${nombreArchivoDe(g)}`
            }))
        };
        zip.append(JSON.stringify(manifiesto, null, 2), { name: 'manifest.json' });

        // Generar metadata.csv interno
        const csvHeader = 'id,alias,comando,duracion_s,tasa_hz,valido,fecha,ruta_archivo';
        const csvRows = lista.map(g =>
            `"${g.id}","${g.alias}","${g.comando}",${g.duracion_s || ''},${g.tasa_hz || 16000},${g.valido === null ? 'sin_revisar' : (g.valido ? 'valido' : 'rechazado')},"${g.created_at}","${g.alias}/${nombreArchivoDe(g)}"`
        );
        zip.append([csvHeader, ...csvRows].join('\n'), { name: 'metadatos.csv' });

        // Generar y adjuntar archivo info_hablante.txt para cada hablante dentro de su respectiva carpeta
        const aliasUnicos = [...new Set(lista.map(g => g.alias))];
        let perfilesZipMap = new Map();

        if (supabase && aliasUnicos.length > 0) {
            try {
                const { data: perfsData } = await supabase
                    .from('hablantes_perfil')
                    .select('*')
                    .in('alias', aliasUnicos);
                if (perfsData) perfsData.forEach(p => perfilesZipMap.set(p.alias, p));
            } catch (e) {}
        }

        aliasUnicos.forEach(al => {
            const perfil = perfilesZipMap.get(al) || memoriaPerfilesHablantes.get(al) || { alias: al };
            const grabsHablante = lista.filter(g => g.alias === al);

            let val = 0, rech = 0, sinRev = 0, dur = 0;
            const cmdsRes = {};
            grabsHablante.forEach(g => {
                const esVal = g.valido === true || g.valido === 'true' || g.valido === 't';
                const esRech = g.valido === false || g.valido === 'false' || g.valido === 'f';
                if (esVal) val++;
                else if (esRech) rech++;
                else sinRev++;
                if (g.duracion_s) dur += parseFloat(g.duracion_s);

                if (!cmdsRes[g.comando]) cmdsRes[g.comando] = { total: 0, validados: 0, rechazados: 0, sinRevisar: 0 };
                cmdsRes[g.comando].total++;
                if (esVal) cmdsRes[g.comando].validados++;
                else if (esRech) cmdsRes[g.comando].rechazados++;
                else cmdsRes[g.comando].sinRevisar++;
            });

            const infoTxtContent = generarTextoInfoHablante(al, perfil, {
                total: grabsHablante.length,
                validados: val,
                rechazados: rech,
                sinRevisar: sinRev,
                duracionTotalSegundos: Math.round(dur),
                comandosGrabados: cmdsRes
            });

            // Agregar info_hablante.txt dentro de la sección/carpeta del hablante
            zip.append(infoTxtContent, { name: `${al}/info_hablante.txt` });
        });

        // Agregar archivos .wav
        for (const grab of lista) {
            let bufferAudio = grab.buffer;

            if (!bufferAudio && supabase && grab.ruta_storage) {
                try {
                    const { data: urlFirmada } = await supabase.storage
                        .from(BUCKET)
                        .createSignedUrl(grab.ruta_storage, 120);

                    if (urlFirmada?.signedUrl) {
                        const resp = await fetch(urlFirmada.signedUrl);
                        if (resp.ok) {
                            bufferAudio = Buffer.from(await resp.arrayBuffer());
                        }
                    }
                } catch (e) {
                    console.warn(`[WARN] No se pudo descargar audio ${grab.ruta_storage}:`, e.message);
                }
            } else if (!bufferAudio && grab.url_audio && grab.url_audio.startsWith('data:audio')) {
                const base64 = grab.url_audio.split(',')[1];
                bufferAudio = Buffer.from(base64, 'base64');
            }

            if (bufferAudio) {
                const rutaEnZip = `${grab.alias}/${nombreArchivoDe(grab)}`;
                zip.append(bufferAudio, { name: rutaEnZip });
            }
        }

        await zip.finalize();
    } catch (err) {
        console.error('[ERROR /api/admin/descargar-zip]', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error al comprimir y generar el archivo ZIP: ' + err.message });
        }
    }
});

// ---------------------------------------------------------------------------
// CONFIGURACIÓN CENTRALIZADA (Admin)
// ---------------------------------------------------------------------------

/**
 * PUT /api/admin/config-grabacion
 * Actualiza la duración, tasa de muestreo y meta por comando.
 */
app.put('/api/admin/config-grabacion', verificarAdmin, (req, res) => {
    const { duracion_s, tasa_hz, meta_por_comando } = req.body;

    const duracionesPermitidas = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const tasasPermitidas = [8000, 16000, 22050, 44100];

    if (duracion_s !== undefined) {
        const d = parseInt(duracion_s);
        if (!duracionesPermitidas.includes(d)) {
            return res.status(400).json({ error: `Duración no permitida. Valores aceptados: ${duracionesPermitidas.join(', ')} segundos.` });
        }
        configGrabacion.duracion_s = d;
    }

    if (tasa_hz !== undefined) {
        const t = parseInt(tasa_hz);
        if (!tasasPermitidas.includes(t)) {
            return res.status(400).json({ error: `Tasa no permitida. Valores aceptados: ${tasasPermitidas.join(', ')} Hz.` });
        }
        configGrabacion.tasa_hz = t;
    }

    if (meta_por_comando !== undefined) {
        const m = parseInt(meta_por_comando);
        if (m >= 1 && m <= 500) {
            configGrabacion.meta_por_comando = m;
        }
    }

    console.log(`[recopilaVoz] Configuración actualizada: ${configGrabacion.duracion_s}s @ ${configGrabacion.tasa_hz}Hz (Meta: ${configGrabacion.meta_por_comando})`);
    res.json({ exito: true, config: configGrabacion });
});

// Redirección directa a admin.html
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Iniciar servidor HTTP
app.listen(PUERTO, () => {
    console.log(`[recopilaVoz] Servidor escuchando en http://localhost:${PUERTO}`);
    console.log(`[recopilaVoz] Panel de Administrador disponible en http://localhost:${PUERTO}/admin`);
});
