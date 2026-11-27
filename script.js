/*
 * Control de Acceso ILB — Firebase (Firestore + Auth) desde el navegador.
 *
 * Colecciones (ver firestore.rules):
 *   alumnos/{matricula}     { matricula, correo, codigoQr: "ALU-<matricula>", createdAt }
 *   profesores/{credencial} { credencial, nombre, apellidos, correo, codigoQr: "PROF-<credencial>", createdAt }
 *   invitados/{n}           { folio: n, nombre, correo, codigoQr: "INV-<n>", createdAt }
 *   contadores/invitados    { n }  -> último folio asignado
 *   accesos/{id}            { id, nombre, grupo, estado, fechaHora }  (solo admin)
 *
 * Duplicados: el ID del documento es la matrícula, así que Firestore rechaza
 * un segundo registro sin tener que revisar los demás.
 */

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

const RE_MATRICULA_ALUMNO = /^[A-Z0-9]{10}$/;
const RE_CREDENCIAL = /^[0-9]{5}$/;
const RE_CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);

  /* ---------- FIREBASE ---------- */
  const config = window.FIREBASE_CONFIG;
  const ADMIN_UID = window.FIREBASE_ADMIN_UID;
  let auth = null;
  let fs = null;
  try {
    firebase.initializeApp(config);
    auth = firebase.auth();
    fs = firebase.firestore();
  } catch (error) {
    console.error("No se pudo inicializar Firebase:", error);
  }
  const marcaTiempo = () => firebase.firestore.FieldValue.serverTimestamp();
  const contadorRef = () => fs.collection("contadores").doc("invitados");

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
  let cancelarAccesosHoy = null;

  let currentQrObj = null;
  let currentModalPayload = null;
  let dbVistaActual = "alumnos"; // "alumnos" | "profesores" | "invitados"
  let db = { alumnos: [], profesores: [], invitados: [] };

  /* ---------- UTILIDADES ---------- */
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
  const limpiar = v => String(v || "").trim().replace(/\s+/g, " ");
  const limpiarMatricula = v => String(v || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const limpiarCorreo = v => String(v || "").trim().toLowerCase();
  const aFecha = v => (v && typeof v.toDate === "function" ? v.toDate() : null);

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
  function mostrarMensaje(texto, tipo = "info") {
    const box = $("msgRegistro");
    box.textContent = texto;
    box.className = tipo === "error" ? "alerta" : "alerta-info";
    box.hidden = false;
  }
  function ocultarMensaje() { $("msgRegistro").hidden = true; }
  function conBotonOcupado(form, fn) {
    return async e => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      if (btn.disabled) return;
      btn.disabled = true;
      try { await fn(); } finally { btn.disabled = false; }
    };
  }

  /* ---------- REGISTRO EN FIRESTORE ---------- */

  /**
   * Intenta crear el documento. Si ya existe, confirma el correo con una escritura
   * mínima (el público no puede leer registros).
   * Devuelve "nuevo", "existente" o "otroCorreo".
   */
  async function registrarOConsultar(coleccion, id, datos) {
    const ref = fs.collection(coleccion).doc(id);
    try {
      await ref.set({ ...datos, createdAt: marcaTiempo() });
      return "nuevo";
    } catch (error) {
      if (error.code !== "permission-denied") throw error;
    }
    return (await consultarConCorreo(coleccion, id, datos.correo)) ? "existente" : "otroCorreo";
  }

  /** true si el documento existe y su correo coincide (sin poder leerlo). */
  async function consultarConCorreo(coleccion, id, correo) {
    try {
      await fs.collection(coleccion).doc(id).update({ correo, ultimaConsulta: marcaTiempo() });
      return true;
    } catch (error) {
      if (error.code === "permission-denied" || error.code === "not-found") return false;
      throw error;
    }
  }

  /** Asigna el siguiente folio de invitado en una transacción (sin repetir números). */
  async function registrarInvitado(nombre, correo) {
    return fs.runTransaction(async tx => {
      const snap = await tx.get(contadorRef());
      const n = (snap.exists ? snap.data().n : 0) + 1;
      const id = String(n);
      tx.set(contadorRef(), { n });
      tx.set(fs.collection("invitados").doc(id), {
        folio: n,
        nombre,
        correo,
        codigoQr: `INV-${id}`,
        createdAt: marcaTiempo()
      });
      return n;
    });
  }

  function errorFirebase(error) {
    console.error(error);
    if (error.code === "unavailable") return "Sin conexión con Firebase. Revisa tu internet e inténtalo de nuevo.";
    if (error.code === "permission-denied") return "Firebase rechazó los datos. Revisa que los campos tengan el formato correcto.";
    return "No se pudo completar el registro. Inténtalo de nuevo.";
  }

  /* ---------- PESTAÑAS DE REGISTRO PÚBLICO ---------- */
  function activarTabRegistro(tab) {
    ["tabAlumno", "tabProfesor", "tabInvitadoPub"].forEach(id => $(id).classList.remove("activo"));
    ["bloqueAlumno", "bloqueProfesor", "bloqueInvitadoPub"].forEach(id => { $(id).hidden = true; });
    ocultarMensaje();
    reiniciarProfesor();
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

  $("alumnoMatricula").addEventListener("input", e => { e.target.value = limpiarMatricula(e.target.value); });
  $("profesorCredencial").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, ""); });
  $("crudMatricula").addEventListener("input", e => {
    e.target.value = $("crudTipo").value === "profesores" ? e.target.value.replace(/\D/g, "") : limpiarMatricula(e.target.value);
  });

  /* ---------- ALUMNO: matrícula + correo ---------- */
  $("formAlumno").addEventListener("submit", conBotonOcupado($("formAlumno"), async () => {
    const matricula = limpiarMatricula($("alumnoMatricula").value);
    const correo = limpiarCorreo($("alumnoCorreo").value);
    if (!RE_MATRICULA_ALUMNO.test(matricula)) {
      mostrarMensaje("La matrícula debe tener exactamente 10 caracteres (letras y/o números).", "error");
      return;
    }
    if (!RE_CORREO.test(correo)) {
      mostrarMensaje("Escribe un correo válido.", "error");
      return;
    }
    ocultarMensaje();
    try {
      const codigoQr = `ALU-${matricula}`;
      const resultado = await registrarOConsultar("alumnos", matricula, { matricula, correo, codigoQr });
      if (resultado === "otroCorreo") {
        mostrarMensaje("Esa matrícula ya está registrada con otro correo. Si es un error, acude con el administrador.", "error");
        return;
      }
      mostrarMensaje(resultado === "nuevo"
        ? "Registro exitoso. Descarga tu código QR."
        : "Ya estabas registrado. Este es tu código QR.");
      $("formAlumno").reset();
      showQrModal({ id_qr: codigoQr, nombre_completo: `Alumno · ${matricula}`, detalle: correo, correo });
    } catch (error) {
      mostrarMensaje(errorFirebase(error), "error");
    }
  }));

  /* ---------- PROFESOR: paso 1 credencial + correo; paso 2 nombre + apellidos ---------- */
  let profesorPendiente = null; // { credencial, correo } validados en el paso 1

  function reiniciarProfesor() {
    profesorPendiente = null;
    $("formProfesor").reset();
    $("formProfesor").hidden = true;
    $("profesorCredencial").readOnly = false;
    $("profesorCorreo").readOnly = false;
  }

  $("formCheckProfesor").addEventListener("submit", conBotonOcupado($("formCheckProfesor"), async () => {
    const credencial = $("profesorCredencial").value.replace(/\D/g, "");
    const correo = limpiarCorreo($("profesorCorreo").value);
    if (!RE_CREDENCIAL.test(credencial)) {
      mostrarMensaje("El número de credencial debe contener exactamente 5 dígitos.", "error");
      return;
    }
    if (!RE_CORREO.test(correo)) {
      mostrarMensaje("Escribe un correo válido.", "error");
      return;
    }
    ocultarMensaje();
    try {
      if (await consultarConCorreo("profesores", credencial, correo)) {
        reiniciarProfesor();
        $("formCheckProfesor").reset();
        mostrarMensaje("Ya estabas registrado. Este es tu código QR.");
        showQrModal({ id_qr: `PROF-${credencial}`, nombre_completo: `Profesor · ${credencial}`, detalle: `Docente · Credencial ${credencial}`, correo });
        return;
      }
      profesorPendiente = { credencial, correo };
      $("profesorCredencial").readOnly = true;
      $("profesorCorreo").readOnly = true;
      $("formProfesor").hidden = false;
      mostrarMensaje("No te encuentras registrado. Completa tu nombre y apellidos para generar tu código QR.");
      $("profesorNombre").focus();
    } catch (error) {
      mostrarMensaje(errorFirebase(error), "error");
    }
  }));

  $("formProfesor").addEventListener("submit", conBotonOcupado($("formProfesor"), async () => {
    if (!profesorPendiente) return;
    const { credencial, correo } = profesorPendiente;
    const nombre = limpiar($("profesorNombre").value);
    const apellidos = limpiar($("profesorApellidos").value);
    if (!nombre || !apellidos) {
      mostrarMensaje("Escribe tu nombre y apellidos.", "error");
      return;
    }
    try {
      const codigoQr = `PROF-${credencial}`;
      const resultado = await registrarOConsultar("profesores", credencial, { credencial, nombre, apellidos, correo, codigoQr });
      if (resultado === "otroCorreo") {
        mostrarMensaje("Esa credencial ya está registrada con otro correo. Si es un error, acude con el administrador.", "error");
        return;
      }
      reiniciarProfesor();
      $("formCheckProfesor").reset();
      mostrarMensaje(resultado === "nuevo" ? "Registro exitoso. Descarga tu código QR." : "Ya estabas registrado. Este es tu código QR.");
      showQrModal({ id_qr: codigoQr, nombre_completo: `${nombre} ${apellidos}`, detalle: `Docente · Credencial ${credencial}`, correo });
    } catch (error) {
      mostrarMensaje(errorFirebase(error), "error");
    }
  }));

  /* ---------- INVITADO: nombre + correo -> folio ---------- */
  $("formInvitadoPub").addEventListener("submit", conBotonOcupado($("formInvitadoPub"), async () => {
    const nombre = limpiar($("invitadoNombre").value);
    const correo = limpiarCorreo($("invitadoCorreo").value);
    if (!nombre || !RE_CORREO.test(correo)) {
      mostrarMensaje("Escribe tu nombre y un correo válido.", "error");
      return;
    }
    ocultarMensaje();
    try {
      const folio = await registrarInvitado(nombre, correo);
      mostrarMensaje(`Pase generado con folio INV-${folio}. Descárgalo: cada registro de invitado crea un folio nuevo.`);
      $("formInvitadoPub").reset();
      showQrModal({ id_qr: `INV-${folio}`, nombre_completo: nombre, detalle: `Invitado · Folio ${folio}`, correo });
    } catch (error) {
      mostrarMensaje(errorFirebase(error), "error");
    }
  }));

  /* ---------- ACCESO SECRETO ADMINISTRADOR (3 CLICS EN MAPACHE O CTRL+SHIFT+A) ---------- */
  let clicsMapache = 0;
  let timerClics = null;
  $("logoMapache").addEventListener("click", () => {
    clicsMapache++;
    clearTimeout(timerClics);
    timerClics = setTimeout(() => { clicsMapache = 0; }, 1200);
    if (clicsMapache >= 3) {
      clicsMapache = 0;
      if (!esAdmin) mostrarVistaPublica("adminLogin");
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
      $("adminEmailInput").focus();
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
      cargarBaseDatos();
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

  $("formAdminLogin").addEventListener("submit", conBotonOcupado($("formAdminLogin"), async () => {
    try {
      const cred = await auth.signInWithEmailAndPassword(
        $("adminEmailInput").value.trim(),
        $("adminPasswordInput").value
      );
      if (cred.user.uid !== ADMIN_UID) {
        await auth.signOut();
        alert("Esta cuenta no está autorizada como administradora.");
      }
    } catch (error) {
      console.error(error);
      alert("No se pudo iniciar sesión. Revisa el correo y la contraseña.");
    } finally {
      $("adminPasswordInput").value = "";
    }
  }));

  $("btnLogoutAdmin").addEventListener("click", async e => {
    e.preventDefault();
    await auth.signOut();
  });

  function alCambiarSesion(user) {
    const eraAdmin = esAdmin;
    esAdmin = Boolean(user && user.uid === ADMIN_UID);
    if (esAdmin && !eraAdmin) {
      $("formAdminLogin").reset();
      mostrarVistaAdmin("inicio");
      escucharAccesosHoy();
    } else if (!esAdmin) {
      if (cancelarAccesosHoy) { cancelarAccesosHoy(); cancelarAccesosHoy = null; }
      registros = [];
      db = { alumnos: [], profesores: [], invitados: [] };
      mostrarVistaPublica("registro");
      render();
    }
  }

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
      if (esAdmin) escucharAccesosHoy();
    }
  }

  /* ---------- MONITOR EN VIVO & HISTORIAL (colección "accesos") ---------- */
  function consultaDia(clave) {
    const inicio = fechaDesdeClave(clave);
    const fin = fechaDesdeClave(sumarDias(clave, 1));
    return fs.collection("accesos")
      .where("fechaHora", ">=", firebase.firestore.Timestamp.fromDate(inicio))
      .where("fechaHora", "<", firebase.firestore.Timestamp.fromDate(fin));
  }

  function normalizar(snapshot) {
    return snapshot.docs
      .map(doc => {
        const d = doc.data();
        return { ...d, _fecha: aFecha(d.fechaHora), _clave: doc.id };
      })
      .filter(r => r._fecha)
      .sort((a, b) => a._fecha - b._fecha);
  }

  function escucharAccesosHoy() {
    if (cancelarAccesosHoy) cancelarAccesosHoy();
    cancelarAccesosHoy = consultaDia(diaActual).onSnapshot(snapshot => {
      registros = normalizar(snapshot);
      $("conexion").hidden = false;
      $("conexion").classList.add("ok");
      $("conexionTexto").textContent = "En vivo · " + formatoHora(new Date());
      render();
    }, error => {
      console.error("No se pudieron escuchar los accesos:", error);
      $("conexionTexto").textContent = "Sin conexión a accesos";
    });
  }

  function tiempoEnEstado(r) {
    const lim = LIMITES_MIN[claveEstado(r.estado)];
    if (!lim) return null;
    const ms = Date.now() - r._fecha.getTime();
    return { min: Math.max(0, Math.floor(ms / 60000)), lim, excedido: ms > lim * 60000 };
  }

  function estadoActualPorPersona() {
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
    const actuales = estadoActualPorPersona();
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
    const items = estadoActualPorPersona().map(r => ({ r, t: tiempoEnEstado(r) }));

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
      cuerpo.appendChild(filaVacia(6, "No se pudo cargar ese día. Revisa la conexión con Firebase."));
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
      const snapshot = await consultaDia(f).get();
      if (token !== tokenVista) return;
      registrosVista = normalizar(snapshot);
      estadoVista = "ok";
    } catch (err) {
      console.error(err);
      if (token !== tokenVista) return;
      estadoVista = "error";
    }
    renderHistorial();
  }

  $("fechaHistorial").max = diaActual;
  $("fechaHistorial").value = fechaVista;
  $("diaSiguiente").disabled = true;
  $("fechaHistorial").addEventListener("change", e => cambiarFecha(e.target.value));
  $("diaAnterior").addEventListener("click", () => cambiarFecha(sumarDias(fechaVista, -1)));
  $("diaSiguiente").addEventListener("click", () => cambiarFecha(sumarDias(fechaVista, 1)));
  $("btnHoy").addEventListener("click", () => cambiarFecha(diaActual));

  /* Exportar CSV / PDF */
  function descargarCsv(filas, nombreArchivo) {
    const esc = v => {
      let s = String(v ?? "");
      if (/^\d+$/.test(s)) return `="${s}"`;
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = "﻿" + filas.map(f => f.map(esc).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $("btnExcel").addEventListener("click", () => {
    if (!ultimaLista.length) { alert("No hay movimientos para exportar en este día."); return; }
    descargarCsv([
      ["ID/Matricula", "Nombre", "Grupo", "Movimiento", "Fecha", "Hora"],
      ...ultimaLista.map(r => [r.id, r.nombre, r.grupo, infoEstado(r.estado).texto, formatoFecha(r._fecha), formatoHora(r._fecha)])
    ], `Accesos_ILB_${fechaVista}.csv`);
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

  /* ---------- GENERAR INVITADO (SOLO ADMIN) ---------- */
  $("formGuest").addEventListener("submit", conBotonOcupado($("formGuest"), async () => {
    const nombre = limpiar($("guestNombre").value);
    const correo = limpiarCorreo($("guestCorreo").value);
    if (!nombre || !RE_CORREO.test(correo)) { alert("Escribe el nombre y un correo válido."); return; }
    try {
      const folio = await registrarInvitado(nombre, correo);
      $("formGuest").reset();
      showQrModal({ id_qr: `INV-${folio}`, nombre_completo: nombre, detalle: `Invitado · Folio ${folio}`, correo });
    } catch (error) {
      alert(errorFirebase(error));
    }
  }));

  /* ---------- GESTIÓN DE BASE DE DATOS (SOLO ADMIN) ---------- */
  async function cargarBaseDatos() {
    if (!esAdmin) return;
    $("resumenDb").textContent = "Cargando…";
    try {
      const [alumnos, profesores, invitados] = await Promise.all(
        ["alumnos", "profesores", "invitados"].map(c => fs.collection(c).get())
      );
      const aLista = snap => snap.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
      db = {
        alumnos: aLista(alumnos).sort((a, b) => a._id.localeCompare(b._id)),
        profesores: aLista(profesores).sort((a, b) => a._id.localeCompare(b._id)),
        invitados: aLista(invitados).sort((a, b) => (a.folio || 0) - (b.folio || 0))
      };
      renderBaseDatos();
    } catch (error) {
      console.error(error);
      $("resumenDb").textContent = "No se pudo cargar la base de datos de Firebase.";
    }
  }

  function fechaRegistro(item) {
    const d = aFecha(item.createdAt);
    return d ? `${formatoFecha(d)} ${formatoHora(d)}` : "—";
  }

  const COLUMNAS_DB = {
    alumnos: {
      titulos: ["Matrícula", "Correo", "Código QR", "Registro"],
      valores: i => [i.matricula || i._id, i.correo, i.codigoQr, fechaRegistro(i)],
      texto: i => `${i._id} ${i.correo}`
    },
    profesores: {
      titulos: ["Credencial", "Nombre Completo", "Correo", "Código QR", "Registro"],
      valores: i => [i.credencial || i._id, `${i.nombre} ${i.apellidos}`, i.correo, i.codigoQr, fechaRegistro(i)],
      texto: i => `${i._id} ${i.nombre} ${i.apellidos} ${i.correo}`
    },
    invitados: {
      titulos: ["Folio", "Nombre", "Correo", "Código QR", "Registro"],
      valores: i => [i.folio, i.nombre, i.correo, i.codigoQr, fechaRegistro(i)],
      texto: i => `${i.folio} INV-${i.folio} ${i.nombre} ${i.correo}`
    }
  };

  function renderBaseDatos() {
    const thead = $("theadDb");
    const tbody = $("tbodyDb");
    const texto = $("dbBuscar").value.trim().toLowerCase();
    const cols = COLUMNAS_DB[dbVistaActual];
    const lista = db[dbVistaActual];

    thead.replaceChildren();
    tbody.replaceChildren();
    const trHead = document.createElement("tr");
    [...cols.titulos, "Acciones"].forEach(t => {
      const th = document.createElement("th");
      th.textContent = t;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);

    const filtrados = lista.filter(i => !texto || cols.texto(i).toLowerCase().includes(texto));
    $("resumenDb").textContent = `Mostrando ${filtrados.length} de ${lista.length} ${dbVistaActual} registrados.`;
    if (!filtrados.length) {
      tbody.appendChild(filaVacia(cols.titulos.length + 1, `No hay ${dbVistaActual} que coincidan.`));
      return;
    }
    filtrados.forEach(item => {
      const tr = document.createElement("tr");
      cols.valores(item).forEach(v => tr.appendChild(celda(v ?? "")));
      tr.appendChild(celdaAccionesDb(dbVistaActual, item));
      tbody.appendChild(tr);
    });
  }

  function botonMini(clase, titulo, icono, accion) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn-mini ${clase}`;
    b.title = titulo;
    b.innerHTML = `<i class="fas ${icono}"></i>`;
    b.addEventListener("click", accion);
    return b;
  }

  function celdaAccionesDb(tipo, item) {
    const td = document.createElement("td");
    td.append(
      botonMini("qr", "Ver QR", "fa-qrcode", () => verQrDesdeDb(tipo, item)),
      botonMini("edit", "Editar", "fa-edit", () => abrirCrudModal(tipo, item)),
      botonMini("del", "Eliminar", "fa-trash", async () => {
        if (!confirm("¿Seguro que deseas eliminar este registro de Firebase?")) return;
        try {
          await fs.collection(tipo).doc(item._id).delete();
          await cargarBaseDatos();
        } catch (error) {
          alert(errorFirebase(error));
        }
      })
    );
    return td;
  }

  function verQrDesdeDb(tipo, item) {
    if (tipo === "alumnos") {
      showQrModal({ id_qr: item.codigoQr || `ALU-${item._id}`, nombre_completo: `Alumno · ${item._id}`, detalle: item.correo, correo: item.correo });
    } else if (tipo === "profesores") {
      showQrModal({ id_qr: item.codigoQr || `PROF-${item._id}`, nombre_completo: `${item.nombre} ${item.apellidos}`, detalle: `Docente · Credencial ${item._id}`, correo: item.correo });
    } else {
      showQrModal({ id_qr: item.codigoQr || `INV-${item._id}`, nombre_completo: item.nombre, detalle: `Invitado · Folio ${item.folio}`, correo: item.correo || "" });
    }
  }

  ["dbTabAlumnos", "dbTabProfesores", "dbTabInvitados"].forEach(id => {
    $(id).addEventListener("click", () => {
      ["dbTabAlumnos", "dbTabProfesores", "dbTabInvitados"].forEach(t => $(t).classList.remove("activo"));
      $(id).classList.add("activo");
      dbVistaActual = id === "dbTabAlumnos" ? "alumnos" : id === "dbTabProfesores" ? "profesores" : "invitados";
      renderBaseDatos();
    });
  });
  $("dbBuscar").addEventListener("input", renderBaseDatos);

  /* Modal CRUD (Agregar / Editar) */
  function abrirCrudModal(tipo, item = null) {
    $("formCrud").reset();
    $("crudTipo").value = tipo;
    $("crudId").value = item ? item._id : "";
    $("crudModalTitle").textContent = item ? "Modificar Registro" : "Nuevo Registro";

    const conMatricula = tipo !== "invitados";
    const conNombre = tipo !== "alumnos";
    const conApellidos = tipo === "profesores";
    document.querySelectorAll(".crud-matricula").forEach(el => { el.hidden = !conMatricula; });
    document.querySelectorAll(".crud-nombre").forEach(el => { el.hidden = !conNombre; });
    document.querySelectorAll(".crud-apellidos").forEach(el => { el.hidden = !conApellidos; });
    $("crudMatriculaLabel").textContent = tipo === "profesores" ? "Credencial (5 dígitos) *" : "Matrícula (10 caracteres) *";
    $("crudMatricula").maxLength = tipo === "profesores" ? 5 : 10;
    $("crudMatricula").required = conMatricula;
    $("crudCorreo").required = true;
    $("crudNombre").required = conNombre;
    $("crudApellidos").required = conApellidos;

    if (item) {
      $("crudMatricula").value = item.matricula || item.credencial || item._id || "";
      $("crudCorreo").value = item.correo || "";
      $("crudNombre").value = item.nombre || "";
      $("crudApellidos").value = item.apellidos || "";
    }
    $("crudModal").hidden = false;
  }

  $("btnDbNuevo").addEventListener("click", () => abrirCrudModal(dbVistaActual, null));
  $("btnCloseCrud").addEventListener("click", () => { $("crudModal").hidden = true; });

  $("formCrud").addEventListener("submit", conBotonOcupado($("formCrud"), async () => {
    const tipo = $("crudTipo").value;
    const idAnterior = $("crudId").value;
    const nombre = limpiar($("crudNombre").value);
    const apellidos = limpiar($("crudApellidos").value);
    const correo = limpiarCorreo($("crudCorreo").value);
    if (!RE_CORREO.test(correo)) { alert("Escribe un correo válido."); return; }

    try {
      if (tipo === "invitados") {
        if (idAnterior) {
          await fs.collection("invitados").doc(idAnterior).update({ nombre, correo });
        } else {
          const folio = await registrarInvitado(nombre, correo);
          alert(`Invitado registrado con folio INV-${folio}.`);
        }
      } else {
        const esAlumno = tipo === "alumnos";
        const matricula = esAlumno ? limpiarMatricula($("crudMatricula").value) : $("crudMatricula").value.replace(/\D/g, "");
        if (!(esAlumno ? RE_MATRICULA_ALUMNO : RE_CREDENCIAL).test(matricula)) {
          alert(esAlumno ? "La matrícula debe tener 10 letras o números." : "La credencial debe tener exactamente 5 dígitos.");
          return;
        }

        const datos = esAlumno
          ? { matricula, correo, codigoQr: `ALU-${matricula}` }
          : { credencial: matricula, nombre, apellidos, correo, codigoQr: `PROF-${matricula}` };

        const nuevoRef = fs.collection(tipo).doc(matricula);
        if (matricula !== idAnterior) {
          const existe = await nuevoRef.get();
          if (existe.exists) { alert(`${esAlumno ? "La matrícula" : "La credencial"} ${matricula} ya está registrada.`); return; }
        }
        const anterior = idAnterior ? db[tipo].find(i => i._id === idAnterior) : null;
        const batch = fs.batch();
        batch.set(nuevoRef, { ...datos, createdAt: anterior?.createdAt || marcaTiempo() }, { merge: true });
        if (idAnterior && idAnterior !== matricula) batch.delete(fs.collection(tipo).doc(idAnterior));
        await batch.commit();
      }
      $("crudModal").hidden = true;
      await cargarBaseDatos();
    } catch (error) {
      alert(errorFirebase(error));
    }
  }));

  /* ---------- MODAL QR ---------- */
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
      margin: 12, // borde blanco dentro del PNG: los lectores lo necesitan
      image: "qrcripto.png",
      qrOptions: { errorCorrectionLevel: "H" }, // tolera ~30% tapado por el logo
      imageOptions: { margin: 4, imageSize: 0.35, hideBackgroundDots: true },
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
  render();

  if (!auth || !fs) {
    mostrarMensaje("No se pudo conectar con Firebase. Revisa firebase-config.js.", "error");
    document.querySelectorAll("#registro button[type=submit]").forEach(b => { b.disabled = true; });
    return;
  }
  $("conexion").hidden = false;
  $("conexionTexto").textContent = "Firebase conectado";
  auth.onAuthStateChanged(alCambiarSesion);
});
