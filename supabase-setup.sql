-- Script de configuracion inicial de Supabase para recopilaVoz
-- Ejecutar en el SQL Editor de tu proyecto Supabase

-- Tabla de comandos configurables
CREATE TABLE IF NOT EXISTS public.comandos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT DEFAULT '',
    activo BOOLEAN DEFAULT true,
    orden INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de grabaciones
CREATE TABLE IF NOT EXISTS public.grabaciones (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    alias TEXT NOT NULL,
    comando TEXT NOT NULL,
    url_audio TEXT NOT NULL,
    ruta_storage TEXT NOT NULL,
    tasa_hz INTEGER DEFAULT 16000,
    duracion_s FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_grabaciones_alias ON public.grabaciones(alias);
CREATE INDEX IF NOT EXISTS idx_grabaciones_comando ON public.grabaciones(comando);
CREATE INDEX IF NOT EXISTS idx_grabaciones_created_at ON public.grabaciones(created_at DESC);

-- Datos iniciales: 6 comandos del experimento H7
INSERT INTO public.comandos (nombre, descripcion, activo, orden) VALUES
    ('Adelante', 'Pronuncia la palabra "Adelante" en voz normal de conversacion', true, 1),
    ('Atras', 'Pronuncia la palabra "Atras" en voz normal de conversacion', true, 2),
    ('Derecha', 'Pronuncia la palabra "Derecha" en voz normal de conversacion', true, 3),
    ('Izquierda', 'Pronuncia la palabra "Izquierda" en voz normal de conversacion', true, 4),
    ('Encender', 'Pronuncia la palabra "Encender" en voz normal de conversacion', true, 5),
    ('Apagar', 'Pronuncia la palabra "Apagar" en voz normal de conversacion', true, 6)
ON CONFLICT DO NOTHING;

-- RLS: Deshabilitado (el backend usa service_role que bypasea RLS)
-- El control de acceso se maneja en el servidor Node.js
