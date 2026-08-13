document.addEventListener('DOMContentLoaded', () => {
    // Referencias
    const formAuth = document.getElementById('form-auth');
    const tokenInput = document.getElementById('token-input');
    const pantallaAuth = document.getElementById('pantalla-auth');
    const panelAdmin = document.getElementById('panel-admin');
    const tabs = document.querySelectorAll('.sidebar-item');
    const tabContents = document.querySelectorAll('.tab-content');
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

    // Inicializacion
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

    // Navegacion Tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('activo'));
            tab.classList.add('activo');
            const target = tab.dataset.tab;
            tabContents.forEach(c => {
                c.style.display = c.id === target ? 'block' : 'none';
            });
            cargarDatosTab(target);
        });
    });

    function mostrarPanelAdmin() {
        pantallaAuth.style.display = 'none';
        panelAdmin.style.display = 'flex';
        // Activar primer tab
        if(tabs.length > 0) tabs[0].click();
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
    }

    // --- TAB RESUMEN ---
    async function cargarResumen() {
        try {
            const res = await peticionAuth('/api/admin/stats');
            const data = await res.json();
            
            if (statGrabaciones) statGrabaciones.textContent = data.totalGrabaciones || 0;
            if (statParticipantes) statParticipantes.textContent = data.totalParticipantes || 0;
            if (statComandos) statComandos.textContent = data.totalComandos || 0;

            if (graficoComandos && data.comandos) {
                graficoComandos.innerHTML = '';
                const maxVal = Math.max(...data.comandos.map(c => c.conteo), 1);
                data.comandos.forEach(c => {
                    const barra = document.createElement('div');
                    barra.className = 'barra-grafico';
                    const ancho = (c.conteo / maxVal) * 100;
                    barra.innerHTML = `
                        <div class="barra-etiqueta">${c.comando}</div>
                        <div class="barra-relleno" style="width: ${ancho}%">${c.conteo}</div>
                    `;
                    graficoComandos.appendChild(barra);
                });
            }

            if (tablaParticipantes && data.participantes) {
                tablaParticipantes.innerHTML = `<tr><th>Alias</th><th>Grabaciones</th></tr>`;
                data.participantes.forEach(p => {
                    tablaParticipantes.innerHTML += `<tr><td>${p.alias}</td><td>${p.conteo}</td></tr>`;
                });
            }
        } catch (err) {
            console.error(err);
        }
    }

    // --- TAB GRABACIONES ---
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
        } catch (err) { }
    }

    btnFiltrar.addEventListener('click', () => {
        currentPage = 1;
        cargarGrabaciones();
    });
    
    btnLimpiarFiltros.addEventListener('click', () => {
        filtroAlias.value = '';
        filtroComando.value = '';
        currentPage = 1;
        cargarGrabaciones();
    });

    async function cargarGrabaciones() {
        try {
            const params = new URLSearchParams({
                pagina: currentPage,
                limite: 20,
                alias: filtroAlias.value.trim(),
                comando: filtroComando.value
            });
            const res = await peticionAuth(`/api/admin/audios?${params}`);
            const data = await res.json();
            
            tablaGrabacionesCuerpo.innerHTML = '';
            data.grabaciones.forEach(g => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${g.alias}</td>
                    <td>${g.comando}</td>
                    <td>${g.duracion_s} s</td>
                    <td>${new Date(g.created_at).toLocaleString()}</td>
                    <td>
                        <button class="btn btn-sm" onclick="abrirReproductor('${g.url_audio}', '${g.alias}', '${g.comando}')">Escuchar</button>
                        <button class="btn btn-sm btn-peligro" onclick="eliminarGrabacion('${g.id}')">Eliminar</button>
                    </td>
                `;
                tablaGrabacionesCuerpo.appendChild(tr);
            });
        } catch (err) { }
    }

    window.eliminarGrabacion = async (id) => {
        if (!confirm('Eliminar esta grabacion?')) return;
        try {
            const res = await peticionAuth(`/api/admin/grabaciones/${id}`, { method: 'DELETE' });
            if (res.ok) {
                mostrarToast('Eliminado', 'exito');
                cargarGrabaciones();
            }
        } catch (err) {
            mostrarToast('Error', 'error');
        }
    };

    window.abrirReproductor = async (url, alias, comando) => {
        modalReproductor.style.display = 'block';
        audioReproductor.src = url;
        document.getElementById('modal-titulo').textContent = `Grabacion de ${alias}`;
        document.getElementById('modal-subtitulo').textContent = `Comando: ${comando}`;
        
        try {
            // Cargar audio para procesar
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
            console.error("Error al procesar audio en modal", err);
        }
    };

    btnCerrarReproductor.addEventListener('click', () => {
        modalReproductor.style.display = 'none';
        audioReproductor.pause();
    });

    window.addEventListener('click', (e) => {
        if (e.target === modalReproductor) {
            modalReproductor.style.display = 'none';
            audioReproductor.pause();
        }
    });

    // --- TAB COMANDOS ---
    async function cargarComandos() {
        try {
            const res = await peticionAuth('/api/admin/comandos');
            const data = await res.json();
            listaComandosAdmin.innerHTML = '';
            data.comandos.forEach(c => {
                const div = document.createElement('div');
                div.className = 'tarjeta-comando-admin';
                div.innerHTML = `
                    <h4>${c.nombre}</h4>
                    <p>${c.descripcion}</p>
                    <p>Estado: ${c.activo ? 'Activo' : 'Inactivo'}</p>
                    <button class="btn btn-sm" onclick="editarComando('${c.id}')">Editar</button>
                    <button class="btn btn-sm btn-peligro" onclick="eliminarComando('${c.id}')">Eliminar</button>
                `;
                listaComandosAdmin.appendChild(div);
            });
        } catch (err) {}
    }

    window.eliminarComando = async (id) => {
        if (!confirm('Eliminar comando?')) return;
        try {
            const res = await peticionAuth(`/api/admin/comandos/${id}`, { method: 'DELETE' });
            if (res.ok) {
                mostrarToast('Comando eliminado', 'exito');
                cargarComandos();
            }
        } catch (err) {
            mostrarToast('Error al eliminar', 'error');
        }
    };

    // Funciones Exportar / Descargar
    btnExportarJson.addEventListener('click', () => descargarRuta('/api/admin/exportar?formato=json', 'export.json'));
    btnExportarCsv.addEventListener('click', () => descargarRuta('/api/admin/exportar?formato=csv', 'export.csv'));
    btnDescargarZip.addEventListener('click', () => descargarRuta('/api/admin/descargar-zip', 'audios.zip'));
    
    btnDescargarFiltroZip.addEventListener('click', () => {
        const params = new URLSearchParams({
            alias: filtroAlias.value.trim(),
            comando: filtroComando.value
        });
        descargarRuta(`/api/admin/descargar-zip?${params}`, 'audios_filtrados.zip');
    });

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
    }

    function mostrarToast(mensaje, tipo) {
        toast.textContent = mensaje;
        toast.className = `toast ${tipo} visible`;
        setTimeout(() => {
            toast.classList.remove('visible');
        }, 3000);
    }
});
