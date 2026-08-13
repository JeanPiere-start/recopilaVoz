document.addEventListener('DOMContentLoaded', () => {
    // Referencias a elementos del DOM
    const formIngreso = document.getElementById('form-ingreso');
    const aliasInput = document.getElementById('alias-input');
    const pantallaIngreso = document.getElementById('pantalla-ingreso');
    const pantallaPrincipal = document.getElementById('pantalla-principal');
    const listaComandos = document.getElementById('lista-comandos');
    const panelGrabacion = document.getElementById('panel-grabacion');
    const comandoNombre = document.getElementById('comando-badge');
    const comandoInstruccion = document.getElementById('comando-instruccion');
    const btnGrabar = document.getElementById('btn-grabar');
    const btnDetener = document.getElementById('btn-detener');
    const canvasVivo = document.getElementById('canvas-espectrograma-vivo');
    const vuBarra = document.getElementById('vu-barra');
    const panelResultado = document.getElementById('panel-resultado');
    const canvasResultado = document.getElementById('canvas-espectrograma-resultado');
    const descHflf = document.getElementById('desc-hflf');
    const descAlta = document.getElementById('desc-alta');
    const descBaja = document.getElementById('desc-baja');
    const descZcr = document.getElementById('desc-zcr');
    const btnRepetir = document.getElementById('btn-repetir');
    const btnConfirmar = document.getElementById('btn-confirmar');
    const cargandoSubida = document.getElementById('cargando-subida');
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

    // Estado de la aplicacion
    let alias = sessionStorage.getItem('alias') || '';
    let comandos = [];
    let comandoSeleccionado = null;
    let grabador = null;
    let audioBlobTemporal = null;
    let duracionTemporal = 0;
    
    // Espectrograma en vivo
    let intervaloVivo = null;
    let analyserNode = null;
    let indiceColumnaVivo = 0;

    // Inicializacion
    if (alias) {
        iniciarSesion(alias);
    }

    // Inicializar canvas negro
    if (canvasVivo) {
        const ctx = canvasVivo.getContext('2d');
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvasVivo.width, canvasVivo.height);
    }

    // Event Listeners
    formIngreso.addEventListener('submit', (e) => {
        e.preventDefault();
        const nuevoAlias = aliasInput.value.trim();
        if (nuevoAlias) {
            iniciarSesion(nuevoAlias);
        }
    });

    btnSalir.addEventListener('click', () => {
        sessionStorage.removeItem('alias');
        location.reload();
    });

    btnRecargarGrabaciones.addEventListener('click', cargarMisGrabaciones);

    btnGrabar.addEventListener('click', iniciarGrabacion);
    btnDetener.addEventListener('click', detenerGrabacion);
    btnRepetir.addEventListener('click', () => {
        panelResultado.style.display = 'none';
        btnGrabar.style.display = 'block';
        btnDetener.style.display = 'none';
        estadoGrabacion.textContent = 'Listo';
        audioBlobTemporal = null;
        limpiarTemporizador();
        limpiarCanvasVivo();
    });

    btnConfirmar.addEventListener('click', subirGrabacion);

    const META_POR_COMANDO = 40;
    let conteoComandosUsuario = {};

    // Funciones
    function iniciarSesion(nuevoAlias) {
        alias = nuevoAlias;
        sessionStorage.getItem('alias') || sessionStorage.setItem('alias', alias);
        pantallaIngreso.style.display = 'none';
        pantallaPrincipal.style.display = 'block';
        if (etiquetaAliasHeader) etiquetaAliasHeader.textContent = alias;
        cargarComandos();
        cargarMisGrabaciones();
    }

    async function cargarComandos() {
        try {
            const res = await fetch('/api/comandos');
            const data = await res.json();
            comandos = data.comandos || [];
            renderizarComandos();
        } catch (error) {
            mostrarToast('Error al cargar comandos', 'error');
        }
    }

    function renderizarComandos() {
        listaComandos.innerHTML = '';
        comandos.forEach(cmd => {
            const conteo = conteoComandosUsuario[cmd.nombre] || 0;
            const esCompletado = conteo >= META_POR_COMANDO;
            
            const item = document.createElement('div');
            item.className = `item-comando ${esCompletado ? 'completado' : 'pendiente'}`;
            if (comandoSeleccionado && comandoSeleccionado.id === cmd.id) {
                item.classList.add('activo');
            }
            item.dataset.id = cmd.id;
            item.innerHTML = `
                <span class="cmd-nombre-texto">${cmd.nombre}</span>
                <span class="cmd-conteo-badge">${conteo}/${META_POR_COMANDO}</span>
            `;
            item.addEventListener('click', () => seleccionarComando(cmd, item));
            listaComandos.appendChild(item);
        });
        actualizarProgreso();
    }

    function seleccionarComando(cmd, elementoHtml) {
        document.querySelectorAll('.item-comando').forEach(el => el.classList.remove('activo'));
        elementoHtml.classList.add('activo');
        comandoSeleccionado = cmd;

        const conteo = conteoComandosUsuario[cmd.nombre] || 0;
        panelGrabacion.style.display = 'block';
        if (comandoNombre) {
            if (conteo >= META_POR_COMANDO) {
                comandoNombre.textContent = `${cmd.nombre} (¡Meta alcanzada! ${conteo}/${META_POR_COMANDO})`;
            } else {
                comandoNombre.textContent = `${cmd.nombre} (Grabación ${conteo + 1} de ${META_POR_COMANDO})`;
            }
        }
        if (comandoInstruccion) {
            comandoInstruccion.textContent = `${cmd.descripcion} (Objetivo: ${META_POR_COMANDO} grabaciones)`;
        }
        panelResultado.style.display = 'none';
        btnGrabar.style.display = 'block';
        btnDetener.style.display = 'none';
        estadoGrabacion.textContent = 'Listo';
        
        limpiarTemporizador();
        limpiarCanvasVivo();
    }

    function actualizarProgreso() {
        let totalGrabados = 0;
        comandos.forEach(cmd => {
            totalGrabados += Math.min(META_POR_COMANDO, conteoComandosUsuario[cmd.nombre] || 0);
        });
        const totalMeta = comandos.length * META_POR_COMANDO;
        const porcentaje = totalMeta > 0 ? (totalGrabados / totalMeta) * 100 : 0;
        
        if (barraProgreso) barraProgreso.style.width = `${porcentaje}%`;
        if (progresoGrabados) progresoGrabados.textContent = totalGrabados;
        if (progresoTotal) progresoTotal.textContent = totalMeta;
    }

    async function iniciarGrabacion() {
        if (!comandoSeleccionado) return;
        
        estadoGrabacion.textContent = 'Grabando...';
        btnGrabar.style.display = 'none';
        btnDetener.style.display = 'block';
        
        grabador = new Grabador();
        
        grabador.onNivelVoz = (nivel) => {
            if (vuBarra) {
                vuBarra.style.width = `${Math.min(100, nivel * 100)}%`;
            }
        };

        try {
            await grabador.iniciar();
            iniciarEspectrogramaVivo();
            iniciarTemporizador(3); 
        } catch (err) {
            mostrarToast('Error al acceder al microfono', 'error');
            estadoGrabacion.textContent = 'Listo';
            btnGrabar.style.display = 'block';
            btnDetener.style.display = 'none';
        }
    }

    function detenerGrabacion() {
        if (grabador) {
            estadoGrabacion.textContent = 'Procesando...';
            detenerEspectrogramaVivo();
            
            grabador.onFinalizar = async (blob, audioData, sampleRate) => {
                audioBlobTemporal = blob;
                duracionTemporal = audioData.length / sampleRate;
                
                // Procesamiento
                const espectrograma = DSP.espectrogramaSTFT(audioData, 512, 256);
                Espectrograma.dibujarEspectrograma(canvasResultado, espectrograma, sampleRate);
                
                const descriptores = DSP.descriptoresEspectrales(espectrograma, sampleRate);
                descHflf.textContent = descriptores.hflfRatio.toFixed(3);
                descAlta.textContent = descriptores.energiaAlta.toFixed(3);
                descBaja.textContent = descriptores.energiaBaja.toFixed(3);
                descZcr.textContent = (DSP.tasaCrucesPorCero(audioData) * 100).toFixed(2);
                
                panelResultado.style.display = 'block';
                btnDetener.style.display = 'none';
                estadoGrabacion.textContent = `Grabacion finalizada: ${duracionTemporal.toFixed(2)} s`;
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
        if (grabador.mediaStreamSource) {
            grabador.mediaStreamSource.connect(analyserNode);
        }
        
        indiceColumnaVivo = 0;
        const arrayDatos = new Float32Array(analyserNode.fftSize);
        
        intervaloVivo = setInterval(() => {
            if (!analyserNode) return;
            analyserNode.getFloatTimeDomainData(arrayDatos);
            
            // Calculo FFT
            const { re, im } = DSP.fftReal(arrayDatos);
            const magnitudes = DSP.magnitudFFT(re, im);
            const potencia = DSP.potenciaEspectral(magnitudes);
            
            Espectrograma.dibujarColumnaEnVivo(canvasVivo, potencia);
        }, 100);
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
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvasVivo.width, canvasVivo.height);
        }
    }

    function iniciarTemporizador(segundos) {
        if(temporizadorBarra) temporizadorBarra.style.transition = `width ${segundos}s linear`;
        setTimeout(() => {
            if(temporizadorBarra) temporizadorBarra.style.width = '100%';
        }, 50);
        
        let restante = segundos;
        if(temporizadorTexto) temporizadorTexto.textContent = `${restante}s`;
        
        const intervalo = setInterval(() => {
            restante--;
            if (restante <= 0) {
                clearInterval(intervalo);
                if (estadoGrabacion.textContent === 'Grabando...') {
                    detenerGrabacion();
                }
            } else {
                if(temporizadorTexto) temporizadorTexto.textContent = `${restante}s`;
            }
        }, 1000);
    }

    function limpiarTemporizador() {
        if(temporizadorBarra) {
            temporizadorBarra.style.transition = 'none';
            temporizadorBarra.style.width = '0%';
        }
        if(temporizadorTexto) temporizadorTexto.textContent = '3s';
        if(vuBarra) vuBarra.style.width = '0%';
    }

    async function subirGrabacion() {
        if (!audioBlobTemporal || !comandoSeleccionado) return;
        
        cargandoSubida.style.display = 'block';
        btnConfirmar.disabled = true;
        
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
                mostrarToast('Grabacion subida con exito', 'exito');
                
                // Actualizar conteo local inmediatamente
                const cmdNombre = comandoSeleccionado.nombre;
                conteoComandosUsuario[cmdNombre] = (conteoComandosUsuario[cmdNombre] || 0) + 1;
                renderizarComandos();
                
                const nuevoConteo = conteoComandosUsuario[cmdNombre];
                if (comandoNombre) {
                    if (nuevoConteo >= META_POR_COMANDO) {
                        comandoNombre.textContent = `${cmdNombre} (¡Meta alcanzada! ${nuevoConteo}/${META_POR_COMANDO})`;
                    } else {
                        comandoNombre.textContent = `${cmdNombre} (Grabación ${nuevoConteo + 1} de ${META_POR_COMANDO})`;
                    }
                }
                
                cargarMisGrabaciones();
                
                // Reset panel
                btnRepetir.click();
            } else {
                mostrarToast(data.error || 'Error al subir grabacion', 'error');
            }
        } catch (error) {
            mostrarToast('Error de red al subir', 'error');
        } finally {
            cargandoSubida.style.display = 'none';
            btnConfirmar.disabled = false;
        }
    }

    async function cargarMisGrabaciones() {
        try {
            const res = await fetch(`/api/mis-audios?alias=${encodeURIComponent(alias)}`);
            const data = await res.json();
            listaMisGrabaciones.innerHTML = '';
            
            conteoComandosUsuario = {};
            if (data.grabaciones) {
                data.grabaciones.forEach(grab => {
                    conteoComandosUsuario[grab.comando] = (conteoComandosUsuario[grab.comando] || 0) + 1;
                    
                    const div = document.createElement('div');
                    div.className = 'tarjeta-grabacion';
                    div.innerHTML = `
                        <h4>Comando: ${grab.comando}</h4>
                        <p>Duración: ${grab.duracion_s} s</p>
                        <p>Fecha: ${new Date(grab.created_at).toLocaleString()}</p>
                        <audio controls src="${grab.url_audio}"></audio>
                    `;
                    listaMisGrabaciones.appendChild(div);
                });
            }
            renderizarComandos();
        } catch (error) {
            mostrarToast('Error al cargar mis grabaciones', 'error');
        }
    }

    function mostrarToast(mensaje, tipo) {
        toast.textContent = mensaje;
        toast.className = `toast ${tipo} visible`;
        setTimeout(() => {
            toast.classList.remove('visible');
        }, 3000);
    }
});
