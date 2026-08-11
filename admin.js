(function () {
  'use strict';

  /* =========================================================
     CONFIG
     ========================================================= */
  var CLIENT_COUNTRY_CODE = '52'; // Verifica el código de país antes de publicar.
  var TOKEN_KEY = 'anylashes_admin_token';

  var token = sessionStorage.getItem(TOKEN_KEY) || null;

  /* =========================================================
     HELPERS
     ========================================================= */
  // Solo se puede marcar "concluida" una vez que ya pasó la hora de la cita.
  // Se parsean fecha y hora a mano (en vez de "new Date('YYYY-MM-DDTHH:MM:00')")
  // porque si el string trae segundos u otro formato inesperado, ese parseo
  // puede devolver "Invalid Date" y entonces la comparación siempre da falso
  // (la cita "nunca pasa"), aunque sea de ayer.
  function hasAppointmentPassed(appt) {
    var dateParts = String(appt.date || '').split('-');
    if (dateParts.length !== 3) return false;
    var y = parseInt(dateParts[0], 10);
    var mo = parseInt(dateParts[1], 10) - 1;
    var d = parseInt(dateParts[2], 10);

    var timeParts = String(appt.time || '').split(':');
    var h = parseInt(timeParts[0], 10) || 0;
    var mi = parseInt(timeParts[1], 10) || 0;

    var dt = new Date(y, mo, d, h, mi, 0);
    if (isNaN(dt.getTime())) return false;
    return dt.getTime() <= Date.now();
  }
  function buildClientWhatsAppUrl(phoneDigits, message) {
    return 'https://wa.me/' + CLIENT_COUNTRY_CODE + phoneDigits + '?text=' + encodeURIComponent(message);
  }

  // Los modales (.modal-overlay, .login-screen, .photo-lightbox) se abren
  // con opacity/visibility + transición CSS. Justo al agregar "is-open",
  // sus hijos todavía no son enfocables — "visibility: hidden" no termina
  // de recalcularse en ese mismo tick, y un retraso fijo (requestAnimationFrame
  // o un setTimeout con un número mágico de ms) resultó poco confiable bajo
  // carga real de CPU. En vez de adivinar cuánto esperar, se pregunta de
  // verdad si el modal ya es visible (con un tope de intentos para no
  // quedar esperando para siempre si algo más impide abrirlo) y recién
  // entonces se mueve el foco. Sin esto, un usuario de teclado que abre un
  // modal a veces se queda con el foco en el botón que lo abrió.
  function focusAfterOpen(el, attemptsLeft) {
    if (!el) return;
    if (attemptsLeft === undefined) attemptsLeft = 30; // ~0.5s a 60fps como tope
    var modal = el.closest('.modal-overlay, .login-screen, .photo-lightbox');
    var isVisible = !modal || getComputedStyle(modal).visibility !== 'hidden';
    if (isVisible || attemptsLeft <= 0) {
      el.focus();
      return;
    }
    requestAnimationFrame(function () { focusAfterOpen(el, attemptsLeft - 1); });
  }

  // Foco atrapado dentro de un modal mientras está abierto: lo usan
  // confirmModal, apptFormModal y cualquier otro modal futuro, para no
  // repetir la misma lógica de Tab/Shift+Tab en cada uno.
  function getFocusable(container) {
    if (!container) return [];
    return Array.prototype.slice
      .call(container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'))
      .filter(function (el) { return el.offsetParent !== null; });
  }
  function trapTabKey(e, container) {
    if (e.key !== 'Tab') return false;
    var items = getFocusable(container);
    if (!items.length) return false;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
      return true;
    }
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  /* =========================================================
     LIGHTBOX — ampliar una foto de trabajo con un toque
     ========================================================= */
  var photoLightbox = document.getElementById('photoLightbox');
  var photoLightboxImg = document.getElementById('photoLightboxImg');
  var photoLightboxClose = document.getElementById('photoLightboxClose');
  var photoLightboxLastFocused = null;

  function openPhotoLightbox(url) {
    if (!photoLightbox || !photoLightboxImg) return;
    photoLightboxLastFocused = document.activeElement;
    photoLightboxImg.src = url;
    photoLightbox.classList.add('is-open');
    // El modal usa opacity/visibility con transición CSS: justo al agregar
    // "is-open" el navegador todavía puede no considerar su contenido
    // enfocable (visibility aún no recalculada), así que .focus() aquí
    // mismo no hace nada. requestAnimationFrame espera al siguiente pintado.
    focusAfterOpen(photoLightboxClose);
  }
  function closePhotoLightbox() {
    if (!photoLightbox || !photoLightbox.classList.contains('is-open')) return;
    photoLightbox.classList.remove('is-open');
    photoLightboxImg.removeAttribute('src');
    if (photoLightboxLastFocused && typeof photoLightboxLastFocused.focus === 'function') {
      photoLightboxLastFocused.focus();
    }
    photoLightboxLastFocused = null;
  }
  if (photoLightboxClose) photoLightboxClose.addEventListener('click', closePhotoLightbox);
  if (photoLightbox) {
    photoLightbox.addEventListener('click', function (e) {
      if (e.target === photoLightbox) closePhotoLightbox();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && photoLightbox && photoLightbox.classList.contains('is-open')) closePhotoLightbox();
  });

  /* =========================================================
     API
     ========================================================= */
  function isAuthError(res) {
    return !!(res && res.error && /sesión|no autorizado/i.test(res.error));
  }
  function authApiGet(params) {
    var withToken = Object.assign({}, params, { token: token });
    return apiGet(withToken).then(function (res) {
      if (isAuthError(res)) { showLogin(res.error); throw new Error(res.error); }
      return res;
    });
  }
  function authApiPost(payload) {
    var withToken = Object.assign({}, payload, { token: token });
    return apiPost(withToken).then(function (res) {
      if (isAuthError(res)) { showLogin(res.error); throw new Error(res.error); }
      return res;
    });
  }

  /* =========================================================
     TOAST
     ========================================================= */
  var toastEl = document.getElementById('adminToast');
  var toastTimer = null;
  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, 3800);
  }

  /* =========================================================
     LOGIN / SESIÓN
     La contraseña nunca vive en este archivo: se escribe una sola vez
     en el servidor (Apps Script) y aquí solo se envía lo que la dueña
     teclea para que el servidor la verifique. Lo único que queda en
     este navegador es un token temporal (vence solo en 6 horas).
     ========================================================= */
  var loginOverlay = document.getElementById('loginOverlay');
  var loginForm = document.getElementById('loginForm');
  var loginPassword = document.getElementById('loginPassword');
  var loginError = document.getElementById('loginError');
  var loginSubmitBtn = document.getElementById('loginSubmitBtn');
  var adminMain = document.getElementById('adminMain');
  var logoutBtn = document.getElementById('logoutBtn');
  var cleanupBtn = document.getElementById('cleanupBtn');

  function showApp() {
    loginOverlay.classList.remove('is-open');
    adminMain.hidden = false;
    logoutBtn.hidden = false;
    if (cleanupBtn) cleanupBtn.hidden = false;
    loadMonthData();
    if (scheduleDateInput) loadDaySchedule(scheduleDateInput.value);
    startHeartbeat();
    updateNotifyBtn();
  }

  var loginPanel = document.querySelector('.login-screen__panel');

  function shakeLoginPanel() {
    if (!loginPanel) return;
    loginPanel.classList.remove('is-shake');
    // eslint-disable-next-line no-unused-expressions
    loginPanel.offsetWidth; // fuerza reflow para poder repetir la animación
    loginPanel.classList.add('is-shake');
  }

  function showLogin(message) {
    token = null;
    sessionStorage.removeItem(TOKEN_KEY);
    adminMain.hidden = true;
    logoutBtn.hidden = true;
    if (notifyBtn) notifyBtn.hidden = true;
    if (cleanupBtn) cleanupBtn.hidden = true;
    loginOverlay.classList.add('is-open');
    stopHeartbeat();
    if (message) {
      loginError.textContent = message;
      loginError.hidden = false;
    } else {
      loginError.hidden = true;
    }
    loginPassword.value = '';
    // Diferido al siguiente pintado: si esta pantalla estaba cerrada (p.
    // ej. la sesión venció mientras se usaba el panel), classList.add
    // dispara la transición de opacity/visibility y .focus() en el mismo
    // tick todavía no encuentra el campo enfocable.
    focusAfterOpen(loginPassword);
  }

  /* =========================================================
     SONIDO — un "ding" breve generado con Web Audio (no necesita
     ningún archivo de audio). El navegador solo deja sonar audio
     libremente después de un primer gesto real del usuario, por eso
     el AudioContext se crea recién al iniciar sesión o al activar
     notificaciones (ambos son clics reales).
     ========================================================= */
  var audioCtx = null;
  function unlockAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { /* Web Audio no disponible */ }
  }
  function playChime() {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    var now = audioCtx.currentTime;
    [880, 1174.66].forEach(function (freq, i) {
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      var start = now + i * 0.16;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }

  /* =========================================================
     NOTIFICACIÓN DEL NAVEGADOR — se activa con un botón (gesto real
     del usuario); una vez concedida, funciona aunque el panel esté
     en otra pestaña o minimizado.
     ========================================================= */
  var notifyBtn = document.getElementById('notifyBtn');

  function updateNotifyBtn() {
    if (!notifyBtn || !('Notification' in window)) { if (notifyBtn) notifyBtn.hidden = true; return; }
    notifyBtn.hidden = Notification.permission === 'granted';
  }

  if (notifyBtn) {
    notifyBtn.addEventListener('click', function () {
      unlockAudio();
      playChime();
      if ('Notification' in window) {
        Notification.requestPermission().then(function () { updateNotifyBtn(); });
      }
    });
    updateNotifyBtn();
  }

  /* =========================================================
     LIMPIEZA DE CITAS ANTIGUAS — borra de verdad (backend) las citas
     de hace más de 2 meses. También corre sola cada mes (ver
     setupAppointmentCleanupTrigger en apps-script-code.gs); este botón
     es para forzarla al momento si hace falta.
     ========================================================= */
  if (cleanupBtn) {
    cleanupBtn.addEventListener('click', function () {
      openConfirmModal({
        title: '¿Limpiar citas antiguas?',
        text: 'Se eliminarán de verdad, de la base de datos, todas las citas con más de 2 meses de antigüedad. Esta acción no se puede deshacer.',
        confirmLabel: 'Sí, limpiar',
        onConfirm: function () {
          confirmModalConfirmBtn.disabled = true;
          authApiPost({ action: 'cleanupAppointments' }).then(function (res) {
            confirmModalConfirmBtn.disabled = false;
            closeConfirmModal();
            if (res.error) { showToast(res.error); return; }
            var n = res.deleted || 0;
            showToast(n === 0 ? 'No había citas antiguas por limpiar.' : n === 1 ? 'Se eliminó 1 cita antigua.' : 'Se eliminaron ' + n + ' citas antiguas.');
            loadMonthData();
          }).catch(function () {
            confirmModalConfirmBtn.disabled = false;
            showToast('No pudimos limpiar las citas antiguas. Intenta de nuevo.');
          });
        }
      });
    });
  }

  function notifyNewAppointment(diff) {
    playChime();
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        var n = new Notification('AnyLashes', {
          body: diff === 1 ? 'Se agendó una nueva cita.' : diff + ' citas nuevas agendadas.',
          icon: 'assets/AnyLashes-logo-HD-transparente.png'
        });
        n.onclick = function () { window.focus(); n.close(); };
      } catch (e) { /* algunos navegadores en escritorio sin permisos de SO lanzan error aquí */ }
    }
  }

  /* =========================================================
     NOTIFICACIÓN EN TIEMPO REAL — mientras haya sesión iniciada se
     pregunta cada 30 s si hay citas nuevas (una sola lectura muy
     liviana en el servidor); sigue funcionando aunque cambies de
     pestaña o minimices el navegador, para que el sonido/aviso te
     alcance igual. Solo se detiene al cerrar sesión.
     ========================================================= */
  var HEARTBEAT_INTERVAL_MS = 30000;
  var heartbeatTimer = null;
  var lastKnownAppointmentCount = null;

  function checkHeartbeat() {
    if (!token) return;
    authApiGet({ action: 'heartbeat' }).then(function (res) {
      if (!res || res.error) return;

      if (lastKnownAppointmentCount === null) {
        lastKnownAppointmentCount = res.count;
        return;
      }
      if (res.count > lastKnownAppointmentCount) {
        var diff = res.count - lastKnownAppointmentCount;
        lastKnownAppointmentCount = res.count;
        showToast(diff === 1 ? '✨ ¡Nueva cita agendada!' : '✨ ' + diff + ' citas nuevas agendadas.');
        notifyNewAppointment(diff);
        loadMonthData();
      } else {
        lastKnownAppointmentCount = res.count;
      }
    }).catch(function () { /* silencioso: se reintenta en el siguiente ciclo */ });
  }

  function startHeartbeat() {
    stopHeartbeat();
    lastKnownAppointmentCount = null;
    checkHeartbeat();
    heartbeatTimer = setInterval(checkHeartbeat, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    loginError.hidden = true;
    loginSubmitBtn.disabled = true;
    var originalHTML = loginSubmitBtn.innerHTML;
    loginSubmitBtn.innerHTML = 'Entrando…';

    apiPost({ action: 'login', password: loginPassword.value }).then(function (res) {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.innerHTML = originalHTML;

      if (res.error || !res.token) {
        loginError.textContent = res.error || 'No se pudo iniciar sesión.';
        loginError.hidden = false;
        shakeLoginPanel();
        loginPassword.value = '';
        loginPassword.focus();
        return;
      }

      token = res.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      unlockAudio();
      showApp();
    }).catch(function () {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.innerHTML = originalHTML;
      loginError.textContent = 'No pudimos conectar con el servidor. Intenta de nuevo.';
      loginError.hidden = false;
      shakeLoginPanel();
    });
  });

  logoutBtn.addEventListener('click', function () {
    if (token) apiPost({ action: 'logout', token: token }).catch(function () {});
    showLogin();
  });

  var togglePasswordBtn = document.getElementById('togglePassword');
  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', function () {
      var isVisible = loginPassword.type === 'text';
      loginPassword.type = isVisible ? 'password' : 'text';
      togglePasswordBtn.setAttribute('aria-pressed', String(!isVisible));
      togglePasswordBtn.setAttribute('aria-label', isVisible ? 'Mostrar contraseña' : 'Ocultar contraseña');
      togglePasswordBtn.innerHTML = '<svg class="icon icon--sm"><use href="#icon-' + (isVisible ? 'eye' : 'eye-off') + '"></use></svg>';
    });
  }

  /* =========================================================
     ESTADO DEL CALENDARIO
     ========================================================= */
  var today = new Date();
  var viewYear = today.getFullYear();
  var viewMonth = today.getMonth();
  var selectedDate = todayISO();
  var monthAppointments = [];
  var monthSchedule = {};

  var calendarTitle = document.getElementById('calendarTitle');
  var calendarGrid = document.getElementById('calendarGrid');
  var prevMonthBtn = document.getElementById('prevMonthBtn');
  var nextMonthBtn = document.getElementById('nextMonthBtn');
  var dayPanelTitle = document.getElementById('dayPanelTitle');
  var dayPanelList = document.getElementById('dayPanelList');

  function monthRange(year, month) {
    var from = year + '-' + pad2(month + 1) + '-01';
    var lastDay = new Date(year, month + 1, 0).getDate();
    var to = year + '-' + pad2(month + 1) + '-' + pad2(lastDay);
    return { from: from, to: to };
  }

  // Una sola llamada por mes visible: trae citas + horarios de ese rango
  // y de ahí se pintan tanto el calendario como el panel del día — así
  // evitamos disparar una petición nueva por cada clic en un día.
  function loadMonthData() {
    if (!token) return;
    var range = monthRange(viewYear, viewMonth);

    Promise.all([
      authApiGet({ action: 'appointments', dateFrom: range.from, dateTo: range.to }),
      authApiGet({ action: 'schedule', dateFrom: range.from, dateTo: range.to })
    ]).then(function (results) {
      monthAppointments = (results[0] && results[0].appointments) || [];
      monthSchedule = (results[1] && results[1].schedule) || {};
      drawCalendarGrid();
      renderDayPanel(selectedDate);
    }).catch(function () {
      showToast('No pudimos cargar el calendario. Intenta de nuevo.');
    });
  }

  function countConfirmed(dateStr) {
    return monthAppointments.filter(function (a) { return a.date === dateStr && a.status !== 'cancelled'; }).length;
  }

  function drawCalendarGrid() {
    if (!calendarGrid) return;
    calendarTitle.textContent = MONTHS_ES[viewMonth] + ' ' + viewYear;

    var firstOfMonth = new Date(viewYear, viewMonth, 1);
    var leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // lunes = 0
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    calendarGrid.innerHTML = '';

    for (var i = 0; i < leadingBlanks; i++) {
      var blank = document.createElement('div');
      blank.className = 'calendar-day is-empty';
      calendarGrid.appendChild(blank);
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = viewYear + '-' + pad2(viewMonth + 1) + '-' + pad2(day);
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'calendar-day';
      cell.setAttribute('data-date', dateStr);

      if (dateStr === todayISO()) cell.classList.add('is-today');
      if (dateStr === selectedDate) cell.classList.add('is-selected');

      var apptCount = countConfirmed(dateStr);
      var hasSchedule = (monthSchedule[dateStr] || []).length > 0;

      var dayNum = document.createElement('span');
      dayNum.textContent = day;
      cell.appendChild(dayNum);

      var dots = document.createElement('span');
      dots.className = 'calendar-day__dots';
      if (apptCount > 0) {
        var maxDots = Math.min(apptCount, 3);
        for (var d = 0; d < maxDots; d++) {
          var dot = document.createElement('span');
          dot.className = 'calendar-day__dot calendar-day__dot--busy';
          dots.appendChild(dot);
        }
      } else if (hasSchedule) {
        var openDot = document.createElement('span');
        openDot.className = 'calendar-day__dot calendar-day__dot--open';
        dots.appendChild(openDot);
      }
      cell.appendChild(dots);

      cell.addEventListener('click', function () {
        selectedDate = this.getAttribute('data-date');
        drawCalendarGrid();
        renderDayPanel(selectedDate);
      });

      calendarGrid.appendChild(cell);
    }
  }

  function renderDayPanel(dateStr) {
    if (!dayPanelTitle || !dayPanelList) return;
    dayPanelTitle.textContent = formatDateEs(dateStr);

    var appts = monthAppointments
      .filter(function (a) { return a.date === dateStr; })
      .sort(function (a, b) { return a.time.localeCompare(b.time); });

    if (!appts.length) {
      dayPanelList.innerHTML = '<p class="slots__empty">No hay citas registradas este día.</p>';
      return;
    }

    dayPanelList.innerHTML = '';
    appts.forEach(function (appt) {
      var statusLabel = appt.status === 'cancelled' ? 'Cancelada' : appt.status === 'completed' ? 'Concluida' : 'Confirmada';
      var card = document.createElement('div');
      card.className = 'appt-card is-' + appt.status;

      card.innerHTML =
        '<div class="appt-card__header">' +
          '<span class="appt-card__time"><svg class="icon icon--sm"><use href="#icon-clock"></use></svg>' + escapeHtml(appt.time) + '</span>' +
          '<span class="appt-card__status">' + statusLabel + '</span>' +
          '<button type="button" class="appt-card__toggle" aria-label="Contraer detalles de la cita" aria-expanded="true">' +
            '<svg class="icon icon--sm"><use href="#icon-chevron-down"></use></svg>' +
          '</button>' +
        '</div>';

      // El contenido queda desplegado (visible) por defecto; el botón de
      // la cabecera hace lo contrario: lo contrae para ver más citas de
      // un vistazo en días con mucha actividad.
      var content = document.createElement('div');
      content.className = 'appt-card__content';

      var body = document.createElement('div');
      body.className = 'appt-card__body';
      body.innerHTML =
        '<span class="appt-card__row appt-card__row--name"><svg class="icon"><use href="#icon-user"></use></svg>' + escapeHtml(appt.clientName || 'Sin nombre') + '</span>' +
        '<span class="appt-card__row"><svg class="icon"><use href="#icon-phone"></use></svg>' + escapeHtml(appt.clientPhone || 'Sin teléfono') + '</span>' +
        '<span class="appt-card__row"><svg class="icon"><use href="#icon-calendar"></use></svg>' + escapeHtml(appt.service) + ' — ' + escapeHtml(appt.style) + '</span>';
      content.appendChild(body);

      var toggleBtn = card.querySelector('.appt-card__toggle');
      toggleBtn.addEventListener('click', function () {
        var collapsed = card.classList.toggle('is-collapsed');
        toggleBtn.setAttribute('aria-expanded', String(!collapsed));
        toggleBtn.setAttribute('aria-label', collapsed ? 'Desplegar detalles de la cita' : 'Contraer detalles de la cita');
      });

      var actions = document.createElement('div');
      actions.className = 'appt-card__actions';

      if (appt.status === 'confirmed') {
        var completeBtn = document.createElement('button');
        completeBtn.type = 'button';
        completeBtn.className = 'btn btn--outline btn--sm';
        completeBtn.textContent = 'Marcar concluida';
        if (!hasAppointmentPassed(appt)) {
          completeBtn.disabled = true;
          completeBtn.title = 'Podrás marcarla concluida cuando llegue la hora de la cita.';
        }
        completeBtn.addEventListener('click', function () {
          completeBtn.disabled = true;
          var originalLabel = completeBtn.textContent;
          completeBtn.textContent = 'Guardando…';
          authApiPost({ action: 'complete', id: appt.id }).then(function (res) {
            if (res.error) {
              completeBtn.disabled = false;
              completeBtn.textContent = originalLabel;
              showToast(res.error);
              return;
            }
            appt.status = 'completed';
            loadMonthData();
            showToast('Cita marcada como concluida.');
          }).catch(function () {
            completeBtn.disabled = false;
            completeBtn.textContent = originalLabel;
            showToast('No pudimos actualizar la cita. Intenta de nuevo.');
          });
        });

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn--danger btn--sm';
        cancelBtn.textContent = 'Cancelar cita';
        cancelBtn.addEventListener('click', function () { openCancelModal(appt); });

        actions.appendChild(completeBtn);
        actions.appendChild(cancelBtn);
      }

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn--outline btn--sm';
      editBtn.innerHTML = '<svg class="icon icon--sm"><use href="#icon-edit"></use></svg>Editar / reprogramar';
      editBtn.addEventListener('click', function () { openApptFormModal('edit', appt); });
      actions.appendChild(editBtn);

      content.appendChild(actions);

      content.appendChild(buildNotesBlock(appt));
      if (appt.status !== 'cancelled' && hasAppointmentPassed(appt)) {
        content.appendChild(buildPhotoBlock(appt));
      }
      card.appendChild(content);
      dayPanelList.appendChild(card);
    });
  }

  // Pulso visual breve para confirmar que un cambio (foto guardada o
  // eliminada) sí quedó reflejado en pantalla.
  function flashSaved(el) {
    el.classList.remove('is-saved');
    void el.offsetWidth; // reinicia la animación si se dispara dos veces seguidas
    el.classList.add('is-saved');
    setTimeout(function () { el.classList.remove('is-saved'); }, 900);
  }

  // Comprime y reescala la foto en el navegador antes de subirla, para
  // que la petición sea rápida y no gaste espacio de más en Drive.
  function compressImage(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
            else { w = Math.round(w * maxDim / h); h = maxDim; }
          }
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = function () { reject(new Error('No se pudo leer la imagen.')); };
        img.src = e.target.result;
      };
      reader.onerror = function () { reject(new Error('No se pudo leer el archivo.')); };
      reader.readAsDataURL(file);
    });
  }

  /* Foto del trabajo terminado (al final de cada cita, una vez que ya
     pasó su hora): se comprime en el navegador y se sube a Drive a
     través del backend; queda guardada junto a la cita. Si ya había
     una foto, se muestra con opción de cambiarla o eliminarla de
     verdad (Drive + base de datos). */
  function buildPhotoBlock(appt) {
    var wrap = document.createElement('div');
    wrap.className = 'appt-card__photo';

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.hidden = true;

    var frame = document.createElement('div');
    frame.className = 'appt-card__photo-frame';
    frame.hidden = !appt.photoUrl;

    var preview = document.createElement('img');
    preview.className = 'appt-card__photo-preview';
    preview.alt = 'Foto del trabajo terminado';
    preview.loading = 'lazy';
    preview.decoding = 'async';

    var skeleton = document.createElement('div');
    skeleton.className = 'appt-card__photo-skeleton';

    var zoomHint = document.createElement('div');
    zoomHint.className = 'appt-card__photo-zoom-hint';
    zoomHint.innerHTML = '<svg class="icon"><use href="#icon-zoom"></use></svg>';

    frame.appendChild(preview);
    frame.appendChild(skeleton);
    frame.appendChild(zoomHint);

    function showPhotoError() {
      frame.querySelectorAll('.appt-card__photo-error').forEach(function (n) { n.remove(); });
      skeleton.hidden = true;
      preview.hidden = true;
      var err = document.createElement('div');
      err.className = 'appt-card__photo-error';
      err.innerHTML = '<svg class="icon"><use href="#icon-image-off"></use></svg>' +
        '<span>No se pudo cargar la foto</span>' +
        '<button type="button">Reintentar</button>';
      err.querySelector('button').addEventListener('click', function () { renderPreview(appt.photoUrl); });
      frame.appendChild(err);
    }

    function renderPreview(url) {
      frame.querySelectorAll('.appt-card__photo-error').forEach(function (n) { n.remove(); });
      if (!url) { frame.hidden = true; return; }
      frame.hidden = false;
      skeleton.hidden = false;
      preview.hidden = false;
      preview.classList.remove('is-loaded');
      preview.onload = function () {
        skeleton.hidden = true;
        preview.classList.add('is-loaded');
      };
      loadPhotoWithFallback(preview, url, showPhotoError);
    }
    renderPreview(appt.photoUrl);

    frame.addEventListener('click', function () {
      if (appt.photoUrl && preview.classList.contains('is-loaded')) openPhotoLightbox(preview.src);
    });

    var actions = document.createElement('div');
    actions.className = 'appt-card__photo-actions';

    var uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'btn btn--text appt-card__photo-toggle';

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn--text appt-card__photo-delete';
    deleteBtn.innerHTML = '<svg class="icon icon--sm"><use href="#icon-close"></use></svg>Eliminar foto';
    deleteBtn.hidden = !appt.photoUrl;

    function setUploadIdle() {
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = '<svg class="icon icon--sm"><use href="#icon-camera"></use></svg>' +
        (appt.photoUrl ? 'Cambiar foto' : 'Guardar foto del trabajo');
    }
    setUploadIdle();

    uploadBtn.addEventListener('click', function () { input.click(); });

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;

      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Subiendo…';

      var pendingDataUrl = null;
      compressImage(file, 1600, 0.82).then(function (dataUrl) {
        pendingDataUrl = dataUrl;
        return authApiPost({
          action: 'uploadWork',
          appointmentId: appt.id,
          imageData: dataUrl,
          mimeType: 'image/jpeg'
        });
      }).then(function (res) {
        if (res.error) {
          setUploadIdle();
          showToast(res.error);
          return;
        }
        appt.photoUrl = res.url || pendingDataUrl;
        renderPreview(appt.photoUrl);
        deleteBtn.hidden = false;
        setUploadIdle();
        flashSaved(wrap);
        showToast('Foto guardada. Ya aparecerá en "Últimos trabajos" del sitio.');
      }).catch(function () {
        setUploadIdle();
        showToast('No pudimos subir la foto. Intenta de nuevo.');
      });
    });

    deleteBtn.addEventListener('click', function () {
      openConfirmModal({
        title: '¿Eliminar esta foto?',
        text: 'Se eliminará de verdad de Drive y de la base de datos. Esta acción no se puede deshacer.',
        confirmLabel: 'Sí, eliminar foto',
        onConfirm: function () {
          confirmModalConfirmBtn.disabled = true;
          authApiPost({ action: 'deleteWork', appointmentId: appt.id }).then(function (res) {
            confirmModalConfirmBtn.disabled = false;
            closeConfirmModal();
            if (res.error) { showToast(res.error); return; }
            appt.photoUrl = null;
            renderPreview(null);
            deleteBtn.hidden = true;
            setUploadIdle();
            flashSaved(wrap);
            showToast('Foto eliminada.');
          }).catch(function () {
            confirmModalConfirmBtn.disabled = false;
            showToast('No pudimos eliminar la foto. Intenta de nuevo.');
          });
        }
      });
    });

    actions.appendChild(uploadBtn);
    actions.appendChild(deleteBtn);
    wrap.appendChild(frame);
    wrap.appendChild(actions);
    wrap.appendChild(input);
    return wrap;
  }

  /* Bloque de notas (extra): un texto libre por cita, opcional, que se
     guarda en el servidor junto con la cita. */
  function buildNotesBlock(appt) {
    var wrap = document.createElement('div');
    wrap.className = 'appt-card__notes';

    var noteText = document.createElement('p');
    noteText.className = 'appt-card__note-text';
    noteText.textContent = appt.notes || '';
    noteText.hidden = !appt.notes;

    var toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn--text appt-card__note-toggle';
    toggleBtn.innerHTML = '<svg class="icon icon--sm"><use href="#icon-note"></use></svg>' + (appt.notes ? 'Editar nota' : 'Agregar nota');

    var editor = document.createElement('div');
    editor.className = 'appt-card__note-editor';
    editor.hidden = true;

    var textarea = document.createElement('textarea');
    textarea.rows = 2;
    textarea.maxLength = 500;
    textarea.placeholder = 'Ej. Le gusta el efecto Cat Eye, alérgica al látex…';
    textarea.value = appt.notes || '';

    var editorActions = document.createElement('div');
    editorActions.className = 'appt-card__note-editor-actions';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn--primary btn--sm';
    saveBtn.textContent = 'Guardar nota';

    var cancelEditBtn = document.createElement('button');
    cancelEditBtn.type = 'button';
    cancelEditBtn.className = 'btn btn--ghost btn--sm';
    cancelEditBtn.textContent = 'Cancelar';

    editorActions.appendChild(cancelEditBtn);
    editorActions.appendChild(saveBtn);
    editor.appendChild(textarea);
    editor.appendChild(editorActions);

    toggleBtn.addEventListener('click', function () {
      editor.hidden = false;
      toggleBtn.hidden = true;
      textarea.focus();
    });
    cancelEditBtn.addEventListener('click', function () {
      textarea.value = appt.notes || '';
      editor.hidden = true;
      toggleBtn.hidden = false;
    });
    saveBtn.addEventListener('click', function () {
      saveBtn.disabled = true;
      var value = textarea.value.trim();
      authApiPost({ action: 'saveNote', id: appt.id, note: value }).then(function (res) {
        saveBtn.disabled = false;
        if (res.error) { showToast(res.error); return; }
        appt.notes = value;
        noteText.textContent = value;
        noteText.hidden = !value;
        toggleBtn.innerHTML = '<svg class="icon icon--sm"><use href="#icon-note"></use></svg>' + (value ? 'Editar nota' : 'Agregar nota');
        editor.hidden = true;
        toggleBtn.hidden = false;
        showToast('Nota guardada.');
      }).catch(function () {
        saveBtn.disabled = false;
        showToast('No pudimos guardar la nota. Intenta de nuevo.');
      });
    });

    wrap.appendChild(noteText);
    wrap.appendChild(toggleBtn);
    wrap.appendChild(editor);
    return wrap;
  }

  if (prevMonthBtn) {
    prevMonthBtn.addEventListener('click', function () {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      loadMonthData();
    });
  }
  if (nextMonthBtn) {
    nextMonthBtn.addEventListener('click', function () {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      loadMonthData();
    });
  }

  /* =========================================================
     MODAL DE CONFIRMACIÓN — genérico: se reusa para cancelar cita y
     para eliminar una foto guardada.
     ========================================================= */
  var confirmModal = document.getElementById('confirmModal');
  var confirmModalTitle = document.getElementById('confirmModalTitle');
  var confirmModalText = document.getElementById('confirmModalText');
  var confirmModalDismiss = document.getElementById('confirmModalDismiss');
  var confirmModalConfirmBtn = document.getElementById('confirmModalConfirm');
  var pendingConfirmAction = null;
  var confirmModalLastFocused = null;

  function openConfirmModal(opts) {
    confirmModalLastFocused = document.activeElement;
    confirmModalTitle.textContent = opts.title;
    confirmModalText.textContent = opts.text;
    confirmModalConfirmBtn.textContent = opts.confirmLabel;
    pendingConfirmAction = opts.onConfirm;
    confirmModal.classList.add('is-open');
    // Enfoca "No, mantener" por defecto: así un Enter accidental no
    // dispara la acción destructiva (cancelar cita / borrar foto). Se
    // difiere al siguiente pintado por la misma razón que en el lightbox:
    // justo al abrir, la visibilidad del modal todavía no se recalculó.
    focusAfterOpen(confirmModalDismiss);
  }
  function closeConfirmModal() {
    if (!confirmModal.classList.contains('is-open')) return;
    confirmModal.classList.remove('is-open');
    pendingConfirmAction = null;
    if (confirmModalLastFocused && typeof confirmModalLastFocused.focus === 'function') {
      confirmModalLastFocused.focus();
    }
    confirmModalLastFocused = null;
  }
  if (confirmModalDismiss) confirmModalDismiss.addEventListener('click', closeConfirmModal);
  if (confirmModal) {
    confirmModal.addEventListener('click', function (e) {
      if (e.target === confirmModal) closeConfirmModal();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (!confirmModal.classList.contains('is-open')) return;
    if (e.key === 'Escape') {
      closeConfirmModal();
      return;
    }
    trapTabKey(e, confirmModal);
  });
  if (confirmModalConfirmBtn) {
    confirmModalConfirmBtn.addEventListener('click', function () {
      if (pendingConfirmAction) pendingConfirmAction();
    });
  }

  function openCancelModal(appt) {
    openConfirmModal({
      title: '¿Cancelar esta cita?',
      text: '¿Seguro que quieres cancelar la cita de ' + (appt.clientName || 'este cliente') +
        ' el ' + formatDateEs(appt.date) + ' a las ' + appt.time + '? Se notificará por WhatsApp automáticamente.',
      confirmLabel: 'Sí, cancelar cita',
      onConfirm: function () {
        // Se abre la pestaña en blanco YA, dentro del clic, para que el
        // navegador no la bloquee cuando la redirijamos tras la respuesta.
        var whatsappTab = openPendingTab();
        confirmModalConfirmBtn.disabled = true;

        authApiPost({ action: 'cancel', id: appt.id }).then(function (res) {
          confirmModalConfirmBtn.disabled = false;

          if (res.error) {
            if (whatsappTab) whatsappTab.close();
            showToast(res.error);
            return;
          }

          closeConfirmModal();
          loadMonthData();

          var cancelled = res.appointment;
          if (cancelled && cancelled.clientPhone) {
            var message = 'Hola ' + (cancelled.clientName || '') + ', te escribimos de AnyLashes. ' +
              'Lamentamos informarte que tu cita del ' + formatDateEs(cancelled.date) + ' a las ' + cancelled.time +
              ' ha sido cancelada. Contáctanos para reagendar cuando gustes. — AnyLashes';
            if (whatsappTab) whatsappTab.location.href = buildClientWhatsAppUrl(cancelled.clientPhone, message);
            showToast('Cita cancelada. Se abrió WhatsApp para notificar a ' + (cancelled.clientName || 'la clienta') + '.');
          } else {
            if (whatsappTab) whatsappTab.close();
            showToast('Cita cancelada (sin teléfono registrado para notificar).');
          }
        }).catch(function () {
          confirmModalConfirmBtn.disabled = false;
          if (whatsappTab) whatsappTab.close();
          showToast('No pudimos cancelar la cita. Intenta de nuevo.');
        });
      }
    });
  }

  /* =========================================================
     FORMULARIO DE CITA — un solo modal para "Nueva cita" (creada por la
     administradora) y "Editar / reprogramar" una cita existente. Llama a
     createAdminAppointment o updateAppointment según el modo, que en el
     servidor comparten toda la validación con la reservación pública
     (mismos mensajes de error, mismo cálculo de traslapes).
     ========================================================= */
  var newApptBtn = document.getElementById('newApptBtn');
  var apptFormModal = document.getElementById('apptFormModal');
  var apptFormTitle = document.getElementById('apptFormTitle');
  var apptForm = document.getElementById('apptForm');
  var apptFormIdInput = document.getElementById('apptFormId');
  var apptFormName = document.getElementById('apptFormName');
  var apptFormPhone = document.getElementById('apptFormPhone');
  var apptFormEmail = document.getElementById('apptFormEmail');
  var apptFormStatus = document.getElementById('apptFormStatus');
  var apptFormService = document.getElementById('apptFormService');
  var apptFormStyle = document.getElementById('apptFormStyle');
  var apptFormDate = document.getElementById('apptFormDate');
  var apptFormSlotsWrap = document.getElementById('apptFormSlots');
  var apptFormTimeInput = document.getElementById('apptFormTime');
  var apptFormNotes = document.getElementById('apptFormNotes');
  var apptFormFeedback = document.getElementById('apptFormFeedback');
  var apptFormCancelBtn = document.getElementById('apptFormCancelBtn');
  var apptFormSubmitBtn = document.getElementById('apptFormSubmitBtn');

  var apptFormMode = 'create'; // 'create' | 'edit'
  var apptFormEditingId = null;
  var apptFormLastFocused = null;
  var apptFormDirty = false;
  var apptFormSlotsRequestToken = 0; // descarta respuestas de slots que ya no aplican
  var apptFormOriginalTime = null; // hora que ya tenía la cita, en modo "edit"
  var apptFormAutoSelectPending = false; // se consume en el primer render de horarios

  function markDirty() { apptFormDirty = true; }

  function clearApptFormErrors() {
    if (!apptForm) return;
    apptForm.querySelectorAll('.field.has-error').forEach(function (f) { f.classList.remove('has-error'); });
  }
  function markApptFormError(el, condition) {
    var field = el.closest('.field');
    if (!field) return false;
    field.classList.toggle('has-error', !!condition);
    return !!condition;
  }

  function renderApptFormSlots(times, booked, isToday, nowStr) {
    if (!apptFormSlotsWrap) return;
    apptFormTimeInput.value = '';
    if (!times.length) {
      apptFormSlotsWrap.innerHTML = '<p class="slots__empty">No hay horarios disponibles este día para este servicio.</p>';
      return;
    }
    apptFormSlotsWrap.innerHTML = '';
    times.slice().sort().forEach(function (time) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var isPast = isToday && time <= nowStr;
      var isBooked = booked.indexOf(time) !== -1;
      if (isPast || isBooked) {
        btn.className = 'slot-btn';
        btn.disabled = true;
        btn.title = isPast ? 'Ya pasó esta hora' : 'Este horario ya está ocupado';
        btn.textContent = time;
      } else {
        btn.className = 'slot-btn';
        btn.textContent = time;
        btn.addEventListener('click', function () {
          apptFormSlotsWrap.querySelectorAll('.slot-btn').forEach(function (b) { b.classList.remove('is-selected'); });
          btn.classList.add('is-selected');
          apptFormTimeInput.value = time;
          markApptFormError(apptFormTimeInput, false);
          markDirty();
        });
        // Al abrir "Editar / reprogramar", la hora que ya tenía la cita se
        // deja preseleccionada (solo la primera vez que se pintan los
        // horarios) — si no, guardar sin tocar el horario fallaba la
        // validación de "elige un horario" aunque la cita ya tuviera uno.
        if (apptFormAutoSelectPending && time === apptFormOriginalTime) {
          btn.classList.add('is-selected');
          apptFormTimeInput.value = time;
        }
      }
      apptFormSlotsWrap.appendChild(btn);
    });
    apptFormAutoSelectPending = false;
  }

  // Se vuelve a pedir disponibilidad cada vez que cambia el servicio o la
  // fecha (la duración del servicio puede cambiar qué horarios se
  // traslaparían), y al reprogramar se excluye la propia cita para que su
  // horario actual no aparezca como "ocupado" contra sí misma.
  function fetchApptFormSlots() {
    var date = apptFormDate.value;
    var service = apptFormService.value;
    if (!apptFormSlotsWrap) return;
    if (!date || !service) {
      apptFormSlotsWrap.innerHTML = '<p class="slots__empty">Elige primero servicio y fecha para ver los horarios disponibles.</p>';
      apptFormTimeInput.value = '';
      return;
    }
    apptFormSlotsWrap.innerHTML = '<p class="slots__empty">Cargando horarios…</p>';
    var requestToken = ++apptFormSlotsRequestToken;
    var params = { action: 'slots', date: date, service: service };
    if (apptFormMode === 'edit' && apptFormEditingId) params.excludeId = apptFormEditingId;

    apiGet(params).then(function (res) {
      if (requestToken !== apptFormSlotsRequestToken) return; // llegó tarde: ya no aplica
      if (res.error) {
        apptFormSlotsWrap.innerHTML = '<p class="slots__empty slots__empty--error">No pudimos cargar los horarios. Intenta de nuevo.</p>';
        return;
      }
      var isToday = date === todayISO();
      renderApptFormSlots(res.times || [], res.booked || [], isToday, nowHHMM());
    }).catch(function () {
      if (requestToken !== apptFormSlotsRequestToken) return;
      apptFormSlotsWrap.innerHTML = '<p class="slots__empty slots__empty--error">No pudimos conectar. Intenta de nuevo.</p>';
    });
  }

  function resetApptForm() {
    apptForm.reset();
    apptFormIdInput.value = '';
    apptFormTimeInput.value = '';
    clearApptFormErrors();
    if (apptFormFeedback) apptFormFeedback.textContent = '';
    if (apptFormSlotsWrap) apptFormSlotsWrap.innerHTML = '<p class="slots__empty">Elige primero servicio y fecha para ver los horarios disponibles.</p>';
    apptFormDirty = false;
  }

  function openApptFormModal(mode, appt, openerEl) {
    if (!apptFormModal) return;
    apptFormMode = mode;
    apptFormEditingId = appt ? appt.id : null;
    apptFormLastFocused = openerEl || document.activeElement;
    apptFormOriginalTime = (mode === 'edit' && appt) ? appt.time : null;
    apptFormAutoSelectPending = mode === 'edit';
    resetApptForm();

    if (mode === 'edit' && appt) {
      apptFormTitle.textContent = 'Editar / reprogramar cita';
      apptFormSubmitBtn.textContent = 'Guardar cambios';
      apptFormIdInput.value = appt.id;
      apptFormName.value = appt.clientName || '';
      apptFormPhone.value = appt.clientPhone || '';
      apptFormEmail.value = appt.clientEmail || '';
      apptFormStatus.value = appt.status || 'confirmed';
      apptFormService.value = appt.service || '';
      apptFormStyle.value = appt.style || '';
      apptFormDate.value = appt.date || '';
      apptFormNotes.value = appt.notes || '';
    } else {
      apptFormTitle.textContent = 'Nueva cita';
      apptFormSubmitBtn.textContent = 'Guardar cita';
      apptFormStatus.value = 'confirmed';
      // Si ya había un día seleccionado en el calendario y no es pasado,
      // se usa como punto de partida — ahorra un clic en el caso común de
      // "agregar una cita al día que ya estoy viendo".
      apptFormDate.value = (selectedDate && selectedDate >= todayISO()) ? selectedDate : todayISO();
    }
    apptFormDate.min = todayISO();

    apptFormModal.classList.add('is-open');
    if (apptFormMode === 'edit' || apptFormService.value) fetchApptFormSlots();
    apptFormDirty = false; // el prefill de "edit" no cuenta como cambio del usuario
    // Diferido al siguiente pintado: igual que en confirmModal/lightbox,
    // .focus() llamado en el mismo tick que classList.add("is-open") no
    // hace nada porque el modal todavía es visibility:hidden en ese instante.
    focusAfterOpen(apptFormName);
  }

  function reallyCloseApptForm() {
    apptFormModal.classList.remove('is-open');
    resetApptForm();
    if (apptFormLastFocused && typeof apptFormLastFocused.focus === 'function') apptFormLastFocused.focus();
    apptFormLastFocused = null;
  }

  function attemptCloseApptForm() {
    if (!apptFormModal.classList.contains('is-open')) return;
    if (!apptFormDirty) { reallyCloseApptForm(); return; }
    openConfirmModal({
      title: '¿Descartar esta cita?',
      text: 'Hay datos capturados en el formulario que todavía no se han guardado. Si continúas, se perderán.',
      confirmLabel: 'Sí, descartar',
      onConfirm: function () {
        closeConfirmModal();
        reallyCloseApptForm();
      }
    });
  }

  if (newApptBtn) {
    newApptBtn.addEventListener('click', function () { openApptFormModal('create', null, newApptBtn); });
  }
  if (apptFormCancelBtn) apptFormCancelBtn.addEventListener('click', attemptCloseApptForm);
  if (apptFormModal) {
    apptFormModal.addEventListener('click', function (e) {
      if (e.target === apptFormModal) attemptCloseApptForm();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (!apptFormModal || !apptFormModal.classList.contains('is-open')) return;
    if (e.key === 'Escape') { attemptCloseApptForm(); return; }
    trapTabKey(e, apptFormModal);
  });

  [apptFormName, apptFormPhone, apptFormEmail, apptFormNotes].forEach(function (el) {
    if (el) el.addEventListener('input', function () { markDirty(); clearFieldErrorOf(el); });
  });
  function clearFieldErrorOf(el) {
    var field = el.closest('.field');
    if (field) field.classList.remove('has-error');
  }
  [apptFormStatus, apptFormStyle].forEach(function (el) {
    if (el) el.addEventListener('change', function () { markDirty(); clearFieldErrorOf(el); });
  });
  if (apptFormService) {
    apptFormService.addEventListener('change', function () {
      markDirty();
      clearFieldErrorOf(apptFormService);
      fetchApptFormSlots();
    });
  }
  if (apptFormDate) {
    apptFormDate.addEventListener('change', function () {
      markDirty();
      clearFieldErrorOf(apptFormDate);
      fetchApptFormSlots();
    });
  }

  if (apptForm) {
    apptForm.addEventListener('submit', function (e) {
      e.preventDefault();
      clearApptFormErrors();

      var name = apptFormName.value.trim();
      var phoneDigits = apptFormPhone.value.replace(/\D/g, '');
      var email = apptFormEmail.value.trim();
      var hasError = false;
      var firstInvalid = null;

      function fail(el, condition) {
        if (markApptFormError(el, condition)) {
          hasError = true;
          if (!firstInvalid) firstInvalid = el;
        }
      }
      fail(apptFormName, name.length < 2);
      fail(apptFormPhone, phoneDigits.length !== 10);
      fail(apptFormEmail, email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
      fail(apptFormService, !apptFormService.value);
      fail(apptFormStyle, !apptFormStyle.value);
      fail(apptFormDate, !apptFormDate.value);
      fail(apptFormTimeInput, !apptFormTimeInput.value);

      if (hasError) {
        if (firstInvalid) firstInvalid.focus();
        if (apptFormFeedback) apptFormFeedback.textContent = 'Revisa los campos marcados.';
        return;
      }

      var payload = {
        clientName: name,
        clientPhone: phoneDigits,
        clientEmail: email,
        status: apptFormStatus.value,
        service: apptFormService.value,
        style: apptFormStyle.value,
        date: apptFormDate.value,
        time: apptFormTimeInput.value,
        notes: apptFormNotes.value.trim()
      };

      var isEdit = apptFormMode === 'edit';
      if (isEdit) payload.id = apptFormIdInput.value;

      apptFormSubmitBtn.disabled = true;
      var originalLabel = apptFormSubmitBtn.textContent;
      apptFormSubmitBtn.textContent = 'Guardando…';
      if (apptFormFeedback) apptFormFeedback.textContent = '';

      authApiPost(Object.assign({ action: isEdit ? 'updateAppointment' : 'createAdminAppointment' }, payload))
        .then(function (res) {
          apptFormSubmitBtn.disabled = false;
          apptFormSubmitBtn.textContent = originalLabel;

          if (res.error) {
            if (apptFormFeedback) apptFormFeedback.textContent = res.error;
            // El horario pudo haberse ocupado entre que se cargó la lista y
            // se envió el formulario (otra reserva, otra pestaña) — se
            // refresca para que la administradora vea el estado real.
            fetchApptFormSlots();
            return;
          }

          apptFormDirty = false;
          reallyCloseApptForm();
          showToast(isEdit ? 'Cita actualizada.' : 'Cita creada correctamente.');
          loadMonthData();
        }).catch(function () {
          apptFormSubmitBtn.disabled = false;
          apptFormSubmitBtn.textContent = originalLabel;
          if (apptFormFeedback) apptFormFeedback.textContent = 'No pudimos conectar con el servidor. Intenta de nuevo.';
        });
    });
  }

  /* =========================================================
     PANEL DE HORARIOS
     ========================================================= */
  var scheduleDateInput = document.getElementById('scheduleDate');
  var scheduleList = document.getElementById('scheduleList');
  var genFrom = document.getElementById('genFrom');
  var genTo = document.getElementById('genTo');
  var genInterval = document.getElementById('genInterval');
  var genBtn = document.getElementById('genBtn');
  var manualTime = document.getElementById('manualTime');
  var addSlotBtn = document.getElementById('addSlotBtn');
  var saveScheduleBtn = document.getElementById('saveScheduleBtn');
  var scheduleFeedback = document.getElementById('scheduleFeedback');

  var currentSlots = [];
  // Se enciende cuando hay horarios agregados/quitados/generados que
  // todavía no se han guardado — si además el usuario intenta cambiar de
  // día (o cerrar la pestaña) sin guardar, avisamos antes de perder ese
  // trabajo en vez de descartarlo en silencio.
  var scheduleDirty = false;
  var lastLoadedScheduleDate = null;

  function renderScheduleList() {
    if (!scheduleList) return;
    if (!scheduleDateInput.value) {
      scheduleList.innerHTML = '<p class="slots__empty">Selecciona un día para ver u ordenar sus horarios.</p>';
      return;
    }
    if (!currentSlots.length) {
      scheduleList.innerHTML = '<p class="slots__empty">Sin horarios todavía. Genera o agrega uno manualmente.</p>';
      return;
    }
    scheduleList.innerHTML = '';
    currentSlots.slice().sort().forEach(function (time) {
      var chip = document.createElement('span');
      chip.className = 'slot-chip';
      chip.innerHTML = escapeHtml(time) + ' <button type="button" aria-label="Quitar ' + escapeHtml(time) + '"><svg class="icon"><use href="#icon-close"></use></svg></button>';
      chip.querySelector('button').addEventListener('click', function () {
        currentSlots = currentSlots.filter(function (t) { return t !== time; });
        scheduleDirty = true;
        renderScheduleList();
      });
      scheduleList.appendChild(chip);
    });
  }

  function loadDaySchedule(dateStr) {
    if (scheduleFeedback) scheduleFeedback.textContent = '';
    scheduleDirty = false;
    if (!dateStr) {
      currentSlots = [];
      lastLoadedScheduleDate = null;
      renderScheduleList();
      return;
    }
    scheduleList.innerHTML = '<p class="slots__empty">Cargando…</p>';

    authApiGet({ action: 'schedule', dateFrom: dateStr, dateTo: dateStr }).then(function (res) {
      var schedule = (res && res.schedule) || {};
      currentSlots = (schedule[dateStr] || []).slice();
      lastLoadedScheduleDate = dateStr;
      scheduleDirty = false;
      renderScheduleList();
    }).catch(function () {
      scheduleList.innerHTML = '<p class="slots__empty slots__empty--error">No pudimos cargar el horario. Intenta de nuevo.</p>';
    });
  }

  if (scheduleDateInput) {
    scheduleDateInput.min = todayISO();
    scheduleDateInput.value = todayISO();
    scheduleDateInput.addEventListener('change', function () {
      var newDate = scheduleDateInput.value;
      if (scheduleDirty) {
        var previousDate = lastLoadedScheduleDate;
        scheduleDateInput.value = previousDate || todayISO(); // no cambia la vista hasta confirmar
        openConfirmModal({
          title: '¿Cambiar de día sin guardar?',
          text: 'Tienes horarios agregados que todavía no guardaste' +
            (previousDate ? ' para el ' + formatDateEs(previousDate) : '') +
            '. Si cambias de día ahora, se perderán.',
          confirmLabel: 'Sí, cambiar de día',
          onConfirm: function () {
            closeConfirmModal();
            scheduleDateInput.value = newDate;
            loadDaySchedule(newDate);
          }
        });
        return;
      }
      loadDaySchedule(newDate);
    });
  }

  window.addEventListener('beforeunload', function (e) {
    if (scheduleDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  if (addSlotBtn) {
    addSlotBtn.addEventListener('click', function () {
      if (!scheduleDateInput.value) {
        if (scheduleFeedback) scheduleFeedback.textContent = 'Selecciona primero un día.';
        return;
      }
      if (!manualTime.value) return;
      if (currentSlots.indexOf(manualTime.value) === -1) {
        currentSlots.push(manualTime.value);
        scheduleDirty = true;
        renderScheduleList();
      }
      manualTime.value = '';
    });
  }

  if (genBtn) {
    genBtn.addEventListener('click', function () {
      if (!scheduleDateInput.value) {
        if (scheduleFeedback) scheduleFeedback.textContent = 'Selecciona primero un día.';
        return;
      }
      var from = genFrom.value;
      var to = genTo.value;
      var interval = parseInt(genInterval.value, 10);
      if (!from || !to || !interval) return;

      var fromMinutes = toMinutes(from);
      var toMinutesVal = toMinutes(to);
      if (fromMinutes === null || toMinutesVal === null || fromMinutes >= toMinutesVal) {
        if (scheduleFeedback) scheduleFeedback.textContent = 'Revisa el rango de horas.';
        return;
      }

      // "Generar" reemplaza la lista por completo: si vuelves a generar con
      // otro rango/intervalo, los horarios anteriores no se quedan mezclados.
      currentSlots = [];
      for (var m = fromMinutes; m < toMinutesVal; m += interval) {
        currentSlots.push(minutesToTime(m));
      }
      scheduleDirty = true;
      renderScheduleList();
      if (scheduleFeedback) scheduleFeedback.textContent = 'Horarios generados. Revisa la lista y guarda.';
    });
  }

  function toMinutes(hhmm) {
    var parts = hhmm.split(':');
    if (parts.length !== 2) return null;
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }
  function minutesToTime(mins) {
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return pad2(h) + ':' + pad2(m);
  }

  if (saveScheduleBtn) {
    saveScheduleBtn.addEventListener('click', function () {
      if (!scheduleDateInput.value) {
        if (scheduleFeedback) scheduleFeedback.textContent = 'Selecciona primero un día.';
        return;
      }
      var dateValue = scheduleDateInput.value;
      saveScheduleBtn.disabled = true;
      var original = saveScheduleBtn.textContent;
      saveScheduleBtn.textContent = 'Guardando…';

      authApiPost({ action: 'saveSchedule', date: dateValue, slots: currentSlots.slice().sort() }).then(function (res) {
        saveScheduleBtn.disabled = false;
        saveScheduleBtn.textContent = original;

        if (res.error) {
          if (scheduleFeedback) scheduleFeedback.textContent = res.error;
          return;
        }
        scheduleDirty = false;
        lastLoadedScheduleDate = dateValue;
        if (scheduleFeedback) scheduleFeedback.textContent = 'Horario guardado ✓';
        showToast('Horario del ' + formatDateEs(dateValue) + ' guardado.');

        // Si el día guardado cae dentro del mes visible, refresca el calendario.
        var range = monthRange(viewYear, viewMonth);
        if (dateValue >= range.from && dateValue <= range.to) loadMonthData();
      }).catch(function () {
        saveScheduleBtn.disabled = false;
        saveScheduleBtn.textContent = original;
        if (scheduleFeedback) scheduleFeedback.textContent = 'No pudimos guardar. Intenta de nuevo.';
      });
    });
  }

  /* =========================================================
     BOTÓN VOLVER ARRIBA
     ========================================================= */
  (function initBackToTop() {
    var btn = document.getElementById('backToTop');
    if (!btn) return;

    function onScroll() {
      if (window.scrollY > 480) btn.classList.add('is-visible');
      else btn.classList.remove('is-visible');
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    });
  })();

  /* =========================================================
     INICIALIZACIÓN
     ========================================================= */
  if (token) {
    showApp();
  } else {
    showLogin();
  }
})();
