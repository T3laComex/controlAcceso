(() => {
  const $ = id => document.getElementById(id);
  const config = window.FIREBASE_CONFIG;
  const adminUid = window.FIREBASE_ADMIN_UID;
  const configReady = config &&
    config.apiKey && config.apiKey !== "PEGA_AQUI_TU_API_KEY" &&
    config.projectId && config.appId && config.appId !== "PEGA_AQUI_TU_APP_ID" &&
    adminUid && adminUid !== "PEGA_AQUI_EL_UID_DEL_ADMIN";

  const sections = ["registro", "adminLogin", "inicio", "historial"];
  let auth = null;
  let firestore = null;
  let entriesToday = [];
  let historyEntries = [];
  let requestInProgress = false;
  let snowActive = true;
  let snowFrame = null;
  let snowflakes = [];

  function showMessage(message, type = "info") {
    const box = $("appMessage");
    box.textContent = message;
    box.className = type === "error" ? "alerta" : "alerta-info";
    box.hidden = false;
  }

  function hideMessage() {
    $("appMessage").hidden = true;
    $("appMessage").textContent = "";
  }

  function localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function escapeCsv(value) {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function formatTimestamp(value) {
    if (!value || typeof value.toDate !== "function") return null;
    return value.toDate();
  }

  function attendeeDate(entry) {
    const date = formatTimestamp(entry.createdAt);
    return date
      ? date.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" })
      : "—";
  }

  function attendeeTime(entry) {
    const date = formatTimestamp(entry.createdAt);
    return date ? date.toLocaleTimeString("es-MX") : "—";
  }

  function renderEntries(tbody, items, query) {
    const filter = query.trim().toLocaleLowerCase("es-MX");
    const visible = items.filter(entry =>
      `${entry.nombre} ${entry.apellidos} ${entry.tipo}`.toLocaleLowerCase("es-MX").includes(filter)
    );
    tbody.replaceChildren();

    if (!visible.length) {
      tbody.appendChild(filaVacia(4, filter ? "No hay resultados para esa búsqueda." : "Aún no hay entradas registradas."));
      return;
    }

    for (const entry of visible) {
      const row = document.createElement("tr");
      for (const value of [
        `${entry.nombre} ${entry.apellidos}`,
        entry.tipo,
        attendeeDate(entry),
        attendeeTime(entry)
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      }
      tbody.appendChild(row);
    }
  }

  function filaVacia(columns, message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns;
    cell.className = "vacio";
    cell.textContent = message;
    row.appendChild(cell);
    return row;
  }

  function renderToday() {
    $("totalEntradas").textContent = String(entriesToday.length);
    renderEntries($("tablaHoy"), entriesToday, $("buscarHoy").value);
  }

  function renderHistory() {
    renderEntries($("tablaHistorial"), historyEntries, $("buscarHistorial").value);
    const date = $("fechaHistorial").value;
    $("resumenHistorial").textContent =
      `${new Date(`${date}T12:00:00`).toLocaleDateString("es-MX", { dateStyle: "long" })} · ${historyEntries.length} entrada${historyEntries.length === 1 ? "" : "s"}`;
  }

  async function loadEntries(date) {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const snapshot = await firestore.collection("attendees")
      .where("createdAt", ">=", firebase.firestore.Timestamp.fromDate(start))
      .where("createdAt", "<", firebase.firestore.Timestamp.fromDate(end))
      .get();
    return snapshot.docs
      .map(document => ({ id: document.id, ...document.data() }))
      .sort((left, right) => {
        const leftTime = formatTimestamp(left.createdAt)?.getTime() || 0;
        const rightTime = formatTimestamp(right.createdAt)?.getTime() || 0;
        return rightTime - leftTime;
      });
  }

  async function refreshAdminViews() {
    if (!auth.currentUser || auth.currentUser.uid !== adminUid) return;
    try {
      const [today, history] = await Promise.all([
        loadEntries(localDateKey()),
        loadEntries($("fechaHistorial").value || localDateKey())
      ]);
      entriesToday = today;
      historyEntries = history;
      renderToday();
      renderHistory();
      $("conexion").classList.remove("error");
      $("conexion").classList.add("ok");
      $("conexionTexto").textContent = "Firebase conectado";
      $("conexion").hidden = false;
      hideMessage();
    } catch (error) {
      console.error("No se pudieron leer los registros de Firebase:", error);
      showMessage("No se pudieron cargar las entradas. Verifica que las reglas de Firestore tengan el UID correcto y que el administrador haya iniciado sesión.", "error");
    }
  }

  function setView(view) {
    sections.forEach(section => { $(section).hidden = true; });
    document.querySelectorAll(".menu a").forEach(link => link.classList.remove("activo"));

    if (view === "adminLogin") {
      $("adminLogin").hidden = false;
      $("menuPublico").hidden = false;
      $("menuAdmin").hidden = true;
      $("adminEmailInput").focus();
      return;
    }

    if (view === "registro") {
      $("registro").hidden = false;
      $("menuPublico").hidden = false;
      $("menuAdmin").hidden = true;
      $("registroBtn").classList.add("activo");
      return;
    }

    if (!auth?.currentUser || auth.currentUser.uid !== adminUid) {
      setView("adminLogin");
      return;
    }

    $("menuPublico").hidden = true;
    $("menuAdmin").hidden = false;
    if (view === "historial") {
      $("historial").hidden = false;
      $("historialBtn").classList.add("activo");
      void refreshAdminViews();
    } else {
      $("inicio").hidden = false;
      $("inicioBtn").classList.add("activo");
      void refreshAdminViews();
    }
  }

  $("formRegistro").addEventListener("submit", async event => {
    event.preventDefault();
    if (!firestore || requestInProgress) return;

    const nombre = $("nombre").value.trim().replace(/\s+/g, " ");
    const apellidos = $("apellidos").value.trim().replace(/\s+/g, " ");
    const tipo = $("tipo").value;
    if (!nombre || !apellidos || !["Alumno", "Profesor", "Invitado"].includes(tipo)) {
      showMessage("Revisa el nombre, los apellidos y el tipo de asistente.", "error");
      return;
    }

    requestInProgress = true;
    $("btnRegistrar").disabled = true;
    hideMessage();
    try {
      await firestore.collection("attendees").add({
        nombre,
        apellidos,
        tipo,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      $("formRegistro").reset();
      showMessage("Entrada registrada correctamente. ¡Bienvenido!");
    } catch (error) {
      console.error("No se pudo guardar la entrada en Firebase:", error);
      showMessage("No se pudo registrar la entrada. Revisa la conexión y las reglas de Firestore e inténtalo otra vez.", "error");
    } finally {
      requestInProgress = false;
      $("btnRegistrar").disabled = false;
    }
  });

  $("formAdminLogin").addEventListener("submit", async event => {
    event.preventDefault();
    if (!auth) return;
    const button = $("formAdminLogin").querySelector("button[type=submit]");
    button.disabled = true;
    hideMessage();
    try {
      const credential = await auth.signInWithEmailAndPassword(
        $("adminEmailInput").value.trim(),
        $("adminPasswordInput").value
      );
      if (credential.user.uid !== adminUid) {
        await auth.signOut();
        throw new Error("Esta cuenta no está autorizada como administradora.");
      }
      $("formAdminLogin").reset();
      setView("inicio");
    } catch (error) {
      console.error("No se pudo iniciar sesión como administrador:", error);
      showMessage(error.message === "Esta cuenta no está autorizada como administradora."
        ? error.message
        : "No se pudo iniciar sesión. Revisa el correo y la contraseña de la cuenta administradora.", "error");
    } finally {
      button.disabled = false;
    }
  });

  $("btnLogoutAdmin").addEventListener("click", async event => {
    event.preventDefault();
    if (auth) await auth.signOut();
    setView("registro");
  });

  $("registroBtn").addEventListener("click", event => {
    event.preventDefault();
    setView("registro");
  });
  $("inicioBtn").addEventListener("click", event => {
    event.preventDefault();
    setView("inicio");
  });
  $("historialBtn").addEventListener("click", event => {
    event.preventDefault();
    setView("historial");
  });
  $("buscarHoy").addEventListener("input", renderToday);
  $("buscarHistorial").addEventListener("input", renderHistory);
  $("fechaHistorial").addEventListener("change", () => { void refreshAdminViews(); });
  $("btnExcel").addEventListener("click", () => {
    const rows = [
      ["Nombre", "Tipo", "Fecha", "Hora"],
      ...historyEntries.map(entry => [
        `${entry.nombre} ${entry.apellidos}`,
        entry.tipo,
        attendeeDate(entry),
        attendeeTime(entry)
      ])
    ];
    const csv = "\uFEFF" + rows.map(row => row.map(escapeCsv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `Entradas_Auditorio_${$("fechaHistorial").value}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });
  $("btnPdf").addEventListener("click", () => window.print());

  let logoClicks = 0;
  let logoTimer = null;
  $("logoMapache").addEventListener("click", () => {
    logoClicks++;
    clearTimeout(logoTimer);
    logoTimer = setTimeout(() => { logoClicks = 0; }, 1200);
    if (logoClicks >= 3) {
      logoClicks = 0;
      if (!auth?.currentUser) setView("adminLogin");
    }
  });
  document.addEventListener("keydown", event => {
    if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === "A" && !auth?.currentUser) {
      event.preventDefault();
      setView("adminLogin");
    }
  });

  function updateClock() {
    const now = new Date();
    $("hora").textContent = now.toLocaleTimeString("es-MX");
    $("fecha").textContent = now.toLocaleDateString("es-MX", {
      weekday: "long", day: "numeric", month: "long", year: "numeric"
    });
  }

  function initSnow() {
    const canvas = $("nieve");
    const context = canvas.getContext("2d");
    const motionReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    snowActive = !motionReduced;

    function resize() {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      snowflakes = Array.from({ length: Math.min(80, Math.round(width * height / 18000)) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 1.5 + Math.random() * 2.5,
        speed: 0.4 + Math.random() * 0.8
      }));
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(165, 243, 252, 0.8)";
      context.shadowColor = "rgba(139, 92, 246, 0.65)";
      context.shadowBlur = 5;
      for (const flake of snowflakes) {
        context.beginPath();
        context.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
        context.fill();
        flake.y += flake.speed;
        if (flake.y > height + 10) {
          flake.y = -10;
          flake.x = Math.random() * width;
        }
      }
      snowFrame = requestAnimationFrame(draw);
    }

    function applySnow() {
      cancelAnimationFrame(snowFrame);
      canvas.style.display = snowActive ? "block" : "none";
      $("nieveBtn").textContent = snowActive ? "❄️ Nieve: activada" : "❄️ Nieve: apagada";
      if (snowActive) {
        resize();
        draw();
      } else {
        context.clearRect(0, 0, width, height);
      }
    }

    $("nieveBtn").addEventListener("click", () => {
      snowActive = !snowActive;
      applySnow();
    });
    window.addEventListener("resize", () => { if (snowActive) resize(); });
    applySnow();
  }

  function renderLights() {
    const container = $("luces");
    const colors = ["#a855f7", "#00e5ff", "#38bdf8", "#ec4899"];
    container.replaceChildren();
    const count = Math.max(8, Math.floor(window.innerWidth / 46));
    for (let index = 0; index < count; index++) {
      const bulb = document.createElement("span");
      bulb.className = "bombilla";
      bulb.style.setProperty("--c", colors[index % colors.length]);
      bulb.style.animationDelay = `${(Math.random() * 2).toFixed(2)}s`;
      if (index % 2) bulb.style.marginTop = "9px";
      container.appendChild(bulb);
    }
  }

  $("fechaHistorial").value = localDateKey();
  updateClock();
  window.setInterval(updateClock, 1000);
  renderLights();
  window.addEventListener("resize", renderLights);
  initSnow();

  if (!configReady) {
    $("configWarning").textContent = "Falta configurar Firebase. Sigue los pasos de README.md y completa firebase-config.js y las reglas de Firestore antes de usar los registros.";
    $("configWarning").hidden = false;
    $("btnRegistrar").disabled = true;
    setView("registro");
    return;
  }

  try {
    firebase.initializeApp(config);
    auth = firebase.auth();
    firestore = firebase.firestore();
    $("conexion").hidden = false;
    $("conexionTexto").textContent = "Formulario listo";
    auth.onAuthStateChanged(user => {
      if (user && user.uid === adminUid) {
        $("conexion").classList.add("ok");
        setView("inicio");
      } else {
        if (user) void auth.signOut();
        setView("registro");
      }
    });
    window.setInterval(() => {
      if (auth.currentUser && (!$("historial").hidden || !$("inicio").hidden)) {
        void refreshAdminViews();
      }
    }, 15000);
  } catch (error) {
    console.error("No se pudo inicializar Firebase:", error);
    $("configWarning").textContent = "No se pudo inicializar Firebase. Revisa la configuración web del proyecto.";
    $("configWarning").hidden = false;
    $("btnRegistrar").disabled = true;
  }
})();
