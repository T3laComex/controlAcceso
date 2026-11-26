# Control de Acceso ILB

## Publicar desde GitHub en Firebase Hosting

El workflow de GitHub Actions publica automáticamente la página estática en Firebase Hosting cuando hay cambios en `main`. Los pull requests dirigidos a `main` crean una vista previa temporal de siete días.

### Configuración inicial (una vez)

1. En Firebase Console, abre el proyecto `t3lacceso` y configura un sitio en **Hosting**. Firebase Hosting tiene cuota gratuita; no despliegues Data Connect para este flujo.
2. En Google Cloud Console → **IAM y administración → Cuentas de servicio**, crea una cuenta de servicio para GitHub Actions y asígnale el rol **Firebase Hosting Admin** (`roles/firebasehosting.admin`). Este rol permite administrar Hosting; no le concedas roles de administrador de Firebase o de bases de datos.
3. Genera una clave JSON para esa cuenta de servicio. No añadas el archivo JSON al repositorio ni lo envíes por chat. Para guardarlo directamente como secreto del repositorio, instala GitHub CLI, autentícate con `gh auth login`, y desde PowerShell ejecuta:

   ```powershell
   Get-Content -Raw -LiteralPath "$env:USERPROFILE\.config\control-acceso\t3lacceso-firebase-adminsdk-fbsvc-22ed280271.json" |
     gh secret set FIREBASE_SERVICE_ACCOUNT_T3LACCESO --repo T3laComex/controlAcceso
   ```

   La clave se envía por entrada estándar y no se imprime en la terminal. También puedes crear el secreto desde **T3laComex/controlAcceso → Settings → Secrets and variables → Actions → New repository secret**, con el nombre `FIREBASE_SERVICE_ACCOUNT_T3LACCESO`.
4. Verifica que la rama predeterminada sea `main` y que Actions esté habilitado.
5. Envía un commit a `main`. Revisa la pestaña **Actions** en GitHub para ver el resultado y la URL de Hosting.

La autenticación de GitHub Actions es distinta de ADC: este despliegue usa el secreto guardado en GitHub. No hace falta ejecutar `gcloud auth application-default login` para publicar.

## Alcance actual y siguientes pasos

Esto conecta **GitHub → Firebase Hosting** para publicar los archivos estáticos. No despliega Firebase Data Connect ni conecta el formulario a una base de datos. El código actual todavía usa rutas `/api/...` atendidas por `server.js`; Firebase Hosting por sí solo no ejecuta ese servidor, así que las funciones de registro y administración no estarán disponibles en el sitio publicado todavía.

Adaptar esos flujos a Firebase Firestore con Firebase Authentication y reglas seguras queda como una fase posterior. La configuración de Data Connect se conserva en `dataconnect/`, pero no se despliega en este flujo.

## Desarrollo local existente

Para ejecutar el backend Node actual localmente, instala Node.js 22 o posterior, ejecuta `npm install`, configura `.env` a partir de `.env.example` y luego `npm start`. El backend actual necesita credenciales de Google y Data Connect; la publicación estática de Hosting no las necesita.
