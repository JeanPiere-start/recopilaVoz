/**
 * grabador.js — Lógica de grabación y remuestreo a 16 kHz
 * Usa MediaRecorder + OfflineAudioContext para capturar y remuestrear.
 * Compatible con dispositivos móviles (iOS/Android).
 * Sin dependencias externas.
 */

'use strict';

/**
 * Convierte un Float32Array PCM a buffer WAV.
 * @param {Float32Array} muestras - audio PCM normalizado [-1, 1]
 * @param {number} tasa - tasa de muestreo
 * @returns {ArrayBuffer} buffer WAV
 */
function pcmAWav(muestras, tasa) {
    const numMuestras = muestras.length;
    const bytesAudio = numMuestras * 2; // 16 bits = 2 bytes por muestra
    const buffer = new ArrayBuffer(44 + bytesAudio);
    const vista = new DataView(buffer);

    const escribirString = (offset, str) => {
        for (let i = 0; i < str.length; i++) vista.setUint8(offset + i, str.charCodeAt(i));
    };

    escribirString(0, 'RIFF');
    vista.setUint32(4, 36 + bytesAudio, true);
    escribirString(8, 'WAVE');
    escribirString(12, 'fmt ');
    vista.setUint32(16, 16, true);           // tamaño del chunk fmt
    vista.setUint16(20, 1, true);            // formato PCM
    vista.setUint16(22, 1, true);            // mono
    vista.setUint32(24, tasa, true);         // tasa de muestreo
    vista.setUint32(28, tasa * 2, true);     // byte rate
    vista.setUint16(32, 2, true);            // block align
    vista.setUint16(34, 16, true);           // bits por muestra
    escribirString(36, 'data');
    vista.setUint32(40, bytesAudio, true);

    // Convertir float32 a int16
    for (let i = 0; i < numMuestras; i++) {
        const s = Math.max(-1, Math.min(1, muestras[i]));
        vista.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
    }

    return buffer;
}

/**
 * Remuestrea un AudioBuffer a la tasa objetivo usando OfflineAudioContext.
 * @param {AudioBuffer} audioBuffer - buffer de entrada
 * @param {number} tasaObjetivo - tasa de muestreo objetivo (ej: 16000)
 * @returns {Promise<Float32Array>} muestras remuestreadas
 */
async function remuestrear(audioBuffer, tasaObjetivo = 16000) {
    const duracion = audioBuffer.duration;
    const numMuestrasObjetivo = Math.ceil(duracion * tasaObjetivo);

    const offlineCtx = new OfflineAudioContext(1, numMuestrasObjetivo, tasaObjetivo);

    // Mezclar todos los canales a mono
    const bufferMono = offlineCtx.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
    const dataMono = bufferMono.getChannelData(0);

    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        const canal = audioBuffer.getChannelData(c);
        for (let i = 0; i < canal.length; i++) {
            dataMono[i] += canal[i] / audioBuffer.numberOfChannels;
        }
    }

    const fuente = offlineCtx.createBufferSource();
    fuente.buffer = bufferMono;
    fuente.connect(offlineCtx.destination);
    fuente.start(0);

    const resultadoBuffer = await offlineCtx.startRendering();
    return resultadoBuffer.getChannelData(0);
}

/**
 * Clase Grabador — gestiona el ciclo completo de grabación.
 * Eventos:
 *   onIniciar()       - cuando empieza la grabación
 *   onFinalizar(blob, muestras16k, duracion) - cuando termina y se procesa
 *   onError(mensaje)  - en caso de error
 *   onNivelVoz(nivel) - nivel RMS en tiempo real [0,1] para vu-meter
 */
class Grabador {
    constructor(tasaHz = 16000) {
        this.mediaRecorder = null;
        this.chunks = [];
        this.stream = null;
        this.audioCtx = null;
        this.analizador = null;
        this.animFrameId = null;
        this.tasaHz = tasaHz; // Tasa de muestreo configurable

        // Callbacks
        this.onIniciar = null;
        this.onFinalizar = null;
        this.onError = null;
        this.onNivelVoz = null;
    }

    /**
     * Solicita permiso al micrófono e inicia la grabación.
     * @param {number} duracionMs - duración en milisegundos (0 = manual)
     */
    async iniciar(duracionMs = 3000) {
        try {
            // Solicitar acceso al micrófono
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: { ideal: 16000 }
                }
            });

            // Configurar analizador para VU-meter en tiempo real
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const fuente = this.audioCtx.createMediaStreamSource(this.stream);
            this.analizador = this.audioCtx.createAnalyser();
            this.analizador.fftSize = 256;
            fuente.connect(this.analizador);
            this._iniciarVuMeter();

            // Determinar MIME type compatible
            const tipos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
            const tipoMime = tipos.find(t => MediaRecorder.isTypeSupported(t)) || '';

            this.chunks = [];
            this.mediaRecorder = new MediaRecorder(this.stream, tipoMime ? { mimeType: tipoMime } : {});
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) this.chunks.push(e.data);
            };
            this.mediaRecorder.onstop = () => this._procesarAudio();

            this.mediaRecorder.start();
            if (this.onIniciar) this.onIniciar();

            // Detener automáticamente si se especificó duración
            if (duracionMs > 0) {
                setTimeout(() => this.detener(), duracionMs);
            }
        } catch (err) {
            const msg = err.name === 'NotAllowedError'
                ? 'Permiso de micrófono denegado. Activa el acceso en la configuración del navegador.'
                : `Error al acceder al micrófono: ${err.message}`;
            if (this.onError) this.onError(msg);
        }
    }

    /** Detiene la grabación manualmente. */
    detener() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this._detenerVuMeter();
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
        }
    }

    /** Procesa el audio grabado: decodifica, remuestrea a la tasa configurada, genera WAV. */
    async _procesarAudio() {
        try {
            const blob = new Blob(this.chunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();

            // Decodificar a AudioBuffer con tasa nativa
            const ctxDecode = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await ctxDecode.decodeAudioData(arrayBuffer);
            ctxDecode.close();

            // Remuestrear a la tasa configurada
            const muestras = await remuestrear(audioBuffer, this.tasaHz);
            const duracion = muestras.length / this.tasaHz;

            // Generar WAV
            const wavBuffer = pcmAWav(muestras, this.tasaHz);
            const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

            if (this.onFinalizar) this.onFinalizar(wavBlob, muestras, duracion);
        } catch (err) {
            if (this.onError) this.onError('Error al procesar el audio: ' + err.message);
        }
    }

    /** Inicia el VU-meter con requestAnimationFrame. */
    _iniciarVuMeter() {
        const datos = new Uint8Array(this.analizador.fftSize);
        const tick = () => {
            this.analizador.getByteTimeDomainData(datos);
            let sumaC = 0;
            for (let i = 0; i < datos.length; i++) {
                const v = (datos[i] - 128) / 128;
                sumaC += v * v;
            }
            const rms = Math.sqrt(sumaC / datos.length);
            if (this.onNivelVoz) this.onNivelVoz(Math.min(1, rms * 5));
            this.animFrameId = requestAnimationFrame(tick);
        };
        this.animFrameId = requestAnimationFrame(tick);
    }

    /** Detiene el VU-meter. */
    _detenerVuMeter() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        if (this.audioCtx) {
            this.audioCtx.close();
            this.audioCtx = null;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Grabador, remuestrear, pcmAWav };
} else {
    window.Grabador = Grabador;
    window.remuestrear = remuestrear;
    window.pcmAWav = pcmAWav;
}
