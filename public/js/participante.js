/**
 * participante.js — Controlador para la vista del Participante en RecopilaVoz
 * Incluye:
 *   - Sistema Anti-Cortes: Pre-calentamiento del micrófono y cuenta regresiva de preparación (3-2-1 / ¡Habla!).
 *   - Visualización en tiempo real del espectrograma y VU-meter.
 *   - Reproductor de prueba inmediato antes de confirmar la grabación.
 *   - Cálculo de descriptores espectrales H7 y actualización precisa de métricas de progreso.
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // Referencias a elementos del DOM
    const formIngreso = document.getElementById('form-ingreso');
    const aliasInput = document.getElementById('alias-input');
    const inputNombres = document.getElementById('input-nombres');
    const inputContacto = document.getElementById('input-contacto');
    const inputNotas = document.getElementById('input-notas');
    const pantallaIngreso = document.getElementById('pantalla-ingreso');
    const pantallaPrincipal = document.getElementById('pantalla-principal');
    const listaComandos = document.getElementById('lista-comandos');
    const panelVacio = document.getElementById('panel-vacio');
    const panelGrabacion = document.getElementById('panel-grabacion');
    const comandoBadge = document.getElementById('comando-badge');
    const comandoInstruccion = document.getElementById('comando-instruccion');
    const btnGrabar = document.getElementById('btn-grabar');
    const btnDetener = document.getElementById('btn-detener');
    const selectCuentaPrevia = document.getElementById('select-cuenta-previa');
    const bannerCuenta = document.getElementById('cuenta-regresiva-banner');
    const cuentaNum = document.getElementById('cuenta-regresiva-num');
    const cuentaTxt = document.getElementById('cuenta-regresiva-txt');
    const canvasVivo = document.getElementById('canvas-espectrograma-vivo');
    const vuBarra = document.getElementById('vu-barra');
    const panelResultado = document.getElementById('panel-resultado');
    const audioPreview = document.getElementById('audio-preview-participante');
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

    // Elementos de Anuncio y Perfil
    const bannerAnuncio = document.getElementById('banner-anuncio-global');
    const anuncioTag = document.getElementById('anuncio-tag');
    const anuncioTexto = document.getElementById('anuncio-texto');
    const anuncioIcono = document.getElementById('anuncio-icono');
    const btnAbrirPerfil = document.getElementById('btn-abrir-perfil');
    const modalPerfil = document.getElementById('modal-perfil-participante');
    const modalPerfilAlias = document.getElementById('modal-perfil-alias');
    const perfilModalNombres = document.getElementById('perfil-modal-nombres');
    const perfilModalContacto = document.getElementById('perfil-modal-contacto');
    const perfilModalNotas = document.getElementById('perfil-modal-notas');
    const formPerfilModal = document.getElementById('form-perfil-modal');
    const btnCerrarModalPerfil = document.getElementById('btn-cerrar-modal-perfil');
    const btnCancelarModalPerfil = document.getElementById('btn-cancelar-modal-perfil');
    const btnDescargarMiTxt = document.getElementById('btn-descargar-mi-txt');

    // Código de dispositivo persistente: identifica a este navegador/dispositivo
    // como el "dueño" de un alias, para evitar que otra persona use el mismo
    // alias o boicotee (grabe/borre) las muestras de alguien más.
    function obtenerCodigoDispositivo() {
        let codigo = localStorage.getItem('recopilaVoz_codigoDispositivo');
        if (!codigo) {
            codigo = (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            localStorage.setItem('recopilaVoz_codigoDispositivo', codigo);
        }
        return codigo;
    }
    const codigoDispositivo = obtenerCodigoDispositivo();

    // Estado de la sesión del participante
    let alias = sessionStorage.getItem('recopilaVoz_alias') || '';
    let perfilHablante = null;
    let comandos = [];
    let comandoSeleccionado = null;
    let grabador = null;
    let audioBlobTemporal = null;
    let duracionTemporal = 0;
    let metaPorComando = 40;
    let conteoComandosUsuario = {};
    let enGrabacion = false;
    let timerGrabacionId = null;
    let timerIntervaloId = null;
    
    // Configuración global obtenida del servidor
    let configGrabacion = { duracion_s: 3, tasa_hz: 16000, meta_por_comando: 40 };
    
    // Espectrograma en vivo
    let intervaloVivo = null;
    let analyserNode = null;

    // Carga de anuncio activo
    cargarAnuncioGlobal();

    // Inicialización automática de sesión
    if (alias) {
        iniciarSesion(alias);
    }

    if (canvasVivo) {
        const ctx = canvasVivo.getContext('2d');
        ctx.fillStyle = '#080b12';
        ctx.fillRect(0, 0, canvasVivo.width, canvasVivo.height);
    }

    // =======================================================================
    // LISTENERS
    // =======================================================================
    /**
     * Reclama o verifica ante el servidor que este dispositivo puede usar el alias
     * indicado. Si el alias ya pertenece a otro dispositivo, no deja continuar.
     */
    async function verificarYReclamarAlias(aliasIntentado) {
        try {
            const res = await fetch('/api/participantes/ingresar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alias: aliasIntentado, codigoDispositivo })
            });
            const data = await res.json();
            if (res.ok && data.exito) {
                return { ok: true, alias: data.alias || aliasIntentado };
            }
            mostrarToast(data.error || 'Ese alias ya está en uso por otro participante.', 'error');
            return { ok: false };
        } catch (e) {
            mostrarToast('Error de conexión al verificar el alias.', 'error');
            return { ok: false };
        }
    }

    if (formIngreso) {
        formIngreso.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nuevoAlias = aliasInput.value.trim();
            if (!nuevoAlias) return;

            const btnSubmit = formIngreso.querySelector('button[type="submit"]');
            if (btnSubmit) btnSubmit.disabled = true;

            const verificacion = await verificarYReclamarAlias(nuevoAlias);

            if (btnSubmit) btnSubmit.disabled = false;
            if (!verificacion.ok) return;

            const nombres = inputNombres ? inputNombres.value.trim() : '';
            const contacto = inputContacto ? inputContacto.value.trim() : '';
            const notas = inputNotas ? inputNotas.value.trim() : '';

            if (nombres || contacto || notas) {
                await guardarPerfilParticipante(verificacion.alias, nombres, contacto, notas);
            }

            iniciarSesion(verificacion.alias);
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

    if (btnGrabar) btnGrabar.addEventListener('click', manejarClickGrabar);
    if (btnDetener) btnDetener.addEventListener('click', detenerGrabacion);

    if (btnRepetir) {
        btnRepetir.addEventListener('click', () => {
            if (panelResultado) panelResultado.classList.add('oculto');
            if (audioPreview) {
                audioPreview.pause();
                audioPreview.src = '';
            }
            if (btnGrabar) {
                btnGrabar.style.display = 'inline-flex';
                btnGrabar.disabled = false;
            }
            if (btnDetener) btnDetener.disabled = true;
            if (estadoGrabacion) {
                estadoGrabacion.textContent = 'Listo para grabar';
                estadoGrabacion.className = 'estado-etiqueta estado-listo';
            }
            audioBlobTemporal = null;
            limpiarTemporizador();
            limpiarCanvasVivo();
        });
    }

    if (btnConfirmar) btnConfirmar.addEventListener('click', subirGrabacion);

    // Listeners del Perfil / Modal
    if (btnAbrirPerfil) {
        btnAbrirPerfil.addEventListener('click', abrirModalPerfil);
    }
    if (btnCerrarModalPerfil) {
        btnCerrarModalPerfil.addEventListener('click', cerrarModalPerfil);
    }
    if (btnCancelarModalPerfil) {
        btnCancelarModalPerfil.addEventListener('click', cerrarModalPerfil);
    }
    if (formPerfilModal) {
        formPerfilModal.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!alias) return;
            const nombres = perfilModalNombres ? perfilModalNombres.value.trim() : '';
            const contacto = perfilModalContacto ? perfilModalContacto.value.trim() : '';
            const notas = perfilModalNotas ? perfilModalNotas.value.trim() : '';

            const exito = await guardarPerfilParticipante(alias, nombres, contacto, notas);
            if (exito) {
                mostrarToast('Ficha de datos guardada correctamente', 'exito');
                cerrarModalPerfil();
            }
        });
    }
    if (btnDescargarMiTxt) {
        btnDescargarMiTxt.addEventListener('click', () => {
            if (alias) {
                window.open(`/api/admin/hablantes/${encodeURIComponent(alias)}/info-txt`, '_blank');
            }
        });
    }

    // Cerrar modal al hacer click en overlay
    if (modalPerfil) {
        modalPerfil.addEventListener('click', (e) => {
            if (e.target === modalPerfil) cerrarModalPerfil();
        });
    }

    // =======================================================================
    // GESTIÓN DE ANUNCIOS & MENSAJES DE ADMINISTRADORES
    // =======================================================================
    async function cargarAnuncioGlobal() {
        try {
            const res = await fetch('/api/anuncio');
            const data = await res.json();
            const anuncio = data.anuncio;

            if (bannerAnuncio && anuncio && anuncio.activo && anuncio.mensaje && anuncio.mensaje.trim()) {
                if (anuncioTexto) anuncioTexto.textContent = anuncio.mensaje.trim();
                
                // Tipo y estilo
                bannerAnuncio.className = 'banner-anuncio-participante';
                if (anuncio.tipo === 'importante') {
                    bannerAnuncio.classList.add('banner-importante');
                    if (anuncioTag) anuncioTag.textContent = 'Aviso Importante';
                } else if (anuncio.tipo === 'exito') {
                    bannerAnuncio.classList.add('banner-exito');
                    if (anuncioTag) anuncioTag.textContent = 'Novedad / Anuncio';
                } else {
                    bannerAnuncio.classList.add('banner-info');
                    if (anuncioTag) anuncioTag.textContent = 'Mensaje del Administrador';
                }
                bannerAnuncio.classList.remove('oculto');
            } else if (bannerAnuncio) {
                bannerAnuncio.classList.add('oculto');
            }
        } catch (e) {
            console.warn('[recopilaVoz] No se pudo cargar anuncio global:', e.message);
        }
    }

    // =======================================================================
    // PERFIL & FICHA DE DATOS DEL HABLANTE
    // =======================================================================
    async function cargarPerfilParticipante(aliasConsultar) {
        try {
            const res = await fetch(`/api/participantes/perfil?alias=${encodeURIComponent(aliasConsultar)}`);
            const data = await res.json();
            if (data.perfil) {
                perfilHablante = data.perfil;
            }
        } catch (e) {
            console.warn('[recopilaVoz] Error al consultar perfil:', e.message);
        }
    }

    async function guardarPerfilParticipante(aliasGuardar, nombres, contacto, notas) {
        try {
            const res = await fetch('/api/participantes/perfil', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    alias: aliasGuardar,
                    nombres_apellidos: nombres,
                    contacto: contacto,
                    notas: notas,
                    codigoDispositivo
                })
            });
            const data = await res.json();
            if (data.exito && data.perfil) {
                perfilHablante = data.perfil;
                return true;
            } else {
                mostrarToast(data.error || 'Error al guardar perfil', 'error');
                return false;
            }
        } catch (e) {
            mostrarToast('Error de conexión al guardar perfil', 'error');
            return false;
        }
    }

    function abrirModalPerfil() {
        if (!modalPerfil) return;
        if (modalPerfilAlias) modalPerfilAlias.textContent = alias || '---';

        if (perfilHablante) {
            if (perfilModalNombres) perfilModalNombres.value = perfilHablante.nombres_apellidos || '';
            if (perfilModalContacto) perfilModalContacto.value = perfilHablante.contacto || '';
            if (perfilModalNotas) perfilModalNotas.value = perfilHablante.notas || '';
        } else {
            cargarPerfilParticipante(alias).then(() => {
                if (perfilHablante) {
                    if (perfilModalNombres) perfilModalNombres.value = perfilHablante.nombres_apellidos || '';
                    if (perfilModalContacto) perfilModalContacto.value = perfilHablante.contacto || '';
                    if (perfilModalNotas) perfilModalNotas.value = perfilHablante.notas || '';
                }
            });
        }

        modalPerfil.classList.remove('oculto');
    }

    function cerrarModalPerfil() {
        if (modalPerfil) modalPerfil.classList.add('oculto');
    }

    // =======================================================================
    // INICIO DE SESIÓN & DATOS
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
            console.warn('Usando configuración estándar');
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

        // Precalentar micrófono inmediatamente para que no haya retraso de hardware
        Grabador.preCalentarMicrofono().catch(() => {});

        cargarConfigGrabacion().then(() => {
            cargarPerfilParticipante(alias);
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
            mostrarToast('Error al obtener la lista de comandos', 'error');
        }
    }

    function renderizarComandos() {
        if (!listaComandos) return;
        listaComandos.innerHTML = '';

        if (comandos.length === 0) {
            listaComandos.innerHTML = '<div class="cargando-comandos">No hay comandos activos actualmente.</div>';
            return;
        }

        comandos.forEach(cmd => {
            const metaCmd = cmd.limite_bloque || metaPorComando || 40;
            const conteo = conteoComandosUsuario[cmd.nombre] || 0;
            const esCompletado = conteo >= metaCmd;
            
            const item = document.createElement('div');
            item.className = `item-comando ${esCompletado ? 'completado' : 'pendiente'}`;
            if (comandoSeleccionado && comandoSeleccionado.id === cmd.id) {
                item.classList.add('activo');
            }
            item.dataset.id = cmd.id;
            item.innerHTML = `
                <span class="cmd-nombre-texto">${cmd.nombre}</span>
                <span class="cmd-conteo-badge">${conteo}/${metaCmd}</span>
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

        actualizarEncabezadoComando(cmd.nombre, conteo);

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
        ocultarBannerCuenta();
    }

    function actualizarEncabezadoComando(nombre, conteo) {
        if (!comandoBadge) return;
        const metaCmd = (comandoSeleccionado && comandoSeleccionado.limite_bloque) || metaPorComando || 40;
        if (conteo >= metaCmd) {
            comandoBadge.textContent = `${nombre} (Meta completada: ${conteo}/${metaCmd})`;
        } else {
            comandoBadge.textContent = `${nombre} (Grabación ${conteo + 1} de ${metaCmd})`;
        }
    }

    function actualizarProgresoGlobal() {
        let totalGrabados = 0;
        let totalMeta = 0;
        comandos.forEach(cmd => {
            const metaCmd = cmd.limite_bloque || metaPorComando || 40;
            totalMeta += metaCmd;
            totalGrabados += Math.min(metaCmd, conteoComandosUsuario[cmd.nombre] || 0);
        });
        if (totalMeta === 0) totalMeta = Math.max(1, comandos.length * (metaPorComando || 40));
        const porcentaje = Math.min(100, Math.round((totalGrabados / totalMeta) * 100));
        
        if (barraProgreso) barraProgreso.style.width = `${porcentaje}%`;
        if (progresoGrabados) progresoGrabados.textContent = totalGrabados;
        if (progresoTotal) progresoTotal.textContent = totalMeta;
    }

    // =======================================================================
    // SISTEMA ANTI-CORTES & CUENTA REGRESIVA DE PREPARACIÓN
    // =======================================================================
    async function manejarClickGrabar() {
        if (!comandoSeleccionado || enGrabacion) return;

        const segundosEspera = parseInt(selectCuentaPrevia ? selectCuentaPrevia.value : 2) || 0;

        if (btnGrabar) btnGrabar.disabled = true;

        // Iniciar micrófono de inmediato para que esté 100% caliente
        grabador = new Grabador(configGrabacion.tasa_hz);
        grabador.onNivelVoz = (nivel) => {
            if (vuBarra) {
                vuBarra.style.width = `${Math.min(100, Math.round(nivel * 100))}%`;
            }
        };

        try {
            await grabador.preparar();
            iniciarEspectrogramaVivo();
        } catch (err) {
            mostrarToast('No se pudo acceder al micrófono: ' + err.message, 'error');
            if (btnGrabar) btnGrabar.disabled = false;
            return;
        }

        if (segundosEspera > 0) {
            ejecutarCuentaRegresiva(segundosEspera);
        } else {
            grabador.comenzarCaptura();
            comenzarCapturaVoz();
        }
    }

    function ejecutarCuentaRegresiva(segundos) {
        if (bannerCuenta) bannerCuenta.classList.remove('oculto');
        if (estadoGrabacion) {
            estadoGrabacion.textContent = 'Preparando micrófono...';
            estadoGrabacion.className = 'estado-etiqueta estado-listo';
        }

        let cuenta = segundos;
        if (cuentaNum) cuentaNum.textContent = cuenta;
        if (cuentaTxt) cuentaTxt.textContent = 'Prepárate para pronunciar la palabra...';
        Grabador.emitirBeep(440, 80);

        const intCountdown = setInterval(() => {
            cuenta--;
            if (cuenta > 0) {
                if (cuentaNum) cuentaNum.textContent = cuenta;
                Grabador.emitirBeep(440, 80);
            } else {
                clearInterval(intCountdown);
                // Momento exacto de hablar: recién aquí arranca la captura real de audio
                if (cuentaNum) cuentaNum.textContent = '🔴';
                if (cuentaTxt) cuentaTxt.textContent = `¡HABLA AHORA! Di: "${comandoSeleccionado.nombre}"`;
                Grabador.emitirBeep(880, 140);
                grabador.comenzarCaptura();
                setTimeout(() => {
                    ocultarBannerCuenta();
                }, 900);
                comenzarCapturaVoz();
            }
        }, 1000);
    }

    function ocultarBannerCuenta() {
        if (bannerCuenta) bannerCuenta.classList.add('oculto');
    }

    function comenzarCapturaVoz() {
        enGrabacion = true;
        if (estadoGrabacion) {
            estadoGrabacion.textContent = '🔴 Grabando voz...';
            estadoGrabacion.className = 'estado-etiqueta estado-grabando';
        }
        if (btnDetener) btnDetener.disabled = false;

        iniciarTemporizador(configGrabacion.duracion_s);
    }

    function detenerGrabacion() {
        if (timerGrabacionId) {
            clearTimeout(timerGrabacionId);
            timerGrabacionId = null;
        }
        if (timerIntervaloId) {
            clearInterval(timerIntervaloId);
            timerIntervaloId = null;
        }

        if (grabador && enGrabacion) {
            enGrabacion = false;
            if (estadoGrabacion) {
                estadoGrabacion.textContent = 'Procesando señal espectral...';
                estadoGrabacion.className = 'estado-etiqueta';
            }
            detenerEspectrogramaVivo();
            
            grabador.onFinalizar = (blob, audioData, sampleRate) => {
                audioBlobTemporal = blob;
                duracionTemporal = audioData.length / sampleRate;

                // Cargar reproductor de prueba inmediato
                if (audioPreview) {
                    const audioUrl = URL.createObjectURL(blob);
                    audioPreview.src = audioUrl;
                }
                
                // Cálculo de Espectrograma STFT
                const stftFunc = (window.DSP && window.DSP.espectrogramaSTFT) || espectrogramaSTFT;
                const descFunc = (window.DSP && window.DSP.descriptoresEspectrales) || descriptoresEspectrales;
                const drawFunc = (window.Espectrograma && window.Espectrograma.dibujarEspectrograma) || window.dibujarEspectrograma || dibujarEspectrograma;

                const espectrograma = stftFunc(audioData, 512, 128, sampleRate);
                drawFunc(canvasResultado, espectrograma, { dbMin: -70, dbMax: 0, mostrarEjes: true });
                
                // Descriptores espectrales H7
                const descriptores = descFunc(audioData, sampleRate);
                if (descriptores) {
                    if (descHflf) descHflf.textContent = descriptores.hflfRatio.toFixed(3);
                    if (descAlta) descAlta.textContent = (descriptores.energiaAlta * 100).toFixed(1) + '%';
                    if (descBaja) descBaja.textContent = (descriptores.energiaBaja * 100).toFixed(1) + '%';
                    if (descZcr) descZcr.textContent = descriptores.zcr.toFixed(4);
                }
                
                if (resultadoDuracion) {
                    resultadoDuracion.textContent = `${duracionTemporal.toFixed(2)}s @ ${sampleRate} Hz`;
                }

                if (panelResultado) panelResultado.classList.remove('oculto');
                if (btnDetener) btnDetener.disabled = true;
                if (btnGrabar) btnGrabar.disabled = false;
                if (estadoGrabacion) {
                    estadoGrabacion.textContent = `Grabación completada (${duracionTemporal.toFixed(2)}s)`;
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
        }, 50);
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
        timerIntervaloId = setInterval(() => {
            transcurrido += paso;
            const rest = Math.max(0, (segundos * 1000 - transcurrido) / 1000);
            if (temporizadorTexto) temporizadorTexto.textContent = `${rest.toFixed(1)}s`;

            if (transcurrido >= segundos * 1000) {
                clearInterval(timerIntervaloId);
                timerIntervaloId = null;
                detenerGrabacion();
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
    // SUBIDA & PERSISTENCIA DE AUDIOS
    // =======================================================================
    async function subirGrabacion() {
        if (!audioBlobTemporal || !comandoSeleccionado) return;
        
        if (cargandoSubida) cargandoSubida.classList.remove('oculto');
        if (btnConfirmar) btnConfirmar.disabled = true;
        
        const tomaEstimativa = (conteoComandosUsuario[comandoSeleccionado.nombre] || 0) + 1;
        const formData = new FormData();
        formData.append('audio', audioBlobTemporal, `${alias}_${String(tomaEstimativa).padStart(2, '0')}_${comandoSeleccionado.nombre}.wav`);
        formData.append('alias', alias);
        formData.append('comando', comandoSeleccionado.nombre);
        formData.append('duracion_s', duracionTemporal.toFixed(2));
        formData.append('codigoDispositivo', codigoDispositivo);

        try {
            const res = await fetch('/api/grabar', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            
            if (data.exito) {
                mostrarToast(`¡Audio de "${comandoSeleccionado.nombre}" guardado con éxito!`, 'exito');
                
                // Actualizar inmediatamente conteo local
                const cmdNombre = comandoSeleccionado.nombre;
                conteoComandosUsuario[cmdNombre] = (conteoComandosUsuario[cmdNombre] || 0) + 1;
                
                actualizarEncabezadoComando(cmdNombre, conteoComandosUsuario[cmdNombre]);
                renderizarComandos();
                cargarMisGrabaciones();

                if (btnRepetir) btnRepetir.click();
            } else {
                mostrarToast(data.error || 'Error al guardar grabación', 'error');
            }
        } catch (error) {
            mostrarToast('Error de conexión al subir la grabación', 'error');
        } finally {
            if (cargandoSubida) cargandoSubida.classList.add('oculto');
            if (btnConfirmar) btnConfirmar.disabled = false;
        }
    }

    async function cargarMisGrabaciones() {
        try {
            const res = await fetch(`/api/mis-audios?alias=${encodeURIComponent(alias)}&codigoDispositivo=${encodeURIComponent(codigoDispositivo)}`);
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
                listaMisGrabaciones.innerHTML = '<p class="lista-vacia">Aún no tienes grabaciones guardadas. Selecciona un comando arriba para comenzar.</p>';
            }

            // Sincronizar badges de comandos y barra de progreso general
            renderizarComandos();
        } catch (error) {
            mostrarToast('Error al actualizar lista de grabaciones', 'error');
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
