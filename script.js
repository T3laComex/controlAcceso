const CONFIG = {
  API_URL: "api.php",          // Endpoint de tu backend PHP/Node en WampServer
  INTERVALO_MS: 3000,
  ADMIN_PASS: "ADMIN123"
};

/* Carreras por Nivel según especificaciones */
const CARRERAS_POR_NIVEL = {
  "Medio Superior": [
    "Bachillerato Informático",
    "Otro"
  ],
  "Superior": [
    "Licenciatura en Ciencias de la Informática",
    "Otro"
  ]
};

/* Estados de acceso (entrada, salida, break, sanitario) */
const ESTADOS = {
  ENTRADA:        { texto: "ENTRADA",          clase: "dentro", dentro: true  },
  SALIDA:         { texto: "SALIDA",           clase: "fuera",  dentro: false },
  SANITARIO:      { texto: "SANITARIO",        clase: "bano",   dentro: false },
  BANO:           { texto: "SANITARIO",        clase: "bano",   dentro: false },
  BREAK:          { texto: "BREAK",            clase: "coffee", dentro: false },
  COFFEE_SALIDA:  { texto: "BREAK",            clase: "coffee", dentro: false },
  REGRESO:        { texto: "REGRESO",          clase: "dentro", dentro: true  },
  COFFEE_ENTRADA: { texto: "REGRESO DE BREAK", clase: "dentro", dentro: true  }
};
const ESTADO_DESCONOCIDO = { texto: "", clase: "otro", dentro: false };
const LIMITES_MIN = { SANITARIO: 10, BANO: 10, BREAK: 30, COFFEE_SALIDA: 30 };
const ETIQUETA_CORTA = { SANITARIO: "sanitario", BANO: "sanitario", BREAK: "break", COFFEE_SALIDA: "break" };

/* Base de datos local (sincronizable con MySQL WampServer) */
let db = JSON.parse(localStorage.getItem("ilb_relacional_db")) || {
  alumnos: [],
  profesores: [],
  invitados: [],
  codigos_qr: []
};

// Compatibilidad si existían datos previos con los nombres viejos
if (db.TBL_Alumnos_ILB && !db.alumnos) db.alumnos = db.TBL_Alumnos_ILB;
if (db.tbl_Profesor && !db.profesores) db.profesores = db.tbl_Profesor;
if (db.tbl_invitado && !db.invitados) db.invitados = db.tbl_invitado;
if (!db.alumnos) db.alumnos = [];
if (!db.profesores) db.profesores = [];
if (!db.invitados) db.invitados = [];
if (!db.codigos_qr) db.codigos_qr = [];

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
  let dbVistaActual = "alumnos"; // "alumnos" | "profesores" | "invitados"

  function saveDatabase() {
    localStorage.setItem("ilb_relacional_db", JSON.stringify(db));
  }

  function registrarCodigoQR(tipo, idReferencia, nombreCompleto) {
    const prefijo = tipo === "alumnos" ? "ALU" : tipo === "profesores" ? "PROF" : "INV";
    const idQr = `QR-${prefijo}-${idReferencia}`;
    const existe = db.codigos_qr.find(q => q.id_qr === idQr);
    if (!existe) {
      db.codigos_qr.push({
        id_qr: idQr,
        tipo,
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

  /* ---------- ACCESO SECRETO ADMINISTRADOR (3 CLICS EN MAPACHE O CTRL+SHIFT+A) ---------- */
  let clicsMapache = 0;
  let timerClics = null;

  $("logoMapache").addEventListener("click", () => {
    clicsMapache++;
    clearTimeout(timerClics);
    timerClics = setTimeout(() => { clicsMapache = 0; }, 1200);

    if (clicsMapache >= 3) {
      clicsMapache = 0;
      if (!esAdmin) {
        mostrarVistaPublica("adminLogin");
      }
    }
  });

  document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === "A") {
      e.preventDefault();
      if (!esAdmin) mostrarVistaPublica("adminLogin");
    }
  });

  /* ---------- NAVEGACIÓN POR ROL (PÚBLICO vs ADMIN) ---------- */
  const todasLasSecciones = ["registro", "adminLogin", "inicio", "historial", "invitado", "baseDatos"];

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
      $("adminPasswordInput").focus();
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
    } else if (vista === "baseDatos") {
      $("baseDatos").hidden = false;
      $("baseDatosBtn").classList.add("activo");
      renderBaseDatos();
    } else {
      $("inicio").hidden = false;
      $("inicioBtn").classList.add("activo");
    }
  }

  $("registroBtn").addEventListener("click", e => { e.preventDefault(); mostrarVistaPublica("registro"); });
  $("inicioBtn").addEventListener("click", e => { e.preventDefault(); mostrarVistaAdmin("inicio"); });
  $("historialBtn").addEventListener("click", e => { e.preventDefault(); mostrarVistaAdmin("historial"); });
  $("invitadoBtn").addEventListener("click", e => { e.preventDefault(); mostrarVistaAdmin("invitado"); });
  $("baseDatosBtn").addEventListener("click", e => { e.preventDefault(); mostrarVistaAdmin("baseDatos"); });
  $("btnHistorial").addEventListener("click", () => mostrarVistaAdmin("historial"));

  $("formAdminLogin").addEventListener("submit", e => {
    e.preventDefault();
    if ($("adminPasswordInput").value === CONFIG.ADMIN_PASS) {
      esAdmin = true;
      $("adminPasswordInput").value = "";
      mostrarVistaAdmin("inicio");
      render();
    } else {
      alert("Contraseña incorrecta. Intente de nuevo.");
    }
  });

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

  /* ---------- MONITOR EN VIVO & HISTORIAL ---------- */
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
      cuerpo.appendChild(filaVacia(7, filtro ? "Sin resultados para tu búsqueda." : "Aún no hay registros de acceso hoy. Esperando escaneos…"));
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
    a.download = `Accesos_ILB_${fechaVista}.csv`;
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

  function normalizar(lista, dia) {
    return lista
      .map(r => ({ ...r, _fecha: new Date(r.fecha_hora) }))
      .filter(r => !isNaN(r._fecha) && claveDia(r._fecha) === dia)
      .sort((a, b) => a._fecha - b._fecha)
      .map(r => ({ ...r, _clave: `${r.id}|${r.fecha_hora}|${r.estado}` }));
  }

  async function cargarDatos() {
    if (!CONFIG.API_URL) return;
    try {
      registros = normalizar(await obtenerDia(diaActual), diaActual);
      $("conexion").hidden = false;
      $("conexion").classList.add("ok");
      $("conexionTexto").textContent = "En vivo · " + formatoHora(new Date());
      render();
    } catch (err) {
      console.error("Error al consultar la API:", err);
    }
  }

  /* ---------- PESTAÑAS DE REGISTRO PÚBLICO (ALUMNO / PROFESOR / INVITADO) ---------- */
  function activarTabRegistro(tab) {
    ["tabAlumno", "tabProfesor", "tabInvitadoPub"].forEach(id => $(id).classList.remove("activo"));
    ["bloqueAlumno", "bloqueProfesor", "bloqueInvitadoPub"].forEach(id => $(id).hidden = true);

    if (tab === "alumno") {
      $("tabAlumno").classList.add("activo");
      $("bloqueAlumno").hidden = false;
    } else if (tab === "profesor") {
      $("tabProfesor").classList.add("activo");
      $("bloqueProfesor").hidden = false;
    } else {
      $("tabInvitadoPub").classList.add("activo");
      $("bloqueInvitadoPub").hidden = false;
    }
  }

  $("tabAlumno").addEventListener("click", () => activarTabRegistro("alumno"));
  $("tabProfesor").addEventListener("click", () => activarTabRegistro("profesor"));
  $("tabInvitadoPub").addEventListener("click", () => activarTabRegistro("invitado"));

  /* ---------- LÓGICA DE COMBOBOX ALUMNO (NIVEL, CARRERA, GRUPO + "OTRO") ---------- */
  $("alumnoNivel").addEventListener("change", e => {
    const nivel = e.target.value;
    const selectCarrera = $("alumnoCarrera");
    selectCarrera.innerHTML = '<option value="">-- Seleccionar Carrera --</option>';
    $("campoCarreraOtra").hidden = true;
    $("alumnoCarreraOtra").required = false;

    if (CARRERAS_POR_NIVEL[nivel]) {
      CARRERAS_POR_NIVEL[nivel].forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        selectCarrera.appendChild(opt);
      });
    }
  });

  $("alumnoCarrera").addEventListener("change", e => {
    const esOtra = e.target.value === "Otro";
    $("campoCarreraOtra").hidden = !esOtra;
    $("alumnoCarreraOtra").required = esOtra;
  });

  $("alumnoGrupo").addEventListener("change", e => {
    const esOtro = e.target.value === "Otro";
    $("campoGrupoOtro").hidden = !esOtro;
    $("alumnoGrupoOtro").required = esOtro;
  });

  /* ---------- FLUJO ALUMNO: PASO 1 CONSULTA / PASO 2 REGISTRO ---------- */
  $("checkAlumnoMatricula").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  });
  $("alumnoMatricula").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  });

  $("formCheckAlumno").addEventListener("submit", e => {
    e.preventDefault();
    const mat = $("checkAlumnoMatricula").value.trim().toUpperCase();
    const correo = $("checkAlumnoCorreo").value.trim().toLowerCase();

    if (!/^[A-Za-z0-9]{10}$/.test(mat)) {
      alert("La matrícula debe tener exactamente 10 caracteres (letras y/o números).");
      return;
    }

    const encontrado = db.alumnos.find(
      a => String(a.matricula).toUpperCase() === mat && String(a.correo_institucional || a.correo).toLowerCase() === correo
    );

    if (encontrado) {
      $("msgNoRegistradoAlumno").hidden = true;
      $("formAlumno").hidden = true;
      const nombreCompleto = `${encontrado.nombre} ${encontrado.apellido_paterno} ${encontrado.apellido_materno}`;
      const id_qr = registrarCodigoQR("alumnos", encontrado.matricula, nombreCompleto);
      saveDatabase();
      showQrModal({
        id_qr,
        nombre_completo: nombreCompleto,
        detalle: `${encontrado.nivel} · ${encontrado.carrera} (${encontrado.grupo})`,
        correo: encontrado.correo_institucional || encontrado.correo
      });
    } else {
      $("msgNoRegistradoAlumno").hidden = false;
      $("formAlumno").hidden = false;
      $("alumnoMatricula").value = mat;
      $("alumnoCorreo").value = correo;
    }
  });

  $("formAlumno").addEventListener("submit", e => {
    e.preventDefault();
    const nombre = $("alumnoNombre").value.trim();
    const apellido_paterno = $("alumnoPaterno").value.trim();
    const apellido_materno = $("alumnoMaterno").value.trim();
    const matricula = $("alumnoMatricula").value.trim().toUpperCase();
    const correo = $("alumnoCorreo").value.trim().toLowerCase();
    const nivel = $("alumnoNivel").value;
    const carreraSel = $("alumnoCarrera").value;
    const carrera = carreraSel === "Otro" ? $("alumnoCarreraOtra").value.trim() : carreraSel;
    const grupoSel = $("alumnoGrupo").value;
    const grupo = grupoSel === "Otro" ? $("alumnoGrupoOtro").value.trim() : grupoSel;

    if (!/^[A-Za-z0-9]{10}$/.test(matricula)) {
      alert("La matrícula debe contener exactamente 10 caracteres (letras y/o números).");
      return;
    }

    const nombreCompleto = `${nombre} ${apellido_paterno} ${apellido_materno}`;
    const id_qr = registrarCodigoQR("alumnos", matricula, nombreCompleto);

    const alumnoRecord = {
      id_alumno: db.alumnos.length + 1,
      nombre,
      apellido_paterno,
      apellido_materno,
      matricula,
      correo,
      nivel,
      carrera,
      grupo,
      codigo_qr: id_qr
    };

    db.alumnos.push(alumnoRecord);
    saveDatabase();

    $("formAlumno").reset();
    $("formCheckAlumno").reset();
    $("formAlumno").hidden = true;
    $("msgNoRegistradoAlumno").hidden = true;
    $("campoCarreraOtra").hidden = true;
    $("campoGrupoOtro").hidden = true;

    showQrModal({
      id_qr,
      nombre_completo: nombreCompleto,
      detalle: `${nivel} · ${carrera} (${grupo})`,
      correo
    });
  });

  /* ---------- FLUJO PROFESOR: PASO 1 CONSULTA / PASO 2 REGISTRO ---------- */
  $("checkProfCredencial").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "");
  });
  $("profesorCredencial").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "");
  });

  $("formCheckProfesor").addEventListener("submit", e => {
    e.preventDefault();
    const cred = $("checkProfCredencial").value.trim();
    const correo = $("checkProfCorreo").value.trim().toLowerCase();

    if (!/^[0-9]{5}$/.test(cred)) {
      alert("El número de credencial debe contener exactamente 5 dígitos numéricos.");
      return;
    }

    const encontrado = db.profesores.find(
      p => String(p.num_credencial) === cred && String(p.correo_institucional || p.correo).toLowerCase() === correo
    );

    if (encontrado) {
      $("msgNoRegistradoProfesor").hidden = true;
      $("formProfesor").hidden = true;
      const nombreCompleto = `${encontrado.nombre} ${encontrado.apellido_paterno} ${encontrado.apellido_materno}`;
      const id_qr = registrarCodigoQR("profesores", encontrado.num_credencial, nombreCompleto);
      saveDatabase();
      showQrModal({
        id_qr,
        nombre_completo: nombreCompleto,
        detalle: `Docente · Credencial ${encontrado.num_credencial}`,
        correo: encontrado.correo_institucional || encontrado.correo
      });
    } else {
      $("msgNoRegistradoProfesor").hidden = false;
      $("formProfesor").hidden = false;
      $("profesorCredencial").value = cred;
      $("profesorCorreo").value = correo;
    }
  });

  $("formProfesor").addEventListener("submit", e => {
    e.preventDefault();
    const nombre = $("profesorNombre").value.trim();
    const apellido_paterno = $("profesorPaterno").value.trim();
    const apellido_materno = $("profesorMaterno").value.trim();
    const num_credencial = $("profesorCredencial").value.trim();
    const correo = $("profesorCorreo").value.trim().toLowerCase();

    if (!/^[0-9]{5}$/.test(num_credencial)) {
      alert("El número de credencial debe contener exactamente 5 dígitos numéricos.");
      return;
    }

    const nombreCompleto = `${nombre} ${apellido_paterno} ${apellido_materno}`;
    const id_qr = registrarCodigoQR("profesores", num_credencial, nombreCompleto);

    const profRecord = {
      id_profesor: db.profesores.length + 1,
      nombre,
      apellido_paterno,
      apellido_materno,
      num_credencial,
      correo,
      codigo_qr: id_qr
    };

    db.profesores.push(profRecord);
    saveDatabase();

    $("formProfesor").reset();
    $("formCheckProfesor").reset();
    $("formProfesor").hidden = true;
    $("msgNoRegistradoProfesor").hidden = true;

    showQrModal({
      id_qr,
      nombre_completo: nombreCompleto,
      detalle: `Docente · Credencial ${num_credencial}`,
      correo
    });
  });

  /* ---------- FLUJO INVITADO PÚBLICO: VALIDACIÓN ---------- */
  $("formCheckInvitado").addEventListener("submit", e => {
    e.preventDefault();
    const nombreBuscado = $("checkInvNombre").value.trim().toLowerCase();
    const correoBuscado = $("checkInvCorreo").value.trim().toLowerCase();

    const encontrado = db.invitados.find(
      inv => String(inv.correo).toLowerCase() === correoBuscado &&
             String(inv.nombre).toLowerCase().includes(nombreBuscado)
    );

    if (encontrado) {
      $("msgNoRegistradoInvitado").hidden = true;
      const nombreCompleto = `${encontrado.nombre} ${encontrado.apellido_paterno} ${encontrado.apellido_materno}`;
      const id_qr = encontrado.codigo_qr || registrarCodigoQR("invitados", encontrado.id_invitado, nombreCompleto);
      saveDatabase();
      showQrModal({
        id_qr,
        nombre_completo: nombreCompleto,
        detalle: "Invitado Especial",
        correo: encontrado.correo
      });
    } else {
      $("msgNoRegistradoInvitado").hidden = false;
    }
  });

  /* ---------- GENERAR INVITADO (SOLO ADMIN) ---------- */
  $("formGuest").addEventListener("submit", e => {
    e.preventDefault();
    const nombre = $("guestNombre").value.trim();
    const apellido_paterno = $("guestPaterno").value.trim();
    const apellido_materno = $("guestMaterno").value.trim();
    const correo = $("guestCorreo").value.trim().toLowerCase();
    const nombreCompleto = `${nombre} ${apellido_paterno} ${apellido_materno}`;
    const nuevoId = db.invitados.length + 1;
    const id_qr = registrarCodigoQR("invitados", nuevoId, nombreCompleto);

    const guestRecord = {
      id_invitado: nuevoId,
      nombre,
      apellido_paterno,
      apellido_materno,
      correo,
      codigo_qr: id_qr
    };

    db.invitados.push(guestRecord);
    saveDatabase();
    $("formGuest").reset();

    showQrModal({
      id_qr,
      nombre_completo: nombreCompleto,
      detalle: "Invitado Especial",
      correo
    });
  });

  /* ---------- GESTIÓN DE BASE DE DATOS (SOLO ADMIN) ---------- */
  function actualizarFiltrosAlumnosDb() {
    const selCarrera = $("dbFiltroCarrera");
    const selGrupo = $("dbFiltroGrupo");
    const carrerasUnicas = [...new Set(db.alumnos.map(a => a.carrera).filter(Boolean))];
    const gruposUnicos = [...new Set(db.alumnos.map(a => a.grupo).filter(Boolean))];

    const valC = selCarrera.value;
    const valG = selGrupo.value;

    selCarrera.innerHTML = '<option value="">Todas las Carreras</option>';
    carrerasUnicas.forEach(c => {
      const o = document.createElement("option");
      o.value = c; o.textContent = c;
      selCarrera.appendChild(o);
    });
    selCarrera.value = carrerasUnicas.includes(valC) ? valC : "";

    selGrupo.innerHTML = '<option value="">Todos los Grupos</option>';
    gruposUnicos.forEach(g => {
      const o = document.createElement("option");
      o.value = g; o.textContent = g;
      selGrupo.appendChild(o);
    });
    selGrupo.value = gruposUnicos.includes(valG) ? valG : "";
  }

  function renderBaseDatos() {
    const thead = $("theadDb");
    const tbody = $("tbodyDb");
    const texto = $("dbBuscar").value.trim().toLowerCase();

    $("filtrosDbAlumnos").hidden = dbVistaActual !== "alumnos";
    thead.replaceChildren();
    tbody.replaceChildren();

    if (dbVistaActual === "alumnos") {
      actualizarFiltrosAlumnosDb();
      const fNivel = $("dbFiltroNivel").value;
      const fCarrera = $("dbFiltroCarrera").value;
      const fGrupo = $("dbFiltroGrupo").value;

      thead.innerHTML = `<tr>
        <th>Matrícula</th>
        <th>Nombre Completo</th>
        <th>Correo</th>
        <th>Nivel</th>
        <th>Carrera</th>
        <th>Grupo</th>
        <th>Acciones</th>
      </tr>`;

      const filtrados = db.alumnos
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => {
          const correo = item.correo || item.correo_institucional || "";
          const nombreFull = `${item.nombre} ${item.apellido_paterno} ${item.apellido_materno}`.toLowerCase();
          if (fNivel && item.nivel !== fNivel) return false;
          if (fCarrera && item.carrera !== fCarrera) return false;
          if (fGrupo && item.grupo !== fGrupo) return false;
          if (texto && !nombreFull.includes(texto) && !String(item.matricula).toLowerCase().includes(texto) && !correo.toLowerCase().includes(texto)) return false;
          return true;
        });

      $("resumenDb").textContent = `Mostrando ${filtrados.length} de ${db.alumnos.length} alumnos registrados.`;
      if (!filtrados.length) {
        tbody.appendChild(filaVacia(7, "No hay alumnos registrados que coincidan con los filtros."));
        return;
      }

      filtrados.forEach(({ item, idx }) => {
        const nombreFull = `${item.nombre} ${item.apellido_paterno} ${item.apellido_materno}`;
        const correo = item.correo || item.correo_institucional || "";
        const tr = document.createElement("tr");
        tr.append(
          celda(item.matricula),
          celda(nombreFull),
          celda(correo),
          celda(item.nivel),
          celda(item.carrera),
          celda(item.grupo),
          celdaAccionesDb("alumnos", idx)
        );
        tbody.appendChild(tr);
      });

    } else if (dbVistaActual === "profesores") {
      thead.innerHTML = `<tr>
        <th>Credencial</th>
        <th>Nombre Completo</th>
        <th>Correo</th>
        <th>Acciones</th>
      </tr>`;

      const filtrados = db.profesores
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => {
          const correo = item.correo || item.correo_institucional || "";
          const nombreFull = `${item.nombre} ${item.apellido_paterno} ${item.apellido_materno}`.toLowerCase();
          if (texto && !nombreFull.includes(texto) && !String(item.num_credencial).includes(texto) && !correo.toLowerCase().includes(texto)) return false;
          return true;
        });

      $("resumenDb").textContent = `Mostrando ${filtrados.length} de ${db.profesores.length} profesores registrados.`;
      if (!filtrados.length) {
        tbody.appendChild(filaVacia(4, "No hay profesores registrados."));
        return;
      }

      filtrados.forEach(({ item, idx }) => {
        const nombreFull = `${item.nombre} ${item.apellido_paterno} ${item.apellido_materno}`;
        const correo = item.correo || item.correo_institucional || "";
        const tr = document.createElement("tr");
        tr.append(
          celda(item.num_credencial),
          celda(nombreFull),
          celda(correo),
          celdaAccionesDb("profesores", idx)
        );
        tbody.appendChild(tr);
      });

    } else {
      thead.innerHTML = `<tr>
        <th>ID</th>
        <th>Nombre Completo</th>
        <th>Correo</th>
        <th>Acciones</th>
      </tr>`;

      const filtrados = db.invitados
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => {
          const nombreFull = `${item.nombre} ${item.apellido_paterno} ${item.apellido_materno}`.toLowerCase();
          if (texto && !nombreFull.includes(texto) && !String(item.correo).toLowerCase().includes(texto)) return false;
          return true;
        });

      $("resumenDb").textContent = `Mostrando ${filtrados.length} de ${db.invitados.length} invitados registrados.`;
      if (!filtrados.length) {
        tbody.appendChild(filaVacia(4, "No hay invitados registrados."));
        return;
      }

      filtrados.forEach(({ item, idx }) => {
        const nombreFull = `${item.nombre} ${item.apellido_paterno} ${item.apellido_materno}`;
        const tr = document.createElement("tr");
        tr.append(
          celda(`INV-${idx + 1}`),
          celda(nombreFull),
          celda(item.correo),
          celdaAccionesDb("invitados", idx)
        );
        tbody.appendChild(tr);
      });
    }
  }

  function celdaAccionesDb(tipo, idx) {
    const td = document.createElement("td");

    const btnQr = document.createElement("button");
    btnQr.type = "button";
    btnQr.className = "btn-mini qr";
    btnQr.title = "Ver QR";
    btnQr.innerHTML = '<i class="fas fa-qrcode"></i>';
    btnQr.addEventListener("click", () => verQrDesdeDb(tipo, idx));

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.className = "btn-mini edit";
    btnEdit.title = "Editar";
    btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
    btnEdit.addEventListener("click", () => abrirCrudModal(tipo, idx));

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "btn-mini del";
    btnDel.title = "Eliminar";
    btnDel.innerHTML = '<i class="fas fa-trash"></i>';
    btnDel.addEventListener("click", () => {
      if (confirm("¿Seguro que deseas eliminar este registro de la base de datos?")) {
        db[tipo].splice(idx, 1);
        saveDatabase();
        renderBaseDatos();
      }
    });

    td.append(btnQr, btnEdit, btnDel);
    return td;
  }

  function verQrDesdeDb(tipo, idx) {
    const reg = db[tipo][idx];
    if (!reg) return;
    const nombreCompleto = `${reg.nombre} ${reg.apellido_paterno} ${reg.apellido_materno}`;
    let ref = "";
    let detalle = "";
    if (tipo === "alumnos") {
      ref = reg.matricula;
      detalle = `${reg.nivel} · ${reg.carrera} (${reg.grupo})`;
    } else if (tipo === "profesores") {
      ref = reg.num_credencial;
      detalle = `Docente · Credencial ${reg.num_credencial}`;
    } else {
      ref = reg.id_invitado || (idx + 1);
      detalle = "Invitado Especial";
    }
    const id_qr = reg.codigo_qr || registrarCodigoQR(tipo, ref, nombreCompleto);
    showQrModal({
      id_qr,
      nombre_completo: nombreCompleto,
      detalle,
      correo: reg.correo || reg.correo_institucional || ""
    });
  }

  // Sub-pestañas BD
  ["dbTabAlumnos", "dbTabProfesores", "dbTabInvitados"].forEach(id => {
    $(id).addEventListener("click", () => {
      ["dbTabAlumnos", "dbTabProfesores", "dbTabInvitados"].forEach(t => $(t).classList.remove("activo"));
      $(id).classList.add("activo");
      dbVistaActual = id === "dbTabAlumnos" ? "alumnos" : id === "dbTabProfesores" ? "profesores" : "invitados";
      renderBaseDatos();
    });
  });

  ["dbFiltroNivel", "dbFiltroCarrera", "dbFiltroGrupo"].forEach(id => {
    $(id).addEventListener("change", renderBaseDatos);
  });
  $("dbBuscar").addEventListener("input", renderBaseDatos);

  /* Modal CRUD (Agregar / Editar) */
  function abrirCrudModal(tipo, idx = null) {
    $("crudTipo").value = tipo;
    $("crudIndex").value = idx !== null ? idx : "";
    $("crudModalTitle").textContent = idx !== null ? "Modificar Registro" : "Nuevo Registro";

    document.querySelectorAll(".crud-alumno").forEach(el => el.hidden = tipo !== "alumnos");
    document.querySelectorAll(".crud-profesor").forEach(el => el.hidden = tipo !== "profesores");

    $("crudMatricula").required = tipo === "alumnos";
    $("crudCarrera").required = tipo === "alumnos";
    $("crudGrupo").required = tipo === "alumnos";
    $("crudCredencial").required = tipo === "profesores";

    if (idx !== null) {
      const item = db[tipo][idx];
      $("crudNombre").value = item.nombre || "";
      $("crudPaterno").value = item.apellido_paterno || "";
      $("crudMaterno").value = item.apellido_materno || "";
      $("crudCorreo").value = item.correo || item.correo_institucional || "";
      if (tipo === "alumnos") {
        $("crudMatricula").value = item.matricula || "";
        $("crudNivel").value = item.nivel || "Superior";
        $("crudCarrera").value = item.carrera || "";
        $("crudGrupo").value = item.grupo || "";
      } else if (tipo === "profesores") {
        $("crudCredencial").value = item.num_credencial || "";
      }
    } else {
      $("formCrud").reset();
    }

    $("crudModal").hidden = false;
  }

  $("btnDbNuevo").addEventListener("click", () => abrirCrudModal(dbVistaActual, null));
  $("btnCloseCrud").addEventListener("click", () => { $("crudModal").hidden = true; });

  $("formCrud").addEventListener("submit", e => {
    e.preventDefault();
    const tipo = $("crudTipo").value;
    const idxStr = $("crudIndex").value;
    const nombre = $("crudNombre").value.trim();
    const apellido_paterno = $("crudPaterno").value.trim();
    const apellido_materno = $("crudMaterno").value.trim();
    const correo = $("crudCorreo").value.trim().toLowerCase();
    const nombreCompleto = `${nombre} ${apellido_paterno} ${apellido_materno}`;

    let nuevoObj = { nombre, apellido_paterno, apellido_materno, correo };

    if (tipo === "alumnos") {
      const matricula = $("crudMatricula").value.trim().toUpperCase();
      if (!/^[A-Za-z0-9]{10}$/.test(matricula)) {
        alert("La matrícula debe tener 10 caracteres (letras y/o números).");
        return;
      }
      nuevoObj.matricula = matricula;
      nuevoObj.nivel = $("crudNivel").value;
      nuevoObj.carrera = $("crudCarrera").value.trim();
      nuevoObj.grupo = $("crudGrupo").value.trim();
      nuevoObj.codigo_qr = registrarCodigoQR("alumnos", matricula, nombreCompleto);
    } else if (tipo === "profesores") {
      const num_credencial = $("crudCredencial").value.trim();
      if (!/^[0-9]{5}$/.test(num_credencial)) {
        alert("El número de credencial debe tener exactamente 5 números.");
        return;
      }
      nuevoObj.num_credencial = num_credencial;
      nuevoObj.codigo_qr = registrarCodigoQR("profesores", num_credencial, nombreCompleto);
    } else {
      const idInv = idxStr !== "" ? (db.invitados[Number(idxStr)].id_invitado || Number(idxStr) + 1) : db.invitados.length + 1;
      nuevoObj.id_invitado = idInv;
      nuevoObj.codigo_qr = registrarCodigoQR("invitados", idInv, nombreCompleto);
    }

    if (idxStr !== "") {
      db[tipo][Number(idxStr)] = { ...db[tipo][Number(idxStr)], ...nuevoObj };
    } else {
      db[tipo].push(nuevoObj);
    }

    saveDatabase();
    $("crudModal").hidden = true;
    renderBaseDatos();
  });

  /* ---------- MODAL QR (LIMPIO SIN CORREO, NI TABLA, NI JSON) ---------- */
  function showQrModal(payload) {
    currentModalPayload = payload;
    $("modalBadgeQr").textContent = payload.id_qr;
    $("modalTitle").textContent = payload.nombre_completo;
    $("modalSub").textContent = payload.detalle || "";

    const container = $("qrContainer");
    container.innerHTML = "";

    currentQrObj = new QRCodeStyling({
      width: 210,
      height: 210,
      type: "canvas",
      data: payload.id_qr,
      dotsOptions: { color: "#4c1d95", type: "rounded" },
      backgroundOptions: { color: "#ffffff" },
      cornersSquareOptions: { color: "#0284c7", type: "extra-rounded" }
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
      `• Folio QR: ${currentModalPayload.id_qr}\n` +
      `\n(Adjunta en este correo la imagen PNG del código QR que se acaba de descargar).\n\n` +
      `Atentamente,\nControl de Acceso · Semana de Informática XXXIII`
    );
    window.open(`mailto:${currentModalPayload.correo}?subject=${asunto}&body=${cuerpo}`, "_blank");
  });

  /* ---------- PARTÍCULAS / NIEVE Y LUCES ---------- */
  (function nieve() {
    const canvas = $("nieve"), ctx = canvas.getContext("2d"), btn = $("nieveBtn");
    const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let guardado = null;
    try { guardado = localStorage.getItem("nieve"); } catch (e) {}
    let activa = guardado ? guardado === "on" : !reducir;
    let w = 0, h = 0, copos = [], raf = null;

    const nuevo = inicial => ({
      x: Math.random() * w, y: inicial ? Math.random() * h : -10,
      r: 1.5 + Math.random() * 2.8, v: 0.4 + Math.random() * 0.9,
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
      ctx.fillStyle = "rgba(165, 243, 252, 0.85)";
      ctx.shadowColor = "rgba(139, 92, 246, 0.75)"; ctx.shadowBlur = 6;
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
    const cont = $("luces"), colores = ["#a855f7", "#00e5ff", "#38bdf8", "#ec4899"];
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