/**
 * participante.js — Controlador para la vista del Participante en RecopilaVoz
 * Permite registrar grabaciones para cada comando activo, visualizar el espectrograma
 * STFT en tiempo real y calcular los descriptores del experimento H7.
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // Referencias a elementos del DOM
    const formIngreso = document.getElementById('form-ingreso');
    const aliasInput = document.getElementById('alias-input');
    const pantallaIngreso = document.getElementById('pantalla-ingreso');
    const pantallaPrincipal = document.getElementById('pantalla-principal');
    const listaComandos = document.getElementById('lista-comandos');
    const panelVacio = document.getElementById('panel-vacio');
    const panelGrabacion = document.getElementById('panel-grabacion');
    const comandoBadge = document.getElementById('comando-badge');
    const comandoInstruccion = document.getElementById('comando-instruccion');
    const btnGrabar = document.getElementById('btn-grabar');
    const btnDetener = document.getElementById('btn-detener');
    const canvasVivo = document.getElementById('canvas-espectrograma-vivo');
    const vuBarra = document.getElementById('vu-barra');
    const panelResultado = document.getElementById('panel-resultado');
    const canvasResultado = document.getElementById('canvas-espectrograma-resultado');
    const resultadoDuracion = document.getElementById('resultado-duracion');
    const descHflf = document.getElementById('desc-hflf');
    const descAlta = document.getElementById('desc-alta');
    const descBaja = document.getElementById('desc-baja');
    const descZcr = document.getElementById('desc-zcr');
    const btnRepetir = document.getElementById('btn-repetir');
    const btnConfirmar = document.getElementById('btn-confirmar');
    const cargandoSubida = document.getElementById('cargando-subida');
    const temporizador = document.getElementById('temporizador');
    const temporizadorBarra = document.getElementById('temporizador-barra');
    const temporizadorTexto = document.getElementById('temporizador-texto');
    const estadoGrabacion = document.getElementById('estado-grabacion');
    const listaMisGrabaciones = document.getElementById('lista-mis-grabaciones');
    const btnRecargarGrabaciones = document.getElementById('btn-recargar-grabaciones');
    const btnSalir = document.getElementById('btn-salir');
    const toast = document.getElementById('toast');
    const barraProgreso = document.getElementById('progreso-barra');
    const progresoGrabados = document.getElementById('progreso-grabados');
    const progresoTotal = document.getElementById('progreso-total');
    const etiquetaAliasHeader = document.getElementById('etiqueta-alias-header');

    // Estado local del participante
    let alias = sessionStorage.getItem('recopilaVoz_alias') || '';
    let comandos = [];
    let comandoSeleccionado = null;
    let grabador = null;
    let audioBlobTemporal = null;
    let duracionTemporal = 0;
    let metaPorComando = 40;
    let conteoComandosUsuario = {};
    
    // Configuración de audio obtenida del backend
    let configGrabacion = { duracion_s: 3, tasa_hz: 16000, meta_por_comando: 40 };
    
    // Espectrograma en vivo
    let intervaloVivo = null;
    let analyserNode = null;

    // Inicialización de sesión si ya existe
    if (alias) {
        iniciarSesion(alias);
    }

    // Inicializar canvas de espectrograma en vivo en negro
    if (canvasVivo) {
        const ctx = canvasVivo.getContext('2d');
        ctx.fillStyle = '#080b12';
        ctx.fillRect(0, 0, canvasVivo.width, canvasVivo.height);
    }

    // Event Listeners
    if (formIngreso) {
        formIngreso.addEventListener('submit', (e) => {
            e.preventDefault();
            const nuevoAlias = aliasInput.value.trim();
            if (nuevoAlias) {
                iniciarSesion(nuevoAlias);
            }
        });
    }

    if (btnSalir) {
        btnSalir.addEventListener('click', () => {
            sessionStorage.removeItem('recopilaVoz_alias');
            location.reload();
        });
    }

    if (btnRecargarGrabaciones) {
        btnRecargarGrabaciones.addEventListener('click', cargarMisGrabaciones);
    }

    if (btnGrabar) btnGrabar.addEventListener('click', iniciarGrabacion);
    if (btnDetener) btnDetener.addEventListener('click', detenerGrabacion);

    if (btnRepetir) {
        btnRepetir.addEventListener('click', () => {
            if (panelResultado) panelResultado.classList.add('oculto');
            if (btnGrabar) {
                btnGrabar.style.display = 'inline-flex';
                btnGrabar.disabled = false;
            }
            if (btnDetener) btnDetener.disabled = true;
            if (estadoGrabacion) {
                estadoGrabacion.textContent = 'Listo';
                estadoGrabacion.className = 'estado-etiqueta estado-listo';
            }
            audioBlobTemporal = null;
            limpiarTemporizador();
            limpiarCanvasVivo();
        });
    }

    if (btnConfirmar) btnConfirmar.addEventListener('click', subirGrabacion);

    // =======================================================================
    // FUNCIONES PRINCIPALES
    // =======================================================================

    async function cargarConfigGrabacion() {
        try {
            const res = await fetch('/api/config-grabacion');
            const data = await res.json();
            if (data.config) {
                configGrabacion = data.config;
                metaPorComando = data.config.meta_por_comando || 40;
            }
            if (btnGrabar) {
                btnGrabar.innerHTML = `<span class="boton-grabar-punto"></span> Grabar (${configGrabacion.duracion_s} seg)`;
            }
        } catch (e) {
            console.warn('Usando configuración de audio por defecto');
        }
    }

    function iniciarSesion(nuevoAlias) {
        alias = nuevoAlias;
        sessionStorage.setItem('recopilaVoz_alias', alias);
        
        if (pantallaIngreso) {
            pantallaIngreso.classList.remove('activa');
            pantallaIngreso.style.display = 'none';
        }
        if (pantallaPrincipal) {
            pantallaPrincipal.classList.add('activa');
            pantallaPrincipal.style.display = 'flex';
        }
        if (etiquetaAliasHeader) {
            etiquetaAliasHeader.textContent = alias;
        }

        cargarConfigGrabacion().then(() => {
            cargarComandos();
            cargarMisGrabaciones();
        });
    }

    async function cargarComandos() {
        try {
            const res = await fetch('/api/comandos');
            const data = await res.json();
            comandos = data.comandos || [];
            renderizarComandos();
        } catch (error) {
            mostrarToast('Error al cargar la lista de comandos', 'error');
        }
    }

    function renderizarComandos() {
        if (!listaComandos) return;
        listaComandos.innerHTML = '';

        if (comandos.length === 0) {
            listaComandos.innerHTML = '<div class="cargando-comandos">No hay comandos activos en este momento.</div>';
            return;
        }

        comandos.forEach(cmd => {
            const conteo = conteoComandosUsuario[cmd.nombre] || 0;
            const esCompletado = conteo >= metaPorComando;
            
            const item = document.createElement('div');
            item.className = `item-comando ${esCompletado ? 'completado' : 'pendiente'}`;
            if (comandoSeleccionado && comandoSeleccionado.id === cmd.id) {
                item.classList.add('activo');
            }
            item.dataset.id = cmd.id;
            item.innerHTML = `
                <span class="cmd-nombre-texto">${cmd.nombre}</span>
                <span class="cmd-conteo-badge">${conteo}/${metaPorComando}</span>
            `;
            item.addEventListener('click', () => seleccionarComando(cmd, item));
            listaComandos.appendChild(item);
        });

        actualizarProgresoGlobal();
    }

    function seleccionarComando(cmd, elementoHtml) {
        document.querySelectorAll('.item-comando').forEach(el => el.classList.remove('activo'));
        elementoHtml.classList.add('activo');
        comandoSeleccionado = cmd;

        const conteo = conteoComandosUsuario[cmd.nombre] || 0;
        
        if (panelVacio) panelVacio.classList.remove('activo-panel');
        if (panelGrabacion) panelGrabacion.classList.add('activo-panel');

        if (comandoBadge) {
            if (conteo >= metaPorComando) {
                comandoBadge.textContent = `${cmd.nombre} (Meta completada: ${conteo}/${metaPorComando})`;
            } else {
                comandoBadge.textContent = `${cmd.nombre} (Grabación ${conteo + 1} de ${metaPorComando})`;
            }
        }
        if (comandoInstruccion) {
            comandoInstruccion.textContent = cmd.descripcion || `Pronuncia la palabra "${cmd.nombre}" en voz clara.`;
        }

        if (panelResultado) panelResultado.classList.add('oculto');
        if (btnGrabar) {
            btnGrabar.style.display = 'inline-flex';
            btnGrabar.disabled = false;
        }
        if (btnDetener) btnDetener.disabled = true;
        if (estadoGrabacion) {
            estadoGrabacion.textContent = 'Listo para grabar';
            estadoGrabacion.className = 'estado-etiqueta estado-listo';
        }
        
        limpiarTemporizador();
        limpiarCanvasVivo();
    }

    function actualizarProgresoGlobal() {
        let totalGrabados = 0;
        comandos.forEach(cmd => {
            totalGrabados += Math.min(metaPorComando, conteoComandosUsuario[cmd.nombre] || 0);
        });
        const totalMeta = comandos.length * metaPorComando;
        const porcentaje = totalMeta > 0 ? (totalGrabados / totalMeta) * 100 : 0;
        
        if (barraProgreso) barraProgreso.style.width = `${porcentaje}%`;
        if (progresoGrabados) progresoGrabados.textContent = totalGrabados;
        if (progresoTotal) progresoTotal.textContent = totalMeta;
    }

    // =======================================================================
    // CICLO DE GRABACIÓN & DSP
    // =======================================================================
    async function iniciarGrabacion() {
        if (!comandoSeleccionado) return;
        
        if (estadoGrabacion) {
            estadoGrabacion.textContent = 'Grabando...';
            estadoGrabacion.className = 'estado-etiqueta estado-grabando';
        }
        if (btnGrabar) btnGrabar.disabled = true;
        if (btnDetener) btnDetener.disabled = false;
        
        grabador = new Grabador(configGrabacion.tasa_hz);
        
        grabador.onNivelVoz = (nivel) => {
            if (vuBarra) {
                vuBarra.style.width = `${Math.min(100, Math.round(nivel * 100))}%`;
            }
        };

        try {
            await grabador.iniciar();
            iniciarEspectrogramaVivo();
            iniciarTemporizador(configGrabacion.duracion_s);
        } catch (err) {
            mostrarToast('No se pudo acceder al micrófono: ' + err.message, 'error');
            if (estadoGrabacion) {
                estadoGrabacion.textContent = 'Error de micrófono';
                estadoGrabacion.className = 'estado-etiqueta';
            }
            if (btnGrabar) btnGrabar.disabled = false;
            if (btnDetener) btnDetener.disabled = true;
        }
    }

    function detenerGrabacion() {
        if (grabador) {
            if (estadoGrabacion) {
                estadoGrabacion.textContent = 'Procesando señal...';
                estadoGrabacion.className = 'estado-etiqueta';
            }
            detenerEspectrogramaVivo();
            
            grabador.onFinalizar = (blob, audioData, sampleRate) => {
                audioBlobTemporal = blob;
                duracionTemporal = audioData.length / sampleRate;
                
                // Cálculo de Espectrograma STFT
                const stftFunc = (window.DSP && window.DSP.espectrogramaSTFT) || espectrogramaSTFT;
                const descFunc = (window.DSP && window.DSP.descriptoresEspectrales) || descriptoresEspectrales;
                const drawFunc = (window.Espectrograma && window.Espectrograma.dibujarEspectrograma) || window.dibujarEspectrograma || dibujarEspectrograma;

                const espectrograma = stftFunc(audioData, 512, 128, sampleRate);
                drawFunc(canvasResultado, espectrograma, { dbMin: -70, dbMax: 0, mostrarEjes: true });
                
                // Cálculo de Descriptores Espectrales del Experimento H7
                const descriptores = descFunc(audioData, sampleRate);
                if (descriptores) {
                    if (descHflf) descHflf.textContent = descriptores.hflfRatio.toFixed(3);
                    if (descAlta) descAlta.textContent = (descriptores.energiaAlta * 100).toFixed(1) + '%';
                    if (descBaja) descBaja.textContent = (descriptores.energiaBaja * 100).toFixed(1) + '%';
                    if (descZcr) descZcr.textContent = descriptores.zcr.toFixed(4);
                }
                
                if (resultadoDuracion) {
                    resultadoDuracion.textContent = `${duracionTemporal.toFixed(2)} segundos @ ${sampleRate} Hz`;
                }

                if (panelResultado) panelResultado.classList.remove('oculto');
                if (btnDetener) btnDetener.disabled = true;
                if (estadoGrabacion) {
                    estadoGrabacion.textContent = `Grabación lista (${duracionTemporal.toFixed(2)}s)`;
                    estadoGrabacion.className = 'estado-etiqueta estado-listo';
                }
                limpiarTemporizador();
            };
            
            grabador.detener();
        }
    }

    function iniciarEspectrogramaVivo() {
        limpiarCanvasVivo();
        if (!grabador || !grabador.audioCtx) return;
        
        analyserNode = grabador.audioCtx.createAnalyser();
        analyserNode.fftSize = 512;
        if (grabador.analizador) {
            grabador.analizador.connect(analyserNode);
        }
        
        const arrayDatos = new Float32Array(analyserNode.fftSize);
        const stftColFunc = (window.Espectrograma && window.Espectrograma.dibujarColumnaEnVivo) || dibujarColumnaEnVivo;
        const fftFunc = (window.DSP && window.DSP.fftReal) || fftReal;
        const magFunc = (window.DSP && window.DSP.magnitudFFT) || magnitudFFT;
        const potFunc = (window.DSP && window.DSP.potenciaEspectral) || potenciaEspectral;

        intervaloVivo = setInterval(() => {
            if (!analyserNode || !canvasVivo) return;
            analyserNode.getFloatTimeDomainData(arrayDatos);
            
            const { re, im } = fftFunc(arrayDatos);
            const magnitudes = magFunc(re, im);
            const potencia = potFunc(magnitudes);
            
            stftColFunc(canvasVivo, potencia, { dbMin: -75, dbMax: 0, anchoColumna: 3 });
        }, 60);
    }

    function detenerEspectrogramaVivo() {
        if (intervaloVivo) {
            clearInterval(intervaloVivo);
            intervaloVivo = null;
        }
        if (analyserNode) {
            analyserNode.disconnect();
            analyserNode = null;
        }
    }

    function limpiarCanvasVivo() {
        if (canvasVivo) {
            const ctx = canvasVivo.getContext('2d');
            ctx.fillStyle = '#080b12';
            ctx.fillRect(0, 0, canvasVivo.width, canvasVivo.height);
        }
    }

    function iniciarTemporizador(segundos) {
        if (temporizador) temporizador.classList.remove('oculto');
        if (temporizadorBarra) {
            temporizadorBarra.style.transition = `width ${segundos}s linear`;
            setTimeout(() => {
                temporizadorBarra.style.width = '100%';
            }, 30);
        }
        
        let restante = segundos;
        if (temporizadorTexto) temporizadorTexto.textContent = `${restante}.0s`;
        
        const paso = 100;
        let transcurrido = 0;
        const intTimer = setInterval(() => {
            transcurrido += paso;
            const rest = Math.max(0, (segundos * 1000 - transcurrido) / 1000);
            if (temporizadorTexto) temporizadorTexto.textContent = `${rest.toFixed(1)}s`;

            if (transcurrido >= segundos * 1000) {
                clearInterval(intTimer);
                if (estadoGrabacion && estadoGrabacion.textContent.includes('Grabando')) {
                    detenerGrabacion();
                }
            }
        }, paso);
    }

    function limpiarTemporizador() {
        if (temporizadorBarra) {
            temporizadorBarra.style.transition = 'none';
            temporizadorBarra.style.width = '0%';
        }
        if (temporizadorTexto) temporizadorTexto.textContent = `${configGrabacion.duracion_s}.0s`;
        if (vuBarra) vuBarra.style.width = '0%';
        if (temporizador) temporizador.classList.add('oculto');
    }

    // =======================================================================
    // SUBIDA Y SINCRONIZACIÓN
    // =======================================================================
    async function subirGrabacion() {
        if (!audioBlobTemporal || !comandoSeleccionado) return;
        
        if (cargandoSubida) cargandoSubida.classList.remove('oculto');
        if (btnConfirmar) btnConfirmar.disabled = true;
        
        const formData = new FormData();
        formData.append('audio', audioBlobTemporal, `${alias}_${comandoSeleccionado.nombre}.wav`);
        formData.append('alias', alias);
        formData.append('comando', comandoSeleccionado.nombre);
        formData.append('duracion_s', duracionTemporal.toFixed(2));

        try {
            const res = await fetch('/api/grabar', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            
            if (data.exito) {
                mostrarToast('Grabación guardada con éxito', 'exito');
                
                // Actualizar conteo local inmediatamente
                const cmdNombre = comandoSeleccionado.nombre;
                conteoComandosUsuario[cmdNombre] = (conteoComandosUsuario[cmdNombre] || 0) + 1;
                renderizarComandos();
                
                const nuevoConteo = conteoComandosUsuario[cmdNombre];
                if (comandoBadge) {
                    if (nuevoConteo >= metaPorComando) {
                        comandoBadge.textContent = `${cmdNombre} (Meta completada: ${nuevoConteo}/${metaPorComando})`;
                    } else {
                        comandoBadge.textContent = `${cmdNombre} (Grabación ${nuevoConteo + 1} de ${metaPorComando})`;
                    }
                }
                
                cargarMisGrabaciones();
                if (btnRepetir) btnRepetir.click();
            } else {
                mostrarToast(data.error || 'Error al guardar la grabación', 'error');
            }
        } catch (error) {
            mostrarToast('Error de red al conectar con el servidor', 'error');
        } finally {
            if (cargandoSubida) cargandoSubida.classList.add('oculto');
            if (btnConfirmar) btnConfirmar.disabled = false;
        }
    }

    async function cargarMisGrabaciones() {
        try {
            const res = await fetch(`/api/mis-audios?alias=${encodeURIComponent(alias)}`);
            const data = await res.json();
            if (!listaMisGrabaciones) return;
            
            listaMisGrabaciones.innerHTML = '';
            conteoComandosUsuario = {};

            if (data.grabaciones && data.grabaciones.length > 0) {
                data.grabaciones.forEach(grab => {
                    conteoComandosUsuario[grab.comando] = (conteoComandosUsuario[grab.comando] || 0) + 1;
                    
                    const div = document.createElement('div');
                    div.className = 'tarjeta-grabacion';
                    div.innerHTML = `
                        <div class="tarjeta-grabacion-info">
                            <h4>${grab.comando}</h4>
                            <p>${grab.duracion_s ? grab.duracion_s.toFixed(2) + 's' : '-'} • ${new Date(grab.created_at).toLocaleTimeString()}</p>
                        </div>
                        <audio controls src="${grab.url_audio}" preload="metadata"></audio>
                    `;
                    listaMisGrabaciones.appendChild(div);
                });
            } else {
                listaMisGrabaciones.innerHTML = '<p class="lista-vacia">Aún no tienes grabaciones registradas. Selecciona un comando para comenzar.</p>';
            }
            renderizarComandos();
        } catch (error) {
            mostrarToast('Error al cargar grabaciones previas', 'error');
        }
    }

    function mostrarToast(mensaje, tipo = 'info') {
        if (!toast) return;
        toast.textContent = mensaje;
        toast.className = `toast visible ${tipo}`;
        setTimeout(() => {
            toast.classList.remove('visible');
        }, 3200);
    }
});
