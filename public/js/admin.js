document.addEventListener('DOMContentLoaded', () => {
    // Referencias
    const formAuth = document.getElementById('form-auth');
    const tokenInput = document.getElementById('token-input');
    const pantallaAuth = document.getElementById('pantalla-auth');
    const panelAdmin = document.getElementById('panel-admin');
    const tabs = document.querySelectorAll('.sidebar-item[data-tab]');
    const tabContents = document.querySelectorAll('.admin-tab');
    const btnCerrarSesion = document.getElementById('btn-cerrar-sesion');
    const toast = document.getElementById('toast');

    // Resumen
    const statGrabaciones = document.getElementById('stat-total-grabaciones');
    const statParticipantes = document.getElementById('stat-total-participantes');
    const statComandos = document.getElementById('stat-total-comandos');
    const graficoComandos = document.getElementById('grafico-comandos');
    const tablaParticipantes = document.getElementById('tabla-participantes');

    // Grabaciones
    const tablaGrabacionesCuerpo = document.getElementById('tabla-grabaciones-cuerpo');
    const filtroAlias = document.getElementById('filtro-alias');
    const filtroComando = document.getElementById('filtro-comando');
    const btnFiltrar = document.getElementById('btn-filtrar');
    const btnLimpiarFiltros = document.getElementById('btn-limpiar-filtros');

    // Comandos
    const listaComandosAdmin = document.getElementById('lista-comandos-admin');
    const btnNuevoComando = document.getElementById('btn-nuevo-comando');
    const modalComando = document.getElementById('modal-comando');
    const btnCerrarModalComando = document.getElementById('modal-comando-cerrar');
    const btnCancelarComando = document.getElementById('btn-cancelar-comando');
    const formComando = document.getElementById('form-comando');

    // Exportaciones
    const btnExportarJson = document.getElementById('btn-exportar-json');
    const btnExportarCsv = document.getElementById('btn-exportar-csv');
    const btnDescargarZip = document.getElementById('btn-descargar-todo-zip');
    const btnDescargarFiltroZip = document.getElementById('btn-descargar-filtro-zip');

    // Reproductor Modal
    const modalReproductor = document.getElementById('modal-reproductor');
    const btnCerrarReproductor = document.getElementById('modal-cerrar');
    const audioReproductor = document.getElementById('audio-reproductor');
    const canvasModal = document.getElementById('canvas-espectrograma-modal');

    let token = sessionStorage.getItem('adminToken') || '';
    let currentPage = 1;

    // =========================================================
    // AUTENTICACION
    // =========================================================
    if (token) {
        mostrarPanelAdmin();
    }

    formAuth.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inputToken = tokenInput.value.trim();
        if (inputToken) {
            try {
                const res = await fetch('/api/admin/verificar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: inputToken })
                });
                const data = await res.json();
                if (data.valido) {
                    token = inputToken;
                    sessionStorage.setItem('adminToken', token);
                    mostrarPanelAdmin();
                } else {
                    mostrarToast('Token invalido', 'error');
                }
            } catch (err) {
                mostrarToast('Error de conexion', 'error');
            }
        }
    });

    btnCerrarSesion.addEventListener('click', () => {
        sessionStorage.removeItem('adminToken');
        location.reload();
    });

    // =========================================================
    // NAVEGACION TABS
    // =========================================================
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('activo'));
            tab.classList.add('activo');

            const target = tab.dataset.tab;
            tabContents.forEach(c => {
                if (c.id === target) {
                    c.classList.add('activo-tab');
                } else {
                    c.classList.remove('activo-tab');
                }
            });
            cargarDatosTab(target);
        });
    });

    function mostrarPanelAdmin() {
        pantallaAuth.style.display = 'none';
        panelAdmin.style.display = 'flex';
        if (tabs.length > 0) tabs[0].click();
        poblarFiltrosComandos();
    }

    async function peticionAuth(url, options = {}) {
        options.headers = options.headers || {};
        options.headers['X-Admin-Token'] = token;
        const res = await fetch(url, options);
        if (res.status === 401 || res.status === 403) {
            btnCerrarSesion.click();
            throw new Error('No autorizado');
        }
        return res;
    }

    function cargarDatosTab(tabId) {
        if (tabId === 'tab-resumen') cargarResumen();
        else if (tabId === 'tab-grabaciones') cargarGrabaciones();
        else if (tabId === 'tab-comandos') cargarComandos();
        else if (tabId === 'tab-configuracion') cargarConfigGrabacion();
    }

    // =========================================================
    // TAB: RESUMEN
    // =========================================================
    const btnActualizarStats = document.getElementById('btn-actualizar-stats');
    if (btnActualizarStats) {
        btnActualizarStats.addEventListener('click', cargarResumen);
    }

    async function cargarResumen() {
        try {
            const res = await peticionAuth('/api/admin/stats');
            const data = await res.json();

            if (statGrabaciones) statGrabaciones.textContent = data.totalGrabaciones || 0;
            if (statParticipantes) statParticipantes.textContent = data.totalParticipantes || 0;
            if (statComandos) statComandos.textContent = data.comandosActivos ? data.comandosActivos.length : 0;

            if (graficoComandos && data.grabacionesPorComando) {
                graficoComandos.innerHTML = '';
                const comandosKeys = Object.keys(data.grabacionesPorComando);
                const maxVal = Math.max(...Object.values(data.grabacionesPorComando), 40);

                comandosKeys.forEach(cmdNombre => {
                    const conteo = data.grabacionesPorComando[cmdNombre] || 0;
                    const barra = document.createElement('div');
                    barra.className = 'barra-grafico';
                    const ancho = (conteo / maxVal) * 100;
                    barra.innerHTML = `
                        <div class="barra-etiqueta">${cmdNombre}</div>
                        <div class="barra-relleno" style="width: ${Math.max(5, ancho)}%">${conteo} audios</div>
                    `;
                    graficoComandos.appendChild(barra);
                });
            }

            if (tablaParticipantes && data.grabacionesPorParticipante) {
                tablaParticipantes.innerHTML = `
                    <table class="tabla-datos">
                        <thead>
                            <tr><th>Alias Participante</th><th>Total Audios Grabados</th></tr>
                        </thead>
                        <tbody>
                            ${Object.keys(data.grabacionesPorParticipante).map(aliasP => `
                                <tr>
                                    <td><strong>${aliasP}</strong></td>
                                    <td>${data.grabacionesPorParticipante[aliasP]} audios</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            }
        } catch (err) {
            console.error(err);
        }
    }

    // =========================================================
    // TAB: GRABACIONES
    // =========================================================
    async function poblarFiltrosComandos() {
        try {
            const res = await peticionAuth('/api/admin/comandos');
            const data = await res.json();
            if (filtroComando) {
                filtroComando.innerHTML = '<option value="">Todos</option>';
                data.comandos.forEach(c => {
                    filtroComando.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
                });
            }
        } catch (err) {}
    }

    if (btnFiltrar) btnFiltrar.addEventListener('click', () => { currentPage = 1; cargarGrabaciones(); });
    if (btnLimpiarFiltros) btnLimpiarFiltros.addEventListener('click', () => {
        filtroAlias.value = '';
        filtroComando.value = '';
        currentPage = 1;
        cargarGrabaciones();
    });

    // Paginacion
    const btnPagAnterior = document.getElementById('btn-pag-anterior');
    const btnPagSiguiente = document.getElementById('btn-pag-siguiente');
    const infoPaginacion = document.getElementById('info-paginacion');

    if (btnPagAnterior) btnPagAnterior.addEventListener('click', () => {
        if (currentPage > 1) { currentPage--; cargarGrabaciones(); }
    });
    if (btnPagSiguiente) btnPagSiguiente.addEventListener('click', () => {
        currentPage++;
        cargarGrabaciones();
    });

    async function cargarGrabaciones() {
        try {
            const params = new URLSearchParams({
                pagina: currentPage,
                limite: 20,
                alias: filtroAlias ? filtroAlias.value.trim() : '',
                comando: filtroComando ? filtroComando.value : ''
            });
            const res = await peticionAuth(`/api/admin/audios?${params}`);
            const data = await res.json();

            if (tablaGrabacionesCuerpo) {
                tablaGrabacionesCuerpo.innerHTML = '';
                if (!data.grabaciones || data.grabaciones.length === 0) {
                    tablaGrabacionesCuerpo.innerHTML = '<tr><td colspan="5" class="celda-cargando">Sin resultados</td></tr>';
                    return;
                }
                data.grabaciones.forEach(g => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${g.alias}</td>
                        <td>${g.comando}</td>
                        <td>${g.duracion_s} s</td>
                        <td>${new Date(g.created_at).toLocaleString()}</td>
                        <td>
                            <button class="boton boton-secundario boton-pequeno" onclick="abrirReproductor('${g.url_audio}', '${g.alias}', '${g.comando}')">Escuchar</button>
                            <button class="boton boton-peligro boton-pequeno" onclick="eliminarGrabacion('${g.id}')">Eliminar</button>
                        </td>
                    `;
                    tablaGrabacionesCuerpo.appendChild(tr);
                });
            }

            if (infoPaginacion) infoPaginacion.textContent = `Página ${currentPage}`;
            if (btnPagAnterior) btnPagAnterior.disabled = currentPage <= 1;
            if (btnPagSiguiente) btnPagSiguiente.disabled = !data.grabaciones || data.grabaciones.length < 20;

        } catch (err) { console.error(err); }
    }

    window.eliminarGrabacion = async (id) => {
        if (!confirm('¿Eliminar esta grabacion?')) return;
        try {
            const res = await peticionAuth(`/api/admin/grabaciones/${id}`, { method: 'DELETE' });
            if (res.ok) {
                mostrarToast('Grabacion eliminada', 'exito');
                cargarGrabaciones();
            }
        } catch (err) {
            mostrarToast('Error al eliminar', 'error');
        }
    };

    // =========================================================
    // MODAL: REPRODUCTOR DE AUDIO
    // =========================================================
    window.abrirReproductor = async (url, alias, comando) => {
        modalReproductor.classList.remove('oculto');
        audioReproductor.src = url;
        document.getElementById('modal-titulo').textContent = `Grabacion de ${alias}`;
        document.getElementById('modal-subtitulo').textContent = `Comando: ${comando}`;

        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const res = await fetch(url);
            const arrayBuffer = await res.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            const audioData = audioBuffer.getChannelData(0);

            const espectrograma = DSP.espectrogramaSTFT(audioData, 512, 256);
            Espectrograma.dibujarEspectrograma(canvasModal, espectrograma, audioBuffer.sampleRate);

            const descriptores = DSP.descriptoresEspectrales(espectrograma, audioBuffer.sampleRate);
            document.getElementById('modal-desc-hflf').textContent = descriptores.hflfRatio.toFixed(3);
            document.getElementById('modal-desc-alta').textContent = descriptores.energiaAlta.toFixed(3);
            document.getElementById('modal-desc-baja').textContent = descriptores.energiaBaja.toFixed(3);
        } catch (err) {
            console.error('Error al procesar audio en modal', err);
        }
    };

    function cerrarReproductor() {
        modalReproductor.classList.add('oculto');
        audioReproductor.pause();
        audioReproductor.src = '';
    }

    if (btnCerrarReproductor) btnCerrarReproductor.addEventListener('click', cerrarReproductor);
    window.addEventListener('click', (e) => {
        if (e.target === modalReproductor) cerrarReproductor();
    });

    // =========================================================
    // TAB: COMANDOS
    // =========================================================
    async function cargarComandos() {
        try {
            const res = await peticionAuth('/api/admin/comandos');
            const data = await res.json();
            listaComandosAdmin.innerHTML = '';
            data.comandos.forEach(c => {
                const div = document.createElement('div');
                div.className = 'tarjeta-comando-admin';
                div.innerHTML = `
                    <div class="tarjeta-cmd-info">
                        <h4>${c.nombre}</h4>
                        <p>${c.descripcion || ''}</p>
                        <span class="estado-badge ${c.activo ? 'activo' : 'inactivo'}">${c.activo ? 'Activo' : 'Inactivo'}</span>
                    </div>
                    <div class="tarjeta-cmd-acciones">
                        <button class="boton boton-secundario boton-pequeno" onclick="editarComando('${c.id}', '${encodeURIComponent(c.nombre)}', '${encodeURIComponent(c.descripcion || '')}', ${c.orden || 0}, ${c.activo})">Editar</button>
                        <button class="boton boton-peligro boton-pequeno" onclick="eliminarComando('${c.id}')">Eliminar</button>
                    </div>
                `;
                listaComandosAdmin.appendChild(div);
            });
        } catch (err) { console.error(err); }
    }

    window.eliminarComando = async (id) => {
        if (!confirm('¿Eliminar este comando?')) return;
        try {
            const res = await peticionAuth(`/api/admin/comandos/${id}`, { method: 'DELETE' });
            if (res.ok) {
                mostrarToast('Comando eliminado', 'exito');
                cargarComandos();
                poblarFiltrosComandos();
            }
        } catch (err) {
            mostrarToast('Error al eliminar', 'error');
        }
    };

    // =========================================================
    // MODAL: CREAR / EDITAR COMANDO
    // =========================================================
    function abrirModalComando() {
        modalComando.classList.remove('oculto');
    }

    function cerrarModalComando() {
        modalComando.classList.add('oculto');
        formComando.reset();
        document.getElementById('cmd-id').value = '';
        document.getElementById('modal-comando-titulo').textContent = 'Nuevo comando';
        const errEl = document.getElementById('modal-comando-error');
        if (errEl) errEl.classList.add('oculto');
    }

    if (btnNuevoComando) {
        btnNuevoComando.addEventListener('click', () => {
            document.getElementById('cmd-id').value = '';
            document.getElementById('cmd-nombre').value = '';
            document.getElementById('cmd-descripcion').value = '';
            document.getElementById('cmd-orden').value = '0';
            document.getElementById('cmd-activo').checked = true;
            document.getElementById('modal-comando-titulo').textContent = 'Nuevo comando';
            abrirModalComando();
        });
    }

    if (btnCerrarModalComando) btnCerrarModalComando.addEventListener('click', cerrarModalComando);
    if (btnCancelarComando) btnCancelarComando.addEventListener('click', cerrarModalComando);
    window.addEventListener('click', (e) => {
        if (e.target === modalComando) cerrarModalComando();
    });

    window.editarComando = (id, nombreEnc, descEnc, orden, activo) => {
        document.getElementById('cmd-id').value = id;
        document.getElementById('cmd-nombre').value = decodeURIComponent(nombreEnc);
        document.getElementById('cmd-descripcion').value = decodeURIComponent(descEnc);
        document.getElementById('cmd-orden').value = orden;
        document.getElementById('cmd-activo').checked = activo === true || activo === 'true';
        document.getElementById('modal-comando-titulo').textContent = 'Editar comando';
        abrirModalComando();
    };

    if (formComando) {
        formComando.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errEl = document.getElementById('modal-comando-error');
            if (errEl) errEl.classList.add('oculto');

            const id = document.getElementById('cmd-id').value.trim();
            const nombre = document.getElementById('cmd-nombre').value.trim();
            const descripcion = document.getElementById('cmd-descripcion').value.trim();
            const orden = parseInt(document.getElementById('cmd-orden').value) || 0;
            const activo = document.getElementById('cmd-activo').checked;

            if (!nombre) {
                if (errEl) { errEl.textContent = 'El nombre es obligatorio.'; errEl.classList.remove('oculto'); }
                return;
            }

            const esEdicion = id !== '';
            const url = esEdicion ? `/api/admin/comandos/${id}` : '/api/admin/comandos';
            const method = esEdicion ? 'PUT' : 'POST';

            try {
                const res = await peticionAuth(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, descripcion, orden, activo })
                });
                const data = await res.json();

                if (res.ok && (data.exito || data.comando)) {
                    mostrarToast(esEdicion ? 'Comando actualizado' : 'Comando creado', 'exito');
                    cerrarModalComando();
                    cargarComandos();
                    poblarFiltrosComandos();
                } else {
                    if (errEl) {
                        errEl.textContent = data.error || 'Error al guardar';
                        errEl.classList.remove('oculto');
                    }
                }
            } catch (err) {
                mostrarToast('Error de conexion', 'error');
            }
        });
    }

    // =========================================================
    // EXPORTACIONES
    // =========================================================
    if (btnExportarJson) btnExportarJson.addEventListener('click', () => descargarRuta('/api/admin/exportar?formato=json', 'export.json'));
    if (btnExportarCsv) btnExportarCsv.addEventListener('click', () => descargarRuta('/api/admin/exportar?formato=csv', 'export.csv'));
    if (btnDescargarZip) btnDescargarZip.addEventListener('click', () => descargarRuta('/api/admin/descargar-zip', 'audios.zip'));

    if (btnDescargarFiltroZip) {
        btnDescargarFiltroZip.addEventListener('click', () => {
            const params = new URLSearchParams({
                alias: filtroAlias ? filtroAlias.value.trim() : '',
                comando: filtroComando ? filtroComando.value : ''
            });
            descargarRuta(`/api/admin/descargar-zip?${params}`, 'audios_filtrados.zip');
        });
    }

    async function descargarRuta(ruta, nombreArchivo) {
        try {
            const res = await peticionAuth(ruta);
            const blob = await res.blob();
            descargarArchivo(blob, nombreArchivo);
        } catch (err) {
            mostrarToast('Error al descargar', 'error');
        }
    }

    function descargarArchivo(blob, nombre) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }

    // =========================================================
    // TOAST
    // =========================================================
    function mostrarToast(mensaje, tipo) {
        toast.textContent = mensaje;
        toast.className = `toast ${tipo} visible`;
        setTimeout(() => {
            toast.classList.remove('visible');
        }, 3000);
    }

    // =========================================================
    // TAB: CONFIGURACION DE GRABACION
    // =========================================================
    async function cargarConfigGrabacion() {
        try {
            const res = await peticionAuth('/api/config-grabacion');
            const data = await res.json();
            const cfg = data.config;

            const elDuracion = document.getElementById('config-valor-duracion');
            const elTasa = document.getElementById('config-valor-tasa');
            const selDuracion = document.getElementById('config-duracion');
            const selTasa = document.getElementById('config-tasa');

            if (elDuracion) elDuracion.textContent = `${cfg.duracion_s} segundo${cfg.duracion_s !== 1 ? 's' : ''}`;
            if (elTasa) elTasa.textContent = `${cfg.tasa_hz.toLocaleString()} Hz`;
            if (selDuracion) selDuracion.value = String(cfg.duracion_s);
            if (selTasa) selTasa.value = String(cfg.tasa_hz);
        } catch (err) {
            console.error('Error al cargar config de grabacion', err);
        }
    }

    const formConfig = document.getElementById('form-config-grabacion');
    const btnRecargarConfig = document.getElementById('btn-recargar-config');
    const configError = document.getElementById('config-error');

    if (formConfig) {
        formConfig.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (configError) configError.classList.add('oculto');

            const duracion_s = parseInt(document.getElementById('config-duracion').value);
            const tasa_hz = parseInt(document.getElementById('config-tasa').value);

            try {
                const res = await peticionAuth('/api/admin/config-grabacion', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ duracion_s, tasa_hz })
                });
                const data = await res.json();

                if (data.exito) {
                    mostrarToast(`Configuracion guardada: ${duracion_s}s | ${tasa_hz.toLocaleString()} Hz`, 'exito');
                    cargarConfigGrabacion();
                } else {
                    if (configError) {
                        configError.textContent = data.error || 'Error al guardar';
                        configError.classList.remove('oculto');
                    }
                }
            } catch (err) {
                mostrarToast('Error de conexion al guardar config', 'error');
            }
        });
    }

    if (btnRecargarConfig) {
        btnRecargarConfig.addEventListener('click', cargarConfigGrabacion);
    }
});
