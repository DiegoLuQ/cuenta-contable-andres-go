# Instalación en el SERVIDOR NUBE de producción (186.64.120.228)

Esta carpeta es la web (interfaz + API). Solo lee MySQL `db_central`; nunca se conecta a Softland.
Un solo contenedor (`cuentas_contables_web`), publicado a través del `nginx-proxy` + Let's Encrypt de `/proyectos/base`, por la red `red_produccion`.

## Qué instalar
Nada nuevo: el servidor ya tiene **Docker + Docker Compose** y el proxy. No hace falta Node ni Python en el servidor.

## Requisitos previos
1. El dominio `central.dpmc.cl` con registro **A → 186.64.120.228**. Let's Encrypt necesita que resuelva antes de levantar el contenedor.
2. La red `red_produccion` existe (`docker network ls`).
3. Las tablas `con_c_*` ya existen en `db_central` (creadas con `../sql/001..003`) y hay un superadmin (`admin`).

## 1. Copiar esta carpeta al servidor

Copiar el contenido de `servidor-nube/` a `/proyectos/cuentas-contables/`, **sin** `node_modules/` ni el `.env` local.

```bash
# desde la máquina de desarrollo (Git Bash), parado en CuentaContables-Andres/
rsync -av --exclude node_modules --exclude .env servidor-nube/ usuario@186.64.120.228:/proyectos/cuentas-contables/
```
También sirve WinSCP / FileZilla: subir todo menos `node_modules` y `.env`.

## 2. Crear el `.env` en el servidor

```bash
cd /proyectos/cuentas-contables
cp .env.production.example .env
nano .env        # completar MYSQL_*, SESSION_SECRET, PUBLIC_URL, VIRTUAL_HOST, LETSENCRYPT_HOST, LETSENCRYPT_EMAIL
chmod 600 .env
```

- `SESSION_SECRET`: obligatorio (el contenedor no arranca sin él). Si cambia, todos deben volver a ingresar.
- `PUBLIC_URL`: URL pública con https (ej. `https://central.dpmc.cl`). Es la que aparece en el JSON de las API keys.
- `MYSQL_HOST`: si MariaDB corre como contenedor en `red_produccion`, usar su nombre de contenedor en vez de la IP.

## 3. Levantar

```bash
docker compose up -d --build
docker compose ps                 # debe quedar "healthy"
docker compose logs -f web        # Ctrl+C para salir
```

Abrir `https://central.dpmc.cl` → pantalla de login. El certificado puede tardar 1–2 minutos la primera vez.

## 4. Primer ingreso
1. Ingresar con `admin` y **cambiar la contraseña** (botón *Contraseña*).
2. Crear los usuarios (*Usuarios*) y, si alguna app lo necesita, sus API keys (página *API Keys*). Con `PUBLIC_URL` definida, el JSON de entrega trae la URL de producción aunque la clave se cree en local.

## Actualizar a una nueva versión
```bash
cd /proyectos/cuentas-contables
# copiar los archivos nuevos (paso 1) y luego:
docker compose up -d --build
docker image prune -f             # opcional: limpia imágenes antiguas
```

## Crear un usuario por consola (si se pierde el acceso)
```bash
docker compose exec web node scripts/crear_usuario.js <usuario> superadmin "<Nombre>"
```

## Extractor
No va en este servidor: es la carpeta `servidor-softland/` (ver su `INSTALAR.md`).
