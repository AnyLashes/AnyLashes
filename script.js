(function () {
  'use strict';

  /* =========================================================
     CONFIG
     Verifica el código de país del número antes de publicar.
     ========================================================= */
  var WHATSAPP_NUMBER = '522321765311'; // 52 = México + 2321765311
  var API_URL = 'https://script.google.com/macros/s/AKfycby_dX7NN0w20zN7-zN7Yi7Gfoxq8JinteaT2K1fwNud8dLtTneHV7QDHEftP-Fidl9W_w/exec';
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function buildWhatsAppUrl(message, number) {
    return 'https://wa.me/' + (number || WHATSAPP_NUMBER) + '?text=' + encodeURIComponent(message);
  }

  // Abre una pestaña en blanco de forma síncrona (dentro del gesto del
  // usuario) para redirigirla después de una respuesta async sin que el
  // navegador la bloquee como pop-up.
  function openPendingTab() {
    var tab = window.open('about:blank', '_blank');
    if (tab) {
      try {
        tab.document.write('<title>Abriendo WhatsApp…</title><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#6E665D;">Redirigiendo a WhatsApp…</body>');
      } catch (e) { /* noop */ }
    }
    return tab;
  }

  function apiGet(params) {
    var query = Object.keys(params)
      .map(function (k) { return k + '=' + encodeURIComponent(params[k]); })
      .join('&');
    return fetch(API_URL + '?' + query).then(function (r) { return r.json(); });
  }

  function apiPost(payload) {
    // Sin header Content-Type a propósito: así el navegador la trata como
    // petición "simple" y evita el preflight OPTIONS que Apps Script no maneja.
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); });
  }

  function formatDateEs(dateStr) {
    var parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    var day = parseInt(parts[2], 10);
    var month = MONTHS_ES[parseInt(parts[1], 10) - 1];
    return day + ' de ' + month + ' de ' + parts[0];
  }

  function todayISO() {
    var d = new Date();
    var offset = d.getTimezoneOffset();
    var local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 10);
  }

  function nowHHMM() {
    var d = new Date();
    var h = ('0' + d.getHours()).slice(-2);
    var m = ('0' + d.getMinutes()).slice(-2);
    return h + ':' + m;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  /* =========================================================
     TOP BAR — mensajes rotativos
     ========================================================= */
  (function initTopbar() {
    var messages = document.querySelectorAll('.topbar__msg');
    if (!messages.length) return;

    var current = 0;
    messages[current].classList.add('is-active');
    if (messages.length < 2 || prefersReducedMotion) return;

    setInterval(function () {
      messages[current].classList.remove('is-active');
      current = (current + 1) % messages.length;
      messages[current].classList.add('is-active');
    }, 4200);
  })();

  /* =========================================================
     HEADER — clase activa al hacer scroll
     ========================================================= */
  (function initHeaderScroll() {
    var header = document.getElementById('siteHeader');
    if (!header) return;

    function onScroll() {
      if (window.scrollY > 12) header.classList.add('is-scrolled');
      else header.classList.remove('is-scrolled');
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  })();

  /* =========================================================
     MENÚ MÓVIL
     ========================================================= */
  (function initMobileMenu() {
    var hamburgerBtn = document.getElementById('hamburgerBtn');
    var closeMenuBtn = document.getElementById('closeMenuBtn');
    var mobileMenu = document.getElementById('mobileMenu');
    var backdrop = document.getElementById('mobileMenuBackdrop');
    if (!hamburgerBtn || !mobileMenu || !backdrop) return;

    function openMenu() {
      mobileMenu.classList.add('is-open');
      backdrop.classList.add('is-open');
      hamburgerBtn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }

    function closeMenu() {
      mobileMenu.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    hamburgerBtn.addEventListener('click', openMenu);
    if (closeMenuBtn) closeMenuBtn.addEventListener('click', closeMenu);
    backdrop.addEventListener('click', closeMenu);

    var mobileLinks = mobileMenu.querySelectorAll('a');
    mobileLinks.forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });
  })();

  /* =========================================================
     SCROLL REVEAL — IntersectionObserver + stagger
     ========================================================= */
  (function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    var groups = new Map();
    items.forEach(function (el) {
      var parent = el.parentElement;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(el);
    });
    groups.forEach(function (list) {
      list.forEach(function (el, idx) {
        el.style.transitionDelay = Math.min(idx * 70, 420) + 'ms';
      });
    });

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -40px 0px' });

    items.forEach(function (el) { observer.observe(el); });
  })();

  /* =========================================================
     HERO — parallax sutil de imagen al hacer scroll
     ========================================================= */
  /* =========================================================
     HERO — ilustración de pestañas construyéndose fibra por fibra.
     Se generan por código sobre la misma curva del párpado (el
     <path class="lash-anim__base">) para que el abanico se vea
     natural: cortas en las esquinas, más largas hacia el centro,
     curvadas hacia arriba como una pestaña real.
     ========================================================= */
  (function initLashAnimation() {
    var group = document.getElementById('lashAnimGroup');
    var svg = document.getElementById('lashAnimSvg');
    var lid = document.getElementById('lashAnimLid');
    var socket = document.getElementById('lashAnimSocket');
    var eyeball = document.getElementById('lashAnimEyeball');
    if (!group || !svg || !lid || !socket || !eyeball) return;

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var OPEN_LID_D = 'M78,300 Q200,203 322,278';

    // Ceja: una forma rellena de ancho variable (delgada a la izquierda,
    // gruesa a la derecha) trazada a lo largo de la curva guía
    // #lashAnimBrowGuide, para que se vea igual que la referencia en vez
    // de un trazo de grosor uniforme.
    var browGuide = document.getElementById('lashAnimBrowGuide');
    var browShape = document.getElementById('lashBrowShape');
    if (browGuide && browShape) {
      var browLen = browGuide.getTotalLength();
      var steps = 40;
      var topPts = [];
      var botPts = [];
      for (var bi = 0; bi <= steps; bi++) {
        var bt = bi / steps;
        var len = bt * browLen;
        var p = browGuide.getPointAtLength(len);
        var p2 = browGuide.getPointAtLength(Math.min(browLen, len + 0.5));
        var tx = p2.x - p.x, ty = p2.y - p.y;
        var tm = Math.sqrt(tx * tx + ty * ty) || 1;
        var nx = -ty / tm, ny = tx / tm; // normal perpendicular a la curva
        // Ancho: delgado en la punta izquierda (bt=0), grueso hacia la
        // derecha (bt=1), como pidió la referencia.
        var halfW = (1.6 + Math.pow(bt, 1.15) * 6.8) / 2;
        topPts.push({ x: p.x + nx * halfW, y: p.y + ny * halfW });
        botPts.push({ x: p.x - nx * halfW, y: p.y - ny * halfW });
      }
      var d = 'M ' + topPts[0].x.toFixed(1) + ' ' + topPts[0].y.toFixed(1) + ' ';
      for (var ti = 1; ti < topPts.length; ti++) {
        d += 'L ' + topPts[ti].x.toFixed(1) + ' ' + topPts[ti].y.toFixed(1) + ' ';
      }
      for (var bj = botPts.length - 1; bj >= 0; bj--) {
        d += 'L ' + botPts[bj].x.toFixed(1) + ' ' + botPts[bj].y.toFixed(1) + ' ';
      }
      d += 'Z';
      var shape = document.createElementNS(SVG_NS, 'path');
      shape.setAttribute('d', d);
      shape.setAttribute('class', 'lash-anim__brow-shape');
      browShape.appendChild(shape);
    }

    // Misma curva de reposo (ojo cerrado) que el <path id="lashAnimLid">:
    // la línea del párpado superior, donde nacen las pestañas.
    var P0 = { x: 78, y: 300 };
    var Pc = { x: 200, y: 292 };
    var P1 = { x: 322, y: 278 };

    function bezierPoint(t) {
      var mt = 1 - t;
      return {
        x: mt * mt * P0.x + 2 * mt * t * Pc.x + t * t * P1.x,
        y: mt * mt * P0.y + 2 * mt * t * Pc.y + t * t * P1.y
      };
    }

    var count = window.innerWidth < 640 ? 13 : 19;
    var buildWindowMs = 2560; // 32% de los 8s del ciclo (ver keyframes lashDraw/lashTipTravel en CSS)
    var fibers = []; // { t, anchor:{x,y}, node }

    for (var i = 0; i < count; i++) {
      var t = count === 1 ? 0.5 : i / (count - 1);
      var anchor = bezierPoint(t);

      // Perfil de largo estilo "cat-eye": cortas junto al lagrimal, más
      // largas hacia la esquina externa, pero contenidas para no chocar
      // con la ceja de arriba.
      var peak = 0.8;
      var spread = 0.3;
      var length = 14 + 50 * Math.exp(-Math.pow((t - peak) / spread, 2));

      // Las pestañas nacen en el párpado superior y se abren hacia arriba
      // y hacia afuera, casi verticales, como una extensión real.
      var skew = -0.25 + t * 0.9;
      var vertical = -1.5;
      var mag = Math.sqrt(skew * skew + vertical * vertical);
      var dirX = skew / mag, dirY = vertical / mag;

      var jitterX = (Math.random() - 0.5) * 4;
      var jitterLen = (Math.random() - 0.5) * 5;
      var len = length + jitterLen;

      // Coordenadas locales (relativas al ancla, que queda en 0,0) para que
      // el <g> contenedor pueda moverse con un simple translate() y seguir
      // en vivo al párpado mientras este se anima.
      var tipX = dirX * len + jitterX;
      var tipY = dirY * len;
      var midX = tipX / 2;
      var midY = tipY / 2;
      var perpX = dirY, perpY = -dirX;
      var curl = 7 + Math.random() * 6;
      var ctrlX = midX + perpX * curl;
      var ctrlY = midY + perpY * curl;

      var d = 'M 0 0 Q ' + ctrlX.toFixed(1) + ' ' + ctrlY.toFixed(1) + ' ' +
        tipX.toFixed(1) + ' ' + tipY.toFixed(1);

      var wrap = document.createElementNS(SVG_NS, 'g');
      wrap.setAttribute('transform', 'translate(' + anchor.x.toFixed(1) + ',' + anchor.y.toFixed(1) + ')');

      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'lash-fiber');
      path.style.setProperty('--lash-delay', Math.round(t * buildWindowMs) + 'ms');
      wrap.appendChild(path);
      group.appendChild(wrap);

      var pathLen = path.getTotalLength();
      path.style.strokeDasharray = pathLen;
      path.style.setProperty('--lash-len', pathLen);

      fibers.push({ t: t, anchor: anchor, node: wrap });
    }

    // Punto medio del párpado inferior (fijo, no se anima): sirve de "piso"
    // para calcular en vivo el centro y la apertura real del ojo.
    var socketTotal = socket.getTotalLength();
    var socketMid = socket.getPointAtLength(socketTotal * 0.5);
    // Apertura máxima teórica (ojo bien abierto), para normalizar la escala
    // del globo ocular entre 0 (cerrado) y 1 (abierto).
    var MAX_GAP = socketMid.y - bezierPointOnOpenLid(0.5).y;

    function bezierPointOnOpenLid(t) {
      var mt = 1 - t;
      return { x: mt * mt * 78 + 2 * mt * t * 200 + t * t * 322, y: mt * mt * 300 + 2 * mt * t * 203 + t * t * 278 };
    }

    // El parpadeo (apertura/cierre del párpado) se anima vía SMIL en el
    // <animate> del path #lashAnimLid. Cada cuadro, reubicamos cada
    // pestaña y el globo ocular en el punto real y actual de esa curva
    // (getPointAtLength), así todo queda siempre "pegado" al párpado y
    // perfectamente centrado en el ojo, sin importar qué tan abierto esté.
    var lidAnim = document.getElementById('lashLidAnim');

    function updateEyeball(lidMid) {
      var cx = (lidMid.x + socketMid.x) / 2;
      var cy = (lidMid.y + socketMid.y) / 2;
      var gap = Math.max(0, socketMid.y - lidMid.y);
      var openness = MAX_GAP > 0 ? Math.min(1, gap / MAX_GAP) : 0;
      var scale = 0.5 + 0.5 * openness;
      eyeball.setAttribute('transform', 'translate(' + cx.toFixed(1) + ',' + cy.toFixed(1) + ') scale(' + scale.toFixed(3) + ')');
      eyeball.style.opacity = Math.max(0, (openness - 0.12) / 0.88).toFixed(3);
    }

    function trackLid() {
      var total = lid.getTotalLength();
      var lidMid = lid.getPointAtLength(total * 0.5);
      for (var i = 0; i < fibers.length; i++) {
        var f = fibers[i];
        var live = lid.getPointAtLength(f.t * total);
        f.node.setAttribute('transform', 'translate(' + live.x.toFixed(1) + ',' + live.y.toFixed(1) + ')');
      }
      updateEyeball(lidMid);
      requestAnimationFrame(trackLid);
    }

    if (prefersReducedMotion) {
      // Sin animación: quitamos el SMIL, fijamos el párpado abierto y
      // ubicamos pestañas + globo ocular sobre esa curva una sola vez.
      if (lidAnim) lidAnim.remove();
      lid.setAttribute('d', OPEN_LID_D);
      var totalOpen = lid.getTotalLength();
      fibers.forEach(function (f) {
        var p = lid.getPointAtLength(f.t * totalOpen);
        f.node.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')');
      });
      updateEyeball(lid.getPointAtLength(totalOpen * 0.5));
    } else {
      requestAnimationFrame(trackLid);
    }
  })();

  (function initHeroParallax() {
    var el = document.querySelector('.lash-anim');
    if (!el || prefersReducedMotion) return;

    var ticking = false;
    function update() {
      var offset = Math.max(-14, Math.min(14, window.scrollY * 0.06));
      el.style.transform = 'translateY(' + offset + 'px)';
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
  })();

  /* =========================================================
     ESTADÍSTICAS — conteo animado
     ========================================================= */
  (function initStats() {
    var stats = document.querySelectorAll('.stat__num');
    if (!stats.length) return;

    function animateCount(el) {
      var target = parseInt(el.getAttribute('data-count'), 10) || 0;
      if (prefersReducedMotion) {
        el.textContent = target;
        return;
      }
      var duration = 1200;
      var startTime = null;

      function step(timestamp) {
        if (startTime === null) startTime = timestamp;
        var progress = Math.min((timestamp - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(eased * target);
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    if (!('IntersectionObserver' in window)) {
      stats.forEach(animateCount);
      return;
    }

    var statsObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          statsObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    stats.forEach(function (el) { statsObserver.observe(el); });
  })();

  /* =========================================================
     ACORDEÓN FAQ
     ========================================================= */
  (function initAccordion() {
    var triggers = document.querySelectorAll('.accordion__trigger');
    if (!triggers.length) return;

    triggers.forEach(function (trigger) {
      var panel = document.getElementById(trigger.getAttribute('aria-controls'));
      if (!panel) return;

      trigger.addEventListener('click', function () {
        var isOpen = trigger.getAttribute('aria-expanded') === 'true';

        triggers.forEach(function (t) {
          var p = document.getElementById(t.getAttribute('aria-controls'));
          if (t !== trigger) {
            t.setAttribute('aria-expanded', 'false');
            if (p) p.style.maxHeight = null;
          }
        });

        if (isOpen) {
          trigger.setAttribute('aria-expanded', 'false');
          panel.style.maxHeight = null;
        } else {
          trigger.setAttribute('aria-expanded', 'true');
          panel.style.maxHeight = panel.scrollHeight + 'px';
        }
      });
    });
  })();

  /* =========================================================
     INTERFAZ DE RESERVA — horarios y envío contra el backend
     ========================================================= */
  (function initBooking() {
    var form = document.getElementById('bookingForm');
    var serviceSelect = document.getElementById('bookingService');
    var styleSelect = document.getElementById('bookingStyle');
    var dateInput = document.getElementById('bookingDate');
    var slotsWrap = document.getElementById('bookingSlots');
    var timeInput = document.getElementById('bookingTime');
    var nameInput = document.getElementById('bookingName');
    var phoneInput = document.getElementById('bookingPhone');
    var summary = document.getElementById('bookingSummary');
    var submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    if (!form || !serviceSelect || !styleSelect || !dateInput || !slotsWrap || !timeInput) return;

    dateInput.min = todayISO();

    function clearFieldError(el) {
      var field = el.closest('.field');
      if (field) field.classList.remove('has-error');
    }

    function renderSlots(dateStr) {
      timeInput.value = '';

      if (!dateStr) {
        slotsWrap.innerHTML = '<p class="slots__empty">Elige primero una fecha para ver los horarios disponibles.</p>';
        return;
      }

      slotsWrap.innerHTML = '<p class="slots__empty">Cargando horarios…</p>';

      apiGet({ action: 'slots', date: dateStr }).then(function (res) {
        if (res.error) {
          slotsWrap.innerHTML = '<p class="slots__empty slots__empty--error">No pudimos cargar los horarios. Intenta de nuevo.</p>';
          return;
        }

        var allTimes = (res.times || []).slice().sort();
        var booked = res.booked || [];

        if (!allTimes.length) {
          slotsWrap.innerHTML = '<p class="slots__empty">No hay horarios disponibles este día. Elige otra fecha o escríbenos directo por WhatsApp.</p>';
          return;
        }

        var isToday = dateStr === todayISO();
        var nowStr = nowHHMM();

        slotsWrap.innerHTML = '';
        allTimes.forEach(function (time) {
          var btn = document.createElement('button');
          btn.type = 'button';
          var isPast = isToday && time <= nowStr;
          var isBooked = booked.indexOf(time) !== -1;

          if (isPast) {
            btn.className = 'slot-btn slot-btn--past';
            btn.disabled = true;
            btn.title = 'Ya pasó esta hora';
            btn.innerHTML = '<span class="slot-btn__time">' + time + '</span><span class="slot-btn__tag">Ya pasó</span>';
          } else if (isBooked) {
            btn.className = 'slot-btn';
            btn.disabled = true;
            btn.title = 'Este horario ya está reservado';
            btn.textContent = time;
          } else {
            btn.className = 'slot-btn';
            btn.textContent = time;
            btn.addEventListener('click', function () {
              slotsWrap.querySelectorAll('.slot-btn').forEach(function (b) { b.classList.remove('is-selected'); });
              btn.classList.add('is-selected');
              timeInput.value = time;
              updateSummary();
            });
          }
          slotsWrap.appendChild(btn);
        });
      }).catch(function () {
        slotsWrap.innerHTML = '<p class="slots__empty slots__empty--error">No pudimos conectar. Revisa tu internet e intenta de nuevo.</p>';
      });
    }

    dateInput.addEventListener('change', function () {
      renderSlots(dateInput.value);
      updateSummary();
    });

    function updateSummary() {
      var service = serviceSelect.value;
      var style = styleSelect.value;
      var date = dateInput.value;
      var time = timeInput.value;
      var name = nameInput ? nameInput.value.trim() : '';

      if (!service && !style && !date && !time && !name) {
        summary.classList.remove('booking__summary--error');
        summary.innerHTML = '<p>Tu selección aparecerá aquí antes de enviarla por WhatsApp.</p>';
        return;
      }

      summary.classList.remove('booking__summary--error');
      summary.innerHTML =
        '<p>' +
        (name ? '<strong>Nombre:</strong> ' + name + '<br>' : '') +
        '<strong>Servicio:</strong> ' + (service || 'Sin elegir') + '<br>' +
        '<strong>Estilo:</strong> ' + (style || 'Sin elegir') + '<br>' +
        '<strong>Fecha:</strong> ' + (date ? formatDateEs(date) : 'Sin elegir') + '<br>' +
        '<strong>Hora:</strong> ' + (time || 'Sin elegir') +
        '</p>';
    }

    [serviceSelect, styleSelect].forEach(function (el) {
      el.addEventListener('change', function () {
        clearFieldError(el);
        updateSummary();
      });
    });
    if (nameInput) nameInput.addEventListener('input', function () { clearFieldError(nameInput); updateSummary(); });
    if (phoneInput) phoneInput.addEventListener('input', function () { clearFieldError(phoneInput); });

    function fillBooking(service, style) {
      if (service) serviceSelect.value = service;
      if (style) styleSelect.value = style;
      updateSummary();

      var bookingSection = document.getElementById('reserva');
      if (bookingSection) {
        bookingSection.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
      }
    }

    document.querySelectorAll('.js-fill-booking').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        fillBooking(btn.getAttribute('data-service'), btn.getAttribute('data-style'));
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var hasError = false;
      var firstInvalid = null;

      function markError(el, condition) {
        var field = el.closest('.field');
        if (condition) {
          if (field) field.classList.add('has-error');
          hasError = true;
          if (!firstInvalid) firstInvalid = el;
        } else if (field) {
          field.classList.remove('has-error');
        }
      }

      markError(serviceSelect, !serviceSelect.value);
      markError(styleSelect, !styleSelect.value);
      markError(dateInput, !dateInput.value);
      markError(timeInput, !timeInput.value);

      var phoneDigits = phoneInput ? phoneInput.value.replace(/\D/g, '') : '';
      var nameValue = nameInput ? nameInput.value.trim() : '';
      if (nameInput) markError(nameInput, nameValue.length < 2);
      if (phoneInput) markError(phoneInput, phoneDigits.length !== 10);

      if (hasError) {
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      var dateValue = dateInput.value;
      var timeValue = timeInput.value;
      var originalBtnHTML = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = 'Enviando…';

      // Se abre una pestaña en blanco AHORA, de forma síncrona dentro del
      // clic del usuario, para que el navegador no la bloquee como pop-up.
      // Se le da la URL real de WhatsApp hasta que el servidor responda.
      var whatsappTab = openPendingTab();

      apiPost({
        action: 'book',
        date: dateValue,
        time: timeValue,
        service: serviceSelect.value,
        style: styleSelect.value,
        clientName: nameValue,
        clientPhone: phoneDigits
      }).then(function (res) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHTML;

        if (res.error) {
          if (whatsappTab) whatsappTab.close();
          summary.classList.add('booking__summary--error');
          summary.innerHTML = '<p>' + res.error + '</p>';
          renderSlots(dateValue);
          return;
        }

        var message = 'Hola AnyLashes, me gustaría agendar una cita.\n' +
          'Nombre: ' + nameValue + '\n' +
          'WhatsApp: ' + phoneDigits + '\n' +
          'Servicio: ' + serviceSelect.value + '\n' +
          'Estilo: ' + styleSelect.value + '\n' +
          'Fecha: ' + formatDateEs(dateValue) + '\n' +
          'Hora: ' + timeValue;

        if (whatsappTab) whatsappTab.location.href = buildWhatsAppUrl(message);

        summary.classList.remove('booking__summary--error');
        summary.innerHTML = '<p><strong>¡Listo, ' + nameValue + '!</strong> Registramos tu cita para el ' +
          formatDateEs(dateValue) + ' a las ' + timeValue + '. Abrimos WhatsApp para confirmar contigo.</p>';

        form.reset();
        renderSlots(dateValue);
      }).catch(function () {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHTML;
        if (whatsappTab) whatsappTab.close();
        summary.classList.add('booking__summary--error');
        summary.innerHTML = '<p>No pudimos conectar con el servidor. Intenta de nuevo en unos segundos.</p>';
      });
    });
  })();

  /* =========================================================
     BOTONES DE WHATSAPP GENERALES (hero, cta final, footer)
     ========================================================= */
  (function initWhatsAppCtas() {
    var defaultMessage = 'Hola AnyLashes, me gustaría agendar una cita.';
    document.querySelectorAll('.js-whatsapp-cta').forEach(function (btn) {
      btn.setAttribute('href', buildWhatsAppUrl(defaultMessage));
      btn.setAttribute('target', '_blank');
      btn.setAttribute('rel', 'noopener');
    });
  })();

  /* =========================================================
     ÚLTIMOS TRABAJOS — fotos reales que la dueña sube desde el panel;
     solo se muestran las del mes en curso.
     ========================================================= */
  (function initRecentWork() {
    var gallery = document.getElementById('workGallery');
    if (!gallery) return;

    apiGet({ action: 'recentWork' }).then(function (res) {
      var works = (res && res.works) || [];
      if (!works.length) {
        gallery.innerHTML = '<p class="work-gallery__empty">Muy pronto verás aquí los trabajos más recientes del mes.</p>';
        return;
      }

      gallery.innerHTML = '';
      works.forEach(function (work, idx) {
        var caption = escapeHtml(work.service) + ' — ' + escapeHtml(work.style);
        var item = document.createElement('figure');
        item.className = 'work-gallery__item';
        item.innerHTML =
          '<img src="' + escapeHtml(work.url) + '" alt="Trabajo reciente: ' + caption + '" loading="lazy">' +
          '<figcaption class="work-gallery__caption">' + caption + '</figcaption>';
        gallery.appendChild(item);

        if (prefersReducedMotion) {
          item.classList.add('is-visible');
        } else {
          item.style.transitionDelay = Math.min(idx * 70, 350) + 'ms';
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { item.classList.add('is-visible'); });
          });
        }
      });
    }).catch(function () {
      gallery.innerHTML = '<p class="work-gallery__empty">No pudimos cargar los trabajos recientes. Intenta más tarde.</p>';
    });
  })();

  /* =========================================================
     PLACEHOLDER IMAGES — fallback elegante si aún no existen
     ========================================================= */
  (function initImageFallback() {
    document.querySelectorAll('img').forEach(function (img) {
      img.addEventListener('error', function () {
        img.classList.add('img-missing');
      }, { once: true });
    });
  })();

  /* =========================================================
     AÑO EN FOOTER
     ========================================================= */
  (function initYear() {
    var yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  })();

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

})();
