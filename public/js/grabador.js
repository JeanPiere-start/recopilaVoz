/**
 * grabador.js — Lógica de grabación, pre-calentamiento de micrófono y remuestreo a 16 kHz
 * Incluye:
 *   - Reutilización de MediaStream para eliminar latencia de arranque del hardware.
 *   - Beep sonoro de cuenta regresiva sintetizado con Web Audio API.
 *   - Remuestreo preciso a 16 kHz vía OfflineAudioContext.
 *   - Conversión de Float32Array PCM a WAV estándar (16-bit mono).
 */

'use strict';

/**
 * Convierte un Float32Array PCM a un buffer WAV de 16 bits mono.
 * @param {Float32Array} muestras - Audio PCM normalizado [-1, 1]
 * @param {number} tasa - Tasa de muestreo (ej: 16000)
 * @returns {ArrayBuffer} Buffer WAV
 */
function pcmAWav(muestras, tasa) {
    const numMuestras = muestras.length;
    const bytesAudio = numMuestras * 2; // 16 bits = 2 bytes por muestra
    const buffer = new ArrayBuffer(44 + bytesAudio);
    const vista = new DataView(buffer);

    const escribirString = (offset, str) => {
        for (let i = 0; i < str.length; i++) {
            vista.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    escribirString(0, 'RIFF');
    vista.setUint32(4, 36 + bytesAudio, true);
    escribirString(8, 'WAVE');
    escribirString(12, 'fmt ');
    vista.setUint32(16, 16, true);           // Tamaño del subchunk fmt
    vista.setUint16(20, 1, true);            // Formato PCM (1)
    vista.setUint16(22, 1, true);            // 1 canal (mono)
    vista.setUint32(24, tasa, true);         // Tasa de muestreo (16000 Hz)
    vista.setUint32(28, tasa * 2, true);     // Byte rate (tasa * canales * bits/8)
    vista.setUint16(32, 2, true);            // Block align
    vista.setUint16(34, 16, true);           // Bits por muestra
    escribirString(36, 'data');
    vista.setUint32(40, bytesAudio, true);

    // Convertir Float32 [-1.0, 1.0] a Int16 [-32768, 32767]
    for (let i = 0; i < numMuestras; i++) {
        const s = Math.max(-1, Math.min(1, muestras[i]));
        vista.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
    }

    return buffer;
}

/**
 * Remuestrea un AudioBuffer a la tasa objetivo usando OfflineAudioContext.
 * @param {AudioBuffer} audioBuffer - Buffer de audio nativo decodificado
 * @param {number} tasaObjetivo - Tasa de muestreo deseada (16000 Hz)
 * @returns {Promise<Float32Array>} Muestras remuestreadas mono
 */
async function remuestrear(audioBuffer, tasaObjetivo = 16000) {
    const duracion = audioBuffer.duration;
    const numMuestrasObjetivo = Math.ceil(duracion * tasaObjetivo);

    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        1,
        Math.max(1, numMuestrasObjetivo),
        tasaObjetivo
    );

    // Mezcla a mono si la entrada es estéreo
    const bufferMono = offlineCtx.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
    const dataMono = bufferMono.getChannelData(0);

    const numCanales = audioBuffer.numberOfChannels;
    for (let c = 0; c < numCanales; c++) {
        const canal = audioBuffer.getChannelData(c);
        for (let i = 0; i < canal.length; i++) {
            dataMono[i] += canal[i] / numCanales;
        }
    }

    const fuente = offlineCtx.createBufferSource();
    fuente.buffer = bufferMono;
    fuente.connect(offlineCtx.destination);
    fuente.start(0);

    const resultadoBuffer = await offlineCtx.startRendering();
    return resultadoBuffer.getChannelData(0);
}

// Variable estática para mantener el stream del micrófono activo (cero latencia de inicio)
let streamMicrofonoGlobal = null;

/**
 * Clase Grabador — Controla la captura de audio, feedback visual y remuestreo.
 */
class Grabador {
    constructor(tasaHz = 16000) {
        this.mediaRecorder = null;
        this.chunks = [];
        this.stream = streamMicrofonoGlobal;
        this.audioCtx = null;
        this.analizador = null;
        this.animFrameId = null;
        this.tasaHz = tasaHz;

        // Callbacks
        this.onIniciar = null;
        this.onFinalizar = null;
        this.onError = null;
        this.onNivelVoz = null;
    }

    /**
     * Pre-solicita permiso de micrófono y mantiene el stream activo en memoria
     * para que cuando el usuario pulse "Grabar" no exista ningún retraso de hardware.
     */
    static async preCalentarMicrofono() {
        try {
            if (!streamMicrofonoGlobal || !streamMicrofonoGlobal.active) {
                streamMicrofonoGlobal = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        sampleRate: { ideal: 16000 }
                    }
                });
            }
            return true;
        } catch (e) {
            console.warn('Microfono no inicializado de antemano:', e.message);
            return false;
        }
    }

    /**
     * Emite un tono sonoro sintetizado breve (beep) para guiar al hablante.
     * @param {number} frecHz - Frecuencia del tono (ej: 440 Hz o 880 Hz)
     * @param {number} duracionMs - Duración en milisegundos (ej: 80 ms)
     */
    static emitirBeep(frecHz = 520, duracionMs = 80) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(frecHz, ctx.currentTime);

            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (duracionMs / 1000));

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + (duracionMs / 1000));
            setTimeout(() => ctx.close(), duracionMs + 100);
        } catch (e) {}
    }

    /**
     * Prepara la captura de audio: activa el micrófono, el analizador (VU-meter /
     * espectrograma en vivo) y deja el MediaRecorder listo — pero SIN empezar a
     * capturar todavía. Esto permite mostrar la cuenta regresiva de preparación
     * sin que el audio de esos segundos (o los beeps) quede grabado en el WAV final.
     * Llamar a comenzarCaptura() para iniciar la grabación real.
     */
    async preparar() {
        try {
            if (!this.stream || !this.stream.active) {
                await Grabador.preCalentarMicrofono();
                this.stream = streamMicrofonoGlobal;
            }

            if (!this.stream) {
                throw new Error('No se pudo acceder al micrófono del dispositivo.');
            }

            // Crear AudioContext para análisis en tiempo real (VU-meter y espectrograma vivo)
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const fuente = this.audioCtx.createMediaStreamSource(this.stream);
            this.analizador = this.audioCtx.createAnalyser();
            this.analizador.fftSize = 512;
            fuente.connect(this.analizador);

            this._iniciarVuMeter();

            // Determinar MIME type soportado por el navegador
            const tiposMime = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/mp4'
            ];
            const mimeSeleccionado = tiposMime.find(t => MediaRecorder.isTypeSupported(t)) || '';

            this.chunks = [];
            this.mediaRecorder = new MediaRecorder(this.stream, mimeSeleccionado ? { mimeType: mimeSeleccionado } : {});

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this.chunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = () => this._procesarAudio();

        } catch (err) {
            const mensaje = err.name === 'NotAllowedError'
                ? 'Permiso de micrófono denegado. Habilita el acceso en los permisos de tu navegador.'
                : `Error al preparar grabación: ${err.message}`;
            if (this.onError) this.onError(mensaje);
            throw err;
        }
    }

    /**
     * Inicia la captura real de audio. Debe llamarse en el instante exacto en que
     * el hablante debe empezar a hablar (p. ej. justo al terminar la cuenta
     * regresiva de preparación), nunca antes.
     */
    comenzarCaptura() {
        if (!this.mediaRecorder) {
            throw new Error('El grabador no fue preparado. Llama a preparar() antes de comenzarCaptura().');
        }
        if (this.mediaRecorder.state !== 'inactive') return;
        this.mediaRecorder.start(50); // Timeslice de 50ms para captura continua
        if (this.onIniciar) this.onIniciar();
    }

    /**
     * Detiene la captura.
     */
    detener() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this._detenerVuMeter();
    }

    /**
     * Procesa los chunks capturados, decodifica a PCM, remuestrea a 16 kHz y genera WAV.
     */
    async _procesarAudio() {
        try {
            const blob = new Blob(this.chunks, { type: (this.mediaRecorder && this.mediaRecorder.mimeType) || 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();

            const ctxDecode = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await ctxDecode.decodeAudioData(arrayBuffer);
            ctxDecode.close();

            // Remuestreo a la tasa configurada (16000 Hz)
            const muestras16k = await remuestrear(audioBuffer, this.tasaHz);
            const duracion = muestras16k.length / this.tasaHz;

            // Generación de WAV
            const wavBuffer = pcmAWav(muestras16k, this.tasaHz);
            const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

            if (this.onFinalizar) {
                this.onFinalizar(wavBlob, muestras16k, this.tasaHz);
            }
        } catch (err) {
            console.error('Error al procesar audio:', err);
            if (this.onError) {
                this.onError('Error al procesar la señal de audio: ' + err.message);
            }
        }
    }

    /**
     * Bucle de análisis VU-meter en tiempo real.
     */
    _iniciarVuMeter() {
        if (!this.analizador) return;
        const datos = new Float32Array(this.analizador.fftSize);

        const tick = () => {
            if (!this.analizador) return;
            this.analizador.getFloatTimeDomainData(datos);

            let sumaCuadrados = 0;
            for (let i = 0; i < datos.length; i++) {
                sumaCuadrados += datos[i] * datos[i];
            }
            const rms = Math.sqrt(sumaCuadrados / datos.length);

            // Escalamiento visual no lineal para el VU-meter
            const nivel = Math.min(1.0, Math.pow(rms * 4.5, 0.7));
            if (this.onNivelVoz) this.onNivelVoz(nivel);

            this.animFrameId = requestAnimationFrame(tick);
        };

        this.animFrameId = requestAnimationFrame(tick);
    }

    /**
     * Limpieza de recursos del VU-meter.
     */
    _detenerVuMeter() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {});
            this.audioCtx = null;
        }
    }
}

// Exportación
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Grabador, remuestrear, pcmAWav };
} else {
    window.Grabador = Grabador;
    window.remuestrear = remuestrear;
    window.pcmAWav = pcmAWav;
}
