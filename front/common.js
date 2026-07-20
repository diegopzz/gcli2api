// =====================================================================
// Módulo JavaScript común del panel de control GCLI2API
// =====================================================================

// =====================================================================
// Gestión de estado global
// =====================================================================
const AppState = {
    // Autenticación
    authToken: '',
    authInProgress: false,
    currentProjectId: '',

    // Autenticación de Antigravity
    antigravityAuthState: null,
    antigravityAuthInProgress: false,

    // Gestión de credenciales
    creds: createCredsManager('normal'),
    antigravityCreds: createCredsManager('antigravity'),

    // Subida de archivos
    uploadFiles: createUploadManager('normal'),
    antigravityUploadFiles: createUploadManager('antigravity'),

    // Gestión de la configuración
    currentConfig: {},
    envLockedFields: new Set(),

    // Gestión de registros
    logWebSocket: null,
    allLogs: [],
    filteredLogs: [],
    currentLogFilter: 'all',

    // Estadísticas de uso
    usageStatsData: {},

    // Cuenta atrás de enfriamiento
    cooldownTimerInterval: null
};

// =====================================================================
// Fábrica del gestor de credenciales
// =====================================================================
function createCredsManager(type) {
    const modeParam = type === 'antigravity' ? 'mode=antigravity' : 'mode=geminicli';

    return {
        type: type,
        data: {},
        filteredData: {},
        currentPage: 1,
        pageSize: 20,
        selectedFiles: new Set(),
        totalCount: 0,
        currentStatusFilter: 'all',
        currentErrorCodeFilter: 'all',
        currentCooldownFilter: 'all',
        currentPreviewFilter: 'all',
        currentTierFilter: 'all',
        statsData: { total: 0, normal: 0, disabled: 0 },

        // Endpoints de la API
        getEndpoint: (action) => {
            const endpoints = {
                status: `./creds/status`,
                action: `./creds/action`,
                batchAction: `./creds/batch-action`,
                download: `./creds/download`,
                downloadAll: `./creds/download-all`,
                detail: `./creds/detail`,
                fetchEmail: `./creds/fetch-email`,
                refreshAllEmails: `./creds/refresh-all-emails`,
                deduplicate: `./creds/deduplicate-by-email`,
                verifyProject: `./creds/verify-project`,
                quota: `./creds/quota`
            };
            return endpoints[action] || '';
        },

        // Obtener el parámetro mode
        getModeParam: () => modeParam,

        // Prefijo de ID de los elementos del DOM
        getElementId: (suffix) => {
            // El ID de las credenciales normales empieza en minúscula, p. ej. credsLoading
            // El ID de Antigravity es antigravity + inicial en mayúscula, p. ej. antigravityCredsLoading
            if (type === 'antigravity') {
                return 'antigravity' + suffix.charAt(0).toUpperCase() + suffix.slice(1);
            }
            return suffix.charAt(0).toLowerCase() + suffix.slice(1);
        },

        // Actualizar la lista de credenciales
        async refresh() {
            const loading = document.getElementById(this.getElementId('CredsLoading'));
            const list = document.getElementById(this.getElementId('CredsList'));

            try {
                loading.style.display = 'block';
                list.innerHTML = '';

                const offset = (this.currentPage - 1) * this.pageSize;
                const errorCodeFilter = this.currentErrorCodeFilter || 'all';
                const cooldownFilter = this.currentCooldownFilter || 'all';
                const previewFilter = this.currentPreviewFilter || 'all';
                const tierFilter = this.currentTierFilter || 'all';
                const response = await fetch(
                    `${this.getEndpoint('status')}?offset=${offset}&limit=${this.pageSize}&status_filter=${this.currentStatusFilter}&error_code_filter=${errorCodeFilter}&cooldown_filter=${cooldownFilter}&preview_filter=${previewFilter}&tier_filter=${tierFilter}&${this.getModeParam()}`,
                    { headers: getAuthHeaders() }
                );

                const data = await response.json();

                if (response.ok) {
                    this.data = {};
                    data.items.forEach(item => {
                        this.data[item.filename] = {
                            filename: item.filename,
                            status: {
                                disabled: item.disabled,
                                error_codes: item.error_codes || [],
                                last_success: item.last_success,
                            },
                            user_email: item.user_email,
                            model_cooldowns: item.model_cooldowns || {},
                            preview: item.preview,
                            tier: item.tier || 'pro',
                            enable_credit: !!item.enable_credit
                        };
                    });

                    this.totalCount = data.total;
                    // Usar las estadísticas globales devueltas por el backend
                    if (data.stats) {
                        this.statsData = data.stats;
                    } else {
                        // Compatibilidad con versiones antiguas del backend
                        this.calculateStats();
                    }
                    this.updateStatsDisplay();
                    this.filteredData = this.data;
                    this.renderList();
                    this.updatePagination();

                    let msg = `Se han cargado ${data.total} archivos de credenciales${type === 'antigravity' ? ' Antigravity' : ''}`;
                    if (this.currentStatusFilter !== 'all') {
                        msg += ` (filtro: ${this.currentStatusFilter === 'enabled' ? 'solo habilitadas' : 'solo deshabilitadas'})`;
                    }
                    showStatus(msg, 'success');
                } else {
                    showStatus(`Error al cargar: ${data.detail || data.error || 'Error desconocido'}`, 'error');
                }
            } catch (error) {
                showStatus(`Error de red: ${error.message}`, 'error');
            } finally {
                loading.style.display = 'none';
            }
        },

        // Calcular las estadísticas (solo por compatibilidad con versiones antiguas del backend)
        calculateStats() {
            this.statsData = { total: this.totalCount, normal: 0, disabled: 0 };
            Object.values(this.data).forEach(credInfo => {
                if (credInfo.status.disabled) {
                    this.statsData.disabled++;
                } else {
                    this.statsData.normal++;
                }
            });
        },

        // Actualizar la visualización de estadísticas
        updateStatsDisplay() {
            document.getElementById(this.getElementId('StatTotal')).textContent = this.statsData.total;
            document.getElementById(this.getElementId('StatNormal')).textContent = this.statsData.normal;
            document.getElementById(this.getElementId('StatDisabled')).textContent = this.statsData.disabled;
        },

        // Renderizar la lista de credenciales
        renderList() {
            const list = document.getElementById(this.getElementId('CredsList'));
            list.innerHTML = '';

            const entries = Object.entries(this.filteredData);

            if (entries.length === 0) {
                const msg = this.totalCount === 0 ? 'No hay archivos de credenciales' : 'No hay datos con los filtros actuales';
                list.innerHTML = `<p style="text-align: center; color: #666;">${msg}</p>`;
                document.getElementById(this.getElementId('PaginationContainer')).style.display = 'none';
                return;
            }

            entries.forEach(([, credInfo]) => {
                list.appendChild(createCredCard(credInfo, this));
            });

            document.getElementById(this.getElementId('PaginationContainer')).style.display =
                this.getTotalPages() > 1 ? 'flex' : 'none';
            this.updateBatchControls();
        },

        // Obtener el número total de páginas
        getTotalPages() {
            return Math.ceil(this.totalCount / this.pageSize);
        },

        // Actualizar la información de paginación
        updatePagination() {
            const totalPages = this.getTotalPages();
            const startItem = (this.currentPage - 1) * this.pageSize + 1;
            const endItem = Math.min(this.currentPage * this.pageSize, this.totalCount);

            document.getElementById(this.getElementId('PaginationInfo')).textContent =
                `Página ${this.currentPage} de ${totalPages} (mostrando ${startItem}-${endItem} de ${this.totalCount} elementos)`;

            document.getElementById(this.getElementId('PrevPageBtn')).disabled = this.currentPage <= 1;
            document.getElementById(this.getElementId('NextPageBtn')).disabled = this.currentPage >= totalPages;
        },

        // Cambiar de página
        changePage(direction) {
            const newPage = this.currentPage + direction;
            if (newPage >= 1 && newPage <= this.getTotalPages()) {
                this.currentPage = newPage;
                this.refresh();
            }
        },

        // Cambiar el tamaño de página
        changePageSize() {
            this.pageSize = parseInt(document.getElementById(this.getElementId('PageSizeSelect')).value);
            this.currentPage = 1;
            this.refresh();
        },

        // Aplicar el filtro de estado
        applyStatusFilter() {
            this.currentStatusFilter = document.getElementById(this.getElementId('StatusFilter')).value;
            const errorCodeFilterEl = document.getElementById(this.getElementId('ErrorCodeFilter'));
            const cooldownFilterEl = document.getElementById(this.getElementId('CooldownFilter'));
            const previewFilterEl = document.getElementById(this.getElementId('PreviewFilter'));
            const tierFilterEl = document.getElementById(this.getElementId('TierFilter'));
            this.currentErrorCodeFilter = errorCodeFilterEl ? errorCodeFilterEl.value : 'all';
            this.currentCooldownFilter = cooldownFilterEl ? cooldownFilterEl.value : 'all';
            this.currentPreviewFilter = previewFilterEl ? previewFilterEl.value : 'all';
            this.currentTierFilter = tierFilterEl ? tierFilterEl.value : 'all';
            this.currentPage = 1;
            this.refresh();
        },

        // Actualizar los controles por lotes
        updateBatchControls() {
            const selectedCount = this.selectedFiles.size;
            document.getElementById(this.getElementId('SelectedCount')).textContent = `${selectedCount} seleccionados`;

            const batchBtnNames = ['Enable', 'Disable', 'Delete', 'Verify', 'Preview'];
            if (this.type === 'antigravity') {
                batchBtnNames.push('EnableCredit');
                batchBtnNames.push('DisableCredit');
            }
            const batchBtns = batchBtnNames.map(action =>
                document.getElementById(this.getElementId(`Batch${action}Btn`))
            );
            batchBtns.forEach(btn => btn && (btn.disabled = selectedCount === 0));

            const selectAllCheckbox = document.getElementById(this.getElementId('SelectAllCheckbox'));
            if (!selectAllCheckbox) return;

            const checkboxes = document.querySelectorAll(`.${this.getElementId('file-checkbox')}`);
            const currentPageSelectedCount = Array.from(checkboxes)
                .filter(cb => this.selectedFiles.has(cb.getAttribute('data-filename'))).length;

            if (currentPageSelectedCount === 0) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = false;
            } else if (currentPageSelectedCount === checkboxes.length) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = true;
            } else {
                selectAllCheckbox.indeterminate = true;
            }

            checkboxes.forEach(cb => {
                cb.checked = this.selectedFiles.has(cb.getAttribute('data-filename'));
            });
        },

        // Acciones sobre credenciales
        async action(filename, action) {
            try {
                const response = await fetch(`${this.getEndpoint('action')}?${this.getModeParam()}`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ filename, action })
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(data.message || `Operación correcta: ${action}`, 'success');
                    await this.refresh();
                } else {
                    showStatus(`Error en la operación: ${data.detail || data.error || 'Error desconocido'}`, 'error');
                }
            } catch (error) {
                showStatus(`Error de red: ${error.message}`, 'error');
            }
        },

        // Operaciones por lotes
        async batchAction(action) {
            const selectedFiles = Array.from(this.selectedFiles);

            if (selectedFiles.length === 0) {
                showStatus('Selecciona primero los archivos sobre los que quieres operar', 'error');
                return;
            }

            const actionNames = {
                enable: 'Habilitar',
                disable: 'Deshabilitar',
                delete: 'Eliminar',
                enable_credit: 'Activar créditos',
                disable_credit: 'Desactivar créditos'
            };
            const actionLabel = actionNames[action] || action;
            const confirmMsg = action === 'delete'
                ? `¿Seguro que quieres eliminar los ${selectedFiles.length} archivos seleccionados?\nAtención: esta operación no se puede deshacer.`
                : `¿Seguro que quieres aplicar "${actionLabel}" a los ${selectedFiles.length} archivos seleccionados?`;

            if (!confirm(confirmMsg)) return;

            try {
                showStatus(`Ejecutando la operación por lotes "${actionLabel}"...`, 'info');

                const response = await fetch(`${this.getEndpoint('batchAction')}?${this.getModeParam()}`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ action, filenames: selectedFiles })
                });

                const data = await response.json();

                if (response.ok) {
                    const successCount = data.success_count || data.succeeded;
                    showStatus(`Operación por lotes completada: ${successCount}/${selectedFiles.length} archivos procesados correctamente`, 'success');
                    this.selectedFiles.clear();
                    this.updateBatchControls();
                    await this.refresh();
                } else {
                    showStatus(`Error en la operación por lotes: ${data.detail || data.error || 'Error desconocido'}`, 'error');
                }
            } catch (error) {
                showStatus(`Error de red en la operación por lotes: ${error.message}`, 'error');
            }
        }
    };
}

// =====================================================================
// Fábrica del gestor de subida de archivos
// =====================================================================
function createUploadManager(type) {
    const modeParam = type === 'antigravity' ? 'mode=antigravity' : 'mode=geminicli';
    const endpoint = `./creds/upload?${modeParam}`;

    return {
        type: type,
        selectedFiles: [],

        getElementId: (suffix) => {
            // El ID de las subidas normales empieza en minúscula, p. ej. fileList
            // El ID de Antigravity es antigravity + inicial en mayúscula, p. ej. antigravityFileList
            if (type === 'antigravity') {
                return 'antigravity' + suffix.charAt(0).toUpperCase() + suffix.slice(1);
            }
            return suffix.charAt(0).toLowerCase() + suffix.slice(1);
        },

        handleFileSelect(event) {
            this.addFiles(Array.from(event.target.files));
        },

        addFiles(files) {
            files.forEach(file => {
                const isValid = file.type === 'application/json' || file.name.endsWith('.json') ||
                    file.type === 'application/zip' || file.name.endsWith('.zip');

                if (isValid) {
                    if (!this.selectedFiles.find(f => f.name === file.name && f.size === file.size)) {
                        this.selectedFiles.push(file);
                    }
                } else {
                    showStatus(`El formato del archivo ${file.name} no es compatible; solo se admiten archivos JSON y ZIP`, 'error');
                }
            });
            this.updateFileList();
        },

        updateFileList() {
            const list = document.getElementById(this.getElementId('FileList'));
            const section = document.getElementById(this.getElementId('FileListSection'));

            if (!list || !section) {
                console.warn('File list elements not found:', this.getElementId('FileList'));
                return;
            }

            if (this.selectedFiles.length === 0) {
                section.classList.add('hidden');
                return;
            }

            section.classList.remove('hidden');
            list.innerHTML = '';

            this.selectedFiles.forEach((file, index) => {
                const isZip = file.name.endsWith('.zip');
                const fileIcon = isZip ? '📦' : '📄';
                const fileType = isZip ? ' (archivo ZIP)' : ' (archivo JSON)';

                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                fileItem.innerHTML = `
                    <div>
                        <span class="file-name">${fileIcon} ${file.name}</span>
                        <span class="file-size">(${formatFileSize(file.size)}${fileType})</span>
                    </div>
                    <button class="remove-btn" onclick="${type === 'antigravity' ? 'removeAntigravityFile' : 'removeFile'}(${index})">Eliminar</button>
                `;
                list.appendChild(fileItem);
            });
        },

        removeFile(index) {
            this.selectedFiles.splice(index, 1);
            this.updateFileList();
        },

        clearFiles() {
            this.selectedFiles = [];
            this.updateFileList();
        },

        async upload() {
            if (this.selectedFiles.length === 0) {
                showStatus('Selecciona los archivos que quieres subir', 'error');
                return;
            }

            const progressSection = document.getElementById(this.getElementId('UploadProgressSection'));
            const progressFill = document.getElementById(this.getElementId('ProgressFill'));
            const progressText = document.getElementById(this.getElementId('ProgressText'));

            progressSection.classList.remove('hidden');

            const formData = new FormData();
            this.selectedFiles.forEach(file => formData.append('files', file));

            if (this.selectedFiles.some(f => f.name.endsWith('.zip'))) {
                showStatus('Subiendo y descomprimiendo el archivo ZIP...', 'info');
            }

            try {
                const xhr = new XMLHttpRequest();
                xhr.timeout = 300000; // 5 minutos

                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percent = (event.loaded / event.total) * 100;
                        progressFill.style.width = percent + '%';
                        progressText.textContent = Math.round(percent) + '%';
                    }
                };

                xhr.onload = () => {
                    if (xhr.status === 200) {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            showStatus(`Se han subido ${data.uploaded_count} archivos${type === 'antigravity' ? ' Antigravity' : ''} correctamente`, 'success');
                            this.clearFiles();
                            progressSection.classList.add('hidden');
                        } catch (e) {
                            showStatus('Error al subir: formato de respuesta del servidor incorrecto', 'error');
                        }
                    } else {
                        try {
                            const error = JSON.parse(xhr.responseText);
                            showStatus(`Error al subir: ${error.detail || error.error || 'Error desconocido'}`, 'error');
                        } catch (e) {
                            showStatus(`Error al subir: HTTP ${xhr.status}`, 'error');
                        }
                    }
                };

                xhr.onerror = () => {
                    showStatus(`Error al subir: conexión interrumpida. Posibles causas: demasiados archivos (${this.selectedFiles.length}) o red inestable. Se recomienda subirlos por lotes.`, 'error');
                    progressSection.classList.add('hidden');
                };

                xhr.ontimeout = () => {
                    showStatus('Error al subir: tiempo de espera agotado. El procesamiento ha tardado demasiado; reduce el número de archivos o comprueba la conexión de red', 'error');
                    progressSection.classList.add('hidden');
                };

                xhr.open('POST', endpoint);
                xhr.setRequestHeader('Authorization', `Bearer ${AppState.authToken}`);
                xhr.send(formData);
            } catch (error) {
                showStatus(`Error al subir: ${error.message}`, 'error');
            }
        }
    };
}

// =====================================================================
// Funciones auxiliares
// =====================================================================
function showStatus(message, type = 'info') {
    const statusSection = document.getElementById('statusSection');
    if (statusSection) {
        // Limpiar el temporizador anterior
        if (window._statusTimeout) {
            clearTimeout(window._statusTimeout);
        }

        // Crear el nuevo toast
        statusSection.innerHTML = `<div class="status ${type}">${message}</div>`;
        const statusDiv = statusSection.querySelector('.status');

        // Forzar el repintado para lanzar la animación
        statusDiv.offsetHeight;
        statusDiv.classList.add('show');

        // Desvanecer y eliminar tras 3 segundos
        window._statusTimeout = setTimeout(() => {
            statusDiv.classList.add('fade-out');
            setTimeout(() => {
                statusSection.innerHTML = '';
            }, 300); // Esperar a que termine la animación de desvanecido
        }, 3000);
    } else {
        showMessageModal('Aviso', message, 'info');
    }
}

// Convierte los enlaces del texto en enlaces HTML clicables
function linkifyText(text) {
    if (!text) return text;

    // Coincide con enlaces que empiezan por http://, https:// y www., excluyendo la puntuación habitual
    const urlPattern = /(https?:\/\/[^\s"'<>()[\]{}]+)|(www\.[^\s"'<>()[\]{}]+)/gi;

    return text.replace(urlPattern, function(url) {
        let href = url;
        // Si empieza por www., añadir https://
        if (url.startsWith('www.')) {
            href = 'https://' + url;
        }

        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="message-link" onclick="event.stopPropagation()" title="Clic para abrir el enlace\nClic derecho para copiar el enlace">${url}</a>`;
    });
}

// Muestra un modal de mensaje mejorado (con resaltado de enlaces)
function showMessageModal(title, message, type = 'info') {
    // Crear el modal
    const modal = document.createElement('div');
    modal.className = 'message-modal-overlay';
    modal.innerHTML = `
        <div class="message-modal ${type}">
            <div class="message-modal-header">
                <h3>${title}</h3>
                <button class="message-modal-close" onclick="this.closest('.message-modal-overlay').remove()">&times;</button>
            </div>
            <div class="message-modal-body">
                ${linkifyText(message).replace(/\n/g, '<br>')}
            </div>
            <div class="message-modal-footer">
                <button class="message-modal-btn" onclick="this.closest('.message-modal-overlay').remove()">Cerrar</button>
            </div>
        </div>
    `;

    // Añadir a la página
    document.body.appendChild(modal);

    // Cerrar al hacer clic en el fondo
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });

    // Cerrar con la tecla ESC
    const escHandler = function(e) {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.authToken}`
    };
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return Math.round(bytes / (1024 * 1024)) + ' MB';
}

function formatCooldownTime(remainingSeconds) {
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

// =====================================================================
// Creación de tarjetas de credencial (común)
// =====================================================================
function createCredCard(credInfo, manager) {
    const div = document.createElement('div');
    const { status, filename } = credInfo;
    const managerType = manager.type;

    // Estilo de la tarjeta
    div.className = status.disabled ? 'cred-card disabled' : 'cred-card';

    // Insignias de estado
    let statusBadges = '';
    statusBadges += status.disabled
        ? '<span class="status-badge disabled">Deshabilitada</span>'
        : '<span class="status-badge enabled">Habilitada</span>';

    if (status.error_codes && status.error_codes.length > 0) {
        statusBadges += `<span class="error-codes">Códigos de error: ${status.error_codes.join(', ')}</span>`;
        const autoBan = status.error_codes.filter(c => c === 400 || c === 403);
        if (autoBan.length > 0 && status.disabled) {
            statusBadges += '<span class="status-badge" style="background-color: #e74c3c; color: white;">AUTO_BAN</span>';
        }
    } else {
        statusBadges += '<span class="status-badge" style="background-color: #28a745; color: white;">Sin errores</span>';
    }

    // Estado de Preview (solo en modo geminicli)
    if (managerType !== 'antigravity' && credInfo.preview !== undefined) {
        if (credInfo.preview) {
            statusBadges += '<span class="status-badge" style="background-color: #28a745; color: white;" title="Esta credencial admite modelos Preview">Preview: ON</span>';
        } else {
            statusBadges += '<span class="status-badge" style="background-color: #8aa5a2; color: white;" title="Esta credencial no admite modelos Preview">Preview: OFF</span>';
        }
    }

    // Estado de tier (se muestra tanto en geminicli como en antigravity)
    const tier = (credInfo.tier || 'pro').toString().toLowerCase();
    const tierLabel = tier.toUpperCase();
    const tierColor = tier === 'ultra' ? '#ff9800' : (tier === 'free' ? '#607d8b' : '#2e7d32');
    statusBadges += `<span class="status-badge" style="background-color: ${tierColor}; color: white;" title="Nivel de la credencial: ${tierLabel}">Tier: ${tierLabel}</span>`;

    // Estado de Credit (solo antigravity)
    if (managerType === 'antigravity') {
        if (credInfo.enable_credit) {
            statusBadges += '<span class="status-badge" style="background-color: #2e7d32; color: white;" title="Modo Credit activado">Credit: ON</span>';
        } else {
            statusBadges += '<span class="status-badge" style="background-color: #616161; color: white;" title="Modo Credit desactivado">Credit: OFF</span>';
        }
    }

    // Estado de enfriamiento por modelo
    if (credInfo.model_cooldowns && Object.keys(credInfo.model_cooldowns).length > 0) {
        const currentTime = Date.now() / 1000;
        const activeCooldowns = Object.entries(credInfo.model_cooldowns)
            .filter(([, until]) => until > currentTime)
            .map(([model, until]) => {
                const remaining = Math.max(0, Math.floor(until - currentTime));
                const shortModel = model.replace('gemini-', '').replace('-exp', '')
                    .replace('2.0-', '2-').replace('1.5-', '1.5-');
                return {
                    model: shortModel,
                    time: formatCooldownTime(remaining).replace(/s$/, '').replace(/ /g, ''),
                    fullModel: model
                };
            });

        if (activeCooldowns.length > 0) {
            activeCooldowns.slice(0, 2).forEach(item => {
                statusBadges += `<span class="cooldown-badge" style="background-color: #17a2b8;" title="Modelo: ${item.fullModel}">⏰ ${item.model}: ${item.time}</span>`;
            });
            if (activeCooldowns.length > 2) {
                const remaining = activeCooldowns.length - 2;
                const remainingModels = activeCooldowns.slice(2).map(i => `${i.fullModel}: ${i.time}`).join('\n');
                statusBadges += `<span class="cooldown-badge" style="background-color: #17a2b8;" title="Otros modelos:\n${remainingModels}">+${remaining}</span>`;
            }
        }
    }

    // ID de ruta
    const pathId = (managerType === 'antigravity' ? 'ag_' : '') + btoa(encodeURIComponent(filename)).replace(/[+/=]/g, '_');

    // Botones de acción
    const actionButtons = `
        ${status.disabled
            ? `<button class="cred-btn enable" data-filename="${filename}" data-action="enable">Habilitar</button>`
            : `<button class="cred-btn disable" data-filename="${filename}" data-action="disable">Deshabilitar</button>`
        }
        <button class="cred-btn view" onclick="toggle${managerType === 'antigravity' ? 'Antigravity' : ''}CredDetails('${pathId}')">Ver contenido</button>
        <button class="cred-btn download" onclick="download${managerType === 'antigravity' ? 'Antigravity' : ''}Cred('${filename}')">Descargar</button>
        <button class="cred-btn email" onclick="fetch${managerType === 'antigravity' ? 'Antigravity' : ''}UserEmail('${filename}')">Ver correo de la cuenta</button>
        ${managerType === 'antigravity' ? `<button class="cred-btn" onclick="toggleAntigravityQuotaDetails('${pathId}')" title="Ver la información de cuota de esta credencial">Ver cuota</button>` : ''}
        ${managerType === 'antigravity' ? (credInfo.enable_credit
            ? `<button class="cred-btn" data-filename="${filename}" data-action="disable_credit" title="Desactivar el modo Credit de esta credencial">Desactivar Credit</button>`
            : `<button class="cred-btn" data-filename="${filename}" data-action="enable_credit" title="Activar el modo Credit de esta credencial">Activar Credit</button>`
        ) : ''}
        ${managerType !== 'antigravity' ? `<button class="cred-btn" onclick="configurePreviewChannel('${filename}')" title="Configurar el canal Preview y activar las funciones experimentales">Configurar Preview</button>` : ''}
        <button class="cred-btn" onclick="verify${managerType === 'antigravity' ? 'Antigravity' : ''}ProjectId('${filename}')" title="Volver a obtener el Project ID; puede recuperar errores 403">Verificar</button>
        <button class="cred-btn" onclick="test${managerType === 'antigravity' ? 'Antigravity' : ''}Credential('${filename}')" title="Comprobar si la credencial funciona">Probar mensaje</button>
        <button class="cred-btn" onclick="toggle${managerType === 'antigravity' ? 'Antigravity' : ''}ErrorDetails('${pathId}')" title="Ver la información detallada de errores de esta credencial">Ver errores</button>
        <button class="cred-btn delete" data-filename="${filename}" data-action="delete">Eliminar</button>
    `;

    // Información del correo
    const emailInfo = credInfo.user_email
        ? `<div class="cred-email" style="font-size: 12px; color: #666; margin-top: 2px;">${credInfo.user_email}</div>`
        : '<div class="cred-email" style="font-size: 12px; color: #999; margin-top: 2px; font-style: italic;">Correo no obtenido</div>';

    const checkboxClass = manager.getElementId('file-checkbox');

    div.innerHTML = `
        <div class="cred-header">
            <div style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" class="${checkboxClass}" data-filename="${filename}" onchange="toggle${managerType === 'antigravity' ? 'Antigravity' : ''}FileSelection('${filename}')">
                <div>
                    <div class="cred-filename">${filename}</div>
                    ${emailInfo}
                </div>
            </div>
            <div class="cred-status">${statusBadges}</div>
        </div>
        <div class="cred-actions">${actionButtons}</div>
        <div class="cred-details" id="details-${pathId}">
            <div class="cred-content" data-filename="${filename}" data-loaded="false">Pulsa el botón "Ver contenido" para cargar los detalles del archivo...</div>
        </div>
        <div class="cred-details" id="errors-${pathId}">
            <div class="cred-content" data-filename="${filename}" data-loaded="false" style="background-color: #fff3cd; border-color: #ffc107;">Pulsa el botón "Ver errores" para cargar la información de errores...</div>
        </div>
        ${managerType === 'antigravity' ? `
        <div class="cred-quota-details" id="quota-${pathId}" style="display: none;">
            <div class="cred-quota-content" data-filename="${filename}" data-loaded="false">
                Pulsa el botón "Ver cuota" para cargar la información de cuota...
            </div>
        </div>
        ` : ''}
    `;

    // Añadir los escuchadores de eventos
    div.querySelectorAll('[data-filename][data-action]').forEach(button => {
        button.addEventListener('click', function () {
            const fn = this.getAttribute('data-filename');
            const action = this.getAttribute('data-action');
            if (action === 'delete') {
                if (confirm(`¿Seguro que quieres eliminar el archivo de credencial${managerType === 'antigravity' ? ' Antigravity' : ''}?\n${fn}`)) {
                    manager.action(fn, action);
                }
            } else {
                manager.action(fn, action);
            }
        });
    });

    return div;
}

// =====================================================================
// Alternar los detalles de la credencial
// =====================================================================
async function toggleCredDetails(pathId) {
    await toggleCredDetailsCommon(pathId, AppState.creds);
}

async function toggleAntigravityCredDetails(pathId) {
    await toggleCredDetailsCommon(pathId, AppState.antigravityCreds);
}

async function toggleCredDetailsCommon(pathId, manager) {
    const details = document.getElementById('details-' + pathId);
    if (!details) return;

    const isShowing = details.classList.toggle('show');

    if (isShowing) {
        const contentDiv = details.querySelector('.cred-content');
        const filename = contentDiv.getAttribute('data-filename');
        const loaded = contentDiv.getAttribute('data-loaded');

        if (loaded === 'false' && filename) {
            contentDiv.textContent = 'Cargando el contenido del archivo...';

            try {
                const modeParam = manager.type === 'antigravity' ? 'mode=antigravity' : 'mode=geminicli';
                const endpoint = `./creds/detail/${encodeURIComponent(filename)}?${modeParam}`;

                const response = await fetch(endpoint, { headers: getAuthHeaders() });

                const data = await response.json();
                if (response.ok && data.content) {
                    contentDiv.textContent = JSON.stringify(data.content, null, 2);
                    contentDiv.setAttribute('data-loaded', 'true');
                } else {
                    contentDiv.textContent = 'No se ha podido cargar el contenido del archivo: ' + (data.error || data.detail || 'Error desconocido');
                }
            } catch (error) {
                contentDiv.textContent = 'Error al cargar el contenido del archivo: ' + error.message;
            }
        }
    }
}

// =====================================================================
// Funciones de inicio de sesión
// =====================================================================
async function login() {
    const password = document.getElementById('loginPassword').value;

    if (!password) {
        showStatus('Introduce la contraseña', 'error');
        return;
    }

    try {
        const response = await fetch('./auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (response.ok) {
            AppState.authToken = data.token;
            localStorage.setItem('gcli2api_auth_token', AppState.authToken);
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('mainSection').classList.remove('hidden');
            showStatus('Sesión iniciada correctamente', 'success');
            // Inicializar el deslizador tras mostrar el panel
            requestAnimationFrame(() => initTabSlider());
        } else {
            showStatus(`Error al iniciar sesión: ${data.detail || data.error || 'Error desconocido'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    }
}

async function autoLogin() {
    const savedToken = localStorage.getItem('gcli2api_auth_token');
    if (!savedToken) return false;

    AppState.authToken = savedToken;

    try {
        const response = await fetch('./config/get', {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AppState.authToken}`
            }
        });

        if (response.ok) {
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('mainSection').classList.remove('hidden');
            showStatus('Sesión iniciada automáticamente', 'success');
            // Inicializar el deslizador tras mostrar el panel
            requestAnimationFrame(() => initTabSlider());
            return true;
        } else if (response.status === 401) {
            localStorage.removeItem('gcli2api_auth_token');
            AppState.authToken = '';
            return false;
        }
        return false;
    } catch (error) {
        return false;
    }
}

function logout() {
    localStorage.removeItem('gcli2api_auth_token');
    AppState.authToken = '';
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('mainSection').classList.add('hidden');
    showStatus('Sesión cerrada', 'info');
    const passwordInput = document.getElementById('loginPassword');
    if (passwordInput) passwordInput.value = '';
}

function handlePasswordEnter(event) {
    if (event.key === 'Enter') login();
}

// =====================================================================
// Cambio de pestañas
// =====================================================================

// Actualizar la posición del deslizador
function updateTabSlider(targetTab, animate = true) {
    const slider = document.querySelector('.tab-slider');
    const tabs = document.querySelector('.tabs');
    if (!slider || !tabs || !targetTab) return;

    // Obtener la posición del botón y el ancho del contenedor
    const tabLeft = targetTab.offsetLeft;
    const tabWidth = targetTab.offsetWidth;
    const tabsWidth = tabs.scrollWidth;

    // Controlar left y right a la vez para sincronizar la animación
    const rightValue = tabsWidth - tabLeft - tabWidth;

    if (animate) {
        slider.style.left = `${tabLeft}px`;
        slider.style.right = `${rightValue}px`;
    } else {
        // Sin animación en la primera carga
        slider.style.transition = 'none';
        slider.style.left = `${tabLeft}px`;
        slider.style.right = `${rightValue}px`;
        // Restaurar la transición tras forzar el repintado
        slider.offsetHeight;
        slider.style.transition = '';
    }
}

// Inicializar la posición del deslizador
function initTabSlider() {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
        updateTabSlider(activeTab, false);
    }
}

// Inicializar el deslizador al cargar la página y al redimensionar la ventana
document.addEventListener('DOMContentLoaded', initTabSlider);
window.addEventListener('resize', () => {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) updateTabSlider(activeTab, false);
});

function switchTab(tabName) {
    // Obtener el área de contenido activa
    const currentContent = document.querySelector('.tab-content.active');
    const targetContent = document.getElementById(tabName + 'Tab');

    // Si se pulsa la pestaña ya activa, no hacer nada
    if (currentContent === targetContent) return;

    // Localizar el botón de la pestaña de destino
    const targetTab = event && event.target ? event.target :
        document.querySelector(`.tab[onclick*="'${tabName}'"]`);

    // Quitar el estado active de todas las pestañas
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));

    // Añadir el estado active a la pestaña pulsada
    if (targetTab) {
        targetTab.classList.add('active');
        // Actualizar la posición del deslizador (con animación)
        updateTabSlider(targetTab, true);
    }

    // Desvanecer el contenido actual
    if (currentContent) {
        // Configurar la transición de salida
        currentContent.style.transition = 'opacity 0.18s ease-out, transform 0.18s ease-out';
        currentContent.style.opacity = '0';
        currentContent.style.transform = 'translateX(-12px)';

        setTimeout(() => {
            currentContent.classList.remove('active');
            currentContent.style.transition = '';
            currentContent.style.opacity = '';
            currentContent.style.transform = '';

            // Mostrar el nuevo contenido
            if (targetContent) {
                // Fijar el estado inicial (antes de añadir la clase active)
                targetContent.style.opacity = '0';
                targetContent.style.transform = 'translateX(12px)';
                targetContent.style.transition = 'none'; // Desactivar la transición temporalmente

                // Añadir la clase active para hacer visible el elemento
                targetContent.classList.add('active');

                // Doble requestAnimationFrame para asegurar que el navegador repinta
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        // Activar la transición y aplicar el estado final
                        targetContent.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
                        targetContent.style.opacity = '1';
                        targetContent.style.transform = 'translateX(0)';

                        // Limpiar los estilos en línea y cargar los datos
                        setTimeout(() => {
                            targetContent.style.transition = '';
                            targetContent.style.opacity = '';
                            targetContent.style.transform = '';

                            // Lanzar la carga de datos al terminar la animación
                            triggerTabDataLoad(tabName);
                        }, 260);
                    });
                });
            }
        }, 180);
    } else {
        // Si no hay contenido actual (primera carga), mostrar directamente el destino
        if (targetContent) {
            targetContent.classList.add('active');
            // Lanzar la carga de datos directamente
            triggerTabDataLoad(tabName);
        }
    }
}

// Carga de datos de la pestaña (separada de la animación)
function triggerTabDataLoad(tabName) {
    if (tabName === 'manage') AppState.creds.refresh();
    if (tabName === 'antigravity-manage') AppState.antigravityCreds.refresh();
    if (tabName === 'config') loadConfig();
    if (tabName === 'logs') connectWebSocket();
}


// =====================================================================
// Funciones de autenticación OAuth
// =====================================================================
async function startAuth() {
    const projectId = document.getElementById('projectId').value.trim();
    AppState.currentProjectId = projectId || null;

    const btn = document.getElementById('getAuthBtn');
    btn.disabled = true;
    btn.textContent = 'Obteniendo el enlace de autenticación...';

    try {
        const requestBody = projectId ? { project_id: projectId } : {};
        showStatus(projectId ? 'Generando el enlace de autenticación con el ID de proyecto indicado...' : 'Se intentará detectar el ID de proyecto automáticamente; generando el enlace de autenticación...', 'info');

        const response = await fetch('./auth/start', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('authUrl').href = data.auth_url;
            document.getElementById('authUrl').textContent = data.auth_url;
            document.getElementById('authUrlSection').classList.remove('hidden');

            const msg = data.auto_project_detection
                ? 'Enlace de autenticación generado (el ID de proyecto se detectará al completar la autenticación). Pulsa el enlace para completar la autorización'
                : `Enlace de autenticación generado (ID de proyecto: ${data.detected_project_id}). Pulsa el enlace para completar la autorización`;
            showStatus(msg, 'info');
            AppState.authInProgress = true;
        } else {
            showStatus(`Error: ${data.error || 'Error al obtener el enlace de autenticación'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Obtener enlace de autenticación';
    }
}

async function getCredentials() {
    if (!AppState.authInProgress) {
        showStatus('Obtén primero el enlace de autenticación y completa la autorización', 'error');
        return;
    }

    const btn = document.getElementById('getCredsBtn');
    btn.disabled = true;
    btn.textContent = 'Esperando la respuesta OAuth...';

    try {
        showStatus('Esperando la respuesta OAuth; esto puede tardar un poco...', 'info');

        const requestBody = AppState.currentProjectId ? { project_id: AppState.currentProjectId } : {};

        const response = await fetch('./auth/callback', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('credentialsContent').textContent = JSON.stringify(data.credentials, null, 2);

            const msg = data.auto_detected_project
                ? `✅ Autenticación correcta. ID de proyecto detectado automáticamente: ${data.credentials.project_id}. Archivo guardado en: ${data.file_path}`
                : `✅ Autenticación correcta. Archivo guardado en: ${data.file_path}`;
            showStatus(msg, 'success');

            document.getElementById('credentialsSection').classList.remove('hidden');
            AppState.authInProgress = false;
        } else if (data.requires_project_selection && data.available_projects) {
            let projectOptions = "Selecciona un proyecto:\n\n";
            data.available_projects.forEach((project, index) => {
                projectOptions += `${index + 1}. ${project.name} (${project.project_id})\n`;
            });
            projectOptions += `\nIntroduce el número (1-${data.available_projects.length}):`;

            const selection = prompt(projectOptions);
            const projectIndex = parseInt(selection) - 1;

            if (projectIndex >= 0 && projectIndex < data.available_projects.length) {
                AppState.currentProjectId = data.available_projects[projectIndex].project_id;
                btn.textContent = 'Reintentar obtener el archivo de autenticación';
                showStatus(`Reintentando con el proyecto seleccionado...`, 'info');
                setTimeout(() => getCredentials(), 1000);
                return;
            } else {
                showStatus('Selección no válida; vuelve a iniciar la autenticación', 'error');
            }
        } else if (data.requires_manual_project_id) {
            const userProjectId = prompt('No se ha podido detectar el ID de proyecto. Introduce manualmente el ID de tu proyecto de Google Cloud:');
            if (userProjectId && userProjectId.trim()) {
                AppState.currentProjectId = userProjectId.trim();
                btn.textContent = 'Reintentar obtener el archivo de autenticación';
                showStatus('Reintentando con el ID de proyecto introducido manualmente...', 'info');
                setTimeout(() => getCredentials(), 1000);
                return;
            } else {
                showStatus('Se necesita el ID de proyecto para completar la autenticación. Vuelve a empezar e introduce un ID correcto', 'error');
            }
        } else {
            showStatus(`❌ Error: ${data.error || 'Error al obtener el archivo de autenticación'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Obtener archivo de autenticación';
    }
}

// =====================================================================
// Funciones de autenticación de Antigravity
// =====================================================================
async function startAntigravityAuth() {
    const btn = document.getElementById('getAntigravityAuthBtn');
    btn.disabled = true;
    btn.textContent = 'Generando el enlace de autenticación...';

    try {
        showStatus('Generando el enlace de autenticación de Antigravity...', 'info');

        const response = await fetch('./auth/start', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ mode: 'antigravity' })
        });

        const data = await response.json();

        if (response.ok) {
            AppState.antigravityAuthState = data.state;
            AppState.antigravityAuthInProgress = true;

            const authUrlLink = document.getElementById('antigravityAuthUrl');
            authUrlLink.href = data.auth_url;
            authUrlLink.textContent = data.auth_url;
            document.getElementById('antigravityAuthUrlSection').classList.remove('hidden');

            showStatus('✅ Enlace de autenticación de Antigravity generado. Pulsa el enlace para completar la autorización', 'success');
        } else {
            showStatus(`❌ Error: ${data.error || 'Error al generar el enlace de autenticación'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Obtener enlace de autenticación de Antigravity';
    }
}

async function getAntigravityCredentials() {
    if (!AppState.antigravityAuthInProgress) {
        showStatus('Obtén primero el enlace de autenticación de Antigravity y completa la autorización', 'error');
        return;
    }

    const btn = document.getElementById('getAntigravityCredsBtn');
    btn.disabled = true;
    btn.textContent = 'Esperando la respuesta OAuth...';

    try {
        showStatus('Esperando la respuesta OAuth de Antigravity...', 'info');

        const response = await fetch('./auth/callback', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ mode: 'antigravity' })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('antigravityCredsContent').textContent = JSON.stringify(data.credentials, null, 2);
            document.getElementById('antigravityCredsSection').classList.remove('hidden');
            AppState.antigravityAuthInProgress = false;
            showStatus(`✅ Autenticación de Antigravity correcta. Archivo guardado en: ${data.file_path}`, 'success');
        } else {
            showStatus(`❌ Error: ${data.error || 'Error al obtener el archivo de autenticación'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Obtener credencial de Antigravity';
    }
}

function downloadAntigravityCredentials() {
    const content = document.getElementById('antigravityCredsContent').textContent;
    const blob = new Blob([content], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `antigravity-credential-${Date.now()}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// =====================================================================
// Gestión de la URL de retorno
// =====================================================================
function toggleProjectIdSection() {
    const section = document.getElementById('projectIdSection');
    const icon = document.getElementById('projectIdToggleIcon');

    if (section.style.display === 'none') {
        section.style.display = 'block';
        icon.style.transform = 'rotate(90deg)';
        icon.textContent = '▼';
    } else {
        section.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '▶';
    }
}

function toggleCallbackUrlSection() {
    const section = document.getElementById('callbackUrlSection');
    const icon = document.getElementById('callbackUrlToggleIcon');

    if (section.style.display === 'none') {
        section.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
        icon.textContent = '▲';
    } else {
        section.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '▼';
    }
}

function toggleAntigravityCallbackUrlSection() {
    const section = document.getElementById('antigravityCallbackUrlSection');
    const icon = document.getElementById('antigravityCallbackUrlToggleIcon');

    if (section.style.display === 'none') {
        section.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
        icon.textContent = '▲';
    } else {
        section.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '▼';
    }
}

async function processCallbackUrl() {
    const callbackUrl = document.getElementById('callbackUrlInput').value.trim();

    if (!callbackUrl) {
        showStatus('Introduce la URL de retorno', 'error');
        return;
    }

    if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
        showStatus('Introduce una URL válida (que empiece por http:// o https://)', 'error');
        return;
    }

    if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
        showStatus('❌ Esta no es una URL de retorno válida. Comprueba que:\n1. Has completado la autorización OAuth de Google\n2. Has copiado la URL completa de la barra de direcciones del navegador\n3. La URL contiene los parámetros code y state', 'error');
        return;
    }

    showStatus('Obteniendo la credencial desde la URL de retorno...', 'info');

    try {
        const projectId = document.getElementById('projectId')?.value.trim() || null;

        const response = await fetch('./auth/callback-url', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ callback_url: callbackUrl, project_id: projectId })
        });

        const result = await response.json();

        if (result.credentials) {
            showStatus(result.message || 'Credencial obtenida correctamente desde la URL de retorno', 'success');
            document.getElementById('credentialsContent').innerHTML = '<pre>' + JSON.stringify(result.credentials, null, 2) + '</pre>';
            document.getElementById('credentialsSection').classList.remove('hidden');
        } else if (result.requires_manual_project_id) {
            showStatus('Hay que indicar el ID de proyecto manualmente: introdúcelo en las opciones avanzadas y vuelve a intentarlo', 'error');
        } else if (result.requires_project_selection) {
            let msg = '<br><strong>Proyectos disponibles:</strong><br>';
            result.available_projects.forEach(p => {
                msg += `• ${p.name} (ID: ${p.project_id})<br>`;
            });
            showStatus('Se han detectado varios proyectos; indica el ID de proyecto en las opciones avanzadas: ' + msg, 'error');
        } else {
            showStatus(result.error || 'Error al obtener la credencial desde la URL de retorno', 'error');
        }

        document.getElementById('callbackUrlInput').value = '';
    } catch (error) {
        showStatus(`Error al obtener la credencial desde la URL de retorno: ${error.message}`, 'error');
    }
}

async function processAntigravityCallbackUrl() {
    const callbackUrl = document.getElementById('antigravityCallbackUrlInput').value.trim();

    if (!callbackUrl) {
        showStatus('Introduce la URL de retorno', 'error');
        return;
    }

    if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
        showStatus('Introduce una URL válida (que empiece por http:// o https://)', 'error');
        return;
    }

    if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
        showStatus('❌ Esta no es una URL de retorno válida. Asegúrate de que contiene los parámetros code y state', 'error');
        return;
    }

    showStatus('Obteniendo la credencial de Antigravity desde la URL de retorno...', 'info');

    try {
        const response = await fetch('./auth/callback-url', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ callback_url: callbackUrl, mode: 'antigravity' })
        });

        const result = await response.json();

        if (result.credentials) {
            showStatus(result.message || 'Credencial de Antigravity obtenida correctamente desde la URL de retorno', 'success');
            document.getElementById('antigravityCredsContent').textContent = JSON.stringify(result.credentials, null, 2);
            document.getElementById('antigravityCredsSection').classList.remove('hidden');
        } else {
            showStatus(result.error || 'Error al obtener la credencial de Antigravity desde la URL de retorno', 'error');
        }

        document.getElementById('antigravityCallbackUrlInput').value = '';
    } catch (error) {
        showStatus(`Error al obtener la credencial de Antigravity desde la URL de retorno: ${error.message}`, 'error');
    }
}

// =====================================================================
// Funciones globales de compatibilidad (invocadas desde el HTML)
// =====================================================================
// Gestión de credenciales normales
function refreshCredsStatus() { AppState.creds.refresh(); }
function applyStatusFilter() { AppState.creds.applyStatusFilter(); }
function changePage(direction) { AppState.creds.changePage(direction); }
function changePageSize() { AppState.creds.changePageSize(); }
function toggleFileSelection(filename) {
    if (AppState.creds.selectedFiles.has(filename)) {
        AppState.creds.selectedFiles.delete(filename);
    } else {
        AppState.creds.selectedFiles.add(filename);
    }
    AppState.creds.updateBatchControls();
}
function toggleSelectAll() {
    const checkbox = document.getElementById('selectAllCheckbox');
    const checkboxes = document.querySelectorAll('.file-checkbox');

    if (checkbox.checked) {
        checkboxes.forEach(cb => AppState.creds.selectedFiles.add(cb.getAttribute('data-filename')));
    } else {
        AppState.creds.selectedFiles.clear();
    }
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
    AppState.creds.updateBatchControls();
}
function batchAction(action) { AppState.creds.batchAction(action); }
function downloadCred(filename) {
    fetch(`./creds/download/${filename}`, { headers: { 'Authorization': `Bearer ${AppState.authToken}` } })
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus(`Archivo descargado: ${filename}`, 'success');
        })
        .catch(() => showStatus(`Error al descargar: ${filename}`, 'error'));
}
async function downloadAllCreds() {
    try {
        const response = await fetch('./creds/download-all', {
            headers: { 'Authorization': `Bearer ${AppState.authToken}` }
        });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'credentials.zip';
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus('Se han descargado todos los archivos de credenciales', 'success');
        }
    } catch (error) {
        showStatus(`Error al descargar el paquete: ${error.message}`, 'error');
    }
}

// Gestión de credenciales de Antigravity
function refreshAntigravityCredsList() { AppState.antigravityCreds.refresh(); }
function applyAntigravityStatusFilter() { AppState.antigravityCreds.applyStatusFilter(); }
function changeAntigravityPage(direction) { AppState.antigravityCreds.changePage(direction); }
function changeAntigravityPageSize() { AppState.antigravityCreds.changePageSize(); }
function toggleAntigravityFileSelection(filename) {
    if (AppState.antigravityCreds.selectedFiles.has(filename)) {
        AppState.antigravityCreds.selectedFiles.delete(filename);
    } else {
        AppState.antigravityCreds.selectedFiles.add(filename);
    }
    AppState.antigravityCreds.updateBatchControls();
}
function toggleSelectAllAntigravity() {
    const checkbox = document.getElementById('selectAllAntigravityCheckbox');
    const checkboxes = document.querySelectorAll('.antigravityFile-checkbox');

    if (checkbox.checked) {
        checkboxes.forEach(cb => AppState.antigravityCreds.selectedFiles.add(cb.getAttribute('data-filename')));
    } else {
        AppState.antigravityCreds.selectedFiles.clear();
    }
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
    AppState.antigravityCreds.updateBatchControls();
}
function batchAntigravityAction(action) { AppState.antigravityCreds.batchAction(action); }
function downloadAntigravityCred(filename) {
    fetch(`./creds/download/${filename}?mode=antigravity`, { headers: getAuthHeaders() })
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus(`✅ Descargado: ${filename}`, 'success');
        })
        .catch(() => showStatus(`Error al descargar: ${filename}`, 'error'));
}
function deleteAntigravityCred(filename) {
    if (confirm(`¿Seguro que quieres eliminar ${filename}?`)) {
        AppState.antigravityCreds.action(filename, 'delete');
    }
}
async function downloadAllAntigravityCreds() {
    try {
        const response = await fetch('./creds/download-all?mode=antigravity', { headers: getAuthHeaders() });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `antigravity_credentials_${Date.now()}.zip`;
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus('✅ Todas las credenciales de Antigravity se han descargado en un paquete', 'success');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    }
}

// Subida de archivos
function handleFileSelect(event) { AppState.uploadFiles.handleFileSelect(event); }
function removeFile(index) { AppState.uploadFiles.removeFile(index); }
function clearFiles() { AppState.uploadFiles.clearFiles(); }
function uploadFiles() { AppState.uploadFiles.upload(); }

function handleAntigravityFileSelect(event) { AppState.antigravityUploadFiles.handleFileSelect(event); }
function handleAntigravityFileDrop(event) {
    event.preventDefault();
    event.currentTarget.style.borderColor = '#007bff';
    event.currentTarget.style.backgroundColor = '#f8f9fa';
    AppState.antigravityUploadFiles.addFiles(Array.from(event.dataTransfer.files));
}
function removeAntigravityFile(index) { AppState.antigravityUploadFiles.removeFile(index); }
function clearAntigravityFiles() { AppState.antigravityUploadFiles.clearFiles(); }
function uploadAntigravityFiles() { AppState.antigravityUploadFiles.upload(); }

// Correo electrónico
// Función auxiliar: actualiza el correo mostrado en la tarjeta a partir del nombre de archivo
function updateEmailDisplay(filename, email, managerType = 'normal') {
    // Buscar la tarjeta de credencial correspondiente
    const containerId = managerType === 'antigravity' ? 'antigravityCredsList' : 'credsList';
    const container = document.getElementById(containerId);
    if (!container) return false;

    // Localizar la casilla mediante data-filename y después su tarjeta padre
    const checkbox = container.querySelector(`input[data-filename="${filename}"]`);
    if (!checkbox) return false;

    // Localizar el elemento cred-card correspondiente
    const card = checkbox.closest('.cred-card');
    if (!card) return false;

    // Localizar el elemento que muestra el correo
    const emailDiv = card.querySelector('.cred-email');
    if (emailDiv) {
        emailDiv.textContent = email;
        emailDiv.style.color = '#666';
        emailDiv.style.fontStyle = 'normal';
        return true;
    }
    return false;
}

async function fetchUserEmail(filename) {
    try {
        showStatus('Obteniendo el correo del usuario...', 'info');
        const response = await fetch(`./creds/fetch-email/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok && data.user_email) {
            showStatus(`Correo obtenido: ${data.user_email}`, 'success');
            // Actualizar el correo de la tarjeta sin recargar toda la lista
            updateEmailDisplay(filename, data.user_email, 'normal');
        } else {
            showStatus(data.message || 'No se ha podido obtener el correo del usuario', 'error');
        }
    } catch (error) {
        showStatus(`Error al obtener el correo: ${error.message}`, 'error');
    }
}

async function fetchAntigravityUserEmail(filename) {
    try {
        showStatus('Obteniendo el correo del usuario...', 'info');
        const response = await fetch(`./creds/fetch-email/${encodeURIComponent(filename)}?mode=antigravity`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok && data.user_email) {
            showStatus(`Correo obtenido: ${data.user_email}`, 'success');
            // Actualizar el correo de la tarjeta sin recargar toda la lista
            updateEmailDisplay(filename, data.user_email, 'antigravity');
        } else {
            showStatus(data.message || 'No se ha podido obtener el correo del usuario', 'error');
        }
    } catch (error) {
        showStatus(`Error al obtener el correo: ${error.message}`, 'error');
    }
}

async function verifyProjectId(filename) {
    try {
        // Mostrar el estado de carga
        showStatus('🔍 Verificando el Project ID, espera un momento...', 'info');

        const response = await fetch(`./creds/verify-project/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (response.ok && data.success) {
            // Mostrar el mensaje de éxito junto al Project ID
            const tierLine = data.subscription_tier ? `\nTier: ${data.subscription_tier}` : '';
            const creditLine = data.credit_amount !== undefined && data.credit_amount !== null
                ? `\nCréditos: ${data.credit_amount}`
                : '';
            const successMsg = `✅ Verificación correcta.\nArchivo: ${filename}\nProject ID: ${data.project_id}${tierLine}${creditLine}\n\n${data.message}`;
            showStatus(successMsg.replace(/\n/g, '<br>'), 'success');

            // Mostrar el aviso de éxito
            showMessageModal('Verificación correcta', `✅ Verificación correcta.\n\nArchivo: ${filename}\nProject ID: ${data.project_id}${tierLine}${creditLine}\n\n${data.message}`, 'success');

            await AppState.creds.refresh();
        } else {
            // Mostrar el mensaje de error
            const errorMsg = data.message || 'Error en la verificación';
            showStatus(`❌ ${errorMsg}`, 'error');
            showMessageModal('Error en la verificación', `❌ Error en la verificación\n\n${errorMsg}`, 'error');
        }
    } catch (error) {
        const errorMsg = `Error en la verificación: ${error.message}`;
        showStatus(`❌ ${errorMsg}`, 'error');
        showMessageModal('Error en la verificación', `❌ ${errorMsg}`, 'error');
    }
}

async function verifyAntigravityProjectId(filename) {
    try {
        // Mostrar el estado de carga
        showStatus('🔍 Verificando el Project ID de Antigravity, espera un momento...', 'info');

        const response = await fetch(`./creds/verify-project/${encodeURIComponent(filename)}?mode=antigravity`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (response.ok && data.success) {
            // Mostrar el mensaje de éxito junto al Project ID
            const tierLine = data.subscription_tier ? `\nTier: ${data.subscription_tier}` : '';
            const creditLine = data.credit_amount !== undefined && data.credit_amount !== null
                ? `\nCréditos: ${data.credit_amount}`
                : '';
            const successMsg = `✅ Verificación correcta.\nArchivo: ${filename}\nProject ID: ${data.project_id}${tierLine}${creditLine}\n\n${data.message}`;
            showStatus(successMsg.replace(/\n/g, '<br>'), 'success');

            // Mostrar el aviso de éxito
            showMessageModal('Verificación correcta', `✅ Verificación de Antigravity correcta.\n\nArchivo: ${filename}\nProject ID: ${data.project_id}${tierLine}${creditLine}\n\n${data.message}`, 'success');

            await AppState.antigravityCreds.refresh();
        } else {
            // Mostrar el mensaje de error
            const errorMsg = data.message || 'Error en la verificación';
            showStatus(`❌ ${errorMsg}`, 'error');
            showMessageModal('Error en la verificación', `❌ Error en la verificación\n\n${errorMsg}`, 'error');
        }
    } catch (error) {
        const errorMsg = `Error en la verificación: ${error.message}`;
        showStatus(`❌ ${errorMsg}`, 'error');
        showMessageModal('Error en la verificación', `❌ ${errorMsg}`, 'error');
    }
}

async function testCredential(filename) {
    try {
        // Mostrar el estado de carga
        showStatus('🧪 Probando la credencial, espera un momento...', 'info');

        const response = await fetch(`./creds/test/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });

        // Analizar la respuesta JSON
        const data = await response.json();

        if (response.status === 200) {
            // Credencial válida
            const successMsg = `✅ Prueba correcta.\nArchivo: ${filename}\nEstado: ${data.message || 'Credencial válida'} (${data.status_code || 200})`;
            showStatus('✅ Prueba correcta', 'success');
            showMessageModal('Prueba correcta', successMsg, 'success');
            await AppState.creds.refresh();
        }
        else {
            // Otros errores: mostrar la información completa del error
            let errorDetails = `❌ Prueba fallida\nArchivo: ${filename}\n`;

            // Si hay una respuesta de error completa, añadirla a los detalles
            if (data.error) {
                try {
                    // Intentar formatear el error JSON
                    const errorObj = JSON.parse(data.error);
                    errorDetails += `\nDetalles del error:\n${JSON.stringify(errorObj, null, 2)}`;
                } catch {
                    // Si no es JSON, mostrar el texto tal cual
                    errorDetails += `\nDetalles del error:\n${data.error}`;
                }
            } else {
                errorDetails += `Código de error: ${data.status_code || response.status}`;
            }

            showStatus(`❌ Prueba fallida - ${data.message || 'Código de error: ' + (data.status_code || response.status)}`, 'error');
            showMessageModal('Prueba fallida', errorDetails, 'error');
        }
    } catch (error) {
        const errorMsg = `Error en la prueba: ${error.message}`;
        showStatus(`❌ ${errorMsg}`, 'error');
        showMessageModal('Prueba fallida', `❌ ${errorMsg}`, 'error');
    }
}

async function testAntigravityCredential(filename) {
    try {
        // Mostrar el estado de carga
        showStatus('🧪 Probando la credencial de Antigravity, espera un momento...', 'info');

        const response = await fetch(`./creds/test/${encodeURIComponent(filename)}?mode=antigravity`, {
            method: 'POST',
            headers: getAuthHeaders()
        });

        // Analizar la respuesta JSON
        const data = await response.json();

        if (response.status === 200) {
            // Credencial válida
            const successMsg = `✅ Prueba correcta.\nArchivo: ${filename}\nEstado: ${data.message || 'Credencial de Antigravity válida'} (${data.status_code || 200})`;
            showStatus('✅ Prueba correcta', 'success');
            showMessageModal('Prueba correcta', successMsg, 'success');
            await AppState.antigravityCreds.refresh();
        }
        else {
            // Otros errores: mostrar la información completa del error
            let errorDetails = `❌ Prueba fallida\nArchivo: ${filename}\n`;

            // Si hay una respuesta de error completa, añadirla a los detalles
            if (data.error) {
                try {
                    // Intentar formatear el error JSON
                    const errorObj = JSON.parse(data.error);
                    errorDetails += `\nDetalles del error:\n${JSON.stringify(errorObj, null, 2)}`;
                } catch {
                    // Si no es JSON, mostrar el texto tal cual
                    errorDetails += `\nDetalles del error:\n${data.error}`;
                }
            } else {
                errorDetails += `Código de error: ${data.status_code || response.status}`;
            }

            showStatus(`❌ Prueba fallida - ${data.message || 'Código de error: ' + (data.status_code || response.status)}`, 'error');
            showMessageModal('Prueba fallida', errorDetails, 'error');
        }
    } catch (error) {
        const errorMsg = `Error en la prueba: ${error.message}`;
        showStatus(`❌ ${errorMsg}`, 'error');
        showMessageModal('Prueba fallida', `❌ ${errorMsg}`, 'error');
    }
}

async function configurePreviewChannel(filename) {
    try {
        // Mostrar el estado de carga
        showStatus('🔧 Configurando el canal Preview, espera un momento...', 'info');

        const response = await fetch(`./creds/configure-preview/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Configuración correcta
            const successMsg = `✅ Configuración correcta.\nArchivo: ${filename}\nEstado: ${data.message}`;
            showStatus(successMsg.replace(/\n/g, '<br>'), 'success');
            showMessageModal('Canal Preview configurado', `✅ Canal Preview configurado correctamente.\n\nArchivo: ${filename}\n\n${data.message}\n\nSetting ID: ${data.setting_id || 'N/A'}\nBinding ID: ${data.binding_id || 'N/A'}`, 'success');

            // Actualizar la lista de credenciales
            await AppState.creds.refresh();
        } else {
            // Error de configuración
            const errorMsg = data.message || 'Error de configuración';
            const errorDetail = data.error || '';
            const step = data.step || '';

            let alertMsg = `❌ Error al configurar el canal Preview\n\nArchivo: ${filename}\n\n${errorMsg}`;
            if (step) {
                alertMsg += `\nPaso fallido: ${step}`;
            }
            if (errorDetail) {
                alertMsg += `\n\nDetalles del error: ${errorDetail}`;
            }

            showStatus(`❌ ${errorMsg}`, 'error');
            showMessageModal('Error al configurar el canal Preview', alertMsg, 'error');
        }
    } catch (error) {
        const errorMsg = `Error al configurar el canal Preview: ${error.message}`;
        showStatus(`❌ ${errorMsg}`, 'error');
        showMessageModal('Error al configurar el canal Preview', `❌ ${errorMsg}`, 'error');
    }
}

async function toggleAntigravityQuotaDetails(pathId) {
    const quotaDetails = document.getElementById('quota-' + pathId);
    if (!quotaDetails) return;

    // Alternar la visibilidad
    const isShowing = quotaDetails.style.display === 'block';

    if (isShowing) {
        // Contraer
        quotaDetails.style.display = 'none';
    } else {
        // Expandir
        quotaDetails.style.display = 'block';

        const contentDiv = quotaDetails.querySelector('.cred-quota-content');
        const filename = contentDiv.getAttribute('data-filename');

        // Recargar los datos en cada expansión
        if (filename) {
            contentDiv.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">📊 Cargando la información de cuota...</div>';

            try {
                const response = await fetch(`./creds/quota/${encodeURIComponent(filename)}?mode=antigravity`, {
                    method: 'GET',
                    headers: getAuthHeaders()
                });
                const data = await response.json();

                if (response.ok && data.success) {
                    // Renderizar la información de cuota
                    const models = data.models || {};

                    if (Object.keys(models).length === 0) {
                        contentDiv.innerHTML = `
                            <div style="text-align: center; padding: 20px; color: #999;">
                                <div style="font-size: 48px; margin-bottom: 10px;">📊</div>
                                <div>No hay información de cuota</div>
                            </div>
                        `;
                    } else {
                        let quotaHTML = `
                            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px; border-radius: 8px 8px 0 0; margin: -10px -10px 15px -10px;">
                                <h4 style="margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 20px;">📊</span>
                                    <span>Detalle de la información de cuota</span>
                                </h4>
                                <div style="font-size: 12px; opacity: 0.9; margin-top: 5px;">Archivo: ${filename}</div>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">
                        `;

                        for (const [modelName, quotaData] of Object.entries(models)) {
                            // El backend devuelve la proporción restante (0-1), no una cantidad absoluta
                            const remainingFraction = quotaData.remaining || 0;
                            const resetTime = quotaData.resetTime || 'N/A';

                            // Calcular el porcentaje utilizado (1 - proporción restante)
                            const usedPercentage = Math.round((1 - remainingFraction) * 100);
                            const remainingPercentage = Math.round(remainingFraction * 100);

                            // Elegir el color según el uso
                            let percentageColor = '#28a745'; // Verde: uso bajo
                            if (usedPercentage >= 90) percentageColor = '#dc3545'; // Rojo: uso muy alto
                            else if (usedPercentage >= 70) percentageColor = '#ffc107'; // Amarillo: uso alto
                            else if (usedPercentage >= 50) percentageColor = '#17a2b8'; // Azul: uso medio

                            quotaHTML += `
                                <div style="background: white; border-left: 4px solid ${percentageColor}; border-radius: 4px; padding: 8px 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                        <div style="font-weight: bold; color: #333; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 8px;" title="${modelName} - restante ${remainingPercentage}% - ${resetTime}">
                                            ${modelName}
                                        </div>
                                        <div style="font-size: 13px; font-weight: bold; color: ${percentageColor}; white-space: nowrap;">
                                            ${remainingPercentage}%
                                        </div>
                                    </div>
                                    <div style="width: 100%; height: 8px; background-color: #e9ecef; border-radius: 4px; overflow: hidden; margin-bottom: 4px;">
                                        <div style="width: ${usedPercentage}%; height: 100%; background-color: ${percentageColor}; transition: width 0.3s ease;"></div>
                                    </div>
                                    <div style="font-size: 10px; color: #666; text-align: right;">
                                        ${resetTime !== 'N/A' ? '🔄 ' + resetTime : ''}
                                    </div>
                                </div>
                            `;
                        }

                        quotaHTML += '</div>';
                        contentDiv.innerHTML = quotaHTML;
                    }

                    showStatus('✅ Información de cuota cargada correctamente', 'success');
                } else {
                    // Mostrar el error
                    const errorMsg = data.error || 'Error al obtener la información de cuota';
                    contentDiv.innerHTML = `
                        <div style="text-align: center; padding: 20px; color: #dc3545;">
                            <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                            <div style="font-weight: bold; margin-bottom: 5px;">Error al obtener la información de cuota</div>
                            <div style="font-size: 13px; color: #666;">${errorMsg}</div>
                        </div>
                    `;
                    showStatus(`❌ ${errorMsg}`, 'error');
                }
            } catch (error) {
                contentDiv.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #dc3545;">
                        <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                        <div style="font-weight: bold; margin-bottom: 5px;">Error de red</div>
                        <div style="font-size: 13px; color: #666;">${error.message}</div>
                    </div>
                `;
                showStatus(`❌ Error al obtener la información de cuota: ${error.message}`, 'error');
            }
        }
    }
}

// =====================================================================
// Ver los detalles de los errores
// =====================================================================
async function toggleErrorDetails(pathId) {
    await toggleErrorDetailsCommon(pathId, AppState.creds);
}

async function toggleAntigravityErrorDetails(pathId) {
    await toggleErrorDetailsCommon(pathId, AppState.antigravityCreds);
}

async function toggleErrorDetailsCommon(pathId, manager) {
    const errorDetails = document.getElementById('errors-' + pathId);
    if (!errorDetails) return;

    // Alternar la visibilidad
    const isShowing = errorDetails.classList.toggle('show');

    if (isShowing) {
        const contentDiv = errorDetails.querySelector('.cred-content');
        const filename = contentDiv.getAttribute('data-filename');

        // Recargar los datos en cada expansión
        if (filename) {
            contentDiv.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">⏳ Cargando la información de errores...</div>';

            try {
                const modeParam = manager.type === 'antigravity' ? 'mode=antigravity' : 'mode=geminicli';
                const response = await fetch(`./creds/errors/${encodeURIComponent(filename)}?${modeParam}`, {
                    method: 'GET',
                    headers: getAuthHeaders()
                });
                const data = await response.json();

                if (response.ok) {
                    const errorCodes = data.error_codes || [];
                    const errorMessages = data.error_messages || {};

                    if (errorCodes.length === 0) {
                        contentDiv.innerHTML = `
                            <div style="text-align: center; padding: 20px; color: #28a745;">
                                <div style="font-size: 48px; margin-bottom: 10px;">✅</div>
                                <div style="font-weight: bold;">Sin errores registrados</div>
                                <div style="font-size: 12px; color: #666; margin-top: 8px;">Esta credencial funciona correctamente</div>
                            </div>
                        `;
                    } else {
                        let errorHTML = '';

                        // Recorrer todos los códigos de error y obtener su mensaje del objeto errorMessages
                        errorCodes.forEach((errorCode) => {
                            const messageStr = errorMessages[errorCode] || 'Sin información detallada';

                            // Extraer el mensaje de error principal y los detalles
                            let displayMsg = messageStr;
                            let detailsHtml = '';

                            try {
                                // Intentar analizar el mensaje en formato JSON
                                const parsedMsg = JSON.parse(messageStr);
                                if (parsedMsg.error) {
                                    // Mostrar el mensaje de error principal
                                    if (parsedMsg.error.message) {
                                        displayMsg = parsedMsg.error.message;
                                    }

                                    // Si existe el campo details, mostrarlo también
                                    if (parsedMsg.error.details && Array.isArray(parsedMsg.error.details)) {
                                        detailsHtml = '<div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #ddd;">';
                                        detailsHtml += '<div style="font-size: 12px; color: #666; margin-bottom: 5px;">Detalles:</div>';

                                        parsedMsg.error.details.forEach((detail, idx) => {
                                            detailsHtml += '<div style="font-size: 12px; margin-left: 10px; margin-bottom: 5px;">';

                                            // Mostrar @type
                                            if (detail['@type']) {
                                                const highlightedType = highlightHttpLinks(escapeHtml(detail['@type']));
                                                detailsHtml += `<div style="color: #007bff;">Tipo: ${highlightedType}</div>`;
                                            }

                                            // Mostrar reason
                                            if (detail.reason) {
                                                detailsHtml += `<div style="color: #dc3545;">Motivo: ${escapeHtml(detail.reason)}</div>`;
                                            }

                                            // Mostrar metadata (p. ej. quotaResetTimeStamp)
                                            if (detail.metadata) {
                                                detailsHtml += '<div style="margin-left: 10px; margin-top: 3px;">';
                                                for (const [key, value] of Object.entries(detail.metadata)) {
                                                    const highlightedValue = highlightHttpLinks(escapeHtml(String(value)));
                                                    detailsHtml += `<div style="font-family: monospace; color: #333;">${escapeHtml(key)}: ${highlightedValue}</div>`;
                                                }
                                                detailsHtml += '</div>';
                                            }

                                            detailsHtml += '</div>';
                                        });

                                        detailsHtml += '</div>';
                                    }

                                    // Si existe el campo status, mostrarlo también
                                    if (parsedMsg.error.status) {
                                        if (!detailsHtml) {
                                            detailsHtml = '<div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #ddd;">';
                                        }
                                        detailsHtml += `<div style="font-size: 12px; color: #666;">Estado: ${escapeHtml(parsedMsg.error.status)}</div>`;
                                        if (!parsedMsg.error.details) {
                                            detailsHtml += '</div>';
                                        }
                                    }
                                }
                            } catch (e) {
                                // Si no está en formato JSON, usar el mensaje original
                            }

                            // Resaltar los enlaces HTTP del mensaje
                            const highlightedMsg = highlightHttpLinks(escapeHtml(displayMsg));

                            errorHTML += `
                                <div style="padding: 12px; margin-bottom: 10px; border-left: 3px solid #dc3545; background-color: #f8f9fa;">
                                    <div style="font-weight: bold; color: #dc3545; margin-bottom: 8px;">Código de error: ${errorCode}</div>
                                    <div style="line-height: 1.6; color: #333; white-space: pre-wrap; word-break: break-word;">
                                        ${highlightedMsg}
                                    </div>
                                    ${detailsHtml}
                                </div>
                            `;
                        });

                        contentDiv.innerHTML = errorHTML;
                    }

                    showStatus('✅ Información de errores cargada correctamente', 'success');
                } else {
                    // Mostrar el error
                    const errorMsg = data.detail || data.error || 'Error al obtener la información de errores';
                    contentDiv.innerHTML = `
                        <div style="text-align: center; padding: 20px; color: #dc3545;">
                            <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                            <div style="font-weight: bold;">Error al cargar</div>
                            <div style="font-size: 12px; margin-top: 8px;">${errorMsg}</div>
                        </div>
                    `;
                    showStatus(`❌ Error al obtener la información de errores: ${errorMsg}`, 'error');
                }
            } catch (error) {
                contentDiv.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #dc3545;">
                        <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                        <div style="font-weight: bold;">Error de red</div>
                        <div style="font-size: 12px; margin-top: 8px;">${error.message}</div>
                    </div>
                `;
                showStatus(`❌ Error al obtener la información de errores: ${error.message}`, 'error');
            }
        }
    }
}

// Función de escapado de HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Función para resaltar los enlaces HTTP
function highlightHttpLinks(text) {
    // Coincide con las URL que empiezan por http:// o https://
    const urlRegex = /(https?:\/\/[^\s<>"]+)/gi;
    return text.replace(urlRegex, function(url) {
        return `<a href="${url}" target="_blank" style="color: #007bff; text-decoration: underline; word-break: break-all;" title="Clic para abrir: ${url}">${url}</a>`;
    });
}

async function batchVerifyProjectIds() {
    const selectedFiles = Array.from(AppState.creds.selectedFiles);
    if (selectedFiles.length === 0) {
        showStatus('❌ Selecciona primero las credenciales que quieres verificar', 'error');
        showMessageModal('Aviso', 'Selecciona primero las credenciales que quieres verificar', 'error');
        return;
    }

    if (!confirm(`¿Seguro que quieres verificar el Project ID de ${selectedFiles.length} credenciales?\n\nLa verificación se hará en paralelo para acelerarla.`)) {
        return;
    }

    showStatus(`🔍 Verificando ${selectedFiles.length} credenciales en paralelo, espera un momento...`, 'info');

    // Lanzar todas las peticiones de verificación en paralelo
    const promises = selectedFiles.map(async (filename) => {
        try {
            const response = await fetch(`./creds/verify-project/${encodeURIComponent(filename)}`, {
                method: 'POST',
                headers: getAuthHeaders()
            });
            const data = await response.json();

            if (response.ok && data.success) {
                return {
                    success: true,
                    filename,
                    projectId: data.project_id,
                    creditAmount: data.credit_amount,
                    message: data.message
                };
            } else {
                return { success: false, filename, error: data.message || 'Error' };
            }
        } catch (error) {
            return { success: false, filename, error: error.message };
        }
    });

    // Esperar a que terminen todas las peticiones
    const results = await Promise.all(promises);

    // Resumen de resultados
    let successCount = 0;
    let failCount = 0;
    const resultMessages = [];

    results.forEach(result => {
        if (result.success) {
            successCount++;
            const creditSuffix = result.creditAmount !== undefined && result.creditAmount !== null
                ? ` (créditos: ${result.creditAmount})`
                : '';
            resultMessages.push(`✅ ${result.filename}: ${result.projectId}${creditSuffix}`);
        } else {
            failCount++;
            resultMessages.push(`❌ ${result.filename}: ${result.error}`);
        }
    });

    await AppState.creds.refresh();

    const summary = `Verificación por lotes completada.\n\nCorrectas: ${successCount}\nFallidas: ${failCount}\nTotal: ${selectedFiles.length}\n\nResultados detallados:\n${resultMessages.join('\n')}`;

    if (failCount === 0) {
        showStatus(`✅ Todas las verificaciones son correctas: ${successCount}/${selectedFiles.length} credenciales`, 'success');
        showMessageModal('Verificación por lotes completada', summary, 'success');
    } else if (successCount === 0) {
        showStatus(`❌ Todas las verificaciones han fallado: ${failCount}/${selectedFiles.length} credenciales`, 'error');
        showMessageModal('Verificación por lotes completada', summary, 'error');
    } else {
        showStatus(`⚠️ Verificación por lotes completada: ${successCount}/${selectedFiles.length} correctas, ${failCount} fallidas`, 'info');
        showMessageModal('Verificación por lotes completada', summary, 'info');
    }

    console.log(summary);
}

async function batchVerifyAntigravityProjectIds() {
    const selectedFiles = Array.from(AppState.antigravityCreds.selectedFiles);
    if (selectedFiles.length === 0) {
        showStatus('❌ Selecciona primero las credenciales de Antigravity que quieres verificar', 'error');
        showMessageModal('Aviso', 'Selecciona primero las credenciales de Antigravity que quieres verificar', 'error');
        return;
    }

    if (!confirm(`¿Seguro que quieres verificar el Project ID de ${selectedFiles.length} credenciales de Antigravity?\n\nLa verificación se hará en paralelo para acelerarla.`)) {
        return;
    }

    showStatus(`🔍 Verificando ${selectedFiles.length} credenciales de Antigravity en paralelo, espera un momento...`, 'info');

    // Lanzar todas las peticiones de verificación en paralelo
    const promises = selectedFiles.map(async (filename) => {
        try {
            const response = await fetch(`./creds/verify-project/${encodeURIComponent(filename)}?mode=antigravity`, {
                method: 'POST',
                headers: getAuthHeaders()
            });
            const data = await response.json();

            if (response.ok && data.success) {
                return {
                    success: true,
                    filename,
                    projectId: data.project_id,
                    creditAmount: data.credit_amount,
                    message: data.message
                };
            } else {
                return { success: false, filename, error: data.message || 'Error' };
            }
        } catch (error) {
            return { success: false, filename, error: error.message };
        }
    });

    // Esperar a que terminen todas las peticiones
    const results = await Promise.all(promises);

    // Resumen de resultados
    let successCount = 0;
    let failCount = 0;
    const resultMessages = [];

    results.forEach(result => {
        if (result.success) {
            successCount++;
            const creditSuffix = result.creditAmount !== undefined && result.creditAmount !== null
                ? ` (créditos: ${result.creditAmount})`
                : '';
            resultMessages.push(`✅ ${result.filename}: ${result.projectId}${creditSuffix}`);
        } else {
            failCount++;
            resultMessages.push(`❌ ${result.filename}: ${result.error}`);
        }
    });

    await AppState.antigravityCreds.refresh();

    const summary = `Verificación por lotes de Antigravity completada.\n\nCorrectas: ${successCount}\nFallidas: ${failCount}\nTotal: ${selectedFiles.length}\n\nResultados detallados:\n${resultMessages.join('\n')}`;

    if (failCount === 0) {
        showStatus(`✅ Todas las verificaciones son correctas: ${successCount}/${selectedFiles.length} credenciales de Antigravity`, 'success');
        showMessageModal('Verificación por lotes de Antigravity completada', summary, 'success');
    } else if (successCount === 0) {
        showStatus(`❌ Todas las verificaciones han fallado: ${failCount}/${selectedFiles.length} credenciales de Antigravity`, 'error');
        showMessageModal('Verificación por lotes de Antigravity completada', summary, 'error');
    } else {
        showStatus(`⚠️ Verificación por lotes completada: ${successCount}/${selectedFiles.length} correctas, ${failCount} fallidas`, 'info');
        showMessageModal('Verificación por lotes de Antigravity completada', summary, 'info');
    }

    console.log(summary);
}

async function batchConfigurePreview() {
    const selectedFiles = Array.from(AppState.creds.selectedFiles);
    if (selectedFiles.length === 0) {
        showStatus('❌ Selecciona primero las credenciales en las que quieres configurar Preview', 'error');
        showMessageModal('Aviso', 'Selecciona primero las credenciales en las que quieres configurar Preview', 'error');
        return;
    }

    if (!confirm(`¿Seguro que quieres configurar el canal Preview en ${selectedFiles.length} credenciales?\n\nLa configuración se hará en paralelo para acelerarla.`)) {
        return;
    }

    showStatus(`🔧 Configurando el canal Preview en ${selectedFiles.length} credenciales, espera un momento...`, 'info');

    // Lanzar todas las peticiones de configuración en paralelo
    const promises = selectedFiles.map(async (filename) => {
        try {
            const response = await fetch(`./creds/configure-preview/${encodeURIComponent(filename)}`, {
                method: 'POST',
                headers: getAuthHeaders()
            });
            const data = await response.json();

            if (response.ok && data.success) {
                return {
                    success: true,
                    filename,
                    message: data.message,
                    setting_id: data.setting_id,
                    binding_id: data.binding_id
                };
            } else {
                return {
                    success: false,
                    filename,
                    error: data.message || 'Error de configuración',
                    step: data.step,
                    errorDetail: data.error
                };
            }
        } catch (error) {
            return { success: false, filename, error: error.message };
        }
    });

    // Esperar a que terminen todas las peticiones
    const results = await Promise.all(promises);

    // Resumen de resultados
    let successCount = 0;
    let failCount = 0;
    const resultMessages = [];

    results.forEach(result => {
        if (result.success) {
            successCount++;
            resultMessages.push(`✅ ${result.filename}: ${result.message || 'Configuración correcta'}`);
        } else {
            failCount++;
            const errorMsg = result.step ? `${result.error} (paso: ${result.step})` : result.error;
            resultMessages.push(`❌ ${result.filename}: ${errorMsg}`);
        }
    });

    await AppState.creds.refresh();

    const summary = `Configuración por lotes del canal Preview completada.\n\nCorrectas: ${successCount}\nFallidas: ${failCount}\nTotal: ${selectedFiles.length}\n\nResultados detallados:\n${resultMessages.join('\n')}`;

    if (failCount === 0) {
        showStatus(`✅ Todas las configuraciones son correctas: canal Preview configurado en ${successCount}/${selectedFiles.length} credenciales`, 'success');
        showMessageModal('Configuración por lotes del canal Preview completada', summary, 'success');
    } else if (successCount === 0) {
        showStatus(`❌ Todas las configuraciones han fallado: ${failCount}/${selectedFiles.length} credenciales`, 'error');
        showMessageModal('Configuración por lotes del canal Preview completada', summary, 'error');
    } else {
        showStatus(`⚠️ Configuración por lotes completada: ${successCount}/${selectedFiles.length} correctas, ${failCount} fallidas`, 'info');
        showMessageModal('Configuración por lotes del canal Preview completada', summary, 'info');
    }

    console.log(summary);
}


async function refreshAllEmails() {
    if (!confirm('¿Seguro que quieres actualizar el correo de usuario de todas las credenciales? Puede tardar un rato.')) return;

    try {
        showStatus('Actualizando todos los correos de usuario...', 'info');
        const response = await fetch('./creds/refresh-all-emails', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            showStatus(`Actualización de correos completada: ${data.success_count}/${data.total_count} direcciones obtenidas`, 'success');
            await AppState.creds.refresh();
        } else {
            showStatus(data.message || 'Error al actualizar los correos', 'error');
        }
    } catch (error) {
        showStatus(`Error de red al actualizar los correos: ${error.message}`, 'error');
    }
}

async function refreshAllAntigravityEmails() {
    if (!confirm('¿Seguro que quieres actualizar el correo de usuario de todas las credenciales de Antigravity? Puede tardar un rato.')) return;

    try {
        showStatus('Actualizando todos los correos de usuario...', 'info');
        const response = await fetch('./creds/refresh-all-emails?mode=antigravity', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            showStatus(`Actualización de correos completada: ${data.success_count}/${data.total_count} direcciones obtenidas`, 'success');
            await AppState.antigravityCreds.refresh();
        } else {
            showStatus(data.message || 'Error al actualizar los correos', 'error');
        }
    } catch (error) {
        showStatus(`Error de red al actualizar los correos: ${error.message}`, 'error');
    }
}

async function deduplicateByEmail() {
    if (!confirm('¿Seguro que quieres eliminar las credenciales duplicadas?\n\nSolo se conservará una credencial por correo; las demás se eliminarán.\nEsta operación no se puede deshacer.')) return;

    try {
        showStatus('Eliminando las credenciales duplicadas...', 'info');
        const response = await fetch('./creds/deduplicate-by-email', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            const msg = `Deduplicación completada: ${data.deleted_count} credenciales duplicadas eliminadas, ${data.kept_count} conservadas (${data.unique_emails_count} correos únicos)`;
            showStatus(msg, 'success');
            await AppState.creds.refresh();
            
            // Mostrar la información detallada
            if (data.duplicate_groups && data.duplicate_groups.length > 0) {
                let details = 'Detalle de la deduplicación:\n\n';
                data.duplicate_groups.forEach(group => {
                    details += `Correo: ${group.email}\nConservado: ${group.kept_file}\nEliminados: ${group.deleted_files.join(', ')}\n\n`;
                });
                console.log(details);
            }
        } else {
            showStatus(data.message || 'Error en la deduplicación', 'error');
        }
    } catch (error) {
        showStatus(`Error de red en la deduplicación: ${error.message}`, 'error');
    }
}

async function deduplicateAntigravityByEmail() {
    if (!confirm('¿Seguro que quieres eliminar las credenciales de Antigravity duplicadas?\n\nSolo se conservará una credencial por correo; las demás se eliminarán.\nEsta operación no se puede deshacer.')) return;

    try {
        showStatus('Eliminando las credenciales duplicadas...', 'info');
        const response = await fetch('./creds/deduplicate-by-email?mode=antigravity', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            const msg = `Deduplicación completada: ${data.deleted_count} credenciales duplicadas eliminadas, ${data.kept_count} conservadas (${data.unique_emails_count} correos únicos)`;
            showStatus(msg, 'success');
            await AppState.antigravityCreds.refresh();
            
            // Mostrar la información detallada
            if (data.duplicate_groups && data.duplicate_groups.length > 0) {
                let details = 'Detalle de la deduplicación:\n\n';
                data.duplicate_groups.forEach(group => {
                    details += `Correo: ${group.email}\nConservado: ${group.kept_file}\nEliminados: ${group.deleted_files.join(', ')}\n\n`;
                });
                console.log(details);
            }
        } else {
            showStatus(data.message || 'Error en la deduplicación', 'error');
        }
    } catch (error) {
        showStatus(`Error de red en la deduplicación: ${error.message}`, 'error');
    }
}

// =====================================================================
// Registros por WebSocket
// =====================================================================
function connectWebSocket() {
    if (AppState.logWebSocket && AppState.logWebSocket.readyState === WebSocket.OPEN) {
        showStatus('El WebSocket ya está conectado', 'info');
        return;
    }

    try {
        const wsPath = new URL('./logs/stream', window.location.href).href;
        const wsUrl = wsPath.replace(/^http/, 'ws');

        // Añadir el parámetro de autenticación token
        const wsUrlWithAuth = `${wsUrl}?token=${encodeURIComponent(AppState.authToken)}`;

        document.getElementById('connectionStatusText').textContent = 'Conectando...';
        document.getElementById('logConnectionStatus').className = 'status info';

        AppState.logWebSocket = new WebSocket(wsUrlWithAuth);

        AppState.logWebSocket.onopen = () => {
            document.getElementById('connectionStatusText').textContent = 'Conectado';
            document.getElementById('logConnectionStatus').className = 'status success';
            showStatus('Conexión al flujo de registros establecida', 'success');
            clearLogsDisplay();
        };

        AppState.logWebSocket.onmessage = (event) => {
            const logLine = event.data;
            if (logLine.trim()) {
                AppState.allLogs.push(logLine);
                if (AppState.allLogs.length > 1000) {
                    AppState.allLogs = AppState.allLogs.slice(-1000);
                }
                filterLogs();
                if (document.getElementById('autoScroll').checked) {
                    const logContainer = document.getElementById('logContainer');
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
            }
        };

        AppState.logWebSocket.onclose = () => {
            document.getElementById('connectionStatusText').textContent = 'Conexión cerrada';
            document.getElementById('logConnectionStatus').className = 'status error';
            showStatus('Se ha cerrado la conexión al flujo de registros', 'info');
        };

        AppState.logWebSocket.onerror = (error) => {
            document.getElementById('connectionStatusText').textContent = 'Error de conexión';
            document.getElementById('logConnectionStatus').className = 'status error';
            showStatus('Error de conexión al flujo de registros: ' + error, 'error');
        };
    } catch (error) {
        showStatus('Error al crear la conexión WebSocket: ' + error.message, 'error');
        document.getElementById('connectionStatusText').textContent = 'Error de conexión';
        document.getElementById('logConnectionStatus').className = 'status error';
    }
}

function disconnectWebSocket() {
    if (AppState.logWebSocket) {
        AppState.logWebSocket.close();
        AppState.logWebSocket = null;
        document.getElementById('connectionStatusText').textContent = 'Sin conexión';
        document.getElementById('logConnectionStatus').className = 'status info';
        showStatus('Conexión al flujo de registros cerrada', 'info');
    }
}

function clearLogsDisplay() {
    AppState.allLogs = [];
    AppState.filteredLogs = [];
    document.getElementById('logContent').textContent = 'Registros vaciados; esperando nuevos registros...';
}

async function downloadLogs() {
    try {
        const response = await fetch('./logs/download', { headers: getAuthHeaders() });

        if (response.ok) {
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'gcli2api_logs.txt';
            if (contentDisposition) {
                const match = contentDisposition.match(/filename=(.+)/);
                if (match) filename = match[1];
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);

            showStatus(`Archivo de registros descargado correctamente: ${filename}`, 'success');
        } else {
            const data = await response.json();
            showStatus(`Error al descargar los registros: ${data.detail || data.error || 'Error desconocido'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red al descargar los registros: ${error.message}`, 'error');
    }
}

async function clearLogs() {
    try {
        const response = await fetch('./logs/clear', {
            method: 'POST',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            clearLogsDisplay();
            showStatus(data.message, 'success');
        } else {
            showStatus(`Error al vaciar los registros: ${data.detail || data.error || 'Error desconocido'}`, 'error');
        }
    } catch (error) {
        clearLogsDisplay();
        showStatus(`Error de red al vaciar los registros: ${error.message}`, 'error');
    }
}

function filterLogs() {
    const filter = document.getElementById('logLevelFilter').value;
    AppState.currentLogFilter = filter;

    if (filter === 'all') {
        AppState.filteredLogs = [...AppState.allLogs];
    } else {
        AppState.filteredLogs = AppState.allLogs.filter(log => log.toUpperCase().includes(filter));
    }

    displayLogs();
}

function displayLogs() {
    const logContent = document.getElementById('logContent');
    if (AppState.filteredLogs.length === 0) {
        logContent.textContent = AppState.currentLogFilter === 'all' ?
            'No hay registros...' : `No hay registros de nivel ${AppState.currentLogFilter}...`;
    } else {
        logContent.textContent = AppState.filteredLogs.join('\n');
    }
}

// =====================================================================
// Gestión de credenciales por variables de entorno
// =====================================================================
async function checkEnvCredsStatus() {
    const loading = document.getElementById('envStatusLoading');
    const content = document.getElementById('envStatusContent');

    try {
        loading.style.display = 'block';
        content.classList.add('hidden');

        const response = await fetch('./auth/env-creds-status', { headers: getAuthHeaders() });
        const data = await response.json();

        if (response.ok) {
            const envVarsList = document.getElementById('envVarsList');
            envVarsList.textContent = Object.keys(data.available_env_vars).length > 0
                ? Object.keys(data.available_env_vars).join(', ')
                : 'No se han encontrado variables de entorno GCLI_CREDS_*';

            const autoLoadStatus = document.getElementById('autoLoadStatus');
            autoLoadStatus.textContent = data.auto_load_enabled ? '✅ Habilitado' : '❌ Deshabilitado';
            autoLoadStatus.style.color = data.auto_load_enabled ? '#28a745' : '#dc3545';

            document.getElementById('envFilesCount').textContent = `${data.existing_env_files_count} archivos`;

            const envFilesList = document.getElementById('envFilesList');
            envFilesList.textContent = data.existing_env_files.length > 0
                ? data.existing_env_files.join(', ')
                : 'Ninguno';

            content.classList.remove('hidden');
            showStatus('Comprobación del estado de las variables de entorno completada', 'success');
        } else {
            showStatus(`Error al obtener el estado de las variables de entorno: ${data.detail || data.error || 'Error desconocido'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    } finally {
        loading.style.display = 'none';
    }
}

async function loadEnvCredentials() {
    try {
        showStatus('Importando credenciales desde las variables de entorno...', 'info');

        const response = await fetch('./auth/load-env-creds', {
            method: 'POST',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            if (data.loaded_count > 0) {
                showStatus(`✅ Se han importado ${data.loaded_count}/${data.total_count} archivos de credenciales`, 'success');
                setTimeout(() => checkEnvCredsStatus(), 1000);
            } else {
                showStatus(`⚠️ ${data.message}`, 'info');
            }
        } else {
            showStatus(`Error al importar: ${data.detail || data.error || 'Error desconocido'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    }
}

async function clearEnvCredentials() {
    if (!confirm('¿Seguro que quieres borrar todos los archivos de credenciales importados desde variables de entorno?\nSe eliminarán todos los archivos de autenticación cuyo nombre empiece por "env-".')) {
        return;
    }

    try {
        showStatus('Borrando los archivos de credenciales de variables de entorno...', 'info');

        const response = await fetch('./auth/env-creds', {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            showStatus(`✅ Se han eliminado ${data.deleted_count} archivos de credenciales de variables de entorno`, 'success');
            setTimeout(() => checkEnvCredsStatus(), 1000);
        } else {
            showStatus(`Error al borrar: ${data.detail || data.error || 'Error desconocido'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    }
}

// =====================================================================
// Gestión de la configuración
// =====================================================================
async function loadConfig() {
    const loading = document.getElementById('configLoading');
    const form = document.getElementById('configForm');

    try {
        loading.style.display = 'block';
        form.classList.add('hidden');

        const response = await fetch('./config/get', { headers: getAuthHeaders() });
        const data = await response.json();

        if (response.ok) {
            AppState.currentConfig = data.config;
            AppState.envLockedFields = new Set(data.env_locked || []);

            populateConfigForm();
            form.classList.remove('hidden');
            showStatus('Configuración cargada correctamente', 'success');
        } else {
            showStatus(`Error al cargar la configuración: ${data.detail || data.error || 'Error desconocido'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    } finally {
        loading.style.display = 'none';
    }
}

function populateConfigForm() {
    const c = AppState.currentConfig;

    setConfigField('host', c.host || '0.0.0.0');
    setConfigField('port', c.port || 7861);
    setConfigField('configApiPassword', c.api_password || '');
    setConfigField('configPanelPassword', c.panel_password || '');
    setConfigField('configPassword', c.password || 'pwd');
    setConfigField('credentialsDir', c.credentials_dir || '');
    setConfigField('proxy', c.proxy || '');
    setConfigField('codeAssistEndpoint', c.code_assist_endpoint || '');
    setConfigField('oauthProxyUrl', c.oauth_proxy_url || '');
    setConfigField('googleapisProxyUrl', c.googleapis_proxy_url || '');
    setConfigField('resourceManagerApiUrl', c.resource_manager_api_url || '');
    setConfigField('serviceUsageApiUrl', c.service_usage_api_url || '');
    setConfigField('antigravityApiUrl', c.antigravity_api_url || '');

    document.getElementById('autoBanEnabled').checked = Boolean(c.auto_ban_enabled);
    setConfigField('autoBanErrorCodes', (c.auto_ban_error_codes || []).join(','));
    setConfigField('callsPerRotation', c.calls_per_rotation || 10);

    document.getElementById('retry429Enabled').checked = Boolean(c.retry_429_enabled);
    setConfigField('retry429MaxRetries', c.retry_429_max_retries || 20);
    setConfigField('retry429Interval', c.retry_429_interval || 0.1);

    document.getElementById('compatibilityModeEnabled').checked = Boolean(c.compatibility_mode_enabled);
    document.getElementById('returnThoughtsToFrontend').checked = Boolean(c.return_thoughts_to_frontend !== false);
    document.getElementById('antigravityStream2nostream').checked = Boolean(c.antigravity_stream2nostream !== false);
    document.getElementById('antigravitySwitchCredentialEnabled').checked = Boolean(c.antigravity_switch_credential_enabled);

    setConfigField('antiTruncationMaxAttempts', c.anti_truncation_max_attempts || 3);

    setConfigField('keepaliveUrl', c.keepalive_url || '');
    setConfigField('keepaliveInterval', c.keepalive_interval || 60);
}

function setConfigField(fieldId, value) {
    const field = document.getElementById(fieldId);
    if (field) {
        field.value = value;
        const configKey = fieldId.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (AppState.envLockedFields.has(configKey)) {
            field.disabled = true;
            field.classList.add('env-locked');
        } else {
            field.disabled = false;
            field.classList.remove('env-locked');
        }
    }
}

async function saveConfig() {
    try {
        const getValue = (id, def = '') => document.getElementById(id)?.value.trim() || def;
        const getInt = (id, def = 0) => parseInt(document.getElementById(id)?.value) || def;
        const getFloat = (id, def = 0.0) => parseFloat(document.getElementById(id)?.value) || def;
        const getChecked = (id, def = false) => document.getElementById(id)?.checked || def;

        const config = {
            host: getValue('host', '0.0.0.0'),
            port: getInt('port', 7861),
            api_password: getValue('configApiPassword'),
            panel_password: getValue('configPanelPassword'),
            password: getValue('configPassword', 'pwd'),
            code_assist_endpoint: getValue('codeAssistEndpoint'),
            credentials_dir: getValue('credentialsDir'),
            proxy: getValue('proxy'),
            oauth_proxy_url: getValue('oauthProxyUrl'),
            googleapis_proxy_url: getValue('googleapisProxyUrl'),
            resource_manager_api_url: getValue('resourceManagerApiUrl'),
            service_usage_api_url: getValue('serviceUsageApiUrl'),
            antigravity_api_url: getValue('antigravityApiUrl'),
            auto_ban_enabled: getChecked('autoBanEnabled'),
            auto_ban_error_codes: getValue('autoBanErrorCodes').split(',')
                .map(c => parseInt(c.trim())).filter(c => !isNaN(c)),
            calls_per_rotation: getInt('callsPerRotation', 10),
            retry_429_enabled: getChecked('retry429Enabled'),
            retry_429_max_retries: getInt('retry429MaxRetries', 20),
            retry_429_interval: getFloat('retry429Interval', 0.1),
            compatibility_mode_enabled: getChecked('compatibilityModeEnabled'),
            return_thoughts_to_frontend: getChecked('returnThoughtsToFrontend'),
            antigravity_stream2nostream: getChecked('antigravityStream2nostream'),
            antigravity_switch_credential_enabled: getChecked('antigravitySwitchCredentialEnabled'),
            anti_truncation_max_attempts: getInt('antiTruncationMaxAttempts', 3),
            keepalive_url: getValue('keepaliveUrl'),
            keepalive_interval: getInt('keepaliveInterval', 60)
        };

        const response = await fetch('./config/save', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ config })
        });

        const data = await response.json();

        if (response.ok) {
            let message = 'Configuración guardada correctamente';

            if (data.hot_updated && data.hot_updated.length > 0) {
                message += `. Los siguientes ajustes se han aplicado de inmediato: ${data.hot_updated.join(', ')}`;
            }

            if (data.restart_required && data.restart_required.length > 0) {
                message += `\n⚠️ Aviso de reinicio: ${data.restart_notice}`;
                showStatus(message, 'info');
            } else {
                showStatus(message, 'success');
            }

            setTimeout(() => loadConfig(), 1000);
        } else {
            showStatus(`Error al guardar la configuración: ${data.detail || data.error || 'Error desconocido'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    }
}

// Configuración de las URL espejo
const mirrorUrls = {
    codeAssistEndpoint: 'https://gcli-api.sukaka.top/cloudcode-pa',
    oauthProxyUrl: 'https://gcli-api.sukaka.top/oauth2',
    googleapisProxyUrl: 'https://gcli-api.sukaka.top/googleapis',
    resourceManagerApiUrl: 'https://gcli-api.sukaka.top/cloudresourcemanager',
    serviceUsageApiUrl: 'https://gcli-api.sukaka.top/serviceusage',
    antigravityApiUrl: 'https://gcli-api.sukaka.top/daily-cloudcode-pa'
};

const officialUrls = {
    codeAssistEndpoint: 'https://cloudcode-pa.googleapis.com',
    oauthProxyUrl: 'https://oauth2.googleapis.com',
    googleapisProxyUrl: 'https://www.googleapis.com',
    resourceManagerApiUrl: 'https://cloudresourcemanager.googleapis.com',
    serviceUsageApiUrl: 'https://serviceusage.googleapis.com',
    antigravityApiUrl: 'https://daily-cloudcode-pa.googleapis.com'
};

function useMirrorUrls() {
    if (confirm('¿Seguro que quieres configurar todos los endpoints con las URL espejo?')) {
        for (const [fieldId, url] of Object.entries(mirrorUrls)) {
            const field = document.getElementById(fieldId);
            if (field && !field.disabled) field.value = url;
        }
        showStatus('✅ Se han aplicado las URL espejo. Recuerda pulsar el botón "Guardar configuración" para guardar los ajustes', 'success');
    }
}

function restoreOfficialUrls() {
    if (confirm('¿Seguro que quieres configurar todos los endpoints con las direcciones oficiales?')) {
        for (const [fieldId, url] of Object.entries(officialUrls)) {
            const field = document.getElementById(fieldId);
            if (field && !field.disabled) field.value = url;
        }
        showStatus('✅ Se han aplicado los endpoints oficiales. Recuerda pulsar el botón "Guardar configuración" para guardar los ajustes', 'success');
    }
}

// =====================================================================
// Estadísticas de uso
// =====================================================================
async function refreshUsageStats() {
    const loading = document.getElementById('usageLoading');
    const list = document.getElementById('usageList');

    try {
        loading.style.display = 'block';
        list.innerHTML = '';

        const [statsResponse, aggregatedResponse] = await Promise.all([
            fetch('./usage/stats', { headers: getAuthHeaders() }),
            fetch('./usage/aggregated', { headers: getAuthHeaders() })
        ]);

        if (statsResponse.status === 401 || aggregatedResponse.status === 401) {
            showStatus('Error de autenticación; vuelve a iniciar sesión', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }

        const statsData = await statsResponse.json();
        const aggregatedData = await aggregatedResponse.json();

        if (statsResponse.ok && aggregatedResponse.ok) {
            AppState.usageStatsData = statsData.success ? statsData.data : statsData;

            const aggData = aggregatedData.success ? aggregatedData.data : aggregatedData;
            document.getElementById('totalApiCalls').textContent = aggData.total_calls_24h || 0;
            document.getElementById('totalFiles').textContent = aggData.total_files || 0;
            document.getElementById('avgCallsPerFile').textContent = (aggData.avg_calls_per_file || 0).toFixed(1);

            renderUsageList();

            showStatus(`Estadísticas de uso cargadas de ${aggData.total_files || Object.keys(AppState.usageStatsData).length} archivos`, 'success');
        } else {
            const errorMsg = statsData.detail || aggregatedData.detail || 'Error al cargar las estadísticas de uso';
            showStatus(`Error: ${errorMsg}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    } finally {
        loading.style.display = 'none';
    }
}

function renderUsageList() {
    const list = document.getElementById('usageList');
    list.innerHTML = '';

    if (Object.keys(AppState.usageStatsData).length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #666;">No hay estadísticas de uso</p>';
        return;
    }

    for (const [filename, stats] of Object.entries(AppState.usageStatsData)) {
        const card = document.createElement('div');
        card.className = 'usage-card';

        const calls24h = stats.calls_24h || 0;

        card.innerHTML = `
            <div class="usage-header">
                <div class="usage-filename">${filename}</div>
            </div>
            <div class="usage-info">
                <div class="usage-info-item" style="grid-column: 1 / -1;">
                    <span class="usage-info-label">Llamadas en las últimas 24 h</span>
                    <span class="usage-info-value" style="font-size: 24px; font-weight: bold; color: #007bff;">${calls24h}</span>
                </div>
            </div>
            <div class="usage-actions">
                <button class="usage-btn reset" onclick="resetSingleUsageStats('${filename}')">Restablecer estadísticas</button>
            </div>
        `;

        list.appendChild(card);
    }
}

async function resetSingleUsageStats(filename) {
    if (!confirm(`¿Seguro que quieres restablecer las estadísticas de uso de ${filename}?`)) return;

    try {
        const response = await fetch('./usage/reset', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ filename })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showStatus(data.message, 'success');
            await refreshUsageStats();
        } else {
            showStatus(`Error al restablecer: ${data.message || data.detail || data.error || 'Error desconocido'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    }
}

async function resetAllUsageStats() {
    if (!confirm('¿Seguro que quieres restablecer las estadísticas de uso de todos los archivos? Esta operación no se puede deshacer.')) return;

    try {
        const response = await fetch('./usage/reset', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({})
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showStatus(data.message, 'success');
            await refreshUsageStats();
        } else {
            showStatus(`Error al restablecer: ${data.message || data.detail || data.error || 'Error desconocido'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error de red: ${error.message}`, 'error');
    }
}

// =====================================================================
// Actualización automática de la cuenta atrás de enfriamiento
// =====================================================================
function startCooldownTimer() {
    if (AppState.cooldownTimerInterval) {
        clearInterval(AppState.cooldownTimerInterval);
    }

    AppState.cooldownTimerInterval = setInterval(() => {
        updateCooldownDisplays();
    }, 1000);
}

function stopCooldownTimer() {
    if (AppState.cooldownTimerInterval) {
        clearInterval(AppState.cooldownTimerInterval);
        AppState.cooldownTimerInterval = null;
    }
}

function updateCooldownDisplays() {
    let needsRefresh = false;

    // Comprobar si el enfriamiento por modelo ha expirado
    for (const credInfo of Object.values(AppState.creds.data)) {
        if (credInfo.model_cooldowns && Object.keys(credInfo.model_cooldowns).length > 0) {
            const currentTime = Date.now() / 1000;
            const hasExpiredCooldowns = Object.entries(credInfo.model_cooldowns).some(([, until]) => until <= currentTime);

            if (hasExpiredCooldowns) {
                needsRefresh = true;
                break;
            }
        }
    }

    if (needsRefresh) {
        AppState.creds.renderList();
        return;
    }

    // Actualizar la visualización del enfriamiento por modelo
    document.querySelectorAll('.cooldown-badge').forEach(badge => {
        const card = badge.closest('.cred-card');
        const filenameEl = card?.querySelector('.cred-filename');
        if (!filenameEl) return;

        const filename = filenameEl.textContent;
        const credInfo = Object.values(AppState.creds.data).find(c => c.filename === filename);

        if (credInfo && credInfo.model_cooldowns) {
            const currentTime = Date.now() / 1000;
            const titleMatch = badge.getAttribute('title')?.match(/Modelo: (.+)/);
            if (titleMatch) {
                const model = titleMatch[1];
                const cooldownUntil = credInfo.model_cooldowns[model];
                if (cooldownUntil) {
                    const remaining = Math.max(0, Math.floor(cooldownUntil - currentTime));
                    if (remaining > 0) {
                        const shortModel = model.replace('gemini-', '').replace('-exp', '')
                            .replace('2.0-', '2-').replace('1.5-', '1.5-');
                        const timeDisplay = formatCooldownTime(remaining).replace(/s$/, '').replace(/ /g, '');
                        badge.innerHTML = `⏰ ${shortModel}: ${timeDisplay}`;
                    }
                }
            }
        }
    });
}

// =====================================================================
// Gestión de la información de versión
// =====================================================================

// Obtiene y muestra la información de versión (sin comprobar actualizaciones)
async function fetchAndDisplayVersion() {
    try {
        const response = await fetch('./version/info');
        const data = await response.json();

        const versionText = document.getElementById('versionText');

        if (data.success) {
            // Mostrar solo el número de versión
            versionText.textContent = `v${data.version}`;
            versionText.title = `Versión completa: ${data.full_hash}\nMensaje del commit: ${data.message}\nFecha del commit: ${data.date}`;
            versionText.style.cursor = 'help';
        } else {
            versionText.textContent = 'Versión desconocida';
            versionText.title = data.error || 'No se ha podido obtener la información de versión';
        }
    } catch (error) {
        console.error('Error al obtener la información de versión:', error);
        const versionText = document.getElementById('versionText');
        if (versionText) {
            versionText.textContent = 'Error al obtener la versión';
        }
    }
}

// Comprobar actualizaciones
async function checkForUpdates() {
    const checkBtn = document.getElementById('checkUpdateBtn');
    if (!checkBtn) return;

    const originalText = checkBtn.textContent;

    try {
        // Mostrar el estado de comprobación
        checkBtn.textContent = 'Comprobando...';
        checkBtn.disabled = true;

        // Llamar a la API para comprobar si hay actualizaciones
        const response = await fetch('./version/info?check_update=true');
        const data = await response.json();

        if (data.success) {
            if (data.check_update === false) {
                // Error al comprobar actualizaciones
                showStatus(`Error al comprobar actualizaciones: ${data.update_error || 'Error desconocido'}`, 'error');
            } else if (data.has_update === true) {
                // Hay actualización
                const updateMsg = `Hay una versión nueva.\nActual: v${data.version}\nÚltima: v${data.latest_version}\n\nNovedades: ${data.latest_message || 'ninguna'}`;
                showStatus(updateMsg.replace(/\n/g, ' '), 'warning');

                // Actualizar el estilo del botón
                checkBtn.style.backgroundColor = '#ffc107';
                checkBtn.textContent = 'Nueva versión';

                setTimeout(() => {
                    checkBtn.style.backgroundColor = '#17a2b8';
                    checkBtn.textContent = originalText;
                }, 5000);
            } else if (data.has_update === false) {
                // Ya está en la última versión
                showStatus('Ya tienes la última versión', 'success');

                checkBtn.style.backgroundColor = '#28a745';
                checkBtn.textContent = 'Actualizado';

                setTimeout(() => {
                    checkBtn.style.backgroundColor = '#17a2b8';
                    checkBtn.textContent = originalText;
                }, 3000);
            } else {
                // No se ha podido determinar
                showStatus('No se ha podido determinar si hay actualizaciones', 'info');
            }
        } else {
            showStatus(`Error al comprobar actualizaciones: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error al comprobar actualizaciones:', error);
        showStatus(`Error al comprobar actualizaciones: ${error.message}`, 'error');
    } finally {
        checkBtn.disabled = false;
        if (checkBtn.textContent === 'Comprobando...') {
            checkBtn.textContent = originalText;
        }
    }
}

// =====================================================================
// Inicialización de la página
// =====================================================================
window.onload = async function () {
    const autoLoginSuccess = await autoLogin();

    if (!autoLoginSuccess) {
        showStatus('Introduce la contraseña para iniciar sesión', 'info');
    } else {
        // Obtener la información de versión tras iniciar sesión
        await fetchAndDisplayVersion();
    }

    startCooldownTimer();

    const antigravityAuthBtn = document.getElementById('getAntigravityAuthBtn');
    if (antigravityAuthBtn) {
        antigravityAuthBtn.addEventListener('click', startAntigravityAuth);
    }
};

// Arrastrar y soltar: inicialización
document.addEventListener('DOMContentLoaded', function () {
    const uploadArea = document.getElementById('uploadArea');

    if (uploadArea) {
        uploadArea.addEventListener('dragover', (event) => {
            event.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', (event) => {
            event.preventDefault();
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (event) => {
            event.preventDefault();
            uploadArea.classList.remove('dragover');
            AppState.uploadFiles.addFiles(Array.from(event.dataTransfer.files));
        });
    }
});

function autoSetKeepaliveUrl() {
    const url = `${window.location.protocol}//${window.location.host}`;
    document.getElementById('keepaliveUrl').value = url;
}
