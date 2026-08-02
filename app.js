// ==========================================================================
// CONSTANTS & STATE MANAGEMENT
// ==========================================================================
const WEEKDAYS = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
const MONTHS = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", 
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
];

// Seed default schedule data to make the app look complete out-of-the-box
const SEED_DATA = {
  // Assuming today is Sunday, Aug 2, 2026 (based on local metadata)
  "2026-08-02": ["BARRIO CENTRAL", "VILLA ADELA", "ZONA CEJA", "BARRIO VILLA DOLORES"],
  "2026-08-03": [
    "BARRIO LA PORTADA", 
    "VILLA VICTORIA", 
    "ZONA GRAN PODER", 
    "MUNAYPATA", 
    "CHAMPACOLLO", 
    "BARRIO LINDO", 
    "ZONA OBRAJES"
  ],
  "2026-08-04": ["ZONA SUR", "CALACOTO", "ACHUMANI", "IRPAVI", "MALLASA"],
  "2026-08-05": ["VILLA FÁTIMA", "PAMPALAHUA", "ZONA MIRAFLORES", "ZONA COPACOBANA"],
  "2026-08-06": ["BARRIO MINERO", "SENKATA", "PUENTE VELA", "VILLA TUNARI", "EL TEJAR", "ZONA ALTO LIMA"],
  "2026-08-07": ["ZONA TEMBLADERANI", "SOPOCACHI", "SAN PEDRO", "BARRIO GRÁFICO"]
};

let scheduleData = {};
let currentSelectedDate = null; // For the admin day editor
let currentCalMonth = 7; // August (0-indexed)
let currentCalYear = 2026;
let isAdminLoggedIn = false;
let deferredPrompt = null; // PWA installation prompt
let currentDisplayDate = null; // For the navigated public view date

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('Service Worker registered:', reg.scope))
      .catch(err => console.error('Service Worker registration failed:', err));
  });
}

// ==========================================================================
// INITIALIZATION
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  loadData();
  setupEventListeners();
  renderPublicView();
  renderAd();
  
  // Set current month/year based on the active display date
  const activeDateInfo = getActiveDateInfo();
  currentCalMonth = activeDateInfo.date.getMonth();
  currentCalYear = activeDateInfo.date.getFullYear();
});

const SYNC_URL = 'api/sync';
let isSyncing = false;

// Load schedule data from localStorage or seed, and sync with remote server
function loadData() {
  const localRaw = localStorage.getItem("glp_schedule_data");
  if (localRaw) {
    try {
      scheduleData = JSON.parse(localRaw);
    } catch (e) {
      console.error("Error parsing local schedule data. Using seed data.", e);
      scheduleData = { ...SEED_DATA };
    }
  } else {
    scheduleData = { ...SEED_DATA };
    localStorage.setItem("glp_schedule_data", JSON.stringify(scheduleData));
  }
  
  // Initial sync from remote
  syncFromRemote();
  
  // Real-time polling check (every 10 seconds)
  setInterval(syncFromRemote, 10000);
  
  // Sync when window becomes focused/visible
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncFromRemote();
    }
  });
}

// Fetch remote schedule changes
function syncFromRemote() {
  if (isSyncing) return;
  isSyncing = true;
  
  fetch(SYNC_URL)
    .then(res => {
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    })
    .then(remoteData => {
      const localStr = JSON.stringify(scheduleData);
      const remoteStr = JSON.stringify(remoteData);
      
      // Update only if data changed and remoteData is valid
      if (localStr !== remoteStr && remoteData && typeof remoteData === 'object' && !Array.isArray(remoteData)) {
        scheduleData = remoteData;
        localStorage.setItem("glp_schedule_data", remoteStr);
        
        // Re-render views
        renderPublicView();
        renderAd();
        
        if (isAdminLoggedIn && typeof renderCalendar === 'function') {
          renderCalendar();
          if (currentSelectedDate) {
            loadDayIntoEditor(currentSelectedDate);
          }
        }
        
        showToast("Cronograma actualizado en tiempo real 🔄");
      }
    })
    .catch(err => {
      console.error("Error during sync:", err);
    })
    .finally(() => {
      isSyncing = false;
    });
}

// Save schedule data locally and upload to remote JSON bin in real-time
function saveScheduleData() {
  const localStr = JSON.stringify(scheduleData);
  localStorage.setItem("glp_schedule_data", localStr);
  
  // Push to remote server
  fetch(SYNC_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: localStr
  })
  .then(res => {
    if (!res.ok) throw new Error("Remote save failed");
    return res.json();
  })
  .then(data => {
    console.log("Real-time sync complete:", data);
  })
  .catch(err => {
    console.error("Error syncing to server:", err);
    showToast("Error de sincronización con servidor", true);
  });
}

// ==========================================================================
// DATE & TIMER LOGIC (14:00 SWITCH)
// ==========================================================================
// Check current hour: if >= 14:00, active date is TOMORROW, otherwise TODAY.
// If the target date falls on Sunday, skip directly to Monday.
function getActiveDateInfo() {
  const now = new Date();
  const currentHour = now.getHours();
  
  // Set target date
  const targetDate = new Date(now);
  let isTomorrow = currentHour >= 14;
  
  if (isTomorrow) {
    targetDate.setDate(now.getDate() + 1);
  }
  
  // Skip Sunday (0) and go directly to Monday (1)
  if (targetDate.getDay() === 0) {
    targetDate.setDate(targetDate.getDate() + 1);
    isTomorrow = true;
  }
  
  return {
    date: targetDate,
    isTomorrow: isTomorrow
  };
}

// Timezone-safe date key formatting (YYYY-MM-DD)
function getDateKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Format date into Spanish string (e.g. "LUNES 3 DE AGOSTO 2026")
function formatSpanishDate(date) {
  const dayName = WEEKDAYS[date.getDay()];
  const dayNum = date.getDate();
  const monthName = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return `${dayName} ${dayNum} DE ${monthName} ${year}`;
}

// Format date into standard admin view title (e.g. "Lunes, 3 de Agosto")
function formatAdminDate(date) {
  const dayName = WEEKDAYS[date.getDay()].toLowerCase();
  const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
  const dayNum = date.getDate();
  const monthName = MONTHS[date.getMonth()].toLowerCase();
  return `${capitalizedDay}, ${dayNum} de ${monthName}`;
}

// ==========================================================================
// PUBLIC VIEW RENDERER
// ==========================================================================
// ==========================================================================
// PUBLIC VIEW RENDERER
// ==========================================================================
function getNextScheduledDate(fromDate) {
  const fromKey = getDateKey(fromDate);
  const sortedDates = Object.keys(scheduleData)
    .filter(key => {
      // Must have items
      if (!scheduleData[key] || scheduleData[key].length === 0) return false;
      // Must be after fromDate
      return key > fromKey;
    })
    .sort();
  
  if (sortedDates.length > 0) {
    const [y, m, d] = sortedDates[0].split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return null;
}

function renderPublicView() {
  const { date: defaultDate, isTomorrow: isDefaultTomorrow } = getActiveDateInfo();
  
  // If currentDisplayDate is not set, initialize it to the default active date
  if (!currentDisplayDate) {
    currentDisplayDate = defaultDate;
  }
  
  const dateKey = getDateKey(currentDisplayDate);
  const isDefaultActive = getDateKey(currentDisplayDate) === getDateKey(defaultDate);
  
  // Update header text
  document.getElementById("active-date-display").textContent = formatSpanishDate(currentDisplayDate);
  
  // Update status badge
  const indicatorText = document.getElementById("indicator-text");
  const scheduleIndicator = document.getElementById("schedule-indicator");
  
  if (isDefaultActive) {
    if (isDefaultTomorrow) {
      indicatorText.textContent = "Cronograma de Mañana (14:00+)";
      scheduleIndicator.classList.add("tomorrow");
      scheduleIndicator.style.borderColor = "rgba(249, 115, 22, 0.4)";
    } else {
      indicatorText.textContent = "Cronograma de Hoy";
      scheduleIndicator.classList.remove("tomorrow");
      scheduleIndicator.style.borderColor = "var(--glass-border)";
    }
  } else {
    // User navigated to a future date
    indicatorText.textContent = "Cronograma Futuro";
    scheduleIndicator.classList.add("tomorrow");
    scheduleIndicator.style.borderColor = "var(--color-flame-glow)";
  }
  
  // Update navigation buttons
  const btnStart = document.getElementById("btn-nav-start");
  const btnNext = document.getElementById("btn-nav-next");
  
  // 1. Return to start button
  if (!isDefaultActive) {
    btnStart.classList.remove("hidden");
  } else {
    btnStart.classList.add("hidden");
  }
  
  // 2. Next day button
  const nextDate = getNextScheduledDate(currentDisplayDate);
  if (nextDate) {
    btnNext.classList.remove("hidden");
  } else {
    btnNext.classList.add("hidden");
  }
  
  // Render barrios column
  const barriosListContainer = document.getElementById("barrios-list");
  barriosListContainer.innerHTML = "";
  
  // Remove existing size-specific classes
  barriosListContainer.classList.remove("count-1-3", "count-4-5", "count-6-7", "count-8-10");
  
  const barrios = scheduleData[dateKey] || [];
  
  if (barrios.length === 0) {
    // Render Empty State
    barriosListContainer.innerHTML = `
      <div class="no-schedule-box animate-pop">
        <div class="no-schedule-icon">🚚💤</div>
        <h3>Sin Distribución Programada</h3>
        <p>No se han registrado barrios de entrega para este día.</p>
      </div>
    `;
    return;
  }
  
  // Add correct dynamic shrinking class
  const count = barrios.length;
  if (count <= 3) {
    barriosListContainer.classList.add("count-1-3");
  } else if (count <= 5) {
    barriosListContainer.classList.add("count-4-5");
  } else if (count <= 7) {
    barriosListContainer.classList.add("count-6-7");
  } else {
    barriosListContainer.classList.add("count-8-10");
  }
  
  // Render column items
  barrios.forEach((barrio, idx) => {
    const item = document.createElement("div");
    item.className = "barrio-item";
    item.style.animationDelay = `${idx * 0.08}s`;
    
    item.innerHTML = `
      <span class="barrio-number">${idx + 1}</span>
      <span class="barrio-name">${barrio}</span>
    `;
    
    barriosListContainer.appendChild(item);
  });
}

// ==========================================================================
// MODALS CONTROLS & AUTHENTICATION
// ==========================================================================
function setupEventListeners() {
  const btnConfig = document.getElementById("btn-config");
  const pwdModal = document.getElementById("password-modal");
  const adminModal = document.getElementById("admin-modal");
  
  const btnClosePwd = document.getElementById("btn-close-pwd");
  const btnSubmitPwd = document.getElementById("btn-submit-pwd");
  const pwdInput = document.getElementById("admin-password");
  
  const btnCloseAdmin = document.getElementById("btn-close-admin");
  const btnLogout = document.getElementById("btn-logout");
  
  // Configuration FAB click
  btnConfig.addEventListener("click", () => {
    // Check if session storage indicates we are logged in
    if (sessionStorage.getItem("spc_admin_auth") === "true") {
      isAdminLoggedIn = true;
      openAdminPanel();
    } else {
      pwdModal.classList.remove("hidden");
      pwdInput.focus();
    }
  });
  
  // Password modal controls
  btnClosePwd.addEventListener("click", () => {
    pwdModal.classList.add("hidden");
    pwdInput.value = "";
    document.getElementById("pwd-error").classList.add("hidden");
  });
  
  btnSubmitPwd.addEventListener("click", handleLogin);
  pwdInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleLogin();
  });
  
  // Admin modal controls
  btnCloseAdmin.addEventListener("click", () => {
    adminModal.classList.add("hidden");
  });
  
  btnLogout.addEventListener("click", () => {
    isAdminLoggedIn = false;
    sessionStorage.removeItem("spc_admin_auth");
    adminModal.classList.add("hidden");
    showToast("Sesión cerrada");
  });
  
  // Calendar month navigation
  document.getElementById("prev-month").addEventListener("click", () => {
    changeMonth(-1);
  });
  document.getElementById("next-month").addEventListener("click", () => {
    changeMonth(1);
  });
  
  // Admin Editor controls
  document.getElementById("btn-save-day").addEventListener("click", saveSelectedDay);
  document.getElementById("btn-clear-all").addEventListener("click", clearEditorInputs);
  document.getElementById("btn-copy-prev").addEventListener("click", copyFromPreviousDay);
  
  // Backup controls
  document.getElementById("btn-export").addEventListener("click", exportSchedules);
  
  const importTrigger = document.getElementById("btn-import-trigger");
  const importFile = document.getElementById("import-file");
  importTrigger.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", importSchedules);
  
  // PWA Install Prompt Listener
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!sessionStorage.getItem('pwa_prompt_dismissed')) {
      showPwaInstallModal(false);
    }
  });
  
  // Setup custom PWA modal callbacks
  setupPwaInstallPrompt();
  
  // Setup Share button functionality
  setupShareButton();
  
  // Setup Date Navigation buttons
  setupDateNavigation();
  
  // Setup Download JPG button
  setupDownloadButton();

  // Save Ad Configuration control
  const btnSaveAd = document.getElementById("btn-save-ad");
  if (btnSaveAd) {
    btnSaveAd.addEventListener("click", saveAdConfig);
  }
}

// ==========================================================================
// DATE NAVIGATION & JPG DOWNLOAD LOGIC
// ==========================================================================
function setupDateNavigation() {
  const btnStart = document.getElementById("btn-nav-start");
  const btnNext = document.getElementById("btn-nav-next");
  
  btnStart.addEventListener("click", () => {
    const { date: defaultDate } = getActiveDateInfo();
    currentDisplayDate = defaultDate;
    renderPublicView();
    showToast("Volviendo al cronograma de hoy/mañana");
  });
  
  btnNext.addEventListener("click", () => {
    const nextDate = getNextScheduledDate(currentDisplayDate);
    if (nextDate) {
      currentDisplayDate = nextDate;
      renderPublicView();
    }
  });
}

function setupDownloadButton() {
  const btnDownload = document.getElementById("btn-download-jpg");
  btnDownload.addEventListener("click", () => {
    downloadCronogramaJpg();
  });
}

function downloadCronogramaJpg() {
  const target = document.querySelector(".app-container");
  const footer = document.querySelector(".app-footer");
  const downloadBtn = document.querySelector(".download-container");
  const navStart = document.getElementById("btn-nav-start");
  const navNext = document.getElementById("btn-nav-next");
  
  // Temporarily hide elements during screenshot
  if (footer) footer.style.display = "none";
  if (downloadBtn) downloadBtn.style.display = "none";
  if (navStart) navStart.style.display = "none";
  if (navNext) navNext.style.display = "none";
  
  showToast("Generando imagen JPG...");
  
  html2canvas(target, {
    backgroundColor: "#0b0f19",
    scale: 2.5, // High resolution capture
    useCORS: true,
    logging: false
  }).then(canvas => {
    // Restore element visibility
    if (footer) footer.style.display = "";
    if (downloadBtn) downloadBtn.style.display = "";
    if (navStart) navStart.style.display = "";
    if (navNext) navNext.style.display = "";
    
    // Create download link
    const link = document.createElement("a");
    const dateKey = getDateKey(currentDisplayDate);
    link.download = `cronograma_spc_${dateKey}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 0.95);
    link.click();
    
    showToast("Imagen descargada con éxito 📸");
  }).catch(err => {
    console.error("Error al generar imagen:", err);
    showToast("Error al generar la imagen", true);
    
    // Restore element visibility on error
    if (footer) footer.style.display = "";
    if (downloadBtn) downloadBtn.style.display = "";
    if (navStart) navStart.style.display = "";
    if (navNext) navNext.style.display = "";
  });
}

// ==========================================================================
// PWA & SHARING UTILITIES
// ==========================================================================
function showPwaInstallModal(isIos = false) {
  const pwaModal = document.getElementById("pwa-modal");
  const btnInstall = document.getElementById("btn-pwa-install");
  const iosInstruction = document.getElementById("ios-instruction");
  
  if (isIos) {
    iosInstruction.classList.remove("hidden");
    btnInstall.classList.add("hidden");
  } else {
    iosInstruction.classList.add("hidden");
    btnInstall.classList.remove("hidden");
  }
  
  pwaModal.classList.remove("hidden");
}

function setupPwaInstallPrompt() {
  const pwaModal = document.getElementById("pwa-modal");
  const btnCancel = document.getElementById("btn-pwa-cancel");
  const btnInstall = document.getElementById("btn-pwa-install");
  
  btnCancel.addEventListener("click", () => {
    pwaModal.classList.add("hidden");
    sessionStorage.setItem('pwa_prompt_dismissed', 'true');
  });
  
  btnInstall.addEventListener("click", () => {
    pwaModal.classList.add("hidden");
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the PWA install prompt');
        } else {
          console.log('User dismissed the PWA install prompt');
        }
        deferredPrompt = null;
      });
    }
  });
  
  // Detect iOS and display the instruction if not in standalone mode
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isIPadOS = navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  
  if ((isIOS || isIPadOS) && !isStandalone) {
    // Show iOS install suggestion after 3 seconds
    if (!sessionStorage.getItem('pwa_prompt_dismissed')) {
      setTimeout(() => {
        showPwaInstallModal(true);
      }, 3000);
    }
  }
}

function setupShareButton() {
  const btnShare = document.getElementById("btn-share");
  btnShare.addEventListener("click", () => {
    const shareData = {
      title: 'Cronograma de GLP - SPC',
      text: 'Consulta el cronograma de entrega de Gas Licuado de Petróleo de SPC.',
      url: window.location.origin + window.location.pathname
    };
    
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      navigator.share(shareData)
        .then(() => showToast("Enlace compartido con éxito"))
        .catch((err) => {
          if (err.name !== 'AbortError') {
            console.error('Error al compartir:', err);
          }
        });
    } else {
      // Fallback: Copy to clipboard
      navigator.clipboard.writeText(shareData.url)
        .then(() => showToast("Enlace copiado al portapapeles"))
        .catch(err => {
          console.error('Error al copiar enlace:', err);
          showToast("No se pudo copiar el enlace", true);
        });
    }
  });
}

// Authentication check
function handleLogin() {
  const pwdInput = document.getElementById("admin-password");
  const errorMsg = document.getElementById("pwd-error");
  
  if (pwdInput.value === "4206371Luis*") {
    // Success
    isAdminLoggedIn = true;
    sessionStorage.setItem("spc_admin_auth", "true");
    
    document.getElementById("password-modal").classList.add("hidden");
    pwdInput.value = "";
    errorMsg.classList.add("hidden");
    
    openAdminPanel();
    showToast("Acceso Concedido");
  } else {
    // Failed
    errorMsg.classList.remove("hidden");
    pwdInput.classList.add("animate-shake");
    setTimeout(() => pwdInput.classList.remove("animate-shake"), 400);
  }
}

// Open Admin Interface
function openAdminPanel() {
  document.getElementById("admin-modal").classList.remove("hidden");
  
  // Default to today/active date's month if calendar hasn't been set
  if (!currentSelectedDate) {
    const activeInfo = getActiveDateInfo();
    currentCalMonth = activeInfo.date.getMonth();
    currentCalYear = activeInfo.date.getFullYear();
    currentSelectedDate = activeInfo.date;
  }
  
  renderCalendar();
  loadDayIntoEditor(currentSelectedDate);
  loadAdIntoConfigurator(); // Populate ad config inputs
}

// ==========================================================================
// ADMIN CALENDAR RENDERER
// ==========================================================================
function renderCalendar() {
  const monthYearLabel = document.getElementById("calendar-month-year");
  const gridContainer = document.getElementById("calendar-grid-days");
  gridContainer.innerHTML = "";
  
  // Update header text (e.g. "Agosto 2026")
  const spanishMonthsCapitalized = MONTHS[currentCalMonth].toLowerCase();
  const formatMonth = spanishMonthsCapitalized.charAt(0).toUpperCase() + spanishMonthsCapitalized.slice(1);
  monthYearLabel.textContent = `${formatMonth} ${currentCalYear}`;
  
  // Calculate first day of the month and total days
  const firstDayIndex = new Date(currentCalYear, currentCalMonth, 1).getDay();
  const totalDays = new Date(currentCalYear, currentCalMonth + 1, 0).getDate();
  
  // Previous month total days to fill padding cells
  const prevMonthTotalDays = new Date(currentCalYear, currentCalMonth, 0).getDate();
  
  // Today's date logic
  const today = new Date();
  const todayKey = getDateKey(today);
  
  // 1. Render previous month padding cells
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dayNum = prevMonthTotalDays - i;
    const paddingCell = document.createElement("div");
    paddingCell.className = "calendar-day-cell other-month";
    paddingCell.textContent = dayNum;
    gridContainer.appendChild(paddingCell);
  }
  
  // 2. Render actual month days
  for (let d = 1; d <= totalDays; d++) {
    const cellDate = new Date(currentCalYear, currentCalMonth, d);
    const dateKey = getDateKey(cellDate);
    
    const dayCell = document.createElement("div");
    dayCell.className = "calendar-day-cell";
    dayCell.textContent = d;
    
    // Check if cell represents today
    if (dateKey === todayKey) {
      dayCell.classList.add("today");
    }
    
    // Check if cell is the currently selected date in editor
    if (currentSelectedDate && getDateKey(currentSelectedDate) === dateKey) {
      dayCell.classList.add("active-selected");
    }
    
    // Check if there are neighborhoods scheduled for this day
    const barriosForDay = scheduleData[dateKey] || [];
    if (barriosForDay.length > 0) {
      const badge = document.createElement("span");
      badge.className = "day-badge";
      dayCell.appendChild(badge);
    }
    
    // Setup cell click listener
    dayCell.addEventListener("click", () => {
      // Remove selected class from old selection
      const previousSelected = gridContainer.querySelector(".calendar-day-cell.active-selected");
      if (previousSelected) previousSelected.classList.remove("active-selected");
      
      dayCell.classList.add("active-selected");
      currentSelectedDate = cellDate;
      
      loadDayIntoEditor(cellDate);
    });
    
    gridContainer.appendChild(dayCell);
  }
  
  // 3. Render next month padding cells to complete a 42-cell calendar grid (6 rows)
  const totalRenderedCells = firstDayIndex + totalDays;
  const paddingNeeded = 42 - totalRenderedCells;
  for (let i = 1; i <= paddingNeeded; i++) {
    const paddingCell = document.createElement("div");
    paddingCell.className = "calendar-day-cell other-month";
    paddingCell.textContent = i;
    gridContainer.appendChild(paddingCell);
  }
}

// Handle Month Navigation
function changeMonth(direction) {
  currentCalMonth += direction;
  if (currentCalMonth < 0) {
    currentCalMonth = 11;
    currentCalYear--;
  } else if (currentCalMonth > 11) {
    currentCalMonth = 0;
    currentCalYear++;
  }
  renderCalendar();
}

// ==========================================================================
// ADMIN DAY EDITOR & AUTOCOMPLETE
// ==========================================================================
function loadDayIntoEditor(date) {
  if (!date) return;
  
  // Update header text for editor
  const dateTitle = document.getElementById("editor-date-title");
  dateTitle.textContent = formatAdminDate(date);
  
  // Enable editor container
  const formContainer = document.getElementById("editor-form-container");
  formContainer.classList.remove("disabled");
  
  // Show/Hide action buttons
  document.getElementById("btn-copy-prev").classList.remove("hidden");
  document.getElementById("btn-clear-all").classList.remove("hidden");
  document.getElementById("btn-save-day").removeAttribute("disabled");
  
  // Retrieve existing schedule
  const dateKey = getDateKey(date);
  const activeBarrios = scheduleData[dateKey] || [];
  
  // Generate inputs
  const inputsContainer = document.getElementById("neighborhoods-inputs-list");
  inputsContainer.innerHTML = "";
  
  // Always build exactly 10 rows
  for (let i = 0; i < 10; i++) {
    const value = activeBarrios[i] || "";
    
    const row = document.createElement("div");
    row.className = "input-row";
    row.innerHTML = `
      <span class="input-index">${i + 1}</span>
      <input type="text" id="input-barrio-${i}" placeholder="Escribe un barrio..." value="${value}" autocomplete="off">
    `;
    
    inputsContainer.appendChild(row);
    
    // Attach autocomplete
    setupAutocomplete(row.querySelector("input"), i);
  }
}

// Save neighborhoods for the selected day
function saveSelectedDay() {
  if (!currentSelectedDate) return;
  
  const dateKey = getDateKey(currentSelectedDate);
  const newBarrios = [];
  
  for (let i = 0; i < 10; i++) {
    const input = document.getElementById(`input-barrio-${i}`);
    if (input) {
      const val = input.value.trim().toUpperCase();
      if (val) {
        newBarrios.push(val);
      }
    }
  }
  
  if (newBarrios.length === 0) {
    // Delete entry if all empty
    delete scheduleData[dateKey];
  } else {
    scheduleData[dateKey] = newBarrios;
  }
  
  saveScheduleData();
  renderCalendar();
  renderPublicView(); // Refresh public display in case today/tomorrow was edited
  
  showToast("Cronograma guardado con éxito");
}

// Clear all input elements in the editor
function clearEditorInputs() {
  for (let i = 0; i < 10; i++) {
    const input = document.getElementById(`input-barrio-${i}`);
    if (input) input.value = "";
  }
  // Focus first input
  const first = document.getElementById("input-barrio-0");
  if (first) first.focus();
}

// Copy from previous day
function copyFromPreviousDay() {
  if (!currentSelectedDate) return;
  
  // Calculate previous day date key
  const prevDate = new Date(currentSelectedDate);
  prevDate.setDate(currentSelectedDate.getDate() - 1);
  const prevKey = getDateKey(prevDate);
  
  const previousBarrios = scheduleData[prevKey] || [];
  
  if (previousBarrios.length === 0) {
    showToast("No hay cronograma el día anterior para copiar", true);
    return;
  }
  
  // Fill inputs
  for (let i = 0; i < 10; i++) {
    const input = document.getElementById(`input-barrio-${i}`);
    if (input) {
      input.value = previousBarrios[i] || "";
    }
  }
  
  showToast(`Copiado desde ${formatAdminDate(prevDate)}`);
}

// Autocomplete logic for neighborhood inputs
function setupAutocomplete(inputElement, index) {
  // Add suggestion container inline
  let suggestionBox = null;
  
  inputElement.addEventListener("input", (e) => {
    const val = e.target.value.trim().toUpperCase();
    
    // Close existing box
    closeSuggestions();
    
    if (val.length < 2) return;
    
    // Extract unique neighborhood list from all saved schedules
    const allUniqueBarrios = new Set();
    Object.values(scheduleData).forEach(barriosArr => {
      barriosArr.forEach(b => allUniqueBarrios.add(b));
    });
    
    // Filter matches
    const matches = Array.from(allUniqueBarrios).filter(b => b.includes(val) && b !== val);
    
    if (matches.length === 0) return;
    
    // Create suggestion drop list
    suggestionBox = document.createElement("div");
    suggestionBox.className = "autocomplete-suggestions";
    
    matches.slice(0, 5).forEach(match => {
      const item = document.createElement("div");
      item.className = "suggestion-item";
      item.textContent = match;
      item.addEventListener("click", () => {
        inputElement.value = match;
        closeSuggestions();
        // Focus next input automatically for speed!
        const nextInput = document.getElementById(`input-barrio-${index + 1}`);
        if (nextInput) nextInput.focus();
      });
      suggestionBox.appendChild(item);
    });
    
    inputElement.parentNode.appendChild(suggestionBox);
  });
  
  // Close suggestion when clicking away or losing focus
  document.addEventListener("click", (e) => {
    if (suggestionBox && !inputElement.contains(e.target) && !suggestionBox.contains(e.target)) {
      closeSuggestions();
    }
  });
  
  inputElement.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSuggestions();
    }
  });
  
  function closeSuggestions() {
    if (suggestionBox) {
      suggestionBox.remove();
      suggestionBox = null;
    }
  }
}

// ==========================================================================
// DATA IMPORT / EXPORT BACKUPS
// ==========================================================================
function exportSchedules() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(scheduleData, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute("href", dataStr);
  dlAnchorElem.setAttribute("download", `respaldo_cronograma_glp_${getDateKey(new Date())}.json`);
  dlAnchorElem.click();
  showToast("Copia de seguridad exportada");
}

function importSchedules(event) {
  const fileInput = event.target;
  const file = fileInput.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsedData = JSON.parse(e.target.result);
      
      // Basic schema check
      if (typeof parsedData === 'object' && parsedData !== null && !Array.isArray(parsedData)) {
        // Merge or replace
        scheduleData = { ...scheduleData, ...parsedData };
        saveScheduleData();
        renderCalendar();
        renderPublicView();
        showToast("Datos importados exitosamente");
      } else {
        showToast("Formato de archivo inválido", true);
      }
    } catch (err) {
      console.error(err);
      showToast("Error al procesar el archivo JSON", true);
    }
  };
  reader.readAsText(file);
  fileInput.value = ""; // Reset file input
}

// ==========================================================================
// TOAST NOTIFICATIONS SYSTEM
// ==========================================================================
function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "toast"; // Reset classes
  
  if (isError) {
    toast.classList.add("error");
  }
  
  toast.classList.remove("hidden");
  
  // Clear any existing timeouts if possible, or just fade out
  setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

// ==========================================================================
// ADVERTISING LOGIC & CONFIGURATION
// ==========================================================================
function renderAd() {
  const adBanner = document.getElementById("ad-banner");
  const adLink = document.getElementById("ad-banner-link");
  const adContent = document.getElementById("ad-banner-content");
  
  const adConfig = scheduleData._ad_config;
  
  if (adConfig && adConfig.active && (adConfig.text || adConfig.imageUrl)) {
    // Set link
    if (adLink) {
      if (adConfig.link) {
        adLink.href = adConfig.link.startsWith("http") ? adConfig.link : "https://" + adConfig.link;
        adLink.style.pointerEvents = "auto";
      } else {
        adLink.removeAttribute("href");
        adLink.style.pointerEvents = "none";
      }
    }
    
    // Clear and build content dynamically for simplicity & reliability
    adContent.innerHTML = "";
    
    if (adConfig.imageUrl) {
      // Image Ad
      const img = document.createElement("img");
      img.className = "ad-banner-image";
      img.src = adConfig.imageUrl;
      img.alt = adConfig.text || "Anuncio Publicitario";
      adContent.appendChild(img);
    } else {
      // Text Ad
      const badge = document.createElement("span");
      badge.className = "ad-badge-tag";
      badge.textContent = "Anuncio";
      
      const txt = document.createElement("span");
      txt.className = "ad-banner-text";
      txt.id = "ad-banner-text";
      txt.textContent = adConfig.text;
      
      adContent.appendChild(badge);
      adContent.appendChild(txt);
    }
    
    adBanner.classList.remove("hidden");
  } else {
    adBanner.classList.add("hidden");
  }
}

function loadAdIntoConfigurator() {
  const adConfig = scheduleData._ad_config || { active: false, text: "", link: "", imageUrl: "" };
  const adEnable = document.getElementById("ad-enable");
  const adText = document.getElementById("ad-text");
  const adLink = document.getElementById("ad-link");
  const adImage = document.getElementById("ad-image");
  
  if (adEnable) adEnable.checked = !!adConfig.active;
  if (adText) adText.value = adConfig.text || "";
  if (adLink) adLink.value = adConfig.link || "";
  if (adImage) adImage.value = adConfig.imageUrl || "";
}

function saveAdConfig() {
  const adEnable = document.getElementById("ad-enable");
  const adText = document.getElementById("ad-text");
  const adLink = document.getElementById("ad-link");
  const adImage = document.getElementById("ad-image");
  
  const active = adEnable ? adEnable.checked : false;
  const text = adText ? adText.value.trim() : "";
  const link = adLink ? adLink.value.trim() : "";
  const imageUrl = adImage ? adImage.value.trim() : "";
  
  scheduleData._ad_config = {
    active,
    text,
    link,
    imageUrl
  };
  
  saveScheduleData();
  renderAd();
  showToast("Publicidad guardada y sincronizada 📣");
}
