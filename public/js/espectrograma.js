/**
 * espectrograma.js — Renderizado de espectrograma en Canvas 2D
 * Recibe la salida de DSP.espectrogramaSTFT y dibuja en un elemento canvas.
 * Sin dependencias externas. Compatible con uso en móvil.
 */

'use strict';

/**
 * Convierte un valor de potencia en dB a un color usando la paleta Magma.
 * @param {number} valorNorm - valor normalizado [0, 1]
 * @returns {string} color CSS rgb()
 */
function paleta(valorNorm) {
    // Paleta Magma simplificada (negros, rojos, amarillos)
    const t = Math.max(0, Math.min(1, valorNorm));
    if (t < 0.25) {
        const r = Math.round(t * 4 * 80);
        const g = 0;
        const b = Math.round(t * 4 * 80 + 20);
        return `rgb(${r},${g},${b})`;
    } else if (t < 0.5) {
        const tt = (t - 0.25) * 4;
        const r = Math.round(80 + tt * 130);
        const g = Math.round(tt * 30);
        const b = Math.round(80 - tt * 50);
        return `rgb(${r},${g},${b})`;
    } else if (t < 0.75) {
        const tt = (t - 0.5) * 4;
        const r = Math.round(210 + tt * 40);
        const g = Math.round(30 + tt * 120);
        const b = Math.round(30);
        return `rgb(${r},${g},${b})`;
    } else {
        const tt = (t - 0.75) * 4;
        const r = 255;
        const g = Math.round(150 + tt * 100);
        const b = Math.round(30 + tt * 200);
        return `rgb(${r},${g},${b})`;
    }
}

/**
 * Dibuja el espectrograma en el canvas dado.
 * @param {HTMLCanvasElement} canvas
 * @param {{ tiempos, frecuencias, potencias }} datos - salida de DSP.espectrogramaSTFT
 * @param {{ dbMin, dbMax, mostrarEjes }} opciones
 */
function dibujarEspectrograma(canvas, datos, opciones = {}) {
    const { tiempos, frecuencias, potencias } = datos;
    if (!potencias || potencias.length === 0) return;

    const dbMin = opciones.dbMin ?? -80;
    const dbMax = opciones.dbMax ?? 0;
    const mostrarEjes = opciones.mostrarEjes !== false;

    const ctx = canvas.getContext('2d');
    const margenIzq = mostrarEjes ? 50 : 0;
    const margenInf = mostrarEjes ? 30 : 0;
    const margenSup = mostrarEjes ? 10 : 0;
    const margenDer = mostrarEjes ? 10 : 0;

    const anchoPlot = canvas.width - margenIzq - margenDer;
    const altoPlot = canvas.height - margenInf - margenSup;

    // Fondo
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const numFrames = potencias.length;
    const numBins = frecuencias.length;
    const anchoCelda = Math.max(1, anchoPlot / numFrames);
    const altoCelda = Math.max(1, altoPlot / numBins);

    // Dibujar celdas del espectrograma
    for (let f = 0; f < numFrames; f++) {
        for (let k = 0; k < numBins; k++) {
            const potDb = 10 * Math.log10(Math.max(1e-10, potencias[f][k]));
            const valorNorm = (potDb - dbMin) / (dbMax - dbMin);

            // Invertir eje Y (frecuencia 0 abajo)
            const x = margenIzq + f * anchoCelda;
            const y = margenSup + (numBins - 1 - k) * altoCelda;

            ctx.fillStyle = paleta(valorNorm);
            ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(anchoCelda), Math.ceil(altoCelda));
        }
    }

    if (!mostrarEjes) return;

    // Ejes y etiquetas
    ctx.fillStyle = '#c8c8d8';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';

    // Eje Y — frecuencia
    const tasa = frecuencias[frecuencias.length - 1] * 2;
    const marcasFrecuencia = [0, 2000, 4000, 6000, 8000].filter(f => f <= tasa / 2);
    marcasFrecuencia.forEach(frec => {
        const y = margenSup + altoPlot - (frec / (tasa / 2)) * altoPlot;
        ctx.fillText(`${frec}`, margenIzq - 4, y + 4);
        ctx.strokeStyle = 'rgba(200,200,216,0.15)';
        ctx.beginPath();
        ctx.moveTo(margenIzq, y);
        ctx.lineTo(margenIzq + anchoPlot, y);
        ctx.stroke();
    });

    // Eje Y label
    ctx.save();
    ctx.translate(12, canvas.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Frecuencia (Hz)', 0, 0);
    ctx.restore();

    // Eje X — tiempo
    ctx.textAlign = 'center';
    const durTotal = tiempos[tiempos.length - 1] || 1;
    const marcasTiempo = [0, 0.5, 1, 1.5, 2, 2.5, 3].filter(t => t <= durTotal + 0.1);
    marcasTiempo.forEach(t => {
        const x = margenIzq + (t / durTotal) * anchoPlot;
        ctx.fillText(`${t.toFixed(1)}s`, x, canvas.height - 5);
    });

    // Eje X label
    ctx.fillText('Tiempo (s)', margenIzq + anchoPlot / 2, canvas.height - 2);
}

/**
 * Dibuja un espectrograma parcial en tiempo real (agrega columnas de la derecha).
 * Desplaza el canvas a la izquierda y agrega la nueva columna.
 * @param {HTMLCanvasElement} canvas
 * @param {Float32Array} potenciaFrame - potencias del frame actual
 * @param {{ dbMin, dbMax }} opciones
 */
function dibujarColumnaEnVivo(canvas, potenciaFrame, opciones = {}) {
    const dbMin = opciones.dbMin ?? -80;
    const dbMax = opciones.dbMax ?? 0;
    const anchoCelda = opciones.anchoCelda ?? 4;
    const ctx = canvas.getContext('2d');
    const numBins = potenciaFrame.length;

    // Desplazar imagen a la izquierda
    ctx.drawImage(canvas, -anchoCelda, 0);

    // Dibujar nueva columna en la derecha
    const altoCelda = canvas.height / numBins;
    for (let k = 0; k < numBins; k++) {
        const potDb = 10 * Math.log10(Math.max(1e-10, potenciaFrame[k]));
        const valorNorm = (potDb - dbMin) / (dbMax - dbMin);
        const y = (numBins - 1 - k) * altoCelda;
        ctx.fillStyle = paleta(valorNorm);
        ctx.fillRect(canvas.width - anchoCelda, Math.floor(y), anchoCelda, Math.ceil(altoCelda));
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { dibujarEspectrograma, dibujarColumnaEnVivo, paleta };
} else {
    window.Espectrograma = { dibujarEspectrograma, dibujarColumnaEnVivo, paleta };
}
