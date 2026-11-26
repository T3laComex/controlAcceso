# Control de Acceso conectado a Firebase SQL Connect

## Preparación

1. Instala Node.js 22 o posterior.
2. Ejecuta `npm install`.
3. Copia `.env.example` a `.env` y configura una contraseña administrativa y un secreto aleatorio de al menos 32 caracteres.
4. Para desarrollo local, configura Application Default Credentials con `gcloud auth application-default login`, o define `GOOGLE_APPLICATION_CREDENTIALS` con una cuenta de servicio guardada fuera del repositorio. La cuenta necesita permisos para ejecutar operaciones de Firebase SQL Connect.
5. Despliega primero el esquema de Data Connect y luego inicia el sitio:

   ```sh
   npx firebase-tools login
   npx firebase-tools deploy --only dataconnect --project t3lacceso
   npm start
   ```

Abre `http://localhost:3000`. El sitio y la API deben servirse desde el mismo origen; abrir `index.html` directamente o usar una extensión de servidor estático no conectará con Node.

## Configuración de Data Connect

El esquema y la configuración del servicio están en `dataconnect/`. Antes de desplegar, confirma en Firebase Console que el ID de instancia de Cloud SQL sea `t3lacceso-servicio` y que la base de datos sea `postgres`. Si la consola muestra otro ID, actualiza `dataconnect/dataconnect.yaml`.

El backend usa el Admin SDK solo en Node. No pongas credenciales de servicio ni contraseñas en `script.js`. Las operaciones administrativas requieren la cookie de sesión que se crea tras validar `ADMIN_PASSWORD`.

## Migración de datos locales

Al iniciar sesión por primera vez, si Data Connect está vacío y hay datos en el navegador, el panel pregunta si deseas copiarlos a Firebase. Si Firebase ya contiene registros, esos datos reemplazan la copia local del navegador.

El endpoint `GET /api/health` verifica la conexión real con Data Connect. Los errores de conexión se registran en la terminal y la API responde con error; no se usa `localStorage` como sustituto silencioso de Firebase.
