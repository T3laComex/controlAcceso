require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { initializeApp } = require("firebase-admin/app");
const { getDataConnect } = require("firebase-admin/data-connect");

const PORT = Number(process.env.PORT || 3000);
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "t3lacceso";
const SERVICE_ID = process.env.DATA_CONNECT_SERVICE_ID || "t3lacceso-servicio";
const LOCATION = process.env.DATA_CONNECT_LOCATION || "us-south1";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const SESSION_COOKIE = "ilb_admin_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;

if (ADMIN_PASSWORD.length < 12) {
  throw new Error("Configura ADMIN_PASSWORD con al menos 12 caracteres en .env.");
}
if (SESSION_SECRET.length < 32) {
  throw new Error("Configura SESSION_SECRET con al menos 32 caracteres en .env.");
}

const app = express();
initializeApp({ projectId: PROJECT_ID });
const dataConnect = getDataConnect({
  serviceId: SERVICE_ID,
  location: LOCATION
});

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

const studentFields = `
  matricula nombre apellidoPaterno apellidoMaterno correo
  nivel carrera grupo codigoQr
`;
const teacherFields = `
  numCredencial nombre apellidoPaterno apellidoMaterno correo codigoQr
`;
const guestFields = `
  id nombre apellidoPaterno apellidoMaterno correo codigoQr
`;
const qrCodeFields = `
  idQr tipo idReferencia titular fechaEmision activo
`;

async function executeGraphql(query, variables = {}, readOnly = false) {
  const result = readOnly
    ? await dataConnect.executeGraphqlRead(query, { variables })
    : await dataConnect.executeGraphql(query, { variables });

  if (result.errors?.length) {
    throw new Error(result.errors.map(error => error.message).join("; "));
  }
  if (!result.data) {
    throw new Error("Firebase SQL Connect devolvió una respuesta vacía.");
  }
  return result.data;
}

async function loadDatabase() {
  const data = await executeGraphql(`
    query LoadControlAccesoDatabase {
      students(limit: 10000) { ${studentFields} }
      teachers(limit: 10000) { ${teacherFields} }
      guests(limit: 10000) { ${guestFields} }
      qrCodes(limit: 10000) { ${qrCodeFields} }
    }
  `, {}, true);

  return {
    alumnos: data.students.map(student => ({
      matricula: student.matricula,
      nombre: student.nombre,
      apellido_paterno: student.apellidoPaterno,
      apellido_materno: student.apellidoMaterno,
      correo: student.correo,
      nivel: student.nivel,
      carrera: student.carrera,
      grupo: student.grupo,
      codigo_qr: student.codigoQr
    })),
    profesores: data.teachers.map(teacher => ({
      num_credencial: teacher.numCredencial,
      nombre: teacher.nombre,
      apellido_paterno: teacher.apellidoPaterno,
      apellido_materno: teacher.apellidoMaterno,
      correo: teacher.correo,
      codigo_qr: teacher.codigoQr
    })),
    invitados: data.guests.map(guest => ({
      id_invitado: guest.id,
      nombre: guest.nombre,
      apellido_paterno: guest.apellidoPaterno,
      apellido_materno: guest.apellidoMaterno,
      correo: guest.correo,
      codigo_qr: guest.codigoQr
    })),
    codigos_qr: data.qrCodes.map(qrCode => ({
      id_qr: qrCode.idQr,
      tipo: qrCode.tipo,
      id_referencia: qrCode.idReferencia,
      titular: qrCode.titular,
      fecha_emision: qrCode.fechaEmision,
      activo: qrCode.activo
    }))
  };
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest();
}

function constantTimeEqual(left, right) {
  return crypto.timingSafeEqual(hash(left), hash(right));
}

function createSessionToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const payload = `${expiresAt}.${crypto.randomBytes(24).toString("base64url")}`;
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function isValidSessionToken(token) {
  if (!token) return false;
  const [expiresAt, nonce, signature, ...rest] = token.split(".");
  if (!expiresAt || !nonce || !signature || rest.length) return false;

  const payload = `${expiresAt}.${nonce}`;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return constantTimeEqual(signature, expected) && Number(expiresAt) > Math.floor(Date.now() / 1000);
}

function readCookie(request, name) {
  const cookies = request.headers.cookie || "";
  const entry = cookies.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

function requireAdmin(request, response, next) {
  if (!isValidSessionToken(readCookie(request, SESSION_COOKIE))) {
    response.status(401).json({ error: "Se requiere una sesión de administrador." });
    return;
  }
  next();
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION_SECONDS}${secure}`
  );
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`
  );
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function requireText(value, field, maxLength = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    const error = new Error(`${field} es obligatorio y no debe exceder ${maxLength} caracteres.`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function normalizeEmail(value) {
  return requireText(value, "El correo", 320).toLowerCase();
}

function qrId(type, reference) {
  const prefix = type === "students" ? "ALU" : type === "teachers" ? "PROF" : "INV";
  return `QR-${prefix}-${reference}`;
}

async function saveQrCode(type, reference, fullName) {
  const idQr = qrId(type, reference);
  const data = {
    idQr,
    tipo: type,
    idReferencia: String(reference),
    titular: fullName,
    fechaEmision: new Date().toISOString().slice(0, 10),
    activo: true
  };

  await executeGraphql(`
    mutation SaveQrCode($data: QrCode_Data!) {
      qrCode_upsert(data: $data)
    }
  `, { data });
  return idQr;
}

function fullName(record) {
  return `${record.nombre} ${record.apellidoPaterno} ${record.apellidoMaterno}`;
}

async function publicLookup(body) {
  const email = normalizeEmail(body.email);

  if (body.type === "student") {
    const matricula = requireText(body.identifier, "La matrícula", 10).toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(matricula)) {
      const error = new Error("La matrícula debe contener exactamente 10 caracteres alfanuméricos.");
      error.status = 400;
      throw error;
    }
    const result = await executeGraphql(`
      query FindStudent($key: Student_Key!) {
        student(key: $key) { ${studentFields} }
      }
    `, { key: { matricula } }, true);
    const student = result.student;
    if (!student || student.correo.toLowerCase() !== email) return null;

    const idQr = await saveQrCode("students", student.matricula, fullName(student));
    return {
      id_qr: idQr,
      nombre_completo: fullName(student),
      detalle: `${student.nivel} · ${student.carrera} (${student.grupo})`,
      correo: student.correo
    };
  }

  if (body.type === "teacher") {
    const numCredencial = requireText(body.identifier, "La credencial", 5);
    if (!/^[0-9]{5}$/.test(numCredencial)) {
      const error = new Error("La credencial debe contener exactamente 5 dígitos.");
      error.status = 400;
      throw error;
    }
    const result = await executeGraphql(`
      query FindTeacher($key: Teacher_Key!) {
        teacher(key: $key) { ${teacherFields} }
      }
    `, { key: { numCredencial } }, true);
    const teacher = result.teacher;
    if (!teacher || teacher.correo.toLowerCase() !== email) return null;

    const idQr = await saveQrCode("teachers", teacher.numCredencial, fullName(teacher));
    return {
      id_qr: idQr,
      nombre_completo: fullName(teacher),
      detalle: `Docente · Credencial ${teacher.numCredencial}`,
      correo: teacher.correo
    };
  }

  if (body.type === "guest") {
    const nombreBuscado = requireText(body.name, "El nombre", 200).toLowerCase();
    const result = await executeGraphql(`
      query FindGuestsByEmail($email: String!) {
        guests(where: { correo: { eq: $email } }, limit: 100) { ${guestFields} }
      }
    `, { email }, true);
    const guest = result.guests.find(record => fullName(record).toLowerCase().includes(nombreBuscado));
    if (!guest) return null;

    const idQr = await saveQrCode("guests", guest.id, fullName(guest));
    return {
      id_qr: idQr,
      nombre_completo: fullName(guest),
      detalle: "Invitado Especial",
      correo: guest.correo
    };
  }

  const error = new Error("Tipo de registro inválido.");
  error.status = 400;
  throw error;
}

function normalizeNewRecord(type, value) {
  const base = {
    nombre: requireText(value.nombre, "El nombre"),
    apellidoPaterno: requireText(value.apellido_paterno, "El apellido paterno"),
    apellidoMaterno: requireText(value.apellido_materno, "El apellido materno"),
    correo: normalizeEmail(value.correo)
  };

  if (type === "student") {
    const matricula = requireText(value.matricula, "La matrícula", 10).toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(matricula)) {
      const error = new Error("La matrícula debe contener exactamente 10 caracteres alfanuméricos.");
      error.status = 400;
      throw error;
    }
    return {
      ...base,
      matricula,
      nivel: requireText(value.nivel, "El nivel"),
      carrera: requireText(value.carrera, "La carrera"),
      grupo: requireText(value.grupo, "El grupo")
    };
  }

  const numCredencial = requireText(value.num_credencial, "La credencial", 5);
  if (!/^[0-9]{5}$/.test(numCredencial)) {
    const error = new Error("La credencial debe contener exactamente 5 dígitos.");
    error.status = 400;
    throw error;
  }
  return { ...base, numCredencial };
}

async function registerPublic(type, body) {
  if (type !== "student" && type !== "teacher") {
    const error = new Error("Tipo de registro inválido.");
    error.status = 400;
    throw error;
  }
  const record = normalizeNewRecord(type, body);
  const isStudent = type === "student";
  const reference = isStudent ? record.matricula : record.numCredencial;
  const name = fullName(record);
  const idQr = qrId(isStudent ? "students" : "teachers", reference);
  const data = { ...record, codigoQr: idQr };
  const mutation = isStudent
    ? `mutation RegisterStudent($data: Student_Data!) { student_insert(data: $data) }`
    : `mutation RegisterTeacher($data: Teacher_Data!) { teacher_insert(data: $data) }`;

  await executeGraphql(mutation, { data });
  await saveQrCode(isStudent ? "students" : "teachers", reference, name);

  return {
    id_qr: idQr,
    nombre_completo: name,
    detalle: isStudent
      ? `${record.nivel} · ${record.carrera} (${record.grupo})`
      : `Docente · Credencial ${record.numCredencial}`,
    correo: record.correo
  };
}

function asStudent(record) {
  return {
    matricula: requireText(record.matricula, "matricula", 10).toUpperCase(),
    nombre: requireText(record.nombre, "nombre"),
    apellidoPaterno: requireText(record.apellido_paterno, "apellido_paterno"),
    apellidoMaterno: requireText(record.apellido_materno, "apellido_materno"),
    correo: normalizeEmail(record.correo),
    nivel: requireText(record.nivel, "nivel"),
    carrera: requireText(record.carrera, "carrera"),
    grupo: requireText(record.grupo, "grupo"),
    codigoQr: String(record.codigo_qr || "")
  };
}

function asTeacher(record) {
  return {
    numCredencial: requireText(String(record.num_credencial || ""), "num_credencial", 5),
    nombre: requireText(record.nombre, "nombre"),
    apellidoPaterno: requireText(record.apellido_paterno, "apellido_paterno"),
    apellidoMaterno: requireText(record.apellido_materno, "apellido_materno"),
    correo: normalizeEmail(record.correo),
    codigoQr: String(record.codigo_qr || "")
  };
}

function asGuest(record, index) {
  return {
    id: String(record.id_invitado || index + 1),
    nombre: requireText(record.nombre, "nombre"),
    apellidoPaterno: requireText(record.apellido_paterno, "apellido_paterno"),
    apellidoMaterno: requireText(record.apellido_materno, "apellido_materno"),
    correo: normalizeEmail(record.correo),
    codigoQr: String(record.codigo_qr || "")
  };
}

function asQrCode(record) {
  return {
    idQr: requireText(record.id_qr, "id_qr"),
    tipo: requireText(record.tipo, "tipo"),
    idReferencia: requireText(String(record.id_referencia || ""), "id_referencia"),
    titular: requireText(record.titular, "titular"),
    fechaEmision: String(record.fecha_emision || new Date().toISOString().slice(0, 10)),
    activo: record.activo !== false
  };
}

async function upsertRows(type, records, keyName) {
  for (const data of records) {
    await executeGraphql(`
      mutation UpsertRecord($data: ${type}_Data!) {
        ${type.charAt(0).toLowerCase()}${type.slice(1)}_upsert(data: $data)
      }
    `, { data });
  }

  const currentRows = await executeGraphql(`
    query LoadCurrentRecords {
      ${type === "Student" ? "students" : type === "Teacher" ? "teachers" : type === "Guest" ? "guests" : "qrCodes"}(limit: 10000) {
        ${keyName}
      }
    }
  `, {}, true);
  const collection = type === "Student" ? "students"
    : type === "Teacher" ? "teachers"
      : type === "Guest" ? "guests" : "qrCodes";
  const mutationName = `${type.charAt(0).toLowerCase()}${type.slice(1)}_delete`;
  const keyType = `${type}_Key`;
  const kept = new Set(records.map(record => String(record[keyName])));

  for (const row of currentRows[collection]) {
    if (kept.has(String(row[keyName]))) continue;
    await executeGraphql(`
      mutation DeleteRecord($key: ${keyType}!) {
        ${mutationName}(key: $key) { key }
      }
    `, { key: { [keyName]: row[keyName] } });
  }
}

async function synchronizeDatabase(database) {
  const students = (database.alumnos || []).map(asStudent);
  const teachers = (database.profesores || []).map(asTeacher);
  const guests = (database.invitados || []).map(asGuest);
  const qrCodes = (database.codigos_qr || []).map(asQrCode);

  await upsertRows("Student", students, "matricula");
  await upsertRows("Teacher", teachers, "numCredencial");
  await upsertRows("Guest", guests, "id");
  await upsertRows("QrCode", qrCodes, "idQr");
}

async function getAccessLogs(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00-06:00`))) {
    const error = new Error("La fecha debe tener el formato YYYY-MM-DD.");
    error.status = 400;
    throw error;
  }

  const start = new Date(`${date}T00:00:00-06:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const result = await executeGraphql(`
    query GetAccessLogs($start: Timestamp!, $end: Timestamp!) {
      accessLogs(where: { fechaHora: { ge: $start, lt: $end } }, limit: 10000) {
        idReferencia nombre grupo estado fechaHora
      }
    }
  `, { start: start.toISOString(), end: end.toISOString() }, true);

  return result.accessLogs.map(log => ({
    id: log.idReferencia,
    nombre: log.nombre,
    grupo: log.grupo,
    estado: log.estado,
    fecha_hora: log.fechaHora
  }));
}

app.get("/api/health", asyncRoute(async (_request, response) => {
  await executeGraphql("query CheckDataConnect { students(limit: 1) { matricula } }", {}, true);
  response.json({ ok: true, service: SERVICE_ID, location: LOCATION });
}));

app.post("/api/admin/login", (request, response) => {
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (!constantTimeEqual(password, ADMIN_PASSWORD)) {
    response.status(401).json({ error: "Contraseña incorrecta." });
    return;
  }
  setSessionCookie(response, createSessionToken());
  response.json({ ok: true });
});

app.post("/api/admin/logout", (_request, response) => {
  clearSessionCookie(response);
  response.json({ ok: true });
});

app.get("/api/admin/database", requireAdmin, asyncRoute(async (_request, response) => {
  response.json(await loadDatabase());
}));

app.put("/api/admin/database", requireAdmin, asyncRoute(async (request, response) => {
  const database = request.body;
  if (!database || typeof database !== "object" || Array.isArray(database)) {
    response.status(400).json({ error: "El cuerpo debe contener la base de datos." });
    return;
  }
  for (const field of ["alumnos", "profesores", "invitados", "codigos_qr"]) {
    if (database[field] !== undefined && !Array.isArray(database[field])) {
      response.status(400).json({ error: `${field} debe ser una lista.` });
      return;
    }
  }
  await synchronizeDatabase(database);
  response.json({ ok: true });
}));

app.post("/api/public/lookup", asyncRoute(async (request, response) => {
  const result = await publicLookup(request.body || {});
  response.json({ found: Boolean(result), qr: result });
}));

app.post("/api/public/register", asyncRoute(async (request, response) => {
  const result = await registerPublic(request.body?.type, request.body || {});
  response.status(201).json({ qr: result });
}));

app.get("/api/accesos", requireAdmin, asyncRoute(async (request, response) => {
  response.json(await getAccessLogs(String(request.query.fecha || "")));
}));

app.post("/api/accesos", requireAdmin, asyncRoute(async (request, response) => {
  const log = request.body || {};
  const fechaHora = new Date(log.fecha_hora || Date.now());
  if (Number.isNaN(fechaHora.getTime())) {
    response.status(400).json({ error: "fecha_hora no es válida." });
    return;
  }
  const data = {
    idReferencia: requireText(String(log.id || ""), "id", 100),
    nombre: requireText(log.nombre, "nombre"),
    grupo: requireText(log.grupo, "grupo"),
    estado: requireText(log.estado, "estado"),
    fechaHora: fechaHora.toISOString()
  };
  await executeGraphql(`
    mutation AddAccessLog($data: AccessLog_Data!) {
      accessLog_insert(data: $data)
    }
  `, { data });
  response.status(201).json({ ok: true });
}));

const publicFiles = new Set([
  "index.html",
  "script.js",
  "style.css",
  "logo-ilb.png",
  "logo-informatica.png"
]);

app.get("/", (_request, response) => response.sendFile(path.join(__dirname, "index.html")));
app.get("/:file", (request, response, next) => {
  if (!publicFiles.has(request.params.file)) {
    next();
    return;
  }
  response.sendFile(path.join(__dirname, request.params.file));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  if (response.headersSent) return;
  response.status(error.status || 500).json({
    error: error.status ? error.message : "Error interno al procesar la solicitud."
  });
});

app.listen(PORT, () => {
  console.log(`Control de Acceso escuchando en http://localhost:${PORT}`);
  console.log(`Firebase SQL Connect: ${PROJECT_ID}/${LOCATION}/${SERVICE_ID}`);
});
