// === CONFIG ===
// SUBSTITUA PELA URL DO SEU GOOGLE APPS SCRIPT
const ENDPOINT = "https://script.google.com/macros/s/AKfycbwiqcBMXASXzbj6BZGeNSkaihlUGcqTT3kG69hddBJOzZ_61_xm_SkeJX5FVB4I3sS17Q/exec";
const PING_URL = "./ping.json";
const SYNC_INTERVAL_MS = 10000; // tenta esvaziar a fila a cada 10s

// === CONFIGURAÇÃO DE TIMEZONE ===
const TIMEZONE = 'America/Sao_Paulo';

// Função utilitária para gerar timestamp no timezone correto
function getCurrentTimestamp() {
  const now = new Date();

  // SOLUÇÃO ROBUSTA: Sempre usar formatação manual para garantir consistência
  // Converter para timezone de São Paulo (UTC-3)
  const saoPauloTime = new Date(now.getTime() - (3 * 60 * 60 * 1000));

  // Formatar manualmente para garantir o mesmo formato em todos os dispositivos
  const year = saoPauloTime.getUTCFullYear();
  const month = String(saoPauloTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(saoPauloTime.getUTCDate()).padStart(2, '0');
  const hours = String(saoPauloTime.getUTCHours()).padStart(2, '0');
  const minutes = String(saoPauloTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(saoPauloTime.getUTCSeconds()).padStart(2, '0');

  // Retornar no formato dd/MM/yyyy HH:mm:ss
  const formattedTimestamp = `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;

  // DEBUG: Log para verificar o que está sendo gerado
  console.log('🕐 Timestamp gerado:', formattedTimestamp);
  console.log('🕐 Data original:', now);
  console.log('🕐 Data São Paulo:', saoPauloTime);

  return formattedTimestamp;
}
// ==============

const $ = (id) => document.getElementById(id);

// Variáveis globais - serão inicializadas quando o DOM estiver pronto
let dot, statusText, ministerioBox, administracaoBox, saveBtn, queueCountEl, queueStatusEl;

// ------------ Queue ------------
function generateUniqueId() {
  // Gerar ID único baseado em timestamp + random
  return `record_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getQueue() {
  try {
    return JSON.parse(localStorage.getItem("queue") || "[]");
  } catch (_) {
    return [];
  }
}

function setQueue(q) {
  localStorage.setItem("queue", JSON.stringify(q));
  updateQueueCount();
}

function enqueue(data) {
  const q = getQueue();

  // Adicionar ID único e timestamp de criação para evitar duplicatas
  const recordWithId = {
    ...data,
    id: generateUniqueId(),
    createdAt: Date.now(),
    synced: false
  };

  q.push(recordWithId);
  setQueue(q);
}

function updateQueueCount() {
  const queue = getQueue();
  // Contar apenas itens pendentes (não sincronizados)
  const pendingCount = queue.filter(item => !item.synced).length;
  const totalCount = queue.length;

  // Verificar se os elementos existem antes de usar
  if (queueCountEl) {
    queueCountEl.textContent = String(pendingCount);
  }

  // Atualizar status visual da fila
  if (queueStatusEl) {
    if (pendingCount === 0) {
      queueStatusEl.textContent = "✓";
      queueStatusEl.className = "queue-badge empty";
    } else if (isSyncing) {
      queueStatusEl.textContent = "⏳";
      queueStatusEl.className = "queue-badge syncing";
    } else {
      queueStatusEl.textContent = "⏸";
      queueStatusEl.className = "queue-badge pending";
    }
  }

  // Log para debug
  console.log(`📊 Fila: ${pendingCount} pendentes de ${totalCount} total`);
}

// ------------ UI ------------
const cargoSelecionado = () => (document.querySelector('input[name="cargo"]:checked')?.value || "");
const radioValue = (name) => (document.querySelector(`input[name="${name}"]:checked`)?.value || "");
const selectValue = (id) => {
  const element = document.getElementById(id);
  if (!element) {
    console.error(`❌ Elemento ${id} não encontrado`);
    return "";
  }

  // SOLUÇÃO CRIATIVA - Para botões, pegar valor do input hidden
  let value = element.value || "";

  console.log(`📋 Valor para ${id}:`, value);
  return value;
};

function showToast(msg, type = 'success') {
  const config = {
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 1200, // Otimizado para 1.2 segundos para melhor fluidez
    timerProgressBar: true,
    didOpen: (toast) => {
      toast.addEventListener('mouseenter', Swal.stopTimer)
      toast.addEventListener('mouseleave', Swal.resumeTimer)
    }
  };

  switch (type) {
    case 'success':
      Swal.fire({
        ...config,
        icon: 'success',
        title: msg,
        background: '#f0f9ff',
        color: '#059669',
        iconColor: '#059669'
      });
      break;
    case 'error':
      Swal.fire({
        ...config,
        icon: 'error',
        title: msg,
        background: '#fef2f2',
        color: '#dc2626',
        iconColor: '#dc2626'
      });
      break;
    case 'warning':
      Swal.fire({
        ...config,
        icon: 'warning',
        title: msg,
        background: '#fffbeb',
        color: '#d97706',
        iconColor: '#d97706'
      });
      break;
    case 'info':
      Swal.fire({
        ...config,
        icon: 'info',
        title: msg,
        background: '#eff6ff',
        color: '#1e40af',
        iconColor: '#1e40af'
      });
      break;
    case 'offline':
      Swal.fire({
        ...config,
        icon: 'info',
        title: 'Salvo offline',
        text: 'Enviado quando voltar online',
        background: '#f0f9ff',
        color: '#1e40af',
        iconColor: '#1e40af',
        timer: 1000 // Reduzido de 4000ms para 1500ms (1.5 segundos)
      });
      break;
    default:
      Swal.fire({
        ...config,
        icon: 'success',
        title: msg,
        background: '#f0f9ff',
        color: '#059669',
        iconColor: '#059669'
      });
  }
}

// ------------ Conectividade Robusta ------------
let isOnline = false;
let connectivityCheckInterval = null;
let lastConnectivityCheck = 0;
let forceOfflineMode = false; // Flag para modo offline forçado

// Detectar dispositivos móveis com mais precisão
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
  /iPhone|iPad|iPod|iOS/.test(navigator.userAgent);

const isAndroid = /Android/.test(navigator.userAgent);
const isMobile = isIOS || isAndroid || /Mobile|Tablet/.test(navigator.userAgent);

// Detectar Chrome no iOS (tem comportamentos específicos)
const isChromeIOS = isIOS && /CriOS|Chrome/.test(navigator.userAgent);
const isSafariIOS = isIOS && /Safari/.test(navigator.userAgent) && !/CriOS|Chrome/.test(navigator.userAgent);

// Detectar Chrome no Android
const isChromeAndroid = isAndroid && /Chrome/.test(navigator.userAgent);
const isSamsungBrowser = /SamsungBrowser/.test(navigator.userAgent);

// Detectar iOS 16.7 especificamente
const isIOS16 = /OS 16_7/.test(navigator.userAgent);
const isSafariIOS16 = isSafariIOS && isIOS16;

// Detectar versões específicas do Android
const isAndroidOld = isAndroid && /Android [1-6]/.test(navigator.userAgent);
const isAndroidNew = isAndroid && /Android [7-9]|Android 1[0-9]/.test(navigator.userAgent);

// Detectar se é mobile e definir modo de compatibilidade
const isMobileCompatibilityMode = isMobile;

console.log("📱 Dispositivo móvel detectado:", isMobile);
console.log("🍎 iOS detectado:", isIOS);
console.log("🤖 Android detectado:", isAndroid);
console.log("🌐 Chrome iOS detectado:", isChromeIOS);
console.log("🧭 Safari iOS detectado:", isSafariIOS);
console.log("🌐 Chrome Android detectado:", isChromeAndroid);
console.log("📱 Samsung Browser detectado:", isSamsungBrowser);
console.log("📱 iOS 16.7 detectado:", isIOS16);
console.log("🧭 Safari iOS 16.7 detectado:", isSafariIOS16);
console.log("🤖 Android antigo detectado:", isAndroidOld);
console.log("🤖 Android novo detectado:", isAndroidNew);
console.log("📱 User Agent:", navigator.userAgent);

// Função para testar conectividade real
async function testConnectivity() {
  try {
    // Se o modo offline foi forçado, retornar false
    if (forceOfflineMode) {
      console.log("🔧 Modo offline forçado ativo - retornando false");
      return false;
    }

    // Se estamos em file://, assumir offline
    if (window.location.protocol === 'file:') {
      console.log("⚠️ Protocolo file:// - assumindo offline");
      return false;
    }

    // Verificar se o navegador reporta offline
    if (!navigator.onLine) {
      console.log("📴 Navegador reporta offline");
      return false;
    }

    // Verificação adicional para mobile (modo avião e conexões lentas)
    if (navigator.connection) {
      const connection = navigator.connection;
      console.log("📱 Informações de conexão:", {
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        rtt: connection.rtt,
        saveData: connection.saveData
      });

      // Se estiver em modo avião ou conexão muito lenta
      if (connection.effectiveType === 'slow-2g' ||
        connection.downlink < 0.5 ||
        connection.rtt > 2000) {
        console.log("📴 Conexão muito lenta ou modo avião detectado - assumindo offline");
        return false;
      }
    }

    // Verificação específica para iOS
    if (isIOS) {
      console.log("🍎 Verificação específica para iOS");
      // iOS tem comportamentos diferentes com fetch e conectividade
      // Vamos usar um teste mais simples e confiável
    }

    // Verificação específica para Android
    if (isAndroid) {
      console.log("🤖 Verificação específica para Android");
      // Android pode ter problemas com Service Workers em versões antigas
      if (isAndroidOld) {
        console.log("⚠️ Android antigo detectado - pode ter limitações");
      }
    }

    // Verificação específica para Chrome no iOS
    if (isChromeIOS) {
      console.log("🌐 Verificação específica para Chrome iOS");
      // Chrome no iOS tem limitações específicas com Service Workers e fetch
      // Pode ter problemas com CORS e timeouts
    }

    // Verificação específica para Chrome no Android
    if (isChromeAndroid) {
      console.log("🌐 Verificação específica para Chrome Android");
      // Chrome no Android geralmente funciona bem, mas pode ter problemas com cache
    }

    // Verificação específica para Samsung Browser
    if (isSamsungBrowser) {
      console.log("📱 Verificação específica para Samsung Browser");
      // Samsung Browser pode ter comportamentos específicos
    }

    // Teste rápido com múltiplos endpoints para maior confiabilidade
    const testUrls = isChromeIOS ? [
      // Chrome iOS tem limitações, usar apenas URLs muito simples
      "https://www.google.com/favicon.ico"
    ] : isSamsungBrowser ? [
      // Samsung Browser pode ter limitações específicas
      "https://www.google.com/favicon.ico",
      "https://www.samsung.com/favicon.ico"
    ] : isAndroidOld ? [
      // Android antigo tem limitações
      "https://www.google.com/favicon.ico"
    ] : isIOS ? [
      // URLs mais simples para iOS Safari
      "https://www.google.com/favicon.ico",
      "https://www.apple.com/favicon.ico"
    ] : isAndroid ? [
      // Android moderno
      "https://www.google.com/favicon.ico",
      "https://www.android.com/favicon.ico"
    ] : [
      // Desktop e outros
      "https://www.google.com/favicon.ico",
      "https://www.cloudflare.com/favicon.ico",
      "https://httpbin.org/status/200"
    ];

    let quickTestPassed = false;
    for (const url of testUrls) {
      try {
        const timeout = isChromeIOS ? 5000 :
          isSamsungBrowser ? 4000 :
            isAndroidOld ? 6000 :
              isIOS ? 3000 :
                isAndroid ? 2000 : 1500;
        const quickTest = await fetch(url, {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store',
          signal: AbortSignal.timeout(timeout)
        });
        console.log("✅ Teste rápido de conectividade passou:", url);
        quickTestPassed = true;
        break;
      } catch (quickError) {
        console.log("❌ Teste rápido falhou para:", url, quickError.message);
        continue;
      }
    }

    if (!quickTestPassed) {
      console.log("❌ Todos os testes rápidos falharam - assumindo offline");
      return false;
    }

    // Se o teste rápido passou, assumir online (não testar endpoint específico para evitar timeouts)
    console.log("✅ Conectividade confirmada via teste rápido");
    return true;

  } catch (error) {
    console.log("❌ Conectividade falhou:", error.message);
    return false;
  }
}

// Função para atualizar status de conectividade
async function updateConnectivityStatus() {
  // Se o modo offline foi forçado, não atualizar automaticamente
  if (forceOfflineMode) {
    console.log("🔧 Modo offline forçado ativo - pulando verificação automática");
    return isOnline;
  }

  const now = Date.now();

  // Evitar verificações muito frequentes (máximo a cada 5 segundos)
  if (now - lastConnectivityCheck < 5000) {
    return isOnline;
  }

  lastConnectivityCheck = now;

  // Verificar conectividade real
  const hasConnectivity = await testConnectivity();

  // Atualizar estado
  const wasOnline = isOnline;
  isOnline = hasConnectivity;

  // Atualizar UI apenas se o status mudou
  if (wasOnline !== isOnline) {
    updateStatusUI();

    // Se voltou online, tentar sincronizar fila
    if (isOnline && !wasOnline) {
      console.log("🌐 Conectividade restaurada - sincronizando fila");
      setTimeout(syncPending, 1000); // Aguardar 1s antes de sincronizar
    }
  }

  return isOnline;
}

// Função para atualizar a UI do status
function updateStatusUI() {
  if (isOnline) {
    dot.classList.add("online");
    statusText.textContent = "Online";
    console.log("✅ Status atualizado: Online");
  } else {
    dot.classList.remove("online");
    statusText.textContent = "Offline";
    console.log("⚠️ Status atualizado: Offline");
  }
}

// Função para iniciar monitoramento de conectividade
function startConnectivityMonitoring() {
  // Verificar conectividade inicial
  updateConnectivityStatus();

  // Verificar a cada 5 segundos (mais responsivo)
  if (connectivityCheckInterval) {
    clearInterval(connectivityCheckInterval);
  }

  connectivityCheckInterval = setInterval(updateConnectivityStatus, 5000);

  console.log("🔄 Monitoramento de conectividade iniciado (verificação a cada 5s)");
}

// Função para parar monitoramento
function stopConnectivityMonitoring() {
  if (connectivityCheckInterval) {
    clearInterval(connectivityCheckInterval);
    connectivityCheckInterval = null;
  }
}

// ------------ Envio de Dados ------------
function toFormBody(obj) {
  return new URLSearchParams({ payload: JSON.stringify(obj) }).toString();
}

// Método específico para Safari iOS 16.7
function trySafariIOS16Method(data) {
  try {
    console.log("🧭 Safari iOS 16.7 - usando método específico...");

    // Para Safari iOS 16.7, voltar ao método que funcionava antes
    const formData = new FormData();
    formData.append('payload', JSON.stringify(data));

    // Usar sendBeacon que funcionava antes
    if (navigator.sendBeacon) {
      const result = navigator.sendBeacon(ENDPOINT, formData);
      console.log("🧭 Safari iOS 16.7 - sendBeacon resultado:", result);
      return result;
    }

    // Fallback para fetch se sendBeacon não funcionar
    return fetch(ENDPOINT, {
      method: 'POST',
      body: formData,
      keepalive: true
    }).then(response => {
      console.log("🧭 Safari iOS 16.7 - fetch resultado:", response.ok);
      return response.ok;
    }).catch(error => {
      console.error("🧭 Safari iOS 16.7 - erro:", error);
      return false;
    });

  } catch (error) {
    console.error("🧭 Safari iOS 16.7 - erro:", error);
    return false;
  }
}

// Método SIMPLES e ROBUSTO para todos os navegadores
function trySimpleMethod(data) {
  try {
    console.log("🚀 Método simples para todos os navegadores...");
    console.log("🚀 Dados:", data);

    // Usar FormData - funciona em todos os navegadores
    const formData = new FormData();
    formData.append('cargo', data.cargo || '');
    formData.append('ministerio', data.ministerio || '');
    formData.append('administracao', data.administracao || '');
    formData.append('timestamp', String(data.timestamp || ''));

    console.log("🚀 Enviando via FormData...");

    // Fetch simples sem complicações
    return fetch(ENDPOINT, {
      method: 'POST',
      body: formData
    }).then(response => {
      console.log("🚀 Resposta:", response.status, response.statusText);
      return response.ok;
    }).catch(error => {
      console.error("🚀 Erro no envio:", error);
      return false;
    });

  } catch (error) {
    console.error("🚀 Erro geral:", error);
    return false;
  }
}

// Método 1: sendBeacon (mais confiável)
function tryBeacon(data) {
  try {
    if (!("sendBeacon" in navigator)) {
      console.log("📡 SendBeacon não disponível");
      return false;
    }

    console.log("📡 Tentando sendBeacon...");

    // Usar FormData - funciona em todos os navegadores
    const formData = new FormData();
    formData.append('cargo', data.cargo || '');
    formData.append('ministerio', data.ministerio || '');
    formData.append('administracao', data.administracao || '');
    formData.append('timestamp', String(data.timestamp || ''));

    const success = navigator.sendBeacon(ENDPOINT, formData);
    console.log("📡 SendBeacon result:", success);
    return success;
  } catch (error) {
    console.error("📡 SendBeacon error:", error);
    return false;
  }
}

// Método 2: fetch com keepalive
async function tryFetchKeepalive(data) {
  try {
    console.log("🔄 Tentando fetch keepalive...");

    const formData = new FormData();
    formData.append('cargo', data.cargo || '');
    formData.append('ministerio', data.ministerio || '');
    formData.append('administracao', data.administracao || '');
    formData.append('timestamp', String(data.timestamp || ''));

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      body: formData,
      keepalive: true
    });

    console.log("🔄 Fetch keepalive response:", response.status);
    return response.ok;

  } catch (error) {
    console.error("🔄 Fetch keepalive error:", error);
    return false;
  }
}

// Método 3: GET como fallback
async function tryGet(data) {
  try {
    console.log("Tentando GET...");

    const params = new URLSearchParams({
      cargo: data.cargo || "",
      ministerio: data.ministerio || "",
      administracao: data.administracao || ""
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log("⏰ Timeout no GET (10s)");
      controller.abort();
    }, 10000); // Reduzido para 10s

    const response = await fetch(`${ENDPOINT}?${params}`, {
      method: "GET",
      mode: "cors",
      keepalive: true,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    console.log("GET resposta:", response.status);

    if (response.ok) {
      try {
        const result = await response.json();
        console.log("GET resultado:", result);
        return result.success === true;
      } catch (parseError) {
        // Se não conseguir parsear JSON, mas a resposta é OK, assumir sucesso
        console.log("⚠️ Resposta OK mas não é JSON válido - assumindo sucesso");
        return true;
      }
    } else {
      console.log("GET falhou - status:", response.status);
      return false;
    }
  } catch (error) {
    console.error("GET erro:", error);
    return false;
  }
}

async function sendItem(data) {
  // Verificar se o endpoint está configurado
  if (!ENDPOINT) {
    console.error("❌ ENDPOINT não configurado");
    return false;
  }

  console.log("🚀 Enviando dados:", data);

  // Tentar sendBeacon primeiro (mais confiável)
  if (tryBeacon(data)) {
    console.log("✅ Enviado via sendBeacon");
    return true;
  }

  // Tentar fetch keepalive
  if (await tryFetchKeepalive(data)) {
    console.log("✅ Enviado via fetch keepalive");
    return true;
  }

  // Tentar método simples como fallback
  if (await trySimpleMethod(data)) {
    console.log("✅ Enviado via método simples");
    return true;
  }

  console.log("❌ Falha em todos os métodos");
  return false;
}

// ------------ Sincronização Robusta ------------
let isSyncing = false;

async function syncPending() {
  // Evitar múltiplas sincronizações simultâneas
  if (isSyncing) {
    console.log("⏳ Sincronização já em andamento");
    return;
  }

  // Verificar conectividade real antes de sincronizar
  const reallyOnline = await testConnectivity();
  if (!reallyOnline) {
    console.log("📴 Offline - pulando sincronização");
    return;
  }

  const q = getQueue();
  // Filtrar apenas itens não sincronizados
  const pendingItems = q.filter(item => !item.synced);

  if (pendingItems.length === 0) {
    console.log("📭 Nenhum item pendente para sincronizar");
    return;
  }

  isSyncing = true;
  updateQueueCount(); // Atualizar status visual
  console.log(`🔄 Iniciando sincronização de ${pendingItems.length} itens pendentes da fila...`);

  const remain = [];
  let successCount = 0;

  try {
    for (let i = 0; i < pendingItems.length; i++) {
      const item = pendingItems[i];
      console.log(`📤 Sincronizando item ${i + 1}/${pendingItems.length} (ID: ${item.id}):`, item);

      // Tentar enviar o item
      const ok = await sendItem(item);
      if (ok) {
        // Marcar como sincronizado
        item.synced = true;
        item.syncedAt = Date.now();
        successCount++;
        console.log(`✅ Item ${i + 1} (ID: ${item.id}) sincronizado com sucesso`);
      } else {
        remain.push(item);
        console.log(`❌ Falha ao sincronizar item ${i + 1} (ID: ${item.id}) - mantendo na fila`);
      }

      // Pausa entre envios para evitar sobrecarga
      if (i < pendingItems.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Atualizar fila com todos os itens (incluindo os marcados como sincronizados)
    const updatedQueue = q.map(item => {
      const pendingItem = pendingItems.find(p => p.id === item.id);
      return pendingItem || item;
    });

    // Remover itens sincronizados há mais de 24 horas para limpeza
    const cleanedQueue = updatedQueue.filter(item => {
      if (!item.synced) return true;
      const hoursSinceSync = (Date.now() - item.syncedAt) / (1000 * 60 * 60);
      return hoursSinceSync < 24; // Manter sincronizados por 24h
    });

    setQueue(cleanedQueue);

    if (successCount > 0) {
      showToast(`${successCount} item(s) sincronizado(s)`, 'success');
      console.log(`✅ Sincronização concluída: ${successCount} enviados, ${remain.length} restantes`);
    }

    if (remain.length > 0) {
      console.log(`⚠️ ${remain.length} itens permanecem na fila`);
    }

  } catch (error) {
    console.error("❌ Erro durante sincronização:", error);
    showToast("Erro na sincronização", 'error');
  } finally {
    isSyncing = false;
    updateQueueCount(); // Atualizar status visual final
  }
}

// ------------ Salvar ------------
async function saveRecord() {
  console.log("🚀 Função saveRecord chamada");
  const cargo = cargoSelecionado();
  console.log("📋 Cargo selecionado:", cargo);

  if (!cargo) {
    console.log("❌ Nenhum cargo selecionado");
    showToast("Selecione um cargo", 'warning');
    return;
  }

  // Coletar dados dos dropdowns baseado no cargo selecionado
  let ministerio = "";
  let administracao = "";

  if (cargo === 'Ministério') {
    ministerio = selectValue('ministerio');
    console.log("🔍 Ministério selecionado:", ministerio);
    console.log("🔍 Elemento select:", document.getElementById('ministerio'));
    if (!ministerio) {
      console.log("❌ Nenhum ministério selecionado");
      showToast("Selecione um ministério", 'warning');
      return;
    }
  } else if (cargo === 'Administração') {
    administracao = selectValue('administracao');
    console.log("🔍 Administração selecionada:", administracao);
    console.log("🔍 Elemento select:", document.getElementById('administracao'));
    if (!administracao) {
      console.log("❌ Nenhuma administração selecionada");
      showToast("Selecione uma função administrativa", 'warning');
      return;
    }
  }

  const data = {
    timestamp: getCurrentTimestamp(),
    cargo,
    ministerio,
    administracao
  };

  console.log("💾 Salvando registro:", data);
  console.log("💾 Timestamp que será enviado:", data.timestamp);
  console.log("💾 Tipo do timestamp:", typeof data.timestamp);
  console.log("📋 Detalhes dos dados:");
  console.log("  - Cargo:", data.cargo);
  console.log("  - Ministério:", data.ministerio);
  console.log("  - Administração:", data.administracao);
  console.log("🍎 iOS detectado:", isIOS);
  console.log("🌐 Chrome iOS detectado:", isChromeIOS);
  console.log("🧭 Safari iOS detectado:", isSafariIOS);

  // Verificar conectividade
  const reallyOnline = await testConnectivity();

  if (reallyOnline) {
    console.log("🌐 Online confirmado - tentando envio imediato");
    try {
      const sent = await sendItem(data);
      if (sent) {
        showToast("Enviado com sucesso!", 'success');
        console.log("✅ Registro enviado com sucesso");

        // Atualizar resumo se estiver na aba de resumo
        if (document.getElementById('summary-tab').classList.contains('active')) {
          setTimeout(updateSummary, 500); // Reduzido de 1000ms para 500ms
        }
        return;
      } else {
        console.log("❌ Falha no envio - adicionando à fila");
      }
    } catch (error) {
      console.log("❌ Erro no envio - adicionando à fila:", error.message);
    }
  } else {
    console.log("📴 Offline ou falha de conectividade - adicionando à fila");
  }

  // Se não conseguiu enviar ou está offline, adicionar à fila
  enqueue(data);
  showToast("Salvo offline", 'offline');
  console.log("📋 Item adicionado à fila:", data);

  // Atualizar resumo se estiver na aba de resumo
  if (document.getElementById('summary-tab').classList.contains('active')) {
    updateSummaryLocal(); // Usar dados locais para itens na fila
  }
}

// ------------ Funções de Debug/Teste ------------
// Função para forçar modo offline (para teste)
function forceOffline() {
  console.log("🔧 FORÇANDO MODO OFFLINE PARA TESTE");
  forceOfflineMode = true; // Ativar flag de modo offline forçado
  isOnline = false;

  // PARAR completamente o monitoramento de conectividade
  stopConnectivityMonitoring();
  console.log("🔧 Monitoramento de conectividade PARADO");

  updateStatusUI();
  showToast("Modo offline forçado para teste", 'info');
  console.log("🔧 Modo offline forçado ativado - monitoramento automático DESABILITADO");
}

// Função para forçar modo online (para teste)
function forceOnline() {
  console.log("🔧 FORÇANDO MODO ONLINE PARA TESTE");
  forceOfflineMode = false; // Desativar flag de modo offline forçado
  isOnline = true;

  // REINICIAR o monitoramento de conectividade
  startConnectivityMonitoring();
  console.log("🔧 Monitoramento de conectividade REINICIADO");

  updateStatusUI();
  showToast("Modo online forçado para teste", 'info');
  console.log("🔧 Modo online forçado ativado - monitoramento automático REABILITADO");
  // Tentar sincronizar fila
  setTimeout(syncPending, 1000);
}

// Função para testar modo offline no mobile
function testMobileOffline() {
  console.log("📱 Testando modo offline no mobile...");
  console.log("navigator.onLine:", navigator.onLine);
  console.log("navigator.connection:", navigator.connection);
  if (navigator.connection) {
    console.log("effectiveType:", navigator.connection.effectiveType);
    console.log("downlink:", navigator.connection.downlink);
    console.log("rtt:", navigator.connection.rtt);
  }

  // Forçar offline para teste
  forceOffline();

  // Testar salvamento
  setTimeout(() => {
    console.log("📱 Testando salvamento em modo offline...");
    const testData = {
      timestamp: getCurrentTimestamp(),
      cargo: "Teste Mobile",
      ministerio: "",
      administracao: ""
    };
    enqueue(testData);
    console.log("📱 Dados de teste adicionados à fila:", testData);
  }, 1000);
}

// Função para simular modo avião no mobile
function simulateAirplaneMode() {
  console.log("✈️ Simulando modo avião...");

  // Forçar offline
  forceOffline();

  // Simular dados de conexão de modo avião
  if (navigator.connection) {
    console.log("✈️ Simulando conexão de modo avião...");
    // Note: Não podemos modificar navigator.connection diretamente,
    // mas podemos forçar o modo offline
  }

  showToast("Modo avião simulado - teste offline", 'info');
}

// Função específica para testar no iOS
function testIOS() {
  console.log("🍎 Testando funcionalidades específicas do iOS...");
  console.log("User Agent:", navigator.userAgent);
  console.log("Platform:", navigator.platform);
  console.log("Max Touch Points:", navigator.maxTouchPoints);
  console.log("Standalone:", window.navigator.standalone);
  console.log("Service Worker:", 'serviceWorker' in navigator);
  console.log("SendBeacon:", 'sendBeacon' in navigator);
  console.log("FormData:", typeof FormData !== 'undefined');

  // Testar conectividade
  testConnectivity().then(result => {
    console.log("🍎 Teste de conectividade iOS:", result);
  });

  // Testar salvamento
  setTimeout(() => {
    console.log("🍎 Testando salvamento no iOS...");
    const testData = {
      timestamp: getCurrentTimestamp(),
      cargo: "Teste iOS",
      ministerio: "",
      administracao: ""
    };
    enqueue(testData);
    console.log("🍎 Dados de teste iOS adicionados à fila:", testData);
  }, 1000);
}

// Função específica para testar no Android
function testAndroid() {
  console.log("🤖 Testando funcionalidades específicas do Android...");
  console.log("User Agent:", navigator.userAgent);
  console.log("Platform:", navigator.platform);
  console.log("Max Touch Points:", navigator.maxTouchPoints);
  console.log("Service Worker:", 'serviceWorker' in navigator);
  console.log("SendBeacon:", 'sendBeacon' in navigator);
  console.log("FormData:", typeof FormData !== 'undefined');
  console.log("Connection API:", 'connection' in navigator);

  // Testar conectividade
  testConnectivity().then(result => {
    console.log("🤖 Teste de conectividade Android:", result);
  });

  // Testar salvamento
  setTimeout(() => {
    console.log("🤖 Testando salvamento no Android...");
    const testData = {
      timestamp: getCurrentTimestamp(),
      cargo: "Teste Android",
      ministerio: "",
      administracao: ""
    };
    enqueue(testData);
    console.log("🤖 Dados de teste Android adicionados à fila:", testData);
  }, 1000);
}

// Função para testar mobile em geral
function testMobile() {
  console.log("📱 Testando funcionalidades mobile...");
  console.log("Dispositivo móvel:", isMobile);
  console.log("iOS:", isIOS);
  console.log("Android:", isAndroid);
  console.log("Chrome iOS:", isChromeIOS);
  console.log("Chrome Android:", isChromeAndroid);
  console.log("Samsung Browser:", isSamsungBrowser);

  if (isIOS) {
    testIOS();
  } else if (isAndroid) {
    testAndroid();
  } else {
    console.log("📱 Dispositivo não identificado como iOS ou Android");
  }
}


// Função para limpar registros duplicados da fila
function clearDuplicateRecords() {
  console.log("🧹 Limpando registros duplicados da fila...");

  const queue = getQueue();
  const uniqueRecords = [];
  const seen = new Set();

  queue.forEach(record => {
    // Criar uma chave única baseada no conteúdo (sem ID)
    const contentKey = `${record.timestamp}_${record.cargo}_${record.ministerio}_${record.administracao}`;

    if (!seen.has(contentKey)) {
      seen.add(contentKey);
      uniqueRecords.push(record);
    } else {
      console.log("🗑️ Removendo registro duplicado:", record);
    }
  });

  const removedCount = queue.length - uniqueRecords.length;

  if (removedCount > 0) {
    setQueue(uniqueRecords);
    console.log(`✅ ${removedCount} registros duplicados removidos`);
    showToast(`${removedCount} registros duplicados removidos`, 'success');
  } else {
    console.log("✅ Nenhum registro duplicado encontrado");
    showToast("Nenhum registro duplicado encontrado", 'info');
  }

  return removedCount;
}

// Adicionar funções globais para debug
window.forceOffline = forceOffline;
window.forceOnline = forceOnline;
window.testConnectivity = testConnectivity;
window.syncPending = syncPending;
window.getQueue = getQueue;
window.testIOS = testIOS;
window.testAndroid = testAndroid;
window.testMobile = testMobile;
window.clearDuplicateRecords = clearDuplicateRecords;

// Função para forçar atualização do resumo
window.forceUpdateSummary = function () {
  console.log("🔄 Forçando atualização do resumo...");
  updateSummary();
};

// Função para verificar se todos os elementos HTML existem
window.checkHTMLElements = function () {
  console.log("🔍 Verificando elementos HTML...");

  const elements = [
    'total-participants',
    'online-count',
    'offline-count',
    'brothers-count',
    'sisters-count',
    'musicians-count',
    'organists-count',
    'ancioes-count',
    'diaconos-count',
    'cooperadores-oficio-count',
    'cooperadores-jovens-count',
    'encarregados-locais-count',
    'encarregados-regionais-count',
    'examinadoras-count',
    'irma-piedade-count',
    'auxiliares-admin-count',
    'secretarios-admin-count',
    'secretarios-musica-count',
    'titular-admin-count'
  ];

  const missingElements = [];
  const foundElements = [];

  elements.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      foundElements.push(id);
      console.log(`✅ Elemento encontrado: ${id} - Valor atual: "${element.textContent}"`);
    } else {
      missingElements.push(id);
      console.log(`❌ Elemento não encontrado: ${id}`);
    }
  });

  console.log(`📊 Resumo: ${foundElements.length} elementos encontrados, ${missingElements.length} elementos faltando`);

  if (missingElements.length > 0) {
    console.error("❌ Elementos faltando:", missingElements);
    showToast(`Elementos faltando: ${missingElements.join(', ')}`, 'error');
    return false;
  } else {
    console.log("✅ Todos os elementos HTML encontrados!");
    showToast('Todos os elementos HTML encontrados!', 'success');
    return true;
  }
};

// Função para testar integração completa
window.testCompleteIntegration = async function () {
  console.log("🧪 Testando integração completa HTML + JavaScript...");

  try {
    // 1. Testar se os elementos HTML existem
    const elements = [
      'total-participants',
      'online-count',
      'offline-count',
      'brothers-count',
      'sisters-count',
      'musicians-count',
      'organists-count',
      'ancioes-count',
      'diaconos-count',
      'cooperadores-oficio-count',
      'cooperadores-jovens-count',
      'encarregados-locais-count',
      'encarregados-regionais-count',
      'examinadoras-count',
      'irma-piedade-count',
      'auxiliares-admin-count',
      'secretarios-admin-count',
      'secretarios-musica-count',
      'titular-admin-count'
    ];

    console.log("🔍 Verificando elementos HTML...");
    const missingElements = [];
    elements.forEach(id => {
      const element = document.getElementById(id);
      if (!element) {
        missingElements.push(id);
      }
    });

    if (missingElements.length > 0) {
      console.error("❌ Elementos HTML não encontrados:", missingElements);
      showToast(`Elementos não encontrados: ${missingElements.join(', ')}`, 'error');
      return false;
    }

    console.log("✅ Todos os elementos HTML encontrados");

    // 2. Testar integração com a planilha
    console.log("🌐 Testando integração com a planilha...");
    const result = await testSheetIntegration();

    if (result && result.success) {
      console.log("✅ Integração completa funcionando!");
      showToast('Integração completa funcionando!', 'success');
      return true;
    } else {
      console.log("❌ Integração com planilha falhou");
      showToast('Integração com planilha falhou', 'error');
      return false;
    }

  } catch (error) {
    console.error("❌ Erro no teste de integração completa:", error);
    showToast('Erro no teste de integração', 'error');
    return false;
  }
};

// Função para exportar dados do resumo
function exportSummaryData() {
  console.log("📤 Exportando dados do resumo...");

  try {
    // Obter todos os dados salvos
    const allData = getAllSavedData();

    if (allData.length === 0) {
      showToast('Nenhum dado para exportar', 'warning');
      return;
    }

    // Criar CSV
    const headers = ['Data', 'Cargo', 'Ministério', 'Administração', 'Timestamp'];
    const csvContent = [
      headers.join(','),
      ...allData.map(item => [
        item.data || '',
        item.cargo || '',
        item.ministerio || '',
        item.administracao || '',
        item.timestamp || ''
      ].join(','))
    ].join('\n');

    // Download do arquivo
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `contagem_ccb_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Dados exportados com sucesso!', 'success');

  } catch (error) {
    console.error('❌ Erro ao exportar dados:', error);
    showToast('Erro ao exportar dados', 'error');
  }
}

// Função para testar a integração com a planilha
window.testSheetIntegration = async function () {
  console.log("🧪 Testando integração com a planilha...");

  try {
    // Verificar conectividade primeiro
    const isOnline = await testConnectivity();
    if (!isOnline) {
      throw new Error('Sem conectividade - não é possível testar a integração');
    }

    // Tentar diferentes formatos de URL
    const urls = [
      `${ENDPOINT}?action=getSummary`,
      `${ENDPOINT}?action=summary`,
      `${ENDPOINT}?getSummary=true`
    ];

    let response = null;
    let workingUrl = null;

    for (const url of urls) {
      console.log(`🔗 Tentando URL: ${url}`);
      try {
        response = await fetch(url, {
          method: 'GET',
          mode: 'cors',
          cache: 'no-cache',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            workingUrl = url;
            console.log(`✅ URL funcionando: ${url}`);
            break;
          }
        }
      } catch (error) {
        console.log(`❌ URL falhou: ${url} - ${error.message}`);
        continue;
      }
    }

    if (!response || !workingUrl) {
      throw new Error('Nenhuma URL funcionou');
    }

    console.log("📊 Status da resposta:", response.status);
    console.log("📊 Headers da resposta:", response.headers);

    if (response.ok) {
      const result = await response.json();
      console.log("📊 Dados recebidos da planilha:", result);

      if (result.success && result.data) {
        console.log("✅ Integração funcionando! Dados:", result.data);

        // Atualizar a interface com os dados obtidos
        updateSummaryWithData(result.data);

        showToast('Integração com planilha funcionando!', 'success');
        return result.data;
      } else {
        console.log("⚠️ Resposta não contém dados válidos:", result);
        showToast('Planilha não retornou dados válidos', 'warning');
        return null;
      }
    } else {
      console.log("❌ Erro HTTP:", response.status, response.statusText);
      showToast(`Erro HTTP: ${response.status}`, 'error');
      return null;
    }
  } catch (error) {
    console.error("❌ Erro na integração:", error);
    showToast(`Erro na integração: ${error.message}`, 'error');
    return null;
  }
};

// Função para testar timestamp
window.testTimestamp = function () {
  const timestamp = getCurrentTimestamp();
  console.log('🕐 Timestamp gerado:', timestamp);
  console.log('🕐 Tipo:', typeof timestamp);
  console.log('🕐 Contém T:', timestamp.includes('T'));
  console.log('🕐 Contém Z:', timestamp.includes('Z'));
  console.log('🕐 Contém /:', timestamp.includes('/'));
  return timestamp;
};

// Função para testar envio de dados
window.testSendData = function () {
  const testData = {
    timestamp: getCurrentTimestamp(),
    cargo: 'Teste',
    ministerio: '',
    administracao: ''
  };

  console.log('🧪 Dados de teste:', testData);
  console.log('🧪 Timestamp tipo:', typeof testData.timestamp);

  // Testar envio
  return sendItem(testData);
};












// ------------ Inicialização ------------
function toggleExtras() {
  const cargo = cargoSelecionado();
  console.log("🔄 Cargo selecionado:", cargo);

  // SOLUÇÃO SIMPLES - usar getElementById diretamente
  const ministerioBox = document.getElementById('ministerioBox');
  const administracaoBox = document.getElementById('administracaoBox');

  if (!ministerioBox || !administracaoBox) {
    console.error("❌ Elementos dropdown não encontrados");
    return;
  }

  // OCULTAR AMBOS PRIMEIRO
  ministerioBox.classList.remove('show');
  administracaoBox.classList.remove('show');

  // MOSTRAR APENAS O CORRETO
  if (cargo === 'Ministério') {
    console.log("📋 Mostrando dropdown de Ministério");
    ministerioBox.classList.add('show');
  } else if (cargo === 'Administração') {
    console.log("📋 Mostrando dropdown de Administração");
    administracaoBox.classList.add('show');
  } else {
    console.log("📋 Nenhum dropdown necessário para:", cargo);
  }
}

// Event listeners SIMPLES
document.querySelectorAll('input[name="cargo"]').forEach(el => {
  el.addEventListener("change", toggleExtras);
});

// Inicialização SIMPLES
document.addEventListener('DOMContentLoaded', function () {
  console.log("🚀 DOM carregado - inicializando...");

  // Inicializar variáveis globais
  dot = $("status-dot");
  statusText = $("status-text");
  ministerioBox = $("ministerioBox");
  administracaoBox = $("administracaoBox");
  saveBtn = $("save");
  queueCountEl = $("queue-count");
  queueStatusEl = $("queue-status");

  console.log("✅ Inicialização simples concluída");

  // Inicializar dropdowns
  toggleExtras();

  // Adicionar event listener do botão salvar
  if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
      console.log("🖱️ Botão salvar clicado");
      e.preventDefault();
      saveRecord();
    });
  }

  // Event listeners para botões do resumo
  const refreshBtn = document.getElementById('refresh-summary');
  const exportBtn = document.getElementById('export-summary');
  const clearBtn = document.getElementById('clear-all-data');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', updateSummary);
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', exportData);
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', clearAllData);
  }
});

// Event listeners para conectividade do navegador
window.addEventListener("online", () => {
  console.log("🌐 Navegador detectou conectividade");
  // Forçar verificação de conectividade após um delay
  setTimeout(async () => {
    await updateConnectivityStatus();
    if (isOnline) {
      syncPending();
    }
  }, 2000);
});

window.addEventListener("offline", () => {
  console.log("📴 Navegador detectou perda de conectividade");
  isOnline = false;
  updateStatusUI();
});

// Auto-sync por timer (apenas se online)
setInterval(() => {
  if (isOnline) {
    syncPending();
  }
}, SYNC_INTERVAL_MS);

// Inicialização
console.log("🚀 Iniciando PWA...");
console.log("Protocolo atual:", window.location.protocol);
console.log("ENDPOINT:", ENDPOINT);

// Inicializar sistema
updateQueueCount();
toggleExtras();

// Iniciar monitoramento de conectividade
startConnectivityMonitoring();

// Service Worker (apenas se não estiver em file://)
if ("serviceWorker" in navigator && window.location.protocol !== 'file:') {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js?v=12")
      .then(registration => {
        console.log("✅ Service Worker registrado:", registration);

        // Para iOS, verificar se está funcionando
        if (isIOS) {
          console.log("🍎 Service Worker no iOS - verificando funcionamento...");
          // iOS pode ter problemas com Service Workers
          if (registration.active) {
            console.log("🍎 Service Worker ativo no iOS");
          } else {
            console.log("🍎 Service Worker não ativo no iOS - pode causar problemas");
          }
        }

        // Para Chrome iOS, verificar limitações específicas
        if (isChromeIOS) {
          console.log("🌐 Service Worker no Chrome iOS - verificando limitações...");
          // Chrome iOS tem limitações específicas com Service Workers
          if (registration.active) {
            console.log("🌐 Service Worker ativo no Chrome iOS");
          } else {
            console.log("🌐 Service Worker não ativo no Chrome iOS - limitações conhecidas");
          }
        }
      })
      .catch(error => {
        console.error("❌ Erro ao registrar Service Worker:", error);
        if (isIOS) {
          console.log("🍎 Erro comum no iOS - Service Worker pode não funcionar corretamente");
        }
      });
  });
} else {
  console.log("⚠️ Service Worker não disponível (file:// protocol)");
}

// === FUNÇÕES DE ESTATÍSTICAS E RESUMO ===

// Inicializar sistema de abas
function initializeTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.getAttribute('data-tab');

      // Remover classe active de todos os botões e conteúdos
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));

      // Adicionar classe active ao botão clicado e conteúdo correspondente
      button.classList.add('active');
      document.getElementById(`${targetTab}-tab`).classList.add('active');

      // Se for a aba de resumo, atualizar as estatísticas
      if (targetTab === 'summary') {
        console.log("📊 Aba de resumo ativada - buscando dados dinâmicos...");
        updateSummary(); // Buscar dados dinâmicos da planilha
      }
    });
  });
}

// Inicializar botões da aba de resumo
function initializeSummaryButtons() {
  console.log("🔗 Inicializando botões da aba de resumo...");

  // Botão de atualizar resumo
  const refreshButton = document.getElementById('refresh-summary');
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      console.log("🔄 Botão de atualizar resumo clicado");
      updateSummary();
    });
  }

  // Botão de exportar dados
  const exportButton = document.getElementById('export-summary');
  if (exportButton) {
    exportButton.addEventListener('click', () => {
      console.log("📤 Botão de exportar dados clicado");
      exportSummaryData();
    });
  }

  // Botão de limpar todos os dados
  const clearButton = document.getElementById('clear-all-data');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      console.log("🗑️ Botão de limpar dados clicado");
      clearAllData();
    });
  }

  console.log("✅ Botões da aba de resumo inicializados");
}

// Função para injetar dados reais da planilha
async function injetarDadosReais() {
  try {
    console.log("🔗 Buscando dados da planilha...");

    const response = await fetch(`${ENDPOINT}?action=getSummary`);
    const result = await response.json();

    console.log("📊 Dados recebidos:", result);

    if (result.success && result.data) {
      // INJETAR DADOS REAIS NO HTML
      document.getElementById('brothers-count').textContent = result.data.brothersCount || 0;
      document.getElementById('sisters-count').textContent = result.data.sistersCount || 0;
      document.getElementById('musicians-count').textContent = result.data.musiciansCount || 0;
      document.getElementById('organists-count').textContent = result.data.organistsCount || 0;

      // Ministério
      document.getElementById('ancioes-count').textContent = result.data.ancioesCount || 0;
      document.getElementById('diaconos-count').textContent = result.data.diaconosCount || 0;
      document.getElementById('cooperadores-oficio-count').textContent = result.data.cooperadoresOficioCount || 0;
      document.getElementById('cooperadores-jovens-count').textContent = result.data.cooperadoresJovensCount || 0;
      document.getElementById('encarregados-locais-count').textContent = result.data.encarregadosLocaisCount || 0;
      document.getElementById('encarregados-regionais-count').textContent = result.data.encarregadosRegionaisCount || 0;
      document.getElementById('examinadoras-count').textContent = result.data.examinadorasCount || 0;
      document.getElementById('irma-piedade-count').textContent = result.data.irmaPiedadeCount || 0;

      // Administração
      document.getElementById('auxiliares-admin-count').textContent = result.data.auxiliaresAdminCount || 0;
      document.getElementById('secretarios-admin-count').textContent = result.data.secretariosAdminCount || 0;
      document.getElementById('secretarios-musica-count').textContent = result.data.secretariosMusicaCount || 0;
      document.getElementById('titular-admin-count').textContent = result.data.titularAdminCount || 0;

      // Total
      document.getElementById('total-participants').textContent = result.data.totalParticipants || 0;

      console.log("✅ DADOS REAIS INJETADOS!");
      return true;
    } else {
      console.log("❌ Erro:", result.error);
      return false;
    }
  } catch (error) {
    console.log("❌ Erro ao buscar dados:", error);
    return false;
  }
}

// Função para atualizar contadores dinamicamente
function atualizarContadores(dados) {
  if (!dados) return;

  // Atualizar contadores por cargo
  document.getElementById('brothers-count').textContent = dados.brothersCount || 0;
  document.getElementById('sisters-count').textContent = dados.sistersCount || 0;
  document.getElementById('musicians-count').textContent = dados.musiciansCount || 0;
  document.getElementById('organists-count').textContent = dados.organistsCount || 0;

  // Atualizar contadores por ministério
  document.getElementById('ancioes-count').textContent = dados.ancioesCount || 0;
  document.getElementById('diaconos-count').textContent = dados.diaconosCount || 0;
  document.getElementById('cooperadores-oficio-count').textContent = dados.cooperadoresOficioCount || 0;
  document.getElementById('cooperadores-jovens-count').textContent = dados.cooperadoresJovensCount || 0;
  document.getElementById('encarregados-locais-count').textContent = dados.encarregadosLocaisCount || 0;
  document.getElementById('encarregados-regionais-count').textContent = dados.encarregadosRegionaisCount || 0;
  document.getElementById('examinadoras-count').textContent = dados.examinadorasCount || 0;
  document.getElementById('irma-piedade-count').textContent = dados.irmaPiedadeCount || 0;

  // Atualizar contadores por administração
  document.getElementById('auxiliares-admin-count').textContent = dados.auxiliaresAdminCount || 0;
  document.getElementById('secretarios-admin-count').textContent = dados.secretariosAdminCount || 0;
  document.getElementById('secretarios-musica-count').textContent = dados.secretariosMusicaCount || 0;
  document.getElementById('titular-admin-count').textContent = dados.titularAdminCount || 0;

  // Atualizar total
  document.getElementById('total-participants').textContent = dados.totalParticipants || 0;
}

// Função principal para atualizar resumo
async function updateSummary() {
  console.log("📊 Injetando dados reais no HTML...");

  const sucesso = await injetarDadosReais();
  if (sucesso) {
    console.log("✅ Dados reais injetados com sucesso!");
  } else {
    console.log("⚠️ Não foi possível injetar dados reais");
  }
}

// Função para atualizar resumo com dados específicos
function updateSummaryWithData(data) {
  console.log("📊 Atualizando resumo com dados fornecidos:", data);

  // Função auxiliar para atualizar elemento com verificação de existência
  function updateElement(id, value, label) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value || 0;
      console.log(`✅ ${label} atualizado: ${value || 0}`);
    } else {
      console.error(`❌ Elemento não encontrado: ${id} (${label})`);
    }
  }

  // Atualizar cards de resumo geral
  updateElement('total-participants', data.totalParticipants, 'Total de Participantes');
  updateElement('online-count', data.onlineCount, 'Registros Online');
  updateElement('offline-count', data.offlineCount, 'Registros Offline');

  // Atualizar estatísticas por cargo
  updateElement('brothers-count', data.brothersCount, 'Irmãos');
  updateElement('sisters-count', data.sistersCount, 'Irmãs');
  updateElement('musicians-count', data.musiciansCount, 'Músicos');
  updateElement('organists-count', data.organistsCount, 'Organistas');

  // Atualizar estatísticas por ministério
  updateElement('ancioes-count', data.ancioesCount, 'Anciães');
  updateElement('diaconos-count', data.diaconosCount, 'Diáconos');
  updateElement('cooperadores-oficio-count', data.cooperadoresOficioCount, 'Cooperadores do Ofício');
  updateElement('cooperadores-jovens-count', data.cooperadoresJovensCount, 'Cooperadores de Jovens');
  updateElement('encarregados-locais-count', data.encarregadosLocaisCount, 'Encarregados Locais');
  updateElement('encarregados-regionais-count', data.encarregadosRegionaisCount, 'Encarregados Regionais');
  updateElement('examinadoras-count', data.examinadorasCount, 'Examinadoras');
  updateElement('irma-piedade-count', data.irmaPiedadeCount, 'Irmãs da Obra da Piedade');

  // Atualizar estatísticas por administração
  updateElement('auxiliares-admin-count', data.auxiliaresAdminCount, 'Auxiliares da Administração');
  updateElement('secretarios-admin-count', data.secretariosAdminCount, 'Secretários da Administração');
  updateElement('secretarios-musica-count', data.secretariosMusicaCount, 'Secretários da Música');
  updateElement('titular-admin-count', data.titularAdminCount, 'Titular da Administração');

  console.log("✅ Interface atualizada com dados da planilha");
}

// Função para atualizar resumo com dados locais (fallback)
function updateSummaryLocal() {
  console.log("📊 Atualizando resumo com dados locais...");

  // Obter todos os dados salvos
  const allData = getAllSavedData();

  // Calcular estatísticas gerais
  const totalParticipants = allData.length;
  const onlineCount = allData.filter(item => item.synced).length;
  const offlineCount = totalParticipants - onlineCount;

  // Atualizar cards de resumo geral
  document.getElementById('total-participants').textContent = totalParticipants;
  document.getElementById('online-count').textContent = onlineCount;
  document.getElementById('offline-count').textContent = offlineCount;

  // Calcular estatísticas por cargo
  updateCargoStats(allData);

  // Calcular estatísticas por ministério
  updateMinistryStats(allData);

  // Calcular estatísticas por administração
  updateAdminStats(allData);

  console.log("✅ Resumo atualizado com dados locais:", { totalParticipants, onlineCount, offlineCount });
}

// Obter todos os dados salvos (localStorage + fila)
function getAllSavedData() {
  const savedData = JSON.parse(localStorage.getItem('savedData') || '[]');
  const queueData = JSON.parse(localStorage.getItem('queue') || '[]');

  // Marcar dados da fila como não sincronizados
  const queueDataWithSync = queueData.map(item => ({ ...item, synced: false }));

  // Marcar dados salvos como sincronizados
  const savedDataWithSync = savedData.map(item => ({ ...item, synced: true }));

  const allData = [...savedDataWithSync, ...queueDataWithSync];

  // Se não há dados, criar alguns dados de exemplo para demonstração
  if (allData.length === 0) {
    console.log("📊 Nenhum dado encontrado - criando dados de exemplo");
    const sampleData = [
      {
        timestamp: getCurrentTimestamp(),
        cargo: 'Irmão',
        ministerio: '',
        administracao: '',
        synced: true
      },
      {
        timestamp: getCurrentTimestamp(),
        cargo: 'Irmã',
        ministerio: '',
        administracao: '',
        synced: true
      },
      {
        timestamp: getCurrentTimestamp(),
        cargo: 'Ministério',
        ministerio: 'Diácono',
        administracao: '',
        synced: true
      },
      {
        timestamp: getCurrentTimestamp(),
        cargo: 'Administração',
        ministerio: '',
        administracao: 'Secretário da Música',
        synced: false
      }
    ];

    // Salvar dados de exemplo no localStorage
    localStorage.setItem('savedData', JSON.stringify(sampleData.slice(0, 3)));
    localStorage.setItem('queue', JSON.stringify(sampleData.slice(3)));

    return sampleData;
  }

  return allData;
}

// Atualizar estatísticas por cargo
function updateCargoStats(data) {
  // Calcular contagens específicas
  const brothersCount = data.filter(item => item.cargo === 'Irmão').length;
  const sistersCount = data.filter(item => item.cargo === 'Irmã').length;
  const musiciansCount = data.filter(item => item.cargo === 'Músico').length;
  const organistsCount = data.filter(item => item.cargo === 'Organista').length;

  // Atualizar os elementos específicos
  document.getElementById('brothers-count').textContent = brothersCount;
  document.getElementById('sisters-count').textContent = sistersCount;
  document.getElementById('musicians-count').textContent = musiciansCount;
  document.getElementById('organists-count').textContent = organistsCount;
}

// Atualizar estatísticas por ministério
function updateMinistryStats(data) {
  // Calcular contagens específicas
  const ancioesCount = data.filter(item => item.ministerio === 'Ancião').length;
  const diaconosCount = data.filter(item => item.ministerio === 'Diácono').length;
  const cooperadoresOficioCount = data.filter(item => item.ministerio === 'Cooperador do Ofício').length;
  const cooperadoresJovensCount = data.filter(item => item.ministerio === 'Cooperador de Jovens').length;
  const encarregadosLocaisCount = data.filter(item => item.ministerio === 'Encarregado Local').length;
  const encarregadosRegionaisCount = data.filter(item => item.ministerio === 'Encarregado Regional').length;
  const examinadorasCount = data.filter(item => item.ministerio === 'Examinadora').length;
  const irmaPiedadeCount = data.filter(item => item.ministerio === 'Irmãs da Obra da Piedade').length;

  // Atualizar os elementos específicos
  document.getElementById('ancioes-count').textContent = ancioesCount;
  document.getElementById('diaconos-count').textContent = diaconosCount;
  document.getElementById('cooperadores-oficio-count').textContent = cooperadoresOficioCount;
  document.getElementById('cooperadores-jovens-count').textContent = cooperadoresJovensCount;
  document.getElementById('encarregados-locais-count').textContent = encarregadosLocaisCount;
  document.getElementById('encarregados-regionais-count').textContent = encarregadosRegionaisCount;
  document.getElementById('examinadoras-count').textContent = examinadorasCount;
  document.getElementById('irma-piedade-count').textContent = irmaPiedadeCount;
}

// Atualizar estatísticas por administração
function updateAdminStats(data) {
  // Calcular contagens específicas
  const auxiliaresAdminCount = data.filter(item => item.administracao === 'Auxiliar da Administração').length;
  const secretariosAdminCount = data.filter(item => item.administracao === 'Secretário da Administração').length;
  const secretariosMusicaCount = data.filter(item => item.administracao === 'Secretário da Música').length;
  const titularAdminCount = data.filter(item => item.administracao === 'Titular da Administração').length;

  // Atualizar os elementos específicos
  document.getElementById('auxiliares-admin-count').textContent = auxiliaresAdminCount;
  document.getElementById('secretarios-admin-count').textContent = secretariosAdminCount;
  document.getElementById('secretarios-musica-count').textContent = secretariosMusicaCount;
  document.getElementById('titular-admin-count').textContent = titularAdminCount;
}


// Organizar dados do resumo na ordem específica
function organizeSummaryData(data) {
  // Calcular estatísticas por cargo
  const cargoStats = {};
  const ministryStats = {};
  const adminStats = {};

  data.forEach(item => {
    // Estatísticas por cargo
    const cargo = item.cargo || 'Não especificado';
    cargoStats[cargo] = (cargoStats[cargo] || 0) + 1;

    // Estatísticas por ministério
    if (item.ministerio && item.ministerio.trim() !== '') {
      const ministerio = item.ministerio;
      ministryStats[ministerio] = (ministryStats[ministerio] || 0) + 1;
    }

    // Estatísticas por administração
    if (item.administracao && item.administracao.trim() !== '') {
      const administracao = item.administracao;
      adminStats[administracao] = (adminStats[administracao] || 0) + 1;
    }
  });

  // Ordem específica dos cargos conforme o relatório
  const cargoOrder = {
    // MINISTÉRIO PRESENTE
    'Anciães': ministryStats['Ancião'] || 0,
    'Diáconos': ministryStats['Diácono'] || 0,
    'Cooperadores do Ofício Ministerial': ministryStats['Cooperador do Ofício'] || 0,
    'Cooperadores de Jovens e Menores': ministryStats['Cooperador de Jovens'] || 0,
    'Encarregados Regionais': ministryStats['Encarregado Regional'] || 0,
    'Encarregados Locais': ministryStats['Encarregado Local'] || 0,
    'Examinadoras de Organistas': ministryStats['Examinadora'] || 0,
    'Irmãs da Obra da Piedade': ministryStats['Irmãs da Obra da Piedade'] || 0,

    // ADMINISTRAÇÃO
    'Secretários da Música': adminStats['Secretários da Música'] || 0,
    'Titular da Administração': adminStats['Titular da Administração'] || 0,
    'Auxiliares da Administração': adminStats['Auxiliares da Administração'] || 0,

    // MÚSICOS E ORGANISTAS
    'Músicos': cargoStats['Músico'] || 0,
    'Organistas': cargoStats['Organista'] || 0,

    // IRMANDADE
    'Irmãos': cargoStats['Irmão'] || 0,
    'Irmãs': cargoStats['Irmã'] || 0
  };

  // Calcular totais
  const totalMinisterio = Object.entries(cargoOrder)
    .slice(0, 8) // Primeiros 8 itens (Ministério)
    .reduce((sum, [, count]) => sum + count, 0);

  const totalAdministracao = Object.entries(cargoOrder)
    .slice(8, 11) // Itens 8-10 (Administração)
    .reduce((sum, [, count]) => sum + count, 0);

  const totalMusicos = Object.entries(cargoOrder)
    .slice(11, 13) // Itens 11-12 (Músicos e Organistas)
    .reduce((sum, [, count]) => sum + count, 0);

  const totalIrmandade = Object.entries(cargoOrder)
    .slice(13, 15) // Itens 13-14 (Irmandade)
    .reduce((sum, [, count]) => sum + count, 0);

  return {
    timestamp: getCurrentTimestamp(),
    cargoOrder,
    totals: {
      totalMinisterio,
      totalAdministracao,
      totalMusicos,
      totalIrmandade,
      totalGeral: totalMinisterio + totalAdministracao + totalMusicos + totalIrmandade
    },
    ministryStats,
    adminStats
  };
}

// Exportar dados para CSV
function exportData() {
  const allData = getAllSavedData();

  if (allData.length === 0) {
    showToast('Nenhum dado para exportar', 'warning');
    return;
  }

  // Criar cabeçalho CSV
  const headers = ['Data/Hora', 'Cargo', 'Ministério', 'Administração', 'Status'];
  const csvContent = [
    headers.join(','),
    ...allData.map(item => [
      `"${item.timestamp || ''}"`,
      `"${item.cargo || ''}"`,
      `"${item.ministerio || ''}"`,
      `"${item.administracao || ''}"`,
      `"${item.synced ? 'Online' : 'Offline'}"`
    ].join(','))
  ].join('\n');

  // Criar e baixar arquivo
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `contagem_participantes_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Dados exportados com sucesso!', 'success');
}


// Limpar todos os dados
function clearAllData() {
  Swal.fire({
    title: '⚠️ Confirmar Limpeza',
    text: 'Tem certeza que deseja limpar TODOS os dados? Esta ação não pode ser desfeita!',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#6b7280',
    confirmButtonText: 'Sim, limpar tudo!',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      // Limpar localStorage
      localStorage.removeItem('savedData');
      localStorage.removeItem('queue');

      // Atualizar contadores
      updateQueueCount();
      updateSummary();

      showToast('Todos os dados foram limpos!', 'success');
    }
  });
}

// Inicialização explícita
console.log("🚀 Iniciando PWA...");
toggleExtras(); // Inicializar estado dos dropdowns
updateConnectivityStatus(); // Verificar conectividade inicial
updateQueueCount(); // Atualizar contador da fila
initializeTabs(); // Inicializar sistema de abas
initializeSummaryButtons(); // Inicializar botões da aba de resumo

// Atualizar resumo se a aba de resumo estiver ativa
setTimeout(() => {
  const summaryTab = document.getElementById('summary-tab');
  if (summaryTab && summaryTab.classList.contains('active')) {
    console.log("📊 Aba de resumo ativa na inicialização - atualizando dados...");
    updateSummary();
  }
}, 1000); // Aguardar 1 segundo para garantir que tudo foi carregado

// Forçar atualização inicial do resumo (independente da aba ativa)
setTimeout(() => {
  console.log("🔄 Forçando atualização inicial do resumo...");
  updateSummary();
}, 2000); // Aguardar 2 segundos para garantir que tudo foi carregado

// Adicionar função global para forçar atualização do resumo
window.forceUpdateSummary = function () {
  console.log("🔄 Forçando atualização do resumo...");
  updateSummary();
};

// Função para testar injeção de dados reais
window.testarDadosReais = async function () {
  console.log("🧪 Testando injeção de dados reais...");
  const sucesso = await injetarDadosReais();
  if (sucesso) {
    console.log("✅ Dados reais injetados com sucesso!");
    alert("✅ Dados reais injetados com sucesso!");
  } else {
    console.log("❌ Falha ao injetar dados reais");
    alert("❌ Falha ao injetar dados reais");
  }
};

// Adicionar função para testar dados da planilha
window.testPlanilhaData = async function () {
  console.log("🧪 Testando dados da planilha...");
  try {
    const result = await testSheetIntegration();
    if (result) {
      console.log("✅ Dados da planilha obtidos com sucesso:", result);
      return result;
    } else {
      console.log("❌ Falha ao obter dados da planilha");
      return null;
    }
  } catch (error) {
    console.error("❌ Erro ao testar dados da planilha:", error);
    return null;
  }
};

// Função para testar endpoint diretamente - SEM CONTAMINAR
window.testEndpoint = async function () {
  console.log("🧪 Testando endpoint diretamente (SEM SALVAR)...");
  console.log("🔗 ENDPOINT:", ENDPOINT);

  try {
    // Usar apenas action=getSummary SEM cargo para não contaminar
    const response = await fetch(`${ENDPOINT}?action=getSummary`);
    console.log("📡 Status:", response.status);
    console.log("📡 Headers:", response.headers);

    const text = await response.text();
    console.log("📄 Resposta como texto:", text);

    try {
      const json = JSON.parse(text);
      console.log("📊 Resposta como JSON:", json);
      return json;
    } catch (parseError) {
      console.log("❌ Erro ao parsear JSON:", parseError);
      return null;
    }
  } catch (error) {
    console.log("❌ Erro na requisição:", error);
    return null;
  }
};

// Função para testar correção de duplicação offline
window.testOfflineDuplicationFix = function () {
  console.log("🧪 Testando correção de duplicação offline...");

  // 1. Limpar fila atual
  localStorage.removeItem('queue');
  console.log("🗑️ Fila limpa");

  // 2. Forçar modo offline
  forceOffline();
  console.log("📴 Modo offline ativado");

  // 3. Adicionar alguns registros de teste
  const testRecords = [
    {
      timestamp: getCurrentTimestamp(),
      cargo: 'Irmão',
      ministerio: '',
      administracao: ''
    },
    {
      timestamp: getCurrentTimestamp(),
      cargo: 'Irmã',
      ministerio: '',
      administracao: ''
    },
    {
      timestamp: getCurrentTimestamp(),
      cargo: 'Ministério',
      ministerio: 'Diácono',
      administracao: ''
    }
  ];

  console.log("📝 Adicionando registros de teste...");
  testRecords.forEach((record, index) => {
    enqueue(record);
    console.log(`✅ Registro ${index + 1} adicionado:`, record);
  });

  // 4. Verificar se todos têm IDs únicos
  const queue = getQueue();
  const ids = queue.map(item => item.id);
  const uniqueIds = [...new Set(ids)];

  console.log("🔍 Verificando IDs únicos...");
  console.log("📊 Total de registros:", queue.length);
  console.log("📊 IDs únicos:", uniqueIds.length);
  console.log("📊 IDs:", ids);

  if (ids.length === uniqueIds.length) {
    console.log("✅ Todos os registros têm IDs únicos!");
  } else {
    console.log("❌ Há IDs duplicados!");
  }

  // 5. Simular tentativa de adicionar registro duplicado
  console.log("🔄 Tentando adicionar registro duplicado...");
  enqueue(testRecords[0]); // Mesmo conteúdo do primeiro

  const finalQueue = getQueue();
  console.log("📊 Fila final:", finalQueue.length, "registros");

  // 6. Verificar se não há duplicatas de conteúdo
  const contentKeys = finalQueue.map(item =>
    `${item.timestamp}_${item.cargo}_${item.ministerio}_${item.administracao}`
  );
  const uniqueContentKeys = [...new Set(contentKeys)];

  if (contentKeys.length === uniqueContentKeys.length) {
    console.log("✅ Nenhuma duplicata de conteúdo encontrada!");
  } else {
    console.log("❌ Há duplicatas de conteúdo!");
    console.log("🔍 Chaves de conteúdo:", contentKeys);
  }

  // 7. Testar limpeza de duplicatas
  console.log("🧹 Testando limpeza de duplicatas...");
  const removedCount = clearDuplicateRecords();
  console.log(`✅ ${removedCount} duplicatas removidas`);

  // 8. Forçar modo online e testar sincronização
  console.log("🌐 Ativando modo online para testar sincronização...");
  forceOnline();

  // Aguardar um pouco e testar sincronização
  setTimeout(() => {
    console.log("🔄 Testando sincronização...");
    syncPending();
  }, 2000);

  return {
    initialRecords: testRecords.length,
    finalRecords: finalQueue.length,
    uniqueIds: uniqueIds.length,
    uniqueContent: uniqueContentKeys.length,
    duplicatesRemoved: removedCount
  };
};


console.log("✅ PWA inicializado com sucesso!");