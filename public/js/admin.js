/**
 * admin.js — Controlador del Panel de Administración de RecopilaVoz
 * Incluye: Multi-Admin, reproductor inline con espectrograma STFT y cursor sincronizado,
 * cálculo de métricas DSP en cliente, acciones en lote y gestión avanzada de comandos.
 */

'use strict';

const adminApp = (() => {
    
    // =======================================================================
    // ESTADO GLOBAL
    // =======================================================================
    let token = localStorage.getItem('recopilaVoz_adminToken') || '';
    let esSuperAdmin = false;

    let datos = {
        stats: {},
        grabaciones: [],
        comandos: [],
        admins: [],
        configGrabacion: { duracion_s: 3, tasa_hz: 16000, meta_por_comando: 40 },
        totalGrabaciones: 0
    };
    
    let filtros = {
        alias: '',
        comando: '',
        estado: '',
        ordenarPor: 'fecha_desc',
        pagina: 0,
        limite: 100
    };

    let seleccionGrabaciones = new Set();
    let seleccionComandos = new Set();
    
    let reproductorActual = null; // ID de la grabación abierta en la tabla
    let audioContextGlobal = null;

    // =======================================================================
    // INICIALIZACIÓN Y AUTENTICACIÓN
    // =======================================================================
    async function init() {
        configurarEventosModales();
        if (token) {
            const authResult = await verificarToken(token);
            if (authResult.valido) {
                esSuperAdmin = authResult.esSuperAdmin;
                actualizarRolUI();
                mostrarPantalla('pantalla-admin');
                cargarDatosIniciales();
            } else {
                cerrarSesion();
            }
        } else {
            mostrarPantalla('pantalla-auth');
        }
    }

    async function verificarToken(t) {
        try {
            const res = await fetch('/api/admin/verificar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: t })
            });
            const data = await res.json();
            return { valido: !!data.valido, esSuperAdmin: !!data.esSuperAdmin };
        } catch (e) {
            return { valido: false, esSuperAdmin: false };
        }
    }

    async function iniciarSesion(e) {
        e.preventDefault();
        const input = document.getElementById('input-token').value.trim();
        if (!input) return;

        const btn = e.target.querySelector('button');
        if (btn) btn.disabled = true;
        
        const authResult = await verificarToken(input);
        if (authResult.valido) {
            token = input;
            esSuperAdmin = authResult.esSuperAdmin;
            localStorage.setItem('recopilaVoz_adminToken', token);
            mostrarToast('Acceso concedido al panel de administración', 'exito');
            actualizarRolUI();
            mostrarPantalla('pantalla-admin');
            cargarDatosIniciales();
        } else {
            mostrarToast('Token de administrador inválido', 'error');
        }
        if (btn) btn.disabled = false;
    }

    function actualizarRolUI() {
        const badge = document.getElementById('sidebar-rol-badge');
        if (badge) {
            badge.textContent = esSuperAdmin ? 'Super Admin' : 'Admin';
            badge.className = esSuperAdmin ? 'sidebar-rol-tag badge-super' : 'sidebar-rol-tag';
        }
    }

    function cerrarSesion() {
        token = '';
        esSuperAdmin = false;
        localStorage.removeItem('recopilaVoz_adminToken');
        mostrarPantalla('pantalla-auth');
        const input = document.getElementById('input-token');
        if (input) input.value = '';
    }

    // =======================================================================
    // UTILIDADES & COMUNICACIÓN HTTP
    // =======================================================================
    function mostrarPantalla(id) {
        document.querySelectorAll('.pantalla').forEach(p => p.classList.remove('activa'));
        const target = document.getElementById(id);
        if (target) target.classList.add('activa');
    }

    function cambiarTab(tabId) {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('activo-tab'));
        const tabTarget = document.getElementById(`tab-${tabId}`);
        if (tabTarget) tabTarget.classList.add('activo-tab');
        
        document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('activo'));
        if (window.event && window.event.currentTarget && window.event.currentTarget.classList.contains('sidebar-item')) {
            window.event.currentTarget.classList.add('activo');
        }

        if (tabId === 'grabaciones') cargarGrabaciones();
        if (tabId === 'comandos') cargarComandos();
        if (tabId === 'resumen') cargarStats();
        if (tabId === 'admins') cargarAdmins();
        if (tabId === 'configuracion') cargarConfiguracionAudio();
    }

    function mostrarToast(mensaje, tipo = 'info') {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = mensaje;
        toast.className = `toast visible ${tipo}`;
        setTimeout(() => toast.classList.remove('visible'), 3200);
    }

    async function fetchAPI(url, opciones = {}) {
        opciones.headers = {
            ...opciones.headers,
            'Content-Type': 'application/json',
            'x-admin-token': token
        };
        const res = await fetch(url, opciones);
        if (res.status === 401) {
            cerrarSesion();
            throw new Error('Sesión expirada o token no autorizado.');
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error en la solicitud al servidor.');
        return data;
    }

    function cargarDatosIniciales() {
        cargarStats();
        cargarFiltroComandos();
        cargarGrabaciones();
        cargarComandos();
        cargarConfiguracionAudio();
    }

    // =======================================================================
    // DASHBOARD & ESTADÍSTICAS
    // =======================================================================
    async function cargarStats() {
        try {
            const data = await fetchAPI('/api/admin/stats');
            datos.stats = data;
            
            const elTotal = document.getElementById('stat-total-grabaciones');
            const elPart = document.getElementById('stat-participantes');
            const elVal = document.getElementById('stat-validados');
            const elRech = document.getElementById('stat-rechazados');
            const elPend = document.getElementById('stat-pendientes');
            const elDur = document.getElementById('stat-subtexto-duracion');
            const elTasa = document.getElementById('stat-tasa-aprobacion');
            const elProm = document.getElementById('stat-promedio-part');

            if (elTotal) elTotal.textContent = (data.totalGrabaciones ?? 0).toLocaleString();
            if (elPart) elPart.textContent = (data.totalParticipantes ?? 0).toLocaleString();
            if (elVal) elVal.textContent = (data.validados ?? 0).toLocaleString();
            if (elRech) elRech.textContent = (data.rechazados ?? 0).toLocaleString();
            if (elPend) elPend.textContent = (data.sinRevisar ?? 0).toLocaleString();

            if (elDur) {
                const segs = data.duracionTotalSegundos || 0;
                const mins = (segs / 60).toFixed(1);
                elDur.textContent = `${segs}s (${mins} min de audio)`;
            }

            if (elTasa) {
                elTasa.textContent = `${data.tasaAprobacion ?? 0}% tasa de aprobación`;
            }

            if (elProm) {
                elProm.textContent = `${data.promedioPorParticipante ?? 0} muestras / persona`;
            }

            renderizarDesglosesDashboard(data);
        } catch (e) {
            mostrarToast('Error al actualizar estadísticas: ' + e.message, 'error');
        }
    }

    function renderizarDesglosesDashboard(data) {
        // Desglose por Comando
        const contCmds = document.getElementById('desglose-comandos');
        const metaBadge = document.getElementById('meta-comando-badge');
        const metaPorCmd = datos.configGrabacion.meta_por_comando || 40;
        if (metaBadge) metaBadge.textContent = `Meta: ${metaPorCmd} / cmd`;

        if (contCmds && data.grabacionesPorComando) {
            const entriesCmd = Object.entries(data.grabacionesPorComando).sort((a, b) => b[1] - a[1]);
            const maxVal = Math.max(...entriesCmd.map(e => e[1]), metaPorCmd, 1);

            if (entriesCmd.length === 0) {
                contCmds.innerHTML = '<div class="lote-preview-vacio">No hay datos de comandos aún.</div>';
            } else {
                contCmds.innerHTML = entriesCmd.map(([cmd, cuenta]) => {
                    const pct = Math.min(100, Math.round((cuenta / maxVal) * 100));
                    const validados = (data.validadosPorComando && data.validadosPorComando[cmd]) || 0;
                    return `
                        <div class="desglose-item" onclick="adminApp.filtrarPorComandoRapido('${cmd}')" title="Filtrar por ${cmd}">
                            <div class="desglose-item-info">
                                <span class="desglose-item-nombre">${cmd}</span>
                                <span class="desglose-item-cuenta"><strong>${cuenta}</strong> grabaciones (${validados} ✓)</span>
                            </div>
                            <div class="barra-progreso-fondo">
                                <div class="barra-progreso-relleno" style="width: ${pct}%;"></div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // Desglose por Participante
        const contParts = document.getElementById('desglose-participantes');
        if (contParts && data.grabacionesPorParticipante) {
            const entriesPart = Object.entries(data.grabacionesPorParticipante).sort((a, b) => b[1] - a[1]);
            const maxValPart = Math.max(...entriesPart.map(e => e[1]), 1);

            if (entriesPart.length === 0) {
                contParts.innerHTML = '<div class="lote-preview-vacio">No hay participantes registrados aún.</div>';
            } else {
                contParts.innerHTML = entriesPart.map(([alias, cuenta]) => {
                    const pct = Math.min(100, Math.round((cuenta / maxValPart) * 100));
                    return `
                        <div class="desglose-item" onclick="adminApp.filtrarPorAliasRapido('${alias}')" title="Filtrar por ${alias}">
                            <div class="desglose-item-info">
                                <span class="desglose-item-nombre">${alias}</span>
                                <span class="desglose-item-cuenta">${cuenta} muestra(s)</span>
                            </div>
                            <div class="barra-progreso-fondo">
                                <div class="barra-progreso-relleno" style="width: ${pct}%; background: var(--color-acento);"></div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    }

    function filtrarPorComandoRapido(cmd) {
        cambiarTab('grabaciones');
        const select = document.getElementById('filtro-comando');
        if (select) select.value = cmd;
        aplicarFiltrosGrabaciones();
    }

    function filtrarPorAliasRapido(alias) {
        cambiarTab('grabaciones');
        const input = document.getElementById('filtro-alias');
        if (input) input.value = alias;
        aplicarFiltrosGrabaciones();
    }

    // =======================================================================
    // GRABACIONES & FILTROS
    // =======================================================================
    async function cargarGrabaciones() {
        const tbody = document.getElementById('lista-grabaciones');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="7" class="spinner-inline"><div class="spinner spinner-pequeno"></div> Cargando grabaciones...</td></tr>';
        
        try {
            const query = new URLSearchParams({
                pagina: filtros.pagina,
                limite: filtros.limite,
                ordenarPor: filtros.ordenarPor
            });
            if (filtros.alias) query.append('alias', filtros.alias);
            if (filtros.comando) query.append('comando', filtros.comando);
            if (filtros.estado !== '') query.append('valido', filtros.estado);

            const res = await fetchAPI(`/api/admin/audios?${query}`);
            datos.grabaciones = res.grabaciones || [];
            datos.totalGrabaciones = res.total || 0;
            
            const conteoEl = document.getElementById('conteo-resultados-grabaciones');
            if (conteoEl) {
                conteoEl.textContent = `Mostrando ${datos.grabaciones.length} de ${datos.totalGrabaciones} grabaciones`;
            }

            renderizarGrabaciones();
            actualizarBarraLoteGrabaciones();
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="7" class="mensaje-error" style="padding: 20px; text-align: center;">Error al cargar grabaciones: ${e.message}</td></tr>`;
        }
    }

    async function cargarFiltroComandos() {
        try {
            const data = await fetchAPI('/api/admin/comandos');
            datos.comandos = data.comandos || [];
            const select = document.getElementById('filtro-comando');
            if (!select) return;
            select.innerHTML = '<option value="">Todos los comandos</option>';
            datos.comandos.forEach(c => {
                select.innerHTML += `<option value="${c.nombre}">${c.nombre}</option>`;
            });
        } catch (e) {}
    }

    function renderizarGrabaciones() {
        const tbody = document.getElementById('lista-grabaciones');
        if (!tbody) return;

        if (datos.grabaciones.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="lote-preview-vacio">No se encontraron grabaciones con los filtros seleccionados.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        datos.grabaciones.forEach(g => {
            const tr = document.createElement('tr');
            tr.id = `fila-${g.id}`;
            
            let estadoHtml = '';
            let claseFila = '';
            if (g.valido === true) {
                estadoHtml = '<span class="badge badge-valido">✓ Válido</span>';
                claseFila = 'fila-valida';
            } else if (g.valido === false) {
                estadoHtml = '<span class="badge badge-rechazado">✗ Rechazado</span>';
                claseFila = 'fila-rechazada';
            } else {
                estadoHtml = '<span class="badge badge-pendiente">? Sin revisar</span>';
            }
            
            if (claseFila) tr.className = claseFila;

            const fecha = new Date(g.created_at).toLocaleString();
            const checked = seleccionGrabaciones.has(g.id) ? 'checked' : '';

            tr.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" class="campo-checkbox check-grabacion" value="${g.id}" ${checked} onchange="adminApp.toggleSeleccionGrabacion('${g.id}', event)">
                </td>
                <td style="font-weight: 600; color: var(--color-texto-1);">${g.alias}</td>
                <td><code style="font-size: 0.9em; font-weight: 600;">${g.comando}</code></td>
                <td style="font-family: var(--fuente-mono); font-size: 0.88em;">${g.duracion_s ? g.duracion_s.toFixed(2) + 's' : '-'}</td>
                <td style="color: var(--color-texto-3); font-size: 0.82em; font-family: var(--fuente-mono);">${fecha}</td>
                <td id="estado-${g.id}">${estadoHtml}</td>
                <td class="celda-acciones">
                    <button class="boton boton-pequeno boton-secundario" onclick="adminApp.toggleReproductor('${g.id}')" title="Escuchar y ver espectrograma STFT">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        Analizar
                    </button>
                    <button class="boton boton-pequeno ${g.valido === true ? 'boton-valido' : 'boton-fantasma'}" onclick="adminApp.validarGrabacion('${g.id}', true)" title="Marcar como Válido">✓</button>
                    <button class="boton boton-pequeno ${g.valido === false ? 'boton-rechazar' : 'boton-fantasma'}" onclick="adminApp.validarGrabacion('${g.id}', false)" title="Marcar como Rechazado">✗</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        const checkTodas = document.getElementById('check-todas-grabaciones');
        if (checkTodas) {
            checkTodas.checked = datos.grabaciones.length > 0 && datos.grabaciones.every(g => seleccionGrabaciones.has(g.id));
        }
    }

    function aplicarFiltrosGrabaciones() {
        const inputAlias = document.getElementById('filtro-alias');
        const selectCmd = document.getElementById('filtro-comando');
        const selectEst = document.getElementById('filtro-estado');
        const selectOrd = document.getElementById('filtro-orden');

        filtros.alias = inputAlias ? inputAlias.value.trim() : '';
        filtros.comando = selectCmd ? selectCmd.value : '';
        filtros.estado = selectEst ? selectEst.value : '';
        filtros.ordenarPor = selectOrd ? selectOrd.value : 'fecha_desc';
        filtros.pagina = 0;
        cargarGrabaciones();
    }

    function limpiarFiltrosGrabaciones() {
        const inputAlias = document.getElementById('filtro-alias');
        const selectCmd = document.getElementById('filtro-comando');
        const selectEst = document.getElementById('filtro-estado');
        const selectOrd = document.getElementById('filtro-orden');

        if (inputAlias) inputAlias.value = '';
        if (selectCmd) selectCmd.value = '';
        if (selectEst) selectEst.value = '';
        if (selectOrd) selectOrd.value = 'fecha_desc';

        filtros.alias = '';
        filtros.comando = '';
        filtros.estado = '';
        filtros.ordenarPor = 'fecha_desc';
        filtros.pagina = 0;
        cargarGrabaciones();
    }

    // =======================================================================
    // REPRODUCTOR INLINE EXPANDIBLE & ESPECTROGRAMA STFT
    // =======================================================================
    function toggleReproductor(id) {
        // Cerrar reproductor abierto anteriormente
        if (reproductorActual && reproductorActual !== id) {
            const trViejo = document.getElementById(`reproductor-tr-${reproductorActual}`);
            if (trViejo) trViejo.remove();
        }

        const trFila = document.getElementById(`fila-${id}`);
        const yaExiste = document.getElementById(`reproductor-tr-${id}`);

        if (yaExiste) {
            yaExiste.remove();
            reproductorActual = null;
            return;
        }

        const grab = datos.grabaciones.find(g => g.id === id);
        if (!grab || !trFila) return;

        let badgeClass = 'badge-pendiente';
        let badgeText = '? Sin revisar';
        if (grab.valido === true) {
            badgeClass = 'badge-valido';
            badgeText = '✓ Válido';
        } else if (grab.valido === false) {
            badgeClass = 'badge-rechazado';
            badgeText = '✗ Rechazado';
        }

        const tr = document.createElement('tr');
        tr.id = `reproductor-tr-${id}`;
        tr.className = 'fila-reproductor';
        
        tr.innerHTML = `
            <td colspan="7">
                <div class="reproductor-inline-card">
                    <div class="reproductor-header">
                        <div class="reproductor-titulo">
                            <span class="reproductor-badge-cmd">${grab.comando}</span>
                            <span class="reproductor-alias">Grabado por <strong>${grab.alias}</strong></span>
                            <span class="reproductor-fecha">${new Date(grab.created_at).toLocaleString()}</span>
                        </div>
                        <div class="reproductor-header-acciones">
                            <span class="badge ${badgeClass}" id="inline-badge-${id}">${badgeText}</span>
                            <button class="boton-icono" onclick="adminApp.toggleReproductor('${id}')" title="Cerrar reproductor">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                    </div>

                    <!-- Visualizador Espectrograma STFT -->
                    <div class="espectrograma-admin-container">
                        <div class="espectrograma-top-info">
                            <span>Espectrograma STFT (Ventana Hann 512, Avance 128)</span>
                            <span id="spec-status-${id}">Decodificando señal de audio...</span>
                        </div>
                        <div class="canvas-relative-wrapper">
                            <canvas id="spec-canvas-${id}" class="espectrograma-canvas-admin" width="800" height="180"></canvas>
                            <div id="spec-cursor-${id}" class="espectrograma-cursor"></div>
                        </div>
                        <div class="espectrograma-leyenda">
                            <span>0 Hz (Graves)</span>
                            <span>Análisis Espectral de Frecuencia vs Tiempo</span>
                            <span id="spec-maxfreq-${id}">8000 Hz (Agudos)</span>
                        </div>
                    </div>

                    <!-- Métricas Espectrales Calculadas -->
                    <div id="metricas-${id}" class="descriptores-panel">
                        <div class="descriptor-item">
                            <span class="descriptor-nombre">Energía Baja (&lt;2kHz)</span>
                            <span class="descriptor-valor" id="m-baja-${id}">--%</span>
                        </div>
                        <div class="descriptor-item">
                            <span class="descriptor-nombre">Energía Alta (&gt;2kHz)</span>
                            <span class="descriptor-valor" id="m-alta-${id}">--%</span>
                        </div>
                        <div class="descriptor-item">
                            <span class="descriptor-nombre">HF / LF Ratio</span>
                            <span class="descriptor-valor" id="m-hflf-${id}">--</span>
                        </div>
                        <div class="descriptor-item">
                            <span class="descriptor-nombre">Cruces por Cero (ZCR)</span>
                            <span class="descriptor-valor" id="m-zcr-${id}">--</span>
                        </div>
                        <div class="descriptor-item">
                            <span class="descriptor-nombre">Centroide Espectral</span>
                            <span class="descriptor-valor" id="m-centroide-${id}">-- Hz</span>
                        </div>
                    </div>

                    <!-- Barra de Reproducción y Acciones -->
                    <div class="reproductor-footer">
                        <audio id="audio-elem-${id}" controls class="reproductor-audio-custom" src="${grab.url_audio}" preload="auto"></audio>
                        
                        <div class="reproductor-estado-acciones">
                            <button class="boton boton-valido ${grab.valido === true ? 'activo' : ''}" onclick="adminApp.validarGrabacion('${id}', true)">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                Validar
                            </button>
                            <button class="boton boton-rechazar ${grab.valido === false ? 'activo' : ''}" onclick="adminApp.validarGrabacion('${id}', false)">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                Rechazar
                            </button>
                            <button class="boton boton-secundario" onclick="adminApp.validarGrabacion('${id}', null)" title="Desmarcar / Dejar sin revisar">
                                ? Sin Revisar
                            </button>
                            <a class="boton boton-secundario" href="${grab.url_audio}" download="${grab.alias}_${grab.comando}.wav" title="Descargar archivo WAV">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>
                                WAV
                            </a>
                            <button class="boton boton-peligro boton-icono-solo" onclick="adminApp.eliminarGrabacion('${id}')" title="Eliminar grabación">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    </div>
                </div>
            </td>
        `;
        
        trFila.insertAdjacentElement('afterend', tr);
        reproductorActual = id;

        // Renderizado del espectrograma y cálculo de descriptores espectrales
        renderizarEspectrogramaGrabacion(id, grab.url_audio);
    }

    async function renderizarEspectrogramaGrabacion(id, url) {
        try {
            const canvas = document.getElementById(`spec-canvas-${id}`);
            const statusSpan = document.getElementById(`spec-status-${id}`);
            const maxFreqSpan = document.getElementById(`spec-maxfreq-${id}`);
            const cursor = document.getElementById(`spec-cursor-${id}`);
            const audioElement = document.getElementById(`audio-elem-${id}`);
            if (!canvas) return;

            // Decodificación de audio
            let arrayBuffer;
            if (url.startsWith('data:audio')) {
                const base64 = url.split(',')[1];
                const binaryString = atob(base64);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                arrayBuffer = bytes.buffer;
            } else {
                const response = await fetch(url);
                arrayBuffer = await response.arrayBuffer();
            }

            if (!audioContextGlobal) {
                audioContextGlobal = new (window.AudioContext || window.webkitAudioContext)();
            }
            const audioBuffer = await audioContextGlobal.decodeAudioData(arrayBuffer.slice(0));
            const pcmData = audioBuffer.getChannelData(0);
            const sampleRate = audioBuffer.sampleRate || 16000;

            if (maxFreqSpan) {
                maxFreqSpan.textContent = `${Math.round(sampleRate / 2)} Hz (Agudos)`;
            }

            // STFT via DSP
            const stftFunc = (window.DSP && window.DSP.espectrogramaSTFT) || espectrogramaSTFT;
            const descFunc = (window.DSP && window.DSP.descriptoresEspectrales) || descriptoresEspectrales;
            const drawFunc = (window.Espectrograma && window.Espectrograma.dibujarEspectrograma) || window.dibujarEspectrograma || dibujarEspectrograma;

            const stft = stftFunc(pcmData, 512, 128, sampleRate);
            drawFunc(canvas, stft, { dbMin: -70, dbMax: 0, mostrarEjes: true });

            // Descriptores espectrales
            if (descFunc) {
                const desc = descFunc(pcmData, sampleRate);
                if (desc) {
                    const mBaja = document.getElementById(`m-baja-${id}`);
                    const mAlta = document.getElementById(`m-alta-${id}`);
                    const mHflf = document.getElementById(`m-hflf-${id}`);
                    const mZcr = document.getElementById(`m-zcr-${id}`);
                    const mCent = document.getElementById(`m-centroide-${id}`);

                    if (mBaja) mBaja.textContent = (desc.energiaBaja * 100).toFixed(1) + '%';
                    if (mAlta) mAlta.textContent = (desc.energiaAlta * 100).toFixed(1) + '%';
                    if (mHflf) mHflf.textContent = desc.hflfRatio.toFixed(3);
                    if (mZcr) mZcr.textContent = desc.zcr.toFixed(4);
                    if (mCent) mCent.textContent = Math.round(desc.centroideHz) + ' Hz';
                }
            }

            if (statusSpan) {
                const dur = (pcmData.length / sampleRate).toFixed(2);
                statusSpan.textContent = `${pcmData.length.toLocaleString()} muestras (${dur}s @ ${sampleRate}Hz)`;
            }

            // Cursor interactivo sincronizado con el tiempo de reproducción
            if (audioElement && cursor) {
                const actualizarCursor = () => {
                    if (audioElement.duration > 0) {
                        const margenIzq = 56;
                        const margenDer = 12;
                        const anchoTotal = canvas.clientWidth || 800;
                        const anchoPlot = anchoTotal - margenIzq - margenDer;
                        const pct = audioElement.currentTime / audioElement.duration;
                        const posX = margenIzq + (pct * anchoPlot);
                        cursor.style.left = `${posX}px`;
                        cursor.style.display = 'block';
                    }
                };
                audioElement.addEventListener('timeupdate', actualizarCursor);
                audioElement.addEventListener('ended', () => {
                    cursor.style.display = 'none';
                });
                audioElement.addEventListener('pause', () => {
                    if (audioElement.currentTime === 0 || audioElement.ended) {
                        cursor.style.display = 'none';
                    }
                });
            }
        } catch (err) {
            console.warn('Espectrograma STFT cargado en modo estándar:', err);
            const statusSpan = document.getElementById(`spec-status-${id}`);
            if (statusSpan) statusSpan.textContent = 'Audio listo para reproducción';
        }
    }

    // =======================================================================
    // VALIDACIÓN & ELIMINACIÓN INDIVIDUAL
    // =======================================================================
    async function validarGrabacion(id, validoStatus) {
        try {
            await fetchAPI(`/api/admin/grabaciones/${id}/validar`, {
                method: 'PUT',
                body: JSON.stringify({ valido: validoStatus })
            });

            const g = datos.grabaciones.find(x => x.id === id);
            if (g) g.valido = validoStatus;

            // Actualizar fila en la tabla
            const tr = document.getElementById(`fila-${id}`);
            const celdaEstado = document.getElementById(`estado-${id}`);
            if (tr) {
                tr.classList.remove('fila-valida', 'fila-rechazada');
                if (validoStatus === true) tr.classList.add('fila-valida');
                if (validoStatus === false) tr.classList.add('fila-rechazada');
            }
            if (celdaEstado) {
                if (validoStatus === true) celdaEstado.innerHTML = '<span class="badge badge-valido">✓ Válido</span>';
                else if (validoStatus === false) celdaEstado.innerHTML = '<span class="badge badge-rechazado">✗ Rechazado</span>';
                else celdaEstado.innerHTML = '<span class="badge badge-pendiente">? Sin revisar</span>';
            }

            // Actualizar badge del reproductor si está abierto
            const badgeInline = document.getElementById(`inline-badge-${id}`);
            if (badgeInline) {
                if (validoStatus === true) {
                    badgeInline.className = 'badge badge-valido';
                    badgeInline.textContent = '✓ Válido';
                } else if (validoStatus === false) {
                    badgeInline.className = 'badge badge-rechazado';
                    badgeInline.textContent = '✗ Rechazado';
                } else {
                    badgeInline.className = 'badge badge-pendiente';
                    badgeInline.textContent = '? Sin revisar';
                }
            }

            cargarStats();
            const estadoTexto = validoStatus === true ? 'marcada como válida' : (validoStatus === false ? 'marcada como rechazada' : 'puesta sin revisar');
            mostrarToast(`Grabación ${estadoTexto}`, 'exito');
        } catch (e) {
            mostrarToast('Error al actualizar estado: ' + e.message, 'error');
        }
    }

    async function eliminarGrabacion(id) {
        if (!confirm('¿Eliminar esta grabación de audio de forma permanente?')) return;
        try {
            await fetchAPI(`/api/admin/grabaciones/${id}`, { method: 'DELETE' });
            mostrarToast('Grabación eliminada correctamente', 'exito');
            
            if (reproductorActual === id) {
                const trRep = document.getElementById(`reproductor-tr-${id}`);
                if (trRep) trRep.remove();
                reproductorActual = null;
            }

            seleccionGrabaciones.delete(id);
            cargarGrabaciones();
            cargarStats();
        } catch (e) {
            mostrarToast('Error al eliminar grabación: ' + e.message, 'error');
        }
    }

    // =======================================================================
    // SELECCIÓN Y ACCIONES EN LOTE (GRABACIONES)
    // =======================================================================
    function toggleSeleccionGrabacion(id, event) {
        if (event.target.checked) seleccionGrabaciones.add(id);
        else seleccionGrabaciones.delete(id);
        actualizarBarraLoteGrabaciones();
    }

    function toggleSeleccionTodasGrabaciones(event) {
        const checkboxes = document.querySelectorAll('.check-grabacion');
        if (event.target.checked) {
            checkboxes.forEach(cb => {
                cb.checked = true;
                seleccionGrabaciones.add(cb.value);
            });
        } else {
            checkboxes.forEach(cb => {
                cb.checked = false;
                seleccionGrabaciones.delete(cb.value);
            });
        }
        actualizarBarraLoteGrabaciones();
    }

    function actualizarBarraLoteGrabaciones() {
        const barra = document.getElementById('barra-lote-grabaciones');
        const texto = document.getElementById('texto-lote-grabaciones');
        const checkTodas = document.getElementById('check-todas-grabaciones');
        if (!barra || !texto) return;

        if (seleccionGrabaciones.size > 0) {
            texto.textContent = `${seleccionGrabaciones.size} grabación(es) seleccionada(s)`;
            barra.classList.add('activa');
        } else {
            barra.classList.remove('activa');
        }

        if (checkTodas) {
            checkTodas.checked = datos.grabaciones.length > 0 && datos.grabaciones.every(g => seleccionGrabaciones.has(g.id));
        }
    }

    async function procesarLoteGrabaciones(accion) {
        if (seleccionGrabaciones.size === 0) return;
        const ids = Array.from(seleccionGrabaciones);

        try {
            if (accion === 'eliminar') {
                if (!confirm(`¿Eliminar definitivamente las ${ids.length} grabaciones seleccionadas?`)) return;
                const res = await fetchAPI('/api/admin/grabaciones', {
                    method: 'DELETE',
                    body: JSON.stringify({ ids })
                });
                mostrarToast(`${res.eliminados || ids.length} grabaciones eliminadas`, 'exito');
                seleccionGrabaciones.clear();
                if (reproductorActual && ids.includes(reproductorActual)) {
                    reproductorActual = null;
                }
                cargarGrabaciones();
                cargarStats();
            } else if (accion === 'validar' || accion === 'rechazar' || accion === 'reset') {
                let valido = null;
                if (accion === 'validar') valido = true;
                if (accion === 'rechazar') valido = false;

                const res = await fetchAPI('/api/admin/grabaciones/lote-validar', {
                    method: 'PUT',
                    body: JSON.stringify({ ids, valido })
                });
                const textoAccion = valido === true ? 'válidas' : (valido === false ? 'rechazadas' : 'sin revisar');
                mostrarToast(`${res.actualizados || ids.length} grabaciones marcadas como ${textoAccion}`, 'exito');
                seleccionGrabaciones.clear();
                cargarGrabaciones();
                cargarStats();
            }
        } catch (e) {
            mostrarToast('Error al procesar lote: ' + e.message, 'error');
        }
    }

    function descargarZipSeleccionados() {
        if (seleccionGrabaciones.size === 0) return;
        const ids = Array.from(seleccionGrabaciones).join(',');
        window.open(`/api/admin/descargar-zip?ids=${encodeURIComponent(ids)}&token=${encodeURIComponent(token)}`, '_blank');
    }

    // =======================================================================
    // GESTIÓN DE COMANDOS (INDIVIDUAL Y EN LOTE)
    // =======================================================================
    async function cargarComandos() {
        const contenedor = document.getElementById('lista-comandos');
        if (!contenedor) return;
        contenedor.innerHTML = '<div class="spinner-inline"><div class="spinner spinner-pequeno"></div> Cargando comandos...</div>';
        
        try {
            const res = await fetchAPI('/api/admin/comandos');
            datos.comandos = res.comandos || [];
            renderizarComandos();
            cargarFiltroComandos();
        } catch (e) {
            contenedor.innerHTML = `<div class="mensaje-error" style="padding: 20px;">Error al cargar comandos: ${e.message}</div>`;
        }
    }

    function renderizarComandos() {
        const contenedor = document.getElementById('lista-comandos');
        if (!contenedor) return;
        contenedor.innerHTML = '';
        
        if (datos.comandos.length === 0) {
            contenedor.innerHTML = '<div class="lote-preview-vacio">No hay comandos registrados. Crea uno nuevo o importa en lote.</div>';
            return;
        }

        datos.comandos.forEach(c => {
            const div = document.createElement('div');
            div.className = 'tarjeta-comando-admin';
            const checked = seleccionComandos.has(c.id) ? 'checked' : '';

            div.innerHTML = `
                <div class="tarjeta-cmd-header">
                    <div class="tarjeta-cmd-info">
                        <h4>${c.nombre}</h4>
                        <p>${c.descripcion || 'Sin instrucción específica'}</p>
                        <div class="tarjeta-cmd-badges">
                            <span class="badge ${c.activo ? 'badge-valido' : 'badge-rechazado'}">${c.activo ? 'Activo' : 'Inactivo'}</span>
                            <span class="badge badge-primario">Orden: ${c.orden}</span>
                            <span class="badge badge-pendiente">${c.totalMuestras || 0} audios (${c.validadas || 0} ✓)</span>
                        </div>
                    </div>
                    <input type="checkbox" class="campo-checkbox check-comando" value="${c.id}" ${checked} onchange="adminApp.toggleSeleccionComando('${c.id}', event)">
                </div>
                <div class="tarjeta-cmd-acciones">
                    <button class="boton boton-pequeno boton-fantasma" onclick="adminApp.toggleActivoComando('${c.id}')" title="Activar/Desactivar">
                        ${c.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <div style="display: flex; gap: 6px;">
                        <button class="boton boton-pequeno boton-secundario" onclick="adminApp.editarComando('${c.id}')">Editar</button>
                        <button class="boton boton-pequeno boton-peligro" onclick="adminApp.eliminarComando('${c.id}')">Eliminar</button>
                    </div>
                </div>
            `;
            contenedor.appendChild(div);
        });

        actualizarBarraLoteComandos();
    }

    async function toggleActivoComando(id) {
        try {
            await fetchAPI(`/api/admin/comandos/${id}/toggle`, { method: 'PUT' });
            cargarComandos();
            cargarStats();
            mostrarToast('Estado del comando actualizado', 'exito');
        } catch (e) {
            mostrarToast('Error: ' + e.message, 'error');
        }
    }

    function toggleSeleccionComando(id, event) {
        if (event.target.checked) seleccionComandos.add(id);
        else seleccionComandos.delete(id);
        actualizarBarraLoteComandos();
    }

    function toggleSeleccionTodosComandos(event) {
        const checkboxes = document.querySelectorAll('.check-comando');
        if (event.target.checked) {
            checkboxes.forEach(cb => {
                cb.checked = true;
                seleccionComandos.add(cb.value);
            });
        } else {
            checkboxes.forEach(cb => {
                cb.checked = false;
                seleccionComandos.delete(cb.value);
            });
        }
        actualizarBarraLoteComandos();
    }

    function actualizarBarraLoteComandos() {
        const barra = document.getElementById('acciones-lote-comandos');
        const texto = document.getElementById('texto-seleccion-comandos');
        const checkTodos = document.getElementById('check-todos-comandos');
        if (!barra || !texto) return;

        if (seleccionComandos.size > 0) {
            texto.textContent = `${seleccionComandos.size} comando(s) seleccionado(s)`;
            barra.style.display = 'flex';
        } else {
            barra.style.display = 'none';
        }

        if (checkTodos) {
            checkTodos.checked = datos.comandos.length > 0 && datos.comandos.every(c => seleccionComandos.has(c.id));
        }
    }

    async function eliminarComandosSeleccionados() {
        if (seleccionComandos.size === 0) return;
        const ids = Array.from(seleccionComandos);
        if (!confirm(`¿Eliminar los ${ids.length} comandos seleccionados?`)) return;
        
        try {
            const res = await fetchAPI('/api/admin/comandos', {
                method: 'DELETE',
                body: JSON.stringify({ ids })
            });
            mostrarToast(`${res.eliminados || ids.length} comandos eliminados`, 'exito');
            seleccionComandos.clear();
            cargarComandos();
            cargarStats();
        } catch (e) {
            mostrarToast('Error al eliminar comandos: ' + e.message, 'error');
        }
    }

    // Modal de comando individual
    function abrirModalComando() {
        const form = document.getElementById('form-comando');
        if (form) form.reset();
        document.getElementById('cmd-id').value = '';
        document.getElementById('cmd-orden').value = datos.comandos.length + 1;
        document.getElementById('modal-comando-titulo').textContent = 'Nuevo Comando';
        document.getElementById('modal-comando').classList.remove('oculto');
    }

    function editarComando(id) {
        const cmd = datos.comandos.find(c => c.id === id);
        if (!cmd) return;
        
        document.getElementById('cmd-id').value = cmd.id;
        document.getElementById('cmd-nombre').value = cmd.nombre;
        document.getElementById('cmd-desc').value = cmd.descripcion || '';
        document.getElementById('cmd-orden').value = cmd.orden || 1;
        document.getElementById('cmd-activo').checked = cmd.activo !== false;
        
        document.getElementById('modal-comando-titulo').textContent = 'Editar Comando';
        document.getElementById('modal-comando').classList.remove('oculto');
    }

    async function guardarComando(e) {
        e.preventDefault();
        const id = document.getElementById('cmd-id').value;
        const nombre = document.getElementById('cmd-nombre').value.trim();
        const descripcion = document.getElementById('cmd-desc').value.trim();
        const orden = parseInt(document.getElementById('cmd-orden').value) || 1;
        const activo = document.getElementById('cmd-activo').checked;

        if (!nombre) return mostrarToast('El nombre es obligatorio', 'error');

        const url = id ? `/api/admin/comandos/${id}` : '/api/admin/comandos';
        const method = id ? 'PUT' : 'POST';

        try {
            await fetchAPI(url, {
                method,
                body: JSON.stringify({ nombre, descripcion, orden, activo })
            });
            mostrarToast(`Comando "${nombre}" ${id ? 'actualizado' : 'creado'} con éxito`, 'exito');
            cerrarModal('modal-comando');
            cargarComandos();
            cargarStats();
        } catch (e) {
            mostrarToast('Error al guardar: ' + e.message, 'error');
        }
    }

    async function eliminarComando(id) {
        const cmd = datos.comandos.find(c => c.id === id);
        const nombre = cmd ? cmd.nombre : 'este comando';
        if (!confirm(`¿Seguro que deseas eliminar el comando "${nombre}"?`)) return;
        
        try {
            await fetchAPI(`/api/admin/comandos/${id}`, { method: 'DELETE' });
            mostrarToast('Comando eliminado', 'exito');
            seleccionComandos.delete(id);
            cargarComandos();
            cargarStats();
        } catch (e) {
            mostrarToast('Error al eliminar: ' + e.message, 'error');
        }
    }

    // Modal Crear Comandos en Lote
    function abrirModalLote() {
        const textarea = document.getElementById('lote-texto');
        if (textarea) textarea.value = '';
        actualizarPreviewLote();
        document.getElementById('modal-lote').classList.remove('oculto');
    }

    function getComandosLoteParseados() {
        const textarea = document.getElementById('lote-texto');
        if (!textarea) return [];
        const rawLines = textarea.value.split(/[\n,]+/);
        const nombresExistentes = new Set(datos.comandos.map(c => c.nombre.toLowerCase()));

        // Sanitización y deduplicación interna
        const unicosMap = new Map();
        rawLines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
                const lower = trimmed.toLowerCase();
                if (!unicosMap.has(lower)) {
                    unicosMap.set(lower, trimmed);
                }
            }
        });

        const autodesc = document.getElementById('lote-auto-desc')?.checked !== false;
        let ordenBase = datos.comandos.length;

        return Array.from(unicosMap.values()).map((nombre, i) => {
            const yaExiste = nombresExistentes.has(nombre.toLowerCase());
            return {
                nombre,
                descripcion: autodesc ? `Pronuncia la palabra "${nombre}" con voz clara y tono natural.` : '',
                activo: true,
                orden: ordenBase + i + 1,
                yaExiste
            };
        });
    }

    function actualizarPreviewLote() {
        const comandos = getComandosLoteParseados();
        const lista = document.getElementById('lote-preview-lista');
        const countSpan = document.getElementById('lote-preview-count');
        if (!lista) return;

        if (countSpan) countSpan.textContent = comandos.length;
        
        if (comandos.length === 0) {
            lista.innerHTML = '<div class="lote-preview-vacio">Escribe palabras para ver la vista previa en tiempo real.</div>';
            return;
        }

        lista.innerHTML = comandos.map(c => `
            <div class="lote-preview-item">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 700; color: var(--color-texto-1); font-size: 0.92rem;">${c.nombre}</span>
                    ${c.yaExiste ? '<span class="badge badge-rechazado" style="font-size: 0.7rem;">Ya existe</span>' : '<span class="badge badge-valido" style="font-size: 0.7rem;">Nuevo</span>'}
                </div>
                <span style="color: var(--color-texto-3); font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c.descripcion}</span>
            </div>
        `).join('');
    }

    async function procesarLoteComandos() {
        const parseados = getComandosLoteParseados();
        const comandos = parseados.map(c => ({
            nombre: c.nombre,
            descripcion: c.descripcion,
            activo: c.activo,
            orden: c.orden
        }));

        if (comandos.length === 0) return mostrarToast('Escribe al menos un comando válido', 'error');

        const btn = document.getElementById('btn-procesar-lote');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Creando...';
        }

        try {
            const res = await fetchAPI('/api/admin/comandos/lote', {
                method: 'POST',
                body: JSON.stringify({ comandos })
            });
            mostrarToast(`${res.total || comandos.length} comandos registrados con éxito`, 'exito');
            cerrarModal('modal-lote');
            cargarComandos();
            cargarStats();
        } catch (e) {
            mostrarToast('Error al crear comandos en lote: ' + e.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Crear Comandos';
            }
        }
    }

    // =======================================================================
    // MULTI-ADMIN TAB
    // =======================================================================
    async function cargarAdmins() {
        const contenedor = document.getElementById('lista-admins');
        if (!contenedor) return;
        contenedor.innerHTML = '<div class="spinner-inline"><div class="spinner spinner-pequeno"></div> Cargando administradores...</div>';

        try {
            const data = await fetchAPI('/api/admin/admins');
            datos.admins = data.admins || [];
            
            contenedor.innerHTML = datos.admins.map(adm => {
                const isSuper = adm.esSuperAdmin;
                return `
                    <div class="admin-token-item ${isSuper ? 'super-admin' : ''}">
                        <div class="admin-token-icono">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                            </svg>
                        </div>
                        <div class="admin-token-info">
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span style="font-weight: 700; color: var(--color-texto-1); font-size: 0.95rem;">Token #${adm.id}</span>
                                <span class="badge ${isSuper ? 'badge-super' : 'badge-primario'}">${adm.rol}</span>
                                ${adm.esActual ? '<span class="badge badge-valido" style="font-size: 0.7rem;">Sesión Actual</span>' : ''}
                            </div>
                            <span class="admin-token-valor">${adm.mascara}</span>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            contenedor.innerHTML = `<div class="mensaje-error" style="padding: 20px;">Error al cargar administradores: ${e.message}</div>`;
        }
    }

    // =======================================================================
    // CONFIGURACIÓN DE AUDIO & EXPERIMENTO
    // =======================================================================
    async function cargarConfiguracionAudio() {
        try {
            const res = await fetch('/api/config-grabacion');
            const data = await res.json();
            if (data.config) {
                datos.configGrabacion = data.config;
                const selectDur = document.getElementById('conf-duracion');
                const selectTasa = document.getElementById('conf-tasa');
                const inputMeta = document.getElementById('conf-meta');

                if (selectDur) selectDur.value = data.config.duracion_s || 3;
                if (selectTasa) selectTasa.value = data.config.tasa_hz || 16000;
                if (inputMeta) inputMeta.value = data.config.meta_por_comando || 40;
            }
        } catch (e) {}
    }

    async function guardarConfiguracionAudio(e) {
        e.preventDefault();
        const duracion_s = parseInt(document.getElementById('conf-duracion').value) || 3;
        const tasa_hz = parseInt(document.getElementById('conf-tasa').value) || 16000;
        const meta_por_comando = parseInt(document.getElementById('conf-meta').value) || 40;

        try {
            const res = await fetchAPI('/api/admin/config-grabacion', {
                method: 'PUT',
                body: JSON.stringify({ duracion_s, tasa_hz, meta_por_comando })
            });
            if (res.exito && res.config) {
                datos.configGrabacion = res.config;
                mostrarToast('Configuración de grabación actualizada', 'exito');
                cargarStats();
            }
        } catch (err) {
            mostrarToast('Error al guardar configuración: ' + err.message, 'error');
        }
    }

    // =======================================================================
    // EXPORTACIÓN & DESCARGA DE DATASETS
    // =======================================================================
    function exportarDatos(formato) {
        let query = `formato=${formato}&token=${encodeURIComponent(token)}`;
        if (filtros.estado !== '') query += `&valido=${filtros.estado}`;
        window.open(`/api/admin/exportar?${query}`, '_blank');
    }

    function descargarZip() {
        const query = new URLSearchParams();
        if (filtros.alias) query.append('alias', filtros.alias);
        if (filtros.comando) query.append('comando', filtros.comando);
        query.append('token', token);
        window.open(`/api/admin/descargar-zip?${query}`, '_blank');
    }

    function descargarZipValidos() {
        const query = new URLSearchParams();
        if (filtros.alias) query.append('alias', filtros.alias);
        if (filtros.comando) query.append('comando', filtros.comando);
        query.append('soloValidos', 'true');
        query.append('token', token);
        window.open(`/api/admin/descargar-zip?${query}`, '_blank');
    }

    // =======================================================================
    // MODALES Y EVENTOS GENERALES
    // =======================================================================
    function cerrarModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('oculto');
    }

    function configurarEventosModales() {
        document.querySelectorAll('.modal-overlay').forEach(m => {
            m.addEventListener('click', e => {
                if (e.target === m) m.classList.add('oculto');
            });
        });

        // Cerrar con Escape
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay:not(.oculto)').forEach(m => m.classList.add('oculto'));
            }
        });
    }

    // Inicializar al cargar el DOM
    document.addEventListener('DOMContentLoaded', init);

    // API Pública expuesta en window.adminApp
    return {
        iniciarSesion,
        cerrarSesion,
        cambiarTab,
        cargarStats,
        cargarGrabaciones,
        aplicarFiltrosGrabaciones,
        limpiarFiltrosGrabaciones,
        filtrarPorComandoRapido,
        filtrarPorAliasRapido,
        toggleSeleccionGrabacion,
        toggleSeleccionTodasGrabaciones,
        procesarLoteGrabaciones,
        descargarZipSeleccionados,
        toggleReproductor,
        validarGrabacion,
        eliminarGrabacion,
        exportarDatos,
        descargarZip,
        descargarZipValidos,
        abrirModalComando,
        editarComando,
        guardarComando,
        toggleActivoComando,
        eliminarComando,
        toggleSeleccionComando,
        toggleSeleccionTodosComandos,
        eliminarComandosSeleccionados,
        abrirModalLote,
        actualizarPreviewLote,
        procesarLoteComandos,
        guardarConfiguracionAudio,
        cerrarModal
    };
})();
