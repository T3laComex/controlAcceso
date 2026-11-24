const CONFIG = {
  API_URL: "",          // Endpoint de tu backend para Tbl_accesos
  INTERVALO_MS: 3000,
  ADMIN_PASS: "ADMIN123"
};

/* Carreras por Nivel (TBL_Alumnos_ILB) */
const CARRERAS_POR_NIVEL = {
  "Medio Superior": [
    "Técnico en Informática",
    "Técnico en Administración",
    "Técnico en Contabilidad",
    "Bachillerato General"
  ],
  "Superior": [
    "Ingeniería en Sistemas Computacionales",
    "Licenciatura en Informática Administrativa",
    "Licenciatura en Administración",
    "Licenciatura en Contaduría Pública",
    "Licenciatura en Derecho"
  ]
};

/* Estados de Tbl_accesos (entrada, salida, break, sanitario) */
const ESTADOS = {
  ENTRADA:        { texto: "ENTRADA",                 clase: "dentro", dentro: true  },
  SALIDA:         { texto: "SALIDA",                  clase: "fuera",  dentro: false },
  SANITARIO:      { texto: "SANITARIO",               clase: "bano",   dentro: false },
  BANO:           { texto: "SANITARIO",               clase: "bano",   dentro: false },
  BREAK:          { texto: "BREAK",                   clase: "coffee", dentro: false },
  COFFEE_SALIDA:  { texto: "BREAK",                   clase: "coffee", dentro: false },
  REGRESO:        { texto: "REGRESO",                 clase: "dentro", dentro: true  },
  COFFEE_ENTRADA: { texto: "REGRESO DE BREAK",        clase: "dentro", dentro: true  }
};
const ESTADO_DESCONOCIDO = { texto: "", clase: "otro", dentro: false };
const LIMITES_MIN = { SANITARIO: 10, BANO: 10, BREAK: 30, COFFEE_SALIDA: 30 };
const ETIQUETA_CORTA = { SANITARIO: "sanitario", BANO: "sanitario", BREAK: "break", COFFEE_SALIDA: "break" };

/* Catálogo tbl_estado */
const TBL_ESTADO = [
  { id_estado: 1, descripcion: "Activo" },
  { id_estado: 2, descripcion: "Especial" },
  { id_estado: 3, descripcion: "Graduado" }
];

/* Base de datos relacional en localStorage */
let db = JSON.parse(localStorage.getItem("ilb_relacional_db")) || {
  TBL_Alumnos_ILB: [],
  tbl_Profesor: [],
  tbl_invitado: [],
  tbl_estado: TBL_ESTADO,
  tbl_codigos_qr: []
};

document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);

  let esAdmin = false;
  let registros = [];
  let diaActual = claveDia(new Date());
  let fechaVista = diaActual;
  let registrosVista = [];
  let estadoVista = "ok";
  let tokenVista = 0;
  let ultimaLista = [];
  let idsVistos = new Set();
  let primeraCarga = true;

  let currentQrObj = null;
  let currentModalPayload = null;

  function saveDatabase() {
    localStorage.setItem("ilb_relacional_db", JSON.stringify(db));
  }

  function registrarCodigoQR(tablaOrigen, idReferencia, nombreCompleto) {
    const idQr = `QR-${tablaOrigen === "TBL_Alumnos_ILB" ? "ALU" : tablaOrigen === "tbl_Profesor" ? "PROF" : "INV"}-${idReferencia}`;
    const existe = db.tbl_codigos_qr.find(q => q.id_qr === idQr);
    if (!existe) {
      db.tbl_codigos_qr.push({
        id_qr: idQr,
        tabla_origen: tablaOrigen,
        id_referencia: String(idReferencia),
        titular: nombreCompleto,
        fecha_emision: claveDia(new Date()),
        activo: true
      });
    }
    return idQr;
  }

  /* ---------- UTILIDADES FECHA/HORA ---------- */
  function claveDia(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function fechaDesdeClave(c) { const [y, m, d] = c.split("-").map(Number); return new Date(y, m - 1, d); }
  function sumarDias(c, n) { const d = fechaDesdeClave(c); d.setDate(d.getDate() + n); return claveDia(d); }
  function fechaLarga(c) {
    return fechaDesdeClave(c).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  const formatoHora = d => d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const formatoFecha = d => d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });

  function claveEstado(e) { return String(e || "").toUpperCase().trim(); }
  function infoEstado(estado) {
    const c = claveEstado(estado);
    return ESTADOS[c] || { ...ESTADO_DESCONOCIDO, texto: c || "SIN ESTADO" };
  }
  function crearBadge(estado) {
    const info = infoEstado(estado);
    const s = document.createElement("span");
    s.className = "badge " + info.clase;
    s.textContent = info.texto;
    return s;
  }
  function celda(contenido) {
    const td = document.createElement("td");
    if (contenido instanceof Node) td.appendChild(contenido);
    else td.textContent = contenido;
    return td;
  }
  function filaVacia(cols, mensaje) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = cols;
    td.className = "vacio";
    td.textContent = mensaje;
    tr.appendChild(td);
    return tr;
  }
  function coincide(r, texto) {
    if (!texto) return true;
    const t = texto.toLowerCase();
    return [r.id, r.nombre, r.grupo].some(v => String(v ?? "").toLowerCase().includes(t));
  }
  function textoMin(m) {
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
  }

  /* ---------- NAVEGACIÓN POR ROL (PÚBLICO vs ADMIN) ---------- */
  const todasLasSecciones = ["registro", "adminLogin", "inicio", "historial", "invitado"];

  function ocultarTodas() {
    todasLasSecciones.forEach(sec => { $(sec).hidden = true; });
    document.querySelectorAll(".menu a").forEach(a => a.classList.remove("activo"));
  }

  function mostrarVistaPublica(vista) {
    ocultarTodas();
    $("menuPublico").hidden = false;
    $("menuAdmin").hidden = true;
    if (vista === "adminLogin") {
      $("adminLogin").hidden = false;
      $("adminLoginBtn").classList.add("activo");
    } else {
      $("registro").hidden = false;
      $("registroBtn").classList.add("activo");
    }
  }

  function mostrarVistaAdmin(vista) {
    if (!esAdmin) {
      mostrarVistaPublica("adminLogin");
      return;
    }
    ocultarTodas();
    $("menuPublico").hidden = true;
    $("menuAdmin").hidden = false;

    if (vista === "historial") {
      $("historial").hidden = false;
      $("historialBtn").classList.add("activo");
    } else if (vista === "invitado") {
      $("invitado").hidden = false;
      $("invitadoBtn").classList.add("activo");
    } else {
      $("inicio").hidden = false;
      $("inicioBtn").classList.add("activo");
    }
  }

  // Eventos del menú público
  $("registroBtn").addEventListener("click", e => { e.preventDefault(); mostrarVistaPublica("registro"); });
  $("adminLoginBtn").addEventListener("click", e => { e.preventDefault(); mostrarVistaPublica("adminLogin"); });

  // Eventos del menú administrador
  $("inicioBtn").addEventListener("click", e => { e.preventDefault(); mostrarVistaAdmin("inicio"); });
  $("historialBtn").addEventListener("click", e => { e.preventDefault(); mostrarVistaAdmin("historial"); });
  $("invitadoBtn").addEventListener("click", e => { e.preventDefault(); mostrarVistaAdmin("invitado"); });
  $("btnHistorial").addEventListener("click", () => mostrarVistaAdmin("historial"));

  // Login Administrador
  $("formAdminLogin").addEventListener("submit", e => {
    e.preventDefault();
    if ($("adminPasswordInput").value === CONFIG.ADMIN_PASS) {
      esAdmin = true;
      $("adminPasswordInput").value = "";
      mostrarVistaAdmin("inicio"); // Entra directo al Monitor en Vivo
      render();
    } else {
      alert("Contraseña incorrecta. Intente de nuevo.");
    }
  });

  // Cerrar Sesión Administrador
  $("btnLogoutAdmin").addEventListener("click", e => {
    e.preventDefault();
    esAdmin = false;
    mostrarVistaPublica("registro");
  });

  /* ---------- RELOJ + REINICIO DIARIO ---------- */
  function actualizarReloj() {
    const ahora = new Date();
    $("hora").textContent = formatoHora(ahora);
    $("fecha").textContent = ahora.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    const hoy = claveDia(ahora);
    if (hoy !== diaActual) {
      const estabaEnHoy = fechaVista === diaActual;
      diaActual = hoy;
      registros = [];
      idsVistos = new Set();
      primeraCarga = true;
      if (estabaEnHoy) fechaVista = hoy;
      $("fechaHistorial").max = hoy;
      $("diaSiguiente").disabled = fechaVista >= hoy;
      $("fechaHistorial").value = fechaVista;
      render();
      cargarDatos();
    }
  }

  /* ---------- MONITOR EN VIVO & HISTORIAL (Tbl_accesos) ---------- */
  function tiempoEnEstado(r) {
    const lim = LIMITES_MIN[claveEstado(r.estado)];
    if (!lim) return null;
    const ms = Date.now() - r._fecha.getTime();
    return { min: Math.max(0, Math.floor(ms / 60000)), lim, excedido: ms > lim * 60000 };
  }

  function estadoActualPorAlumno() {
    const mapa = new Map();
    registros.forEach(r => mapa.set(String(r.id), r));
    return [...mapa.values()];
  }

  function animarNumero(el, valor) {
    if (el.textContent !== String(valor)) {
      el.textContent = valor;
      el.classList.remove("cambio");
      void el.offsetWidth;
      el.classList.add("cambio");
    }
  }

  function render() {
    const actuales = estadoActualPorAlumno();
    const dentro = actuales.filter(r => infoEstado(r.estado).dentro).length;
    animarNumero($("totalAlumnos"), actuales.length);
    animarNumero($("alumnosDentro"), dentro);
    animarNumero($("alumnosFuera"), actuales.length - dentro);
    renderInicio();
    renderHistorial();
    primeraCarga = false;
  }

  function renderInicio() {
    const cuerpo = $("tablaInicio");
    const filtro = $("buscarInicio").value.trim();
    const items = estadoActualPorAlumno().map(r => ({ r, t: tiempoEnEstado(r) }));

    const excedidos = items.filter(x => x.t && x.t.excedido);
    const banner = $("alertaTiempo");
    if (excedidos.length) {
      const nombres = excedidos.slice(0, 3).map(x =>
        `${x.r.nombre} (${ETIQUETA_CORTA[claveEstado(x.r.estado)]} · ${textoMin(x.t.min)})`
      ).join(", ");
      const extra = excedidos.length > 3 ? ` y ${excedidos.length - 3} más` : "";
      banner.textContent = `⚠ ${excedidos.length} usuario${excedidos.length === 1 ? "" : "s"} excede${excedidos.length === 1 ? "" : "n"} el tiempo permitido: ${nombres}${extra}.`;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }

    const lista = items
      .filter(x => coincide(x.r, filtro))
      .sort((a, b) => (b.t?.excedido ? 1 : 0) - (a.t?.excedido ? 1 : 0) || b.r._fecha - a.r._fecha);

    cuerpo.replaceChildren();
    if (!lista.length) {
      cuerpo.appendChild(filaVacia(7, filtro ? "Sin resultados para tu búsqueda." : "Aún no hay registros en Tbl_accesos hoy. Esperando escaneos…"));
      return;
    }

    lista.forEach(({ r, t }) => {
      const tr = document.createElement("tr");
      if (t && t.excedido) tr.className = "fila-alerta";
      const tiempo = document.createElement("span");
      if (t) {
        tiempo.className = "tiempo" + (t.excedido ? " excedido" : "");
        tiempo.textContent = (t.excedido ? "⚠ " : "⏱ ") + textoMin(t.min) + ` (máx. ${t.lim})`;
      } else {
        tiempo.textContent = "—";
      }
      tr.append(
        celda(r.id),
        celda(r.nombre),
        celda(r.grupo),
        celda(crearBadge(r.estado)),
        celda(formatoFecha(r._fecha)),
        celda(formatoHora(r._fecha)),
        celda(tiempo)
      );
      cuerpo.appendChild(tr);
    });
  }

  function renderHistorial() {
    const cuerpo = $("tablaHistorial");
    const filtro = $("buscarHistorial").value.trim();
    const estado = $("filtroEstado").value;
    const esHoy = fechaVista === diaActual;
    const base = esHoy ? registros : registrosVista;

    const filtrados = base.filter(r => coincide(r, filtro) && (!estado || claveEstado(r.estado) === estado));
    ultimaLista = filtrados;

    cuerpo.replaceChildren();
    if (estadoVista === "cargando") {
      $("resumenHistorial").textContent = "Cargando…";
      cuerpo.appendChild(filaVacia(6, "Cargando movimientos…"));
    } else if (estadoVista === "error") {
      $("resumenHistorial").textContent = "";
      cuerpo.appendChild(filaVacia(6, "No se pudo cargar ese día. Revisa la conexión con el servidor."));
    } else {
      $("resumenHistorial").textContent =
        `${fechaLarga(fechaVista)} · ${filtrados.length} movimiento${filtrados.length === 1 ? "" : "s"}` +
        (filtrados.length !== base.length ? ` (de ${base.length})` : "");
      if (!filtrados.length) {
        cuerpo.appendChild(filaVacia(6, base.length
          ? "Sin resultados para tu filtro."
          : esHoy ? "Aún no hay movimientos hoy." : "No hay movimientos registrados este día."));
      }
      filtrados.slice().reverse().forEach(r => {
        const tr = document.createElement("tr");
        if (esHoy && !primeraCarga && !idsVistos.has(r._clave)) tr.className = "fila-nueva";
        tr.append(
          celda(r.id),
          celda(r.nombre),
          celda(r.grupo),
          celda(crearBadge(r.estado)),
          celda(formatoFecha(r._fecha)),
          celda(formatoHora(r._fecha))
        );
        cuerpo.appendChild(tr);
      });
    }
    registros.forEach(r => idsVistos.add(r._clave));
  }

  async function cambiarFecha(f) {
    if (!f) return;
    if (f > diaActual) f = diaActual;
    fechaVista = f;
    $("fechaHistorial").value = f;
    $("diaSiguiente").disabled = f >= diaActual;
    const token = ++tokenVista;

    if (f === diaActual) { estadoVista = "ok"; renderHistorial(); return; }

    estadoVista = "cargando";
    registrosVista = [];
    renderHistorial();
    try {
      const datos = await obtenerDia(f);
      if (token !== tokenVista) return;
      registrosVista = normalizar(datos, f);
      estadoVista = "ok";
    } catch (err) {
      console.error(err);
      if (token !== tokenVista) return;
      estadoVista = "error";
    }
    renderHistorial();
  }

  async function obtenerDia(f) {
    if (!CONFIG.API_URL) throw new Error("API_URL no configurada");
    const resp = await fetch(`${CONFIG.API_URL}?fecha=${f}`, { cache: "no-store" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const d = await resp.json();
    return Array.isArray(d) ? d : [];
  }

  $("fechaHistorial").max = diaActual;
  $("fechaHistorial").value = fechaVista;
  $("diaSiguiente").disabled = true;
  $("fechaHistorial").addEventListener("change", e => cambiarFecha(e.target.value));
  $("diaAnterior").addEventListener("click", () => cambiarFecha(sumarDias(fechaVista, -1)));
  $("diaSiguiente").addEventListener("click", () => cambiarFecha(sumarDias(fechaVista, 1)));
  $("btnHoy").addEventListener("click", () => cambiarFecha(diaActual));

  /* Exportar CSV / PDF */
  $("btnExcel").addEventListener("click", () => {
    if (!ultimaLista.length) { alert("No hay movimientos para exportar en este día."); return; }
    const esc = v => {
      let s = String(v ?? "");
      if (/^\d+$/.test(s)) return `="${s}"`;
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const filas = [
      ["ID/Matricula", "Nombre", "Grupo", "Movimiento", "Fecha", "Hora"],
      ...ultimaLista.map(r => [r.id, r.nombre, r.grupo, infoEstado(r.estado).texto, formatoFecha(r._fecha), formatoHora(r._fecha)])
    ];
    const csv = "\uFEFF" + filas.map(f => f.map(esc).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Tbl_accesos_${fechaVista}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $("btnPdf").addEventListener("click", () => {
    const tituloOriginal = document.title;
    $("impFecha").textContent = fechaLarga(fechaVista);
    document.title = `Historial ${fechaVista}`;
    window.print();
    document.title = tituloOriginal;
  });

  ["ENTRADA", "SALIDA", "BREAK", "SANITARIO"].forEach(clave => {
    const o = document.createElement("option");
    o.value = clave;
    o.textContent = ESTADOS[clave].texto;
    $("filtroEstado").appendChild(o);
  });
  $("buscarInicio").addEventListener("input", renderInicio);
  $("buscarHistorial").addEventListener("input", renderHistorial);
  $("filtroEstado").addEventListener("change", renderHistorial);

  function marcarConexion(ok, texto) {
    $("conexion").classList.toggle("ok", ok);
    $("conexion").classList.toggle("error", !ok);
    $("conexionTexto").textContent = texto;
  }

  function normalizar(lista, dia) {
    return lista
      .map(r => ({ ...r, _fecha: new Date(r.fecha_hora) }))
      .filter(r => !isNaN(r._fecha) && claveDia(r._fecha) === dia)
      .sort((a, b) => a._fecha - b._fecha)
      .map(r => ({ ...r, _clave: `${r.id}|${r.fecha_hora}|${r.estado}` }));
  }

  async function cargarDatos() {
    if (!CONFIG.API_URL) { marcarConexion(false, "Modo Local (Sin API_URL)"); return; }
    try {
      registros = normalizar(await obtenerDia(diaActual), diaActual);
      marcarConexion(true, "En vivo · " + formatoHora(new Date()));
      render();
    } catch (err) {
      console.error("Error al consultar la API:", err);
      marcarConexion(false, "Sin conexión con el servidor");
    }
  }

  /* ---------- REGISTRO PÚBLICO (TBL_Alumnos_ILB & tbl_Profesor) ---------- */
  $("tabAlumno").addEventListener("click", () => {
    $("tabAlumno").classList.add("activo");
    $("tabProfesor").classList.remove("activo");
    $("formAlumno").hidden = false;
    $("formProfesor").hidden = true;
  });

  $("tabProfesor").addEventListener("click", () => {
    $("tabProfesor").classList.add("activo");
    $("tabAlumno").classList.remove("activo");
    $("formProfesor").hidden = false;
    $("formAlumno").hidden = true;
  });

  $("alumnoNivel").addEventListener("change", e => {
    const nivel = e.target.value;
    const selectCarrera = $("alumnoCarrera");
    selectCarrera.innerHTML = '<option value="">-- Seleccionar Carrera --</option>';
    if (CARRERAS_POR_NIVEL[nivel]) {
      CARRERAS_POR_NIVEL[nivel].forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        selectCarrera.appendChild(opt);
      });
    }
  });

  // Registro Alumno (TBL_Alumnos_ILB)
  $("formAlumno").addEventListener("submit", e => {
    e.preventDefault();
    const nombre = $("alumnoNombre").value.trim();
    const apellido_paterno = $("alumnoPaterno").value.trim();
    const apellido_materno = $("alumnoMaterno").value.trim();
    const matricula = $("alumnoMatricula").value.trim();
    const correo_institucional = $("alumnoCorreo").value.trim();
    const estatus = $("alumnoEstado").value;
    const nivel = $("alumnoNivel").value;
    const carrera = $("alumnoCarrera").value;
    const grupo = $("alumnoGrupo").value;

    if (!/^[0-9]{10}$/.test(matricula)) {
      alert("La matrícula debe contener exactamente 10 dígitos numéricos.");
      return;
    }

    const estadoObj = TBL_ESTADO.find(st => st.descripcion === estatus) || TBL_ESTADO[0];
    const nombreCompleto = `${nombre} ${apellido_paterno} ${apellido_materno}`;

    const alumnoRecord = {
      id_alumno: db.TBL_Alumnos_ILB.length + 1,
      nombre,
      apellido_paterno,
      apellido_materno,
      grupo,
      carrera,
      nivel,
      matricula,
      correo_institucional,
      id_estado: estadoObj.id_estado,
      estatus: estadoObj.descripcion
    };

    db.TBL_Alumnos_ILB.push(alumnoRecord);
    const id_qr = registrarCodigoQR("TBL_Alumnos_ILB", matricula, nombreCompleto);
    saveDatabase();

    $("formAlumno").reset();
    $("alumnoCarrera").innerHTML = '<option value="">-- Primero selecciona el nivel --</option>';

    showQrModal({
      id_qr,
      tabla: "TBL_Alumnos_ILB",
      nombre_completo: nombreCompleto,
      correo: correo_institucional,
      datos: alumnoRecord
    });
  });

  // Registro Profesor (tbl_Profesor)
  $("formProfesor").addEventListener("submit", e => {
    e.preventDefault();
    const nombre = $("profesorNombre").value.trim();
    const apellido_paterno = $("profesorPaterno").value.trim();
    const apellido_materno = $("profesorMaterno").value.trim();
    const num_credencial = $("profesorCredencial").value.trim();
    const correo_institucional = $("profesorCorreo").value.trim();
    const nombreCompleto = `${nombre} ${apellido_paterno} ${apellido_materno}`;

    const profRecord = {
      id_profesor: db.tbl_Profesor.length + 1,
      nombre,
      apellido_paterno,
      apellido_materno,
      correo_institucional,
      num_credencial
    };

    db.tbl_Profesor.push(profRecord);
    const id_qr = registrarCodigoQR("tbl_Profesor", num_credencial, nombreCompleto);
    saveDatabase();
    $("formProfesor").reset();

    showQrModal({
      id_qr,
      tabla: "tbl_Profesor",
      nombre_completo: nombreCompleto,
      correo: correo_institucional,
      datos: profRecord
    });
  });

  /* ---------- GENERAR INVITADO (SOLO ADMIN) ---------- */
  $("formGuest").addEventListener("submit", e => {
    e.preventDefault();
    const nombre = $("guestNombre").value.trim();
    const apellido_paterno = $("guestPaterno").value.trim();
    const apellido_materno = $("guestMaterno").value.trim();
    const correo = $("guestCorreo").value.trim();
    const nombreCompleto = `${nombre} ${apellido_paterno} ${apellido_materno}`;
    const nuevoId = db.tbl_invitado.length + 1;

    const guestRecord = {
      id_invitado: nuevoId,
      nombre,
      apellido_paterno,
      apellido_materno,
      correo
    };

    db.tbl_invitado.push(guestRecord);
    const id_qr = registrarCodigoQR("tbl_invitado", `INV-${nuevoId}`, nombreCompleto);
    saveDatabase();
    $("formGuest").reset();

    showQrModal({
      id_qr,
      tabla: "tbl_invitado",
      nombre_completo: nombreCompleto,
      correo,
      datos: guestRecord
    });
  });

  /* ---------- MODAL QR ---------- */
  function showQrModal(payload) {
    currentModalPayload = payload;
    $("modalBadgeQr").textContent = payload.id_qr;
    $("modalTitle").textContent = payload.nombre_completo;
    $("modalSub").textContent = `Tabla: ${payload.tabla}`;
    $("modalJson").textContent = JSON.stringify(payload, null, 2);

    const container = $("qrContainer");
    container.innerHTML = "";

    currentQrObj = new QRCodeStyling({
      width: 210,
      height: 210,
      type: "canvas",
      data: JSON.stringify(payload),
      dotsOptions: { color: "#7A003C", type: "rounded" },
      backgroundOptions: { color: "#ffffff" },
      cornersSquareOptions: { color: "#2471A3", type: "extra-rounded" }
    });

    currentQrObj.append(container);
    $("qrModal").hidden = false;
  }

  $("btnCloseModal").addEventListener("click", () => { $("qrModal").hidden = true; });
  $("qrModal").addEventListener("click", e => {
    if (e.target === $("qrModal")) $("qrModal").hidden = true;
  });

  $("btnDownloadQR").addEventListener("click", () => {
    if (currentQrObj && currentModalPayload) {
      currentQrObj.download({ name: `${currentModalPayload.id_qr}`, extension: "png" });
    }
  });

  $("btnEmailQR").addEventListener("click", () => {
    if (!currentModalPayload) return;
    if (currentQrObj) {
      currentQrObj.download({ name: `${currentModalPayload.id_qr}`, extension: "png" });
    }
    const asunto = encodeURIComponent(`Credencial QR de Acceso (${currentModalPayload.id_qr}) - Instituto Leonardo Bravo`);
    const cuerpo = encodeURIComponent(
      `Hola ${currentModalPayload.nombre_completo},\n\n` +
      `Se ha generado tu código QR de acceso para el Instituto Leonardo Bravo (Plantel Centro).\n\n` +
      `• Folio QR (tbl_codigos_qr): ${currentModalPayload.id_qr}\n` +
      `• Registro en: ${currentModalPayload.tabla}\n` +
      `\n(Adjunta en este correo la imagen PNG del código QR que se acaba de descargar).\n\n` +
      `Atentamente,\nControl de Acceso · Semana de Informática XXXIII`
    );
    window.open(`mailto:${currentModalPayload.correo}?subject=${asunto}&body=${cuerpo}`, "_blank");
  });

  /* ---------- NIEVE Y LUCES NAVIDEÑAS ---------- */
  (function nieve() {
    const canvas = $("nieve"), ctx = canvas.getContext("2d"), btn = $("nieveBtn");
    const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let guardado = null;
    try { guardado = localStorage.getItem("nieve"); } catch (e) {}
    let activa = guardado ? guardado === "on" : !reducir;
    let w = 0, h = 0, copos = [], raf = null;

    const nuevo = inicial => ({
      x: Math.random() * w, y: inicial ? Math.random() * h : -10,
      r: 1.5 + Math.random() * 3.2, v: 0.5 + Math.random() * 1.1,
      a: Math.random() * 6.28, s: 0.01 + Math.random() * 0.02
    });

    function ajustar() {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      copos = Array.from({ length: Math.min(90, Math.round(w * h / 15000)) }, () => nuevo(true));
    }
    function cuadro() {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.shadowColor = "rgba(80,120,170,.6)"; ctx.shadowBlur = 4;
      copos.forEach((c, i) => {
        c.a += c.s; c.y += c.v * (0.5 + c.r / 4); c.x += Math.sin(c.a) * 0.6;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 6.283); ctx.fill();
        if (c.y > h + 10 || c.x < -20 || c.x > w + 20) copos[i] = nuevo(false);
      });
      raf = requestAnimationFrame(cuadro);
    }
    function aplicar() {
      cancelAnimationFrame(raf); raf = null;
      btn.textContent = activa ? "❄️ Nieve: activada" : "❄️ Nieve: apagada";
      canvas.style.display = activa ? "block" : "none";
      if (activa) { ajustar(); cuadro(); } else ctx.clearRect(0, 0, w, h);
    }
    btn.addEventListener("click", () => {
      activa = !activa;
      try { localStorage.setItem("nieve", activa ? "on" : "off"); } catch (e) {}
      aplicar();
    });
    window.addEventListener("resize", () => { if (activa) ajustar(); });
    aplicar();
  })();

  function luces() {
    const cont = $("luces"), colores = ["#ff3b3b", "#ffd23f", "#3bd16f", "#4aa8ff"];
    cont.replaceChildren();
    const n = Math.max(8, Math.floor(window.innerWidth / 46));
    for (let i = 0; i < n; i++) {
      const b = document.createElement("span");
      b.className = "bombilla";
      b.style.setProperty("--c", colores[i % colores.length]);
      b.style.animationDelay = (Math.random() * 2).toFixed(2) + "s";
      if (i % 2) b.style.marginTop = "9px";
      cont.appendChild(b);
    }
  }
  luces();
  let tLuces;
  window.addEventListener("resize", () => { clearTimeout(tLuces); tLuces = setTimeout(luces, 250); });

  /* ---------- ARRANQUE ---------- */
  mostrarVistaPublica("registro");
  actualizarReloj();
  setInterval(actualizarReloj, 1000);
  setInterval(renderInicio, 15000);
  cargarDatos();
  if (CONFIG.API_URL) setInterval(cargarDatos, CONFIG.INTERVALO_MS);
  render();
});