# Control de acceso al auditorio

Sitio estático para Firebase Hosting conectado directamente a Firestore. Cada persona se registra sin crear cuenta y obtiene un código QR. Solo la cuenta de administrador autorizada puede leer los registros.

## Registro y códigos QR

| Tipo | Datos que pide | Documento en Firestore | Contenido del QR |
|---|---|---|---|
| Alumno | Matrícula (10 caracteres) y correo | `alumnos/{matricula}` | `ALU-<matrícula>` |
| Profesor | Matrícula, nombre, apellidos y correo | `profesores/{matricula}` | `PROF-<matrícula>` |
| Invitado | Nombre y apellidos | `invitados/{folio}` | `INV-<folio>` |

- **Sin duplicados:** la matrícula es el ID del documento. Las reglas solo permiten *crear* documentos nuevos, así que un segundo registro con la misma matrícula se rechaza sin revisar los demás registros.
- **"Consultar / Obtener mi QR":** si la matrícula ya existe y el correo coincide, se vuelve a mostrar el QR. Si el correo no coincide, se rechaza. El público nunca puede leer los registros.
- **Folio de invitado:** consecutivo (1, 2, 3…), asignado en una transacción con el contador `contadores/invitados`. Las reglas obligan a que el contador avance de uno en uno junto con la creación del invitado.
- El panel de administrador (3 clics en el logo o Ctrl+Shift+A) inicia sesión con Firebase Authentication y permite ver, editar y borrar registros, generar invitados y consultar la colección `accesos` (monitor en vivo e historial).

Después de cambiar `firestore.rules`, publícalas con `firebase deploy --only firestore:rules --project t3lacceso` (o cópialas en Firebase Console → Firestore Database → Reglas). El workflow de GitHub solo publica Hosting, no las reglas.

## Conectar el proyecto Firebase una vez

1. En Firebase Console, abre `t3lacceso` → **Configuración del proyecto** → **General**. Si aún no tienes una aplicación web, agrégala. Copia `apiKey`, `authDomain`, `projectId` y `appId` de la configuración de Firebase para aplicaciones web en `firebase-config.js`. Esos valores de cliente son públicos; nunca pongas aquí una clave privada ni contraseña.
2. En **Authentication → Sign-in method**, habilita **Correo electrónico/contraseña**.
3. En **Authentication → Users**, agrega la cuenta del administrador. Copia su **UID**.
4. En `firebase-config.js`, reemplaza `PEGA_AQUI_EL_UID_DEL_ADMIN` por ese UID.
5. Verifica que el UID de `firestore.rules` (función `isAdmin`) sea el mismo y publica las reglas (ver arriba). Las reglas permiten crear registros públicos con campos limitados; solo ese UID puede leerlos, modificarlos o eliminarlos. El resto de la base queda denegado.
6. En Firestore Database, crea la base de datos en modo de producción si todavía no existe. No uses reglas abiertas de prueba.
7. El sitio funciona con usuarios en el plan gratuito Spark mientras se respeten sus cuotas. En este proyecto no se necesita Data Connect, Node ni una tarjeta para los registros de Firestore en el nivel gratuito.

`firebase-config.js` y la app deben publicarse desde la misma rama y dominio de Firebase Hosting. No abras `index.html` con `file://`; usa Hosting o un servidor local.

## Publicación desde GitHub

El workflow `.github/workflows/firebase-hosting.yml` publica `main` en Firebase Hosting y crea vistas previas para pull requests del mismo repositorio. Requiere el secreto `FIREBASE_SERVICE_ACCOUNT_T3LACCESO` en GitHub. Este secreto es para publicar el sitio; no se usa en el navegador ni concede acceso a los registros de asistentes.

Después de configurar `firebase-config.js` y publicar las reglas, sube los cambios a `main`. Revisa **Actions** y abre la URL de Hosting que muestre el despliegue. En la web, pulsa tres veces el logo para abrir el acceso del administrador. Registra una persona ficticia y confirma que aparece en Firestore, en la colección `alumnos`, `profesores` o `invitados`.

Los registros son públicos de escritura para permitir el acceso sin cuenta, pero las reglas no permiten leerlos públicamente. Como cualquier formulario público, alguien podría intentar enviar registros falsos o consumir cuota; las reglas validan campos y restringen el tamaño, pero no son un limitador de frecuencia. Para un evento real, activa Firebase App Check y revisa las cuotas.

## Revocar la clave de cuenta de servicio expuesta en OneDrive

No revoques la clave anterior hasta tener una nueva en el secreto de GitHub, porque Actions la necesita para publicar.

1. Abre [Cuentas de servicio de Google Cloud](https://console.cloud.google.com/iam-admin/serviceaccounts?project=t3lacceso) y selecciona la cuenta creada para Firebase Hosting.
2. Abre **Claves → Agregar clave → Crear clave nueva → JSON**. Descárgala directamente fuera de OneDrive.
3. En GitHub, abre `T3laComex/controlAcceso → Settings → Secrets and variables → Actions → FIREBASE_SERVICE_ACCOUNT_T3LACCESO` y actualiza el secreto con el contenido completo del JSON nuevo. No subas el archivo al repositorio ni lo compartas por chat.
4. Confirma que el secreto quedó guardado y vuelve a ejecutar el workflow de Firebase Hosting en **Actions**. Comprueba que termine en verde.
5. Regresa a **Claves** de la cuenta de servicio y elimina la clave anterior, identificándola por el ID de la clave expuesta o su fecha de creación. No elimines la clave nueva.
6. Borra la copia antigua de OneDrive y vacía la papelera de OneDrive/Windows. Conserva la nueva solo como secreto de GitHub; si mantienes una copia local para futuras rotaciones, guárdala fuera de carpetas sincronizadas y excluida de Git.

## Mantener una sola publicación

Para evitar dos sitios distintos, desactiva GitHub Pages en `T3laComex/controlAcceso → Settings → Pages` si ya no lo vas a usar. La publicación oficial será Firebase Hosting.
