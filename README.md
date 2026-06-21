<img src="./project-logo.png" alt="Klai" width="120" />

# Klai

**The first interface that builds itself over any video.**

You don't navigate menus or click buttons. You speak (or type), and Klai builds the exact widget you need right on top of whatever you're watching. It reads the current video frame to understand the context, then composes animated widgets over the video, placed so they don't cover the action.

Built at Platanus Hack 26 (CDMX) for the **New Interface** track.

---

## What it is

Klai is a Chrome extension (plus a small Next.js backend) that turns any video into an interactive surface driven by intent. Today it shines on sports: while watching a match you ask for the score, the stats, the win probability, or a timer, and it appears instantly over the broadcast. The same engine works on lectures, cooking videos, and gameplay.

The idea is to flip the usual relationship: instead of you adapting to a fixed UI, the UI adapts to your intent.

## How it works

1. You ask for something by voice or text.
2. Klai captures the visible tab frame and interprets it with AI (Claude, vision).
3. It returns a validated description of which widget to render, and the extension draws a hand-built, animated component over the video.

The AI never writes runtime code. It chooses from a curated set of components and fills their data, which keeps the result reliable and consistent.

## Features

- **Works on any video** — sports, lectures, cooking, gameplay. Klai detects the kind of content and picks the right widgets.
- **Voice and text** — speak or type your request.
- **Live widgets** — scoreboard, stats panel, win-probability bar, alerts, timer, key points, definitions.
- **Voice control of the interface** — "close the scoreboard", "move the stats to the right", "clear everything".
- **Watch mode** — Klai proactively surfaces notable moments on its own (a goal, a penalty, a card).
- **Fill-the-gap scoreboard** — when the broadcast hides its own score (a replay, a wide shot), Klai shows the last known score; when the broadcast shows it again, Klai's hides itself.
- **Manageable widgets** — drag, close, and arrange each widget freely.

### Sports examples (most tested)

While watching a match:

- "What's the score?" — a live scoreboard with teams and minute.
- "Who's winning?" — a win-probability bar.
- "Show me the cards" — yellow and red cards per team.
- "Put a 10 minute timer" — a countdown over the video.
- "Give me the match summary" — several widgets at once.

## Install (for users)

The fastest way to try Klai. The extension talks to our hosted backend, so you don't need to run anything else.

1. Download the latest `klai-extension-v1.0.1.zip` from the [Releases page](https://github.com/KiraBelak/overlai/releases).
2. Unzip it.
3. Open `chrome://extensions`, enable **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.
5. On first run, grant microphone access on the one-time page that opens (needed for voice).

That's it. Open any video and start asking.

> Note: Chrome does not allow one-click installs from outside the Chrome Web Store, so the load-unpacked step above is the supported way until the store listing is live.

## Run from source (for developers)

Klai is open source. To run the full stack locally:

### 1. Backend

```bash
cd backend
yarn install
```

Create `backend/.env.local` with your keys:

```bash
ANTHROPIC_API_KEY=sk-ant-...   # Claude (vision + structured output)
OPENAI_API_KEY=sk-...          # Whisper voice transcription
FIRECRAWL_API_KEY=fc-...       # web research (optional)
```

Then run it:

```bash
yarn dev   # serves on http://localhost:3000
```

### 2. Extension

```bash
cd extension
npm install
npm run build:dev   # builds to dist/ pointing at localhost, with auto-rebuild
```

Load it in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `extension/dist`

On first run, Klai opens a one-time page to grant microphone access (needed for voice).

> For a production build pointing at the deployed backend, set `VITE_BACKEND_BASE_URL` in `extension/.env.production` and run `npm run build`.

## Usage

- Click the Klai icon and speak or type your request, or use the keyboard shortcut **Alt+Shift+K** over any video.
- Turn on **Watch mode** in the popup to let Klai surface notable moments automatically.
- Manage widgets by voice ("close the scoreboard", "move it to the right") or by dragging and closing them directly.

## Tech stack

- **Extension**: Chrome Manifest V3, React, TypeScript, Vite + CRXJS, Framer Motion, Zod.
- **Backend**: Next.js (App Router) on Vercel.
- **AI**: Claude for vision and structured (tool-use) output; Whisper for voice transcription.
- **Data**: live sports data from ESPN.

## Project structure

```
extension/   Chrome extension (popup, content overlay, service worker, widgets)
backend/     Next.js API (/api/generate, /api/transcribe) + landing page
```

## Open source

Contributions are welcome. Open an issue or a pull request. The curated-component model makes it easy to add a new widget: define its schema, build the component, register it, and describe it to the model.

## Team

- Juan Kaleb Rodriguez Esparza ([@KiraBelak](https://github.com/KiraBelak))
- Fora Delgado ([@Foralitos](https://github.com/Foralitos))
- Pedro Gutierrez ([@ronihy](https://github.com/ronihy))


 # Klai

  **La primera interfaz que se construye sola sobre cualquier video.**

  No navegas menús ni haces clic en botones. Hablas (o escribes), y Klai construye el widget exacto que necesitas directamente sobre lo que estás viendo. Lee el cuadro actual del video para entender el contexto y compone widgets animados encima del video, posicionados para no tapar la
  acción.

  Construido en Platanus Hack 26 (CDMX) para el track de **Nueva Interfaz**.

  ---

  ## Qué es

  Klai es una extensión de Chrome (más un pequeño backend en Next.js) que convierte cualquier video en una superficie interactiva impulsada por intención. Hoy brilla en deportes: mientras ves un partido le pides el marcador, las estadísticas, la probabilidad de victoria o un cronómetro, y
  aparece al instante sobre la transmisión. El mismo motor funciona en clases, videos de cocina y gameplay.

  La idea es invertir la relación habitual: en lugar de que tú te adaptes a una UI fija, la UI se adapta a tu intención.

  ## Cómo funciona

  1. Pides algo por voz o texto.
  2. Klai captura el cuadro visible del tab y lo interpreta con IA (Claude, visión).
  3. Devuelve una descripción validada del widget a renderizar, y la extensión dibuja un componente animado y construido a mano sobre el video.

  La IA nunca escribe código en tiempo real. Elige de un conjunto curado de componentes y llena sus datos, lo que mantiene el resultado confiable y consistente.

  ## Funciones

  - **Funciona en cualquier video** — deportes, clases, cocina, gameplay. Klai detecta el tipo de contenido y elige los widgets correctos.
  - **Voz y texto** — habla o escribe tu solicitud.
  - **Widgets en vivo** — marcador, panel de estadísticas, barra de probabilidad de victoria, alertas, cronómetro, puntos clave, definiciones.
  - **Control por voz de la interfaz** — "cierra el marcador", "mueve las estadísticas a la derecha", "limpia todo".
  - **Modo watch** — Klai muestra proactivamente los momentos notables por su cuenta (un gol, un penal, una tarjeta).
  - **Marcador de relleno** — cuando la transmisión oculta su propio marcador (un replay, una toma abierta), Klai muestra el último resultado conocido; cuando la transmisión lo vuelve a mostrar, Klai esconde el suyo.
  - **Widgets manejables** — arrastra, cierra y acomoda cada widget libremente.

  ### Ejemplos en deportes (los más probados)

  Mientras ves un partido:

  - "¿Cómo va el marcador?" — un marcador en vivo con equipos y minuto.
  - "¿Quién va ganando?" — una barra de probabilidad de victoria.
  - "Muéstrame las tarjetas" — tarjetas amarillas y rojas por equipo.
  - "Pon un cronómetro de 10 minutos" — una cuenta regresiva sobre el video.
  - "Dame el resumen del partido" — varios widgets a la vez.

  ## Instalación (para usuarios)

  La forma más rápida de probar Klai. La extensión se conecta a nuestro backend en producción, no necesitas correr nada más.

  1. Descarga el último `klai-extension-v1.0.1.zip` desde la [página de Releases](https://github.com/KiraBelak/overlai/releases).
  2. Descomprímelo.
  3. Abre `chrome://extensions`, activa el **Modo desarrollador** (arriba a la derecha).
  4. Haz clic en **Cargar descomprimida** y selecciona la carpeta descomprimida.
  5. En el primer uso, otorga acceso al micrófono en la página que se abre (necesario para la voz).

  Listo. Abre cualquier video y empieza a preguntar.

  > Nota: Chrome no permite instalaciones con un clic desde fuera de la Chrome Web Store, así que el paso anterior es la forma soportada hasta que el listing en la tienda esté activo.

  ## Correr desde código fuente (para desarrolladores)

  Klai es open source. Para correr el stack completo en local:

  ### 1. Backend

  ```bash
  cd backend
  yarn install
  ```
  Crea backend/.env.local con tus keys:

  ANTHROPIC_API_KEY=sk-ant-...   # Claude (visión + salida estructurada)
  OPENAI_API_KEY=sk-...          # Transcripción de voz con Whisper
  FIRECRAWL_API_KEY=fc-...       # Búsqueda web (opcional)

  Luego córrelo:
 ```bash
  yarn dev   # sirve en http://localhost:3000
 ```
  2. Extensión
 ```bash
  cd extension
  npm install
  npm run build:dev   # compila a dist/ apuntando a localhost, con auto-rebuild
 ```
  Cárgala en Chrome:
 
  1. Abre chrome://extensions
  2. Activa el Modo desarrollador
  3. Haz clic en Cargar descomprimida y selecciona extension/dist

  En el primer uso, Klai abre una página única para otorgar acceso al micrófono (necesario para la voz).

  ▎ Para un build de producción apuntando al backend desplegado, define VITE_BACKEND_BASE_URL en extension/.env.production y corre npm run build.

  Uso

  - Haz clic en el ícono de Klai y habla o escribe tu solicitud, o usa el atajo de teclado Alt+Shift+K sobre cualquier video.
  - Activa el Modo watch en el popup para que Klai muestre los momentos notables automáticamente.
  - Maneja los widgets por voz ("cierra el marcador", "muévelo a la derecha") o arrastrándolos y cerrándolos directamente.

  Stack tecnológico

  - Extensión: Chrome Manifest V3, React, TypeScript, Vite + CRXJS, Framer Motion, Zod.
  - Backend: Next.js (App Router) en Vercel.
  - IA: Claude para visión y salida estructurada (tool use); Whisper para transcripción de voz.
  - Datos: datos deportivos en vivo desde ESPN.

  Estructura del proyecto
```
  extension/   Extensión Chrome (popup, overlay de contenido, service worker, widgets)
  backend/     API Next.js (/api/generate, /api/transcribe) + landing page
```
  Open source

  Las contribuciones son bienvenidas. Abre un issue o un pull request. El modelo de componentes curados facilita agregar un nuevo widget: define su schema, construye el componente, regístralo y descríbeselo al modelo.

  Equipo

  - Juan Kaleb Rodriguez Esparza (@KiraBelak (https://github.com/KiraBelak))
  - Fora Delgado (@Foralitos (https://github.com/Foralitos))
  - Pedro Gutierrez (@ronihy (https://github.com/ronihy))
