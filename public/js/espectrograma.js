/**
 * espectrograma.js — Renderizado de espectrogramas en Canvas 2D
 * Renderiza matrices STFT calculadas por dsp.js con mapa de calor científico (Magma).
 * Soporta modo estático de alta resolución y modo scroll en tiempo real (en vivo).
 * Sin dependencias externas.
 */

'use strict';

/**
 * Convierte un valor normalizado [0, 1] a color RGB según la paleta científica Magma.
 * @param {number} valorNorm - Valor normalizado entre 0.0 (silencio) y 1.0 (máxima energía)
 * @returns {string} Color en formato rgb(r, g, b)
 */
function paleta(valorNorm) {
    const t = Math.max(0, Math.min(1, valorNorm));
    if (t < 0.25) {
        const f = t * 4;
        const r = Math.round(f * 70);
        const g = Math.round(f * 10);
        const b = Math.round(20 + f * 90);
        return `rgb(${r},${g},${b})`;
    } else if (t < 0.5) {
        const f = (t - 0.25) * 4;
        const r = Math.round(70 + f * 115);
        const g = Math.round(10 + f * 40);
        const b = Math.round(110 - f * 50);
        return `rgb(${r},${g},${b})`;
    } else if (t < 0.75) {
        const f = (t - 0.5) * 4;
        const r = Math.round(185 + f * 55);
        const g = Math.round(50 + f * 95);
        const b = Math.round(60 - f * 20);
        return `rgb(${r},${g},${b})`;
    } else {
        const f = (t - 0.75) * 4;
        const r = Math.round(240 + f * 15);
        const g = Math.round(145 + f * 105);
        const b = Math.round(40 + f * 180);
        return `rgb(${r},${g},${b})`;
    }
}

/**
 * Dibuja un espectrograma STFT completo en un elemento Canvas HTML5.
 * @param {HTMLCanvasElement} canvas
 * @param {{ tiempos: Float32Array, frecuencias: Float32Array, potencias: Float32Array[] }} datos
 * @param {{ dbMin?: number, dbMax?: number, mostrarEjes?: boolean, colorFondo?: string }} [opciones]
 */
function dibujarEspectrograma(canvas, datos, opciones = {}) {
    if (!canvas || !datos || !datos.potencias || datos.potencias.length === 0) return;

    const { tiempos, frecuencias, potencias } = datos;
    const dbMin = opciones.dbMin ?? -75;
    const dbMax = opciones.dbMax ?? 0;
    const mostrarEjes = opciones.mostrarEjes !== false;
    const colorFondo = opciones.colorFondo || '#080b12';

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    const margenIzq = mostrarEjes ? 56 : 0;
    const margenInf = mostrarEjes ? 28 : 0;
    const margenSup = mostrarEjes ? 12 : 0;
    const margenDer = mostrarEjes ? 12 : 0;

    const anchoPlot = width - margenIzq - margenDer;
    const altoPlot = height - margenInf - margenSup;

    // Fondo oscuro
    ctx.fillStyle = colorFondo;
    ctx.fillRect(0, 0, width, height);

    const numFrames = potencias.length;
    const numBins = frecuencias.length;
    const anchoCelda = anchoPlot / numFrames;
    const altoCelda = altoPlot / numBins;

    // Renderizado de celdas espectrales
    for (let f = 0; f < numFrames; f++) {
        const framePot = potencias[f];
        const x = margenIzq + (f * anchoCelda);

        for (let k = 0; k < numBins; k++) {
            const pot = framePot[k];
            const potDb = 10 * Math.log10(Math.max(1e-10, pot));
            const valorNorm = (potDb - dbMin) / (dbMax - dbMin);

            // Invertir eje vertical: frecuencias bajas abajo, altas arriba
            const y = margenSup + altoPlot - ((k + 1) * altoCelda);

            ctx.fillStyle = paleta(valorNorm);
            ctx.fillRect(
                Math.floor(x),
                Math.floor(y),
                Math.ceil(anchoCelda + 0.5),
                Math.ceil(altoCelda + 0.5)
            );
        }
    }

    if (!mostrarEjes) return;

    // Guías y etiquetas de ejes
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';

    // Eje vertical: Frecuencia en Hz
    const maxFreq = frecuencias[frecuencias.length - 1] || 8000;
    const ticksFreq = [0, 2000, 4000, 6000, 8000].filter(f => f <= maxFreq + 50);

    ticksFreq.forEach(freq => {
        const y = margenSup + altoPlot - ((freq / maxFreq) * altoPlot);

        // Línea tenue de cuadrícula
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(margenIzq, y);
        ctx.lineTo(margenIzq + anchoPlot, y);
        ctx.stroke();

        // Texto etiqueta
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'right';
        const textoLabel = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
        ctx.fillText(textoLabel, margenIzq - 8, y);
    });

    // Eje horizontal: Tiempo en segundos
    const duracionTotal = tiempos[tiempos.length - 1] || 3.0;
    const pasoTiempo = duracionTotal > 4 ? 1.0 : 0.5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let t = 0; t <= duracionTotal + 0.01; t += pasoTiempo) {
        const x = margenIzq + ((t / duracionTotal) * anchoPlot);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(x, margenSup);
        ctx.lineTo(x, margenSup + altoPlot);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`${t.toFixed(1)}s`, x, margenSup + altoPlot + 6);
    }
}

/**
 * Dibuja una columna espectral en vivo desplazando el canvas existente a la izquierda.
 * @param {HTMLCanvasElement} canvas
 * @param {Float32Array} potenciaFrame - Potencias del frame actual
 * @param {{ dbMin?: number, dbMax?: number, anchoColumna?: number }} [opciones]
 */
function dibujarColumnaEnVivo(canvas, potenciaFrame, opciones = {}) {
    if (!canvas || !potenciaFrame || potenciaFrame.length === 0) return;

    const dbMin = opciones.dbMin ?? -75;
    const dbMax = opciones.dbMax ?? 0;
    const anchoCol = opciones.anchoColumna ?? 3;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Desplazar imagen hacia la izquierda
    ctx.drawImage(canvas, -anchoCol, 0);

    // Dibujar la nueva columna a la derecha
    const numBins = potenciaFrame.length;
    const altoCelda = height / numBins;

    for (let k = 0; k < numBins; k++) {
        const pot = potenciaFrame[k];
        const potDb = 10 * Math.log10(Math.max(1e-10, pot));
        const valorNorm = (potDb - dbMin) / (dbMax - dbMin);
        const y = height - ((k + 1) * altoCelda);

        ctx.fillStyle = paleta(valorNorm);
        ctx.fillRect(width - anchoCol, Math.floor(y), anchoCol, Math.ceil(altoCelda));
    }
}

// Exportaciones
const espectroExports = {
    paleta,
    dibujarEspectrograma,
    dibujarColumnaEnVivo
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = espectroExports;
}
if (typeof window !== 'undefined') {
    window.Espectrograma = espectroExports;
    window.dibujarEspectrograma = dibujarEspectrograma;
}
