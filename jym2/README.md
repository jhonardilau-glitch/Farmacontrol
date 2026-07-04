# Droguería JYM 2 — v3

## Despliegue en Railway (gratis, 5 minutos)

1. Crea cuenta en https://railway.app (con tu cuenta de GitHub)
2. En Railway → "New Project" → "Deploy from GitHub repo"
3. Sube esta carpeta a un repositorio de GitHub primero:
   - Ve a https://github.com/new → crea repo `drogueria-jym2`
   - Sube los archivos (sin node_modules ni data/)
4. Railway detecta Node.js automáticamente y despliega
5. Te da una URL tipo: `https://drogueria-jym2.up.railway.app`
6. Esa URL funciona desde la Zebra, PC, celular — cualquier red

## Uso en red local (sin internet)

1. Doble clic en `INICIAR.bat`
2. PC: http://localhost:3000
3. Zebra: http://<IP-del-PC>:3000

## Credenciales por defecto
- Usuario: `admin` / Contraseña: `12345`
- Usuario: `jym` / Contraseña: `jym2024`

## Logo
Pon `drogueriajym2.png` en la carpeta `public/fondo/`

## Datos
Los datos se guardan en `data/db.json` (creado automáticamente)
