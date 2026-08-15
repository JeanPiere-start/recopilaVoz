/**
 * dsp.js — Módulo de Procesamiento Digital de Señales (DSP)
 * Funciones puras y testeables. Sin dependencias de GUI ni DOM.
 * Compatible con el experimento de separabilidad espectral H7 del proyecto controlVoz.
 *
 * Contenido:
 *   - ventanaHann(N)                                    -> Float32Array de longitud N
 *   - fftReal(señal)                                    -> { re, im }
 *   - siguientePotenciaDe2(n)                           -> number
 *   - magnitudFFT(re, im)                               -> Float32Array (primeros N/2+1 bins)
 *   - potenciaEspectral(mag)                            -> Float32Array (mag^2)
 *   - tasaCrucesPorCero(señal)                          -> number [0, 1]
 *   - centroideEspectral(mag, freqs)                    -> number (Hz)
 *   - espectrogramaSTFT(señal, tamFrame, avance, tasa)  -> { tiempos, frecuencias, potencias }
 *   - descriptoresEspectrales(señal, tasa)              -> { hflfRatio, energiaAlta, energiaBaja, zcr, centroideHz }
 *   - normalizarDescriptores(d)                         -> vector [hflf, alta, baja, zcr] normalizado [0, 1]
 */

'use strict';

/**
 * Genera una ventana de Hann de N puntos.
 * w[n] = 0.5 * (1 - cos(2*pi*n / (N-1)))
 * @param {number} N - Longitud de la ventana
 * @returns {Float32Array}
 */
function ventanaHann(N) {
    if (N <= 0) return new Float32Array(0);
    if (N === 1) return new Float32Array([1]);
    const w = new Float32Array(N);
    const factor = (2 * Math.PI) / (N - 1);
    for (let n = 0; n < N; n++) {
        w[n] = 0.5 * (1 - Math.cos(factor * n));
    }
    return w;
}

/**
 * Calcula la siguiente potencia de 2 mayor o igual a n.
 * @param {number} n
 * @returns {number}
 */
function siguientePotenciaDe2(n) {
    if (n <= 1) return 1;
    let p = 1;
    while (p < n) p <<= 1;
    return p;
}

/**
 * Calcula la FFT de una señal real usando el algoritmo Cooley-Tukey radix-2 (in-place).
 * La longitud de la señal debe ser una potencia de 2.
 * @param {Float32Array|Array<number>} señal - Señal de entrada real
 * @returns {{ re: Float32Array, im: Float32Array }}
 */
function fftReal(señal) {
    const N = señal.length;
    const re = new Float32Array(N);
    const im = new Float32Array(N);

    // Copia inicial
    for (let i = 0; i < N; i++) {
        re[i] = señal[i];
    }

    // Bit-reversal permutation
    let j = 0;
    for (let i = 1; i < N; i++) {
        let bit = N >> 1;
        for (; j & bit; bit >>= 1) {
            j ^= bit;
        }
        j ^= bit;
        if (i < j) {
            const tempR = re[i];
            re[i] = re[j];
            re[j] = tempR;
            const tempI = im[i];
            im[i] = im[j];
            im[j] = tempI;
        }
    }

    // Butterfly computations
    for (let len = 2; len <= N; len <<= 1) {
        const mitad = len >> 1;
        const angulo = (-2 * Math.PI) / len;
        const wrBase = Math.cos(angulo);
        const wiBase = Math.sin(angulo);

        for (let i = 0; i < N; i += len) {
            let wr = 1.0;
            let wi = 0.0;
            for (let k = 0; k < mitad; k++) {
                const idxPar = i + k;
                const idxImpar = i + k + mitad;

                const uRe = re[idxPar];
                const uIm = im[idxPar];
                const vRe = re[idxImpar] * wr - im[idxImpar] * wi;
                const vIm = re[idxImpar] * wi + im[idxImpar] * wr;

                re[idxPar] = uRe + vRe;
                im[idxPar] = uIm + vIm;
                re[idxImpar] = uRe - vRe;
                im[idxImpar] = uIm - vIm;

                const wrNuevo = wr * wrBase - wi * wiBase;
                wi = wr * wiBase + wi * wrBase;
                wr = wrNuevo;
            }
        }
    }

    return { re, im };
}

/**
 * Calcula magnitudes espectrales (espectro de un solo lado / single-sided).
 * Retorna los primeros N/2 + 1 bins.
 * @param {Float32Array} re
 * @param {Float32Array} im
 * @returns {Float32Array}
 */
function magnitudFFT(re, im) {
    const numBins = (re.length >> 1) + 1;
    const mag = new Float32Array(numBins);
    for (let i = 0; i < numBins; i++) {
        mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }
    return mag;
}

/**
 * Calcula la potencia espectral (magnitud al cuadrado).
 * @param {Float32Array} mag
 * @returns {Float32Array}
 */
function potenciaEspectral(mag) {
    const pot = new Float32Array(mag.length);
    for (let i = 0; i < mag.length; i++) {
        pot[i] = mag[i] * mag[i];
    }
    return pot;
}

/**
 * Calcula la tasa de cruces por cero (Zero-Crossing Rate, ZCR).
 * @param {Float32Array|Array<number>} señal
 * @returns {number} [0, 1]
 */
function tasaCrucesPorCero(señal) {
    if (!señal || señal.length <= 1) return 0;
    let cruces = 0;
    for (let i = 1; i < señal.length; i++) {
        if ((señal[i] >= 0 && señal[i - 1] < 0) || (señal[i] < 0 && señal[i - 1] >= 0)) {
            cruces++;
        }
    }
    return cruces / (señal.length - 1);
}

/**
 * Calcula el centroide espectral en Hz.
 * @param {Float32Array} mag
 * @param {Float32Array} freqs
 * @returns {number}
 */
function centroideEspectral(mag, freqs) {
    let sumaPonderada = 0;
    let sumaTotal = 0;
    for (let i = 0; i < mag.length; i++) {
        sumaPonderada += mag[i] * freqs[i];
        sumaTotal += mag[i];
    }
    return sumaTotal > 0 ? sumaPonderada / sumaTotal : 0;
}

/**
 * Calcula el espectrograma STFT (Short-Time Fourier Transform).
 * @param {Float32Array} señal     - Señal de audio PCM
 * @param {number}       tamFrame  - Tamaño de la ventana (ej: 512)
 * @param {number}       avance    - Avance entre ventanas (ej: 128)
 * @param {number}       tasa      - Tasa de muestreo en Hz (ej: 16000)
 * @returns {{ tiempos: Float32Array, frecuencias: Float32Array, potencias: Float32Array[] }}
 */
function espectrogramaSTFT(señal, tamFrame = 512, avance = 128, tasa = 16000) {
    if (!señal || señal.length === 0) {
        return { tiempos: new Float32Array(0), frecuencias: new Float32Array(0), potencias: [] };
    }

    const ventana = ventanaHann(tamFrame);
    const tamFFT = siguientePotenciaDe2(tamFrame);
    const numBins = (tamFFT >> 1) + 1;
    const numFrames = Math.max(1, Math.floor((señal.length - tamFrame) / avance) + 1);

    const potencias = [];
    const tiempos = new Float32Array(numFrames);
    const frecuencias = new Float32Array(numBins);

    // Vector de frecuencias
    for (let k = 0; k < numBins; k++) {
        frecuencias[k] = (k * tasa) / tamFFT;
    }

    for (let f = 0; f < numFrames; f++) {
        const inicio = f * avance;
        tiempos[f] = inicio / tasa;

        const frame = new Float32Array(tamFFT);
        for (let n = 0; n < tamFrame && (inicio + n) < señal.length; n++) {
            frame[n] = señal[inicio + n] * ventana[n];
        }

        const { re, im } = fftReal(frame);
        const mag = magnitudFFT(re, im);
        potencias.push(potenciaEspectral(mag));
    }

    return { tiempos, frecuencias, potencias };
}

/**
 * Extrae los 4 descriptores espectrales principales del experimento H7.
 * @param {Float32Array} señal - Señal de audio PCM
 * @param {number}       tasa  - Tasa de muestreo en Hz (16000)
 * @returns {{ hflfRatio: number, energiaAlta: number, energiaBaja: number, zcr: number, centroideHz: number }}
 */
function descriptoresEspectrales(señal, tasa = 16000) {
    if (!señal || señal.length === 0) {
        return { hflfRatio: 0, energiaAlta: 0, energiaBaja: 0, zcr: 0, centroideHz: 0 };
    }

    const tamFFT = siguientePotenciaDe2(Math.min(señal.length, 2048));
    const frame = new Float32Array(tamFFT);
    const ventana = ventanaHann(Math.min(señal.length, tamFFT));

    for (let i = 0; i < ventana.length; i++) {
        frame[i] = señal[i] * ventana[i];
    }

    const { re, im } = fftReal(frame);
    const mag = magnitudFFT(re, im);
    const numBins = mag.length;

    // Frecuencia de corte baja/alta: 2000 Hz (estándar experimento H7)
    const freqCorte = 2000;
    const binCorte = Math.floor((freqCorte / tasa) * 2 * numBins);

    let energiaTotal = 0;
    let energiaBajaVal = 0;
    let energiaAltaVal = 0;

    const freqs = new Float32Array(numBins);
    for (let k = 0; k < numBins; k++) {
        freqs[k] = (k * tasa) / tamFFT;
        const pot = mag[k] * mag[k];
        energiaTotal += pot;
        if (k <= binCorte) {
            energiaBajaVal += pot;
        } else {
            energiaAltaVal += pot;
        }
    }

    const hflfRatio = energiaBajaVal > 0 ? (energiaAltaVal / energiaBajaVal) : 0;
    const energiaAlta = energiaTotal > 0 ? (energiaAltaVal / energiaTotal) : 0;
    const energiaBaja = energiaTotal > 0 ? (energiaBajaVal / energiaTotal) : 0;
    const zcr = tasaCrucesPorCero(señal);
    const centroideHz = centroideEspectral(mag, freqs);

    return {
        hflfRatio,
        energiaAlta,
        energiaBaja,
        zcr,
        centroideHz
    };
}

/**
 * Normaliza los descriptores espectrales al intervalo [0, 1].
 * @param {{ hflfRatio: number, energiaAlta: number, energiaBaja: number, zcr: number }} d
 * @returns {number[]} Vector normalizado [hflf, alta, baja, zcr]
 */
function normalizarDescriptores(d) {
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

// Exportación universal (Node.js + Navegador)
const dspExports = {
    ventanaHann,
    siguientePotenciaDe2,
    fftReal,
    magnitudFFT,
    potenciaEspectral,
    tasaCrucesPorCero,
    centroideEspectral,
    espectrogramaSTFT,
    descriptoresEspectrales,
    normalizarDescriptores
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = dspExports;
}
if (typeof window !== 'undefined') {
    window.DSP = dspExports;
}
