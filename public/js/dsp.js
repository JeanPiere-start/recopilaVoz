/**
 * dsp.js — Módulo de Procesamiento Digital de Señales
 * Funciones puras y testeables. Sin dependencias de GUI.
 * Compatible con el experimento H7 del proyecto controlVoz.
 *
 * Contenido:
 *   - ventanaHann(N)              -> Float32Array de longitud N
 *   - fftReal(señal)              -> { re, im } arrays de longitud N/2+1
 *   - magnitudFFT(re, im)         -> Float32Array de magnitudes lineales
 *   - potenciaEspectral(mag)      -> Float32Array (mag^2)
 *   - espectrogramaSTFT(señal, tamaño, avance, tasa) -> { tiempos, frecuencias, potencias }
 *   - descriptoresEspectrales(señal, tasa) -> { hflfRatio, energiaAlta, energiaBaja, zcr }
 *   - normalizarDescriptores(d)   -> vector [hflfRatio, energiaAlta, energiaBaja, zcr] normalizado [0,1]
 */

'use strict';

// ---------------------------------------------------------------------------
// Ventana de Hann
// ---------------------------------------------------------------------------
/**
 * Genera una ventana de Hann de N puntos.
 * w[n] = 0.5 * (1 - cos(2*pi*n / (N-1)))
 * @param {number} N - longitud de la ventana
 * @returns {Float32Array}
 */
function ventanaHann(N) {
    const w = new Float32Array(N);
    for (let n = 0; n < N; n++) {
        w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
    }
    return w;
}

// ---------------------------------------------------------------------------
// FFT (Cooley-Tukey radix-2, in-place)
// ---------------------------------------------------------------------------
/**
 * Calcula la FFT de una señal real usando el algoritmo Cooley-Tukey radix-2.
 * La longitud debe ser potencia de 2.
 * @param {Float32Array} señal - señal de entrada (real)
 * @returns {{ re: Float32Array, im: Float32Array }} partes real e imaginaria (longitud N)
 */
function fftReal(señal) {
    const N = señal.length;
    const re = new Float32Array(N);
    const im = new Float32Array(N);

    // Copiar señal
    for (let i = 0; i < N; i++) re[i] = señal[i];

    // Bit-reversal
    let j = 0;
    for (let i = 1; i < N; i++) {
        let bit = N >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }

    // Butterfly
    for (let len = 2; len <= N; len <<= 1) {
        const angulo = (-2 * Math.PI) / len;
        const wrBase = Math.cos(angulo);
        const wiBase = Math.sin(angulo);
        for (let i = 0; i < N; i += len) {
            let wr = 1, wi = 0;
            for (let k = 0; k < len / 2; k++) {
                const uRe = re[i + k];
                const uIm = im[i + k];
                const vRe = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
                const vIm = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
                re[i + k] = uRe + vRe;
                im[i + k] = uIm + vIm;
                re[i + k + len / 2] = uRe - vRe;
                im[i + k + len / 2] = uIm - vIm;
                const wrNuevo = wr * wrBase - wi * wiBase;
                wi = wr * wiBase + wi * wrBase;
                wr = wrNuevo;
            }
        }
    }

    return { re, im };
}

/**
 * Siguiente potencia de 2 mayor o igual a n.
 */
function siguientePotenciaDe2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
}

/**
 * Calcula magnitudes espectrales (espectro de un solo lado).
 * Solo retorna los primeros N/2+1 bins (simetria de señal real).
 * @param {Float32Array} re - parte real
 * @param {Float32Array} im - parte imaginaria
 * @returns {Float32Array} magnitudes
 */
function magnitudFFT(re, im) {
    const mitad = Math.floor(re.length / 2) + 1;
    const mag = new Float32Array(mitad);
    for (let i = 0; i < mitad; i++) {
        mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }
    return mag;
}

/**
 * Calcula la potencia espectral (magnitud^2).
 * @param {Float32Array} mag - magnitudes
 * @returns {Float32Array}
 */
function potenciaEspectral(mag) {
    const pot = new Float32Array(mag.length);
    for (let i = 0; i < mag.length; i++) pot[i] = mag[i] * mag[i];
    return pot;
}

// ---------------------------------------------------------------------------
// Espectrograma STFT
// ---------------------------------------------------------------------------
/**
 * Calcula el espectrograma STFT de una señal.
 * @param {Float32Array} señal     - señal de entrada
 * @param {number}       tamFrame  - tamaño de ventana en muestras (ej: 512)
 * @param {number}       avance    - paso entre ventanas (ej: 128)
 * @param {number}       tasa      - tasa de muestreo en Hz (ej: 16000)
 * @returns {{ tiempos: Float32Array, frecuencias: Float32Array, potencias: Float32Array[] }}
 *   potencias[i] es la potencia espectral del frame i (longitud tamFrame/2+1)
 */
function espectrogramaSTFT(señal, tamFrame = 512, avance = 128, tasa = 16000) {
    const ventana = ventanaHann(tamFrame);
    const tamFFT = siguientePotenciaDe2(tamFrame);
    const numFrames = Math.floor((señal.length - tamFrame) / avance) + 1;
    const numBins = Math.floor(tamFFT / 2) + 1;

    const potencias = [];
    const tiempos = new Float32Array(numFrames);
    const frecuencias = new Float32Array(numBins);

    // Frecuencias de cada bin
    for (let k = 0; k < numBins; k++) {
        frecuencias[k] = (k * tasa) / tamFFT;
    }

    for (let f = 0; f < numFrames; f++) {
        const inicio = f * avance;
        tiempos[f] = inicio / tasa;

        // Extraer frame y aplicar ventana
        const frame = new Float32Array(tamFFT); // ceros por defecto (zero-pad)
        for (let n = 0; n < tamFrame && (inicio + n) < señal.length; n++) {
            frame[n] = señal[inicio + n] * ventana[n];
        }

        const { re, im } = fftReal(frame);
        potencias.push(potenciaEspectral(magnitudFFT(re, im)));
    }

    return { tiempos, frecuencias, potencias };
}

// ---------------------------------------------------------------------------
// Descriptores espectrales del experimento H7
// ---------------------------------------------------------------------------
/**
 * Calcula los 4 descriptores espectrales del experimento H7.
 * @param {Float32Array} señal - señal PCM de entrada
 * @param {number}       tasa  - tasa de muestreo Hz
 * @returns {{ hflfRatio: number, energiaAlta: number, energiaBaja: number, zcr: number }}
 */
function descriptoresEspectrales(señal, tasa = 16000) {
    // Usar frame central para descriptores globales
    const N = siguientePotenciaDe2(señal.length);
    const frame = new Float32Array(N);
    const ventana = ventanaHann(Math.min(señal.length, N));
    const longVentana = Math.min(señal.length, N);
    for (let i = 0; i < longVentana; i++) frame[i] = señal[i] * ventana[i];

    const { re, im } = fftReal(frame);
    const mag = magnitudFFT(re, im);
    const numBins = mag.length;

    // Frecuencia de corte LF/HF: 2000 Hz
    const freqCorte = 2000;
    const binCorte = Math.floor((freqCorte / tasa) * 2 * numBins);

    let energiaTotal = 0;
    let energiaBajaVal = 0;
    let energiaAltaVal = 0;

    for (let k = 0; k < numBins; k++) {
        const pot = mag[k] * mag[k];
        energiaTotal += pot;
        if (k <= binCorte) energiaBajaVal += pot;
        else energiaAltaVal += pot;
    }

    const hflfRatio = energiaBajaVal > 0 ? energiaAltaVal / energiaBajaVal : 0;
    const energiaAltaNorm = energiaTotal > 0 ? energiaAltaVal / energiaTotal : 0;
    const energiaBajaNorm = energiaTotal > 0 ? energiaBajaVal / energiaTotal : 0;

    // Tasa de cruces por cero
    let cruces = 0;
    for (let i = 1; i < señal.length; i++) {
        if ((señal[i] >= 0 && señal[i - 1] < 0) || (señal[i] < 0 && señal[i - 1] >= 0)) {
            cruces++;
        }
    }
    const zcr = señal.length > 1 ? cruces / (señal.length - 1) : 0;

    return {
        hflfRatio,
        energiaAlta: energiaAltaNorm,
        energiaBaja: energiaBajaNorm,
        zcr
    };
}

/**
 * Normaliza los descriptores al rango [0, 1] para uso en clasificador.
 * Usa los rangos tipicos observados en señales de voz a 16 kHz.
 * @param {{ hflfRatio, energiaAlta, energiaBaja, zcr }} d
 * @returns {number[]} vector normalizado [hflfRatio, energiaAlta, energiaBaja, zcr]
 */
function normalizarDescriptores(d) {
    // Rangos tipicos para voz a 16 kHz (ajustables segun corpus)
    const rangos = {
        hflfRatio: [0, 5],
        energiaAlta: [0, 1],
        energiaBaja: [0, 1],
        zcr: [0, 0.5]
    };
    return [
        Math.min(1, Math.max(0, (d.hflfRatio - rangos.hflfRatio[0]) / (rangos.hflfRatio[1] - rangos.hflfRatio[0]))),
        Math.min(1, Math.max(0, d.energiaAlta)),
        Math.min(1, Math.max(0, d.energiaBaja)),
        Math.min(1, Math.max(0, (d.zcr - rangos.zcr[0]) / (rangos.zcr[1] - rangos.zcr[0])))
    ];
}

// Exportar para uso como modulo ES o en <script> global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ventanaHann, fftReal, magnitudFFT, potenciaEspectral, espectrogramaSTFT, descriptoresEspectrales, normalizarDescriptores };
} else {
    window.DSP = { ventanaHann, fftReal, magnitudFFT, potenciaEspectral, espectrogramaSTFT, descriptoresEspectrales, normalizarDescriptores };
}
