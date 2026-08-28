-- ============================================================================
-- RecopilaVoz — Script de Configuración y Migración para Supabase
-- Proyecto: Laboratorio de Análisis Espectral y Control por Voz (H7)
-- Ejecutar en el SQL Editor de tu proyecto Supabase (https://supabase.com)
-- ============================================================================

-- 1. Tabla de comandos configurables con límite de audios por bloque
CREATE TABLE IF NOT EXISTS public.comandos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE,
    descripcion TEXT DEFAULT '',
    activo BOOLEAN DEFAULT true,
    orden INTEGER DEFAULT 0,
    limite_bloque INTEGER DEFAULT 40, -- Límite de audios por bloque / meta configurable por admin
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de grabaciones de audio
CREATE TABLE IF NOT EXISTS public.grabaciones (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    alias TEXT NOT NULL,
    comando TEXT NOT NULL,
    url_audio TEXT NOT NULL,
    ruta_storage TEXT NOT NULL,
    tasa_hz INTEGER DEFAULT 16000,
    duracion_s FLOAT,
    valido BOOLEAN DEFAULT NULL, -- NULL = sin revisar (?), TRUE = válido (✓), FALSE = rechazado (✗)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabla de perfiles y registro opcional de hablantes
CREATE TABLE IF NOT EXISTS public.hablantes_perfil (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    alias TEXT NOT NULL UNIQUE,
    nombres_apellidos TEXT DEFAULT '',
    contacto TEXT DEFAULT '', -- Teléfono o correo electrónico
    notas TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabla de anuncios y mensajes de los administradores para los participantes
CREATE TABLE IF NOT EXISTS public.anuncios (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    mensaje TEXT NOT NULL DEFAULT '',
    tipo TEXT DEFAULT 'info', -- 'info', 'importante', 'exito'
    activo BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Migraciones seguras e idempotentes para proyectos existentes
DO $$ 
BEGIN 
    -- Columna valido en grabaciones
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'grabaciones' 
        AND column_name = 'valido'
    ) THEN 
        ALTER TABLE public.grabaciones ADD COLUMN valido BOOLEAN DEFAULT NULL;
    END IF;

    -- Columna limite_bloque en comandos
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'comandos' 
        AND column_name = 'limite_bloque'
    ) THEN 
        ALTER TABLE public.comandos ADD COLUMN limite_bloque INTEGER DEFAULT 40;
    END IF;

    -- Columna codigo_dispositivo en hablantes_perfil (protección anti-suplantación de alias)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'hablantes_perfil' 
        AND column_name = 'codigo_dispositivo'
    ) THEN 
        ALTER TABLE public.hablantes_perfil ADD COLUMN codigo_dispositivo TEXT;
    END IF;

    -- Columna nombre_archivo en grabaciones (etiquetado estándar Hablante_toma_comando.wav)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'grabaciones' 
        AND column_name = 'nombre_archivo'
    ) THEN 
        ALTER TABLE public.grabaciones ADD COLUMN nombre_archivo TEXT;
    END IF;
END $$;

-- 5b. Restricciones UNIQUE necesarias para los INSERT/UPSERT con ON CONFLICT.
-- Si las tablas ya existían de una versión anterior del proyecto (creadas sin
-- estas restricciones), CREATE TABLE IF NOT EXISTS no las agrega retroactivamente.
-- Este bloque las crea de forma segura, sin borrar ninguna fila.
DO $$
BEGIN
    BEGIN
        ALTER TABLE public.comandos ADD CONSTRAINT comandos_nombre_key UNIQUE (nombre);
    EXCEPTION
        WHEN duplicate_object THEN
            NULL; -- La restricción ya existe, no hay nada que hacer.
        WHEN unique_violation THEN
            RAISE NOTICE 'No se pudo crear UNIQUE en comandos.nombre: hay nombres de comando duplicados. Elimina los duplicados manualmente y vuelve a correr este script.';
    END;

    BEGIN
        ALTER TABLE public.hablantes_perfil ADD CONSTRAINT hablantes_perfil_alias_key UNIQUE (alias);
    EXCEPTION
        WHEN duplicate_object THEN
            NULL;
        WHEN unique_violation THEN
            RAISE NOTICE 'No se pudo crear UNIQUE en hablantes_perfil.alias: hay alias duplicados. Elimina los duplicados manualmente y vuelve a correr este script.';
    END;
END $$;

-- 6. Índices optimizados para búsquedas, filtros, ordenación y estadísticas
CREATE INDEX IF NOT EXISTS idx_grabaciones_alias ON public.grabaciones(alias);
CREATE INDEX IF NOT EXISTS idx_grabaciones_comando ON public.grabaciones(comando);
CREATE INDEX IF NOT EXISTS idx_grabaciones_valido ON public.grabaciones(valido);
CREATE INDEX IF NOT EXISTS idx_grabaciones_created_at ON public.grabaciones(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comandos_activo ON public.comandos(activo);
CREATE INDEX IF NOT EXISTS idx_comandos_orden ON public.comandos(orden ASC);
CREATE INDEX IF NOT EXISTS idx_hablantes_perfil_alias ON public.hablantes_perfil(alias);

-- 7. Datos iniciales del vocabulario estándar H7 (control por voz)
INSERT INTO public.comandos (nombre, descripcion, activo, orden, limite_bloque) VALUES
    ('Adelante', 'Pronuncia la palabra "Adelante" con tono natural de conversación.', true, 1, 40),
    ('Atras', 'Pronuncia la palabra "Atras" con tono natural de conversación.', true, 2, 40),
    ('Derecha', 'Pronuncia la palabra "Derecha" con tono natural de conversación.', true, 3, 40),
    ('Izquierda', 'Pronuncia la palabra "Izquierda" con tono natural de conversación.', true, 4, 40),
    ('Encender', 'Pronuncia la palabra "Encender" con tono natural de conversación.', true, 5, 40),
    ('Apagar', 'Pronuncia la palabra "Apagar" con tono natural de conversación.', true, 6, 40)
ON CONFLICT (nombre) DO UPDATE SET 
    limite_bloque = COALESCE(public.comandos.limite_bloque, EXCLUDED.limite_bloque);

-- 8. Configuración de Storage
-- Crea un Bucket llamado "audios" en Supabase Storage (Storage -> New Bucket -> "audios").
-- Puedes configurarlo como Público (Public bucket) o usar la clave service_role en el backend.
-- Estructura de almacenamiento: {alias}/{comando}_{timestamp}.wav

-- 9. Seguridad y Políticas RLS
-- El backend Node.js se conecta con SUPABASE_SERVICE_KEY (rol service_role),
-- el cual bypasses RLS automáticamente. Si deseas habilitar RLS para acceso anon:
-- ALTER TABLE public.grabaciones ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Permitir lectura publica de grabaciones" ON public.grabaciones FOR SELECT USING (true);
-- CREATE POLICY "Permitir insercion anonima de grabaciones" ON public.grabaciones FOR INSERT WITH CHECK (true);
