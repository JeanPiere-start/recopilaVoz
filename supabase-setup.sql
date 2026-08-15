-- ============================================================================
-- RecopilaVoz — Script de Configuración y Migración para Supabase
-- Proyecto: Laboratorio de Análisis Espectral y Control por Voz (H7)
-- Ejecutar en el SQL Editor de tu proyecto Supabase (https://supabase.com)
-- ============================================================================

-- 1. Tabla de comandos configurables
CREATE TABLE IF NOT EXISTS public.comandos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE,
    descripcion TEXT DEFAULT '',
    activo BOOLEAN DEFAULT true,
    orden INTEGER DEFAULT 0,
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
    valido BOOLEAN DEFAULT NULL, -- NULL = sin revisar, TRUE = válido (✓), FALSE = rechazado (✗)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Migración segura para proyectos existentes (idempotente)
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'grabaciones' 
        AND column_name = 'valido'
    ) THEN 
        ALTER TABLE public.grabaciones ADD COLUMN valido BOOLEAN DEFAULT NULL;
    END IF;
END $$;

-- 4. Índices optimizados para búsquedas, filtros y estadísticas
CREATE INDEX IF NOT EXISTS idx_grabaciones_alias ON public.grabaciones(alias);
CREATE INDEX IF NOT EXISTS idx_grabaciones_comando ON public.grabaciones(comando);
CREATE INDEX IF NOT EXISTS idx_grabaciones_valido ON public.grabaciones(valido);
CREATE INDEX IF NOT EXISTS idx_grabaciones_created_at ON public.grabaciones(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comandos_activo ON public.comandos(activo);
CREATE INDEX IF NOT EXISTS idx_comandos_orden ON public.comandos(orden ASC);

-- 5. Datos iniciales del vocabulario estándar H7 (control por voz)
INSERT INTO public.comandos (nombre, descripcion, activo, orden) VALUES
    ('Adelante', 'Pronuncia la palabra "Adelante" con tono natural de conversación.', true, 1),
    ('Atras', 'Pronuncia la palabra "Atras" con tono natural de conversación.', true, 2),
    ('Derecha', 'Pronuncia la palabra "Derecha" con tono natural de conversación.', true, 3),
    ('Izquierda', 'Pronuncia la palabra "Izquierda" con tono natural de conversación.', true, 4),
    ('Encender', 'Pronuncia la palabra "Encender" con tono natural de conversación.', true, 5),
    ('Apagar', 'Pronuncia la palabra "Apagar" con tono natural de conversación.', true, 6)
ON CONFLICT (nombre) DO NOTHING;

-- 6. Configuración de Storage
-- Crea un Bucket llamado "audios" en Supabase Storage con acceso público o firmado.
-- Las grabaciones se guardan bajo la estructura: {alias}/{comando}_{timestamp}.wav

-- 7. Seguridad (RLS)
-- El backend Node.js utiliza la SUPABASE_SERVICE_KEY (rol service_role),
-- la cual tiene privilegios administrativos y realiza las validaciones de acceso.
