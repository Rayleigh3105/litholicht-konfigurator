# LithoLicht 3D Konfigurator - Standalone

Standalone 3D-Konfigurator fuer Lithophane-Produkte. Kommuniziert mit Odoo ueber API.

## Architektur

```
┌─────────────────────────────────────────────────┐
│  Frontend (dieses Projekt)                      │
│  - Vite + Vanilla JS                            │
│  - Three.js 3D-Rendering                        │
│  - Gehostet auf Vercel/Netlify                  │
└─────────────────────┬───────────────────────────┘
                      │ JSON-RPC API
                      ▼
┌─────────────────────────────────────────────────┐
│  Odoo Backend                                   │
│  - litholicht_product_fields Modul              │
│  - Produkte & Varianten                         │
│  - Warenkorb & Checkout                         │
└─────────────────────────────────────────────────┘
```

## Voraussetzungen

- Node.js 18+
- Odoo mit installiertem `litholicht_product_fields` Modul

## Installation

```bash
# Dependencies installieren
npm install

# Umgebungsvariablen konfigurieren
cp .env.example .env
# Dann .env editieren und VITE_ODOO_URL setzen

# Entwicklungsserver starten
npm run dev
```

## Konfiguration

Erstelle eine `.env` Datei:

```env
VITE_ODOO_URL=https://dein-odoo-server.de
```

## Development

```bash
npm run dev
```

Oeffnet http://localhost:3000

## Build fuer Produktion

```bash
npm run build
```

Output liegt in `dist/` - kann auf Vercel, Netlify oder jedem Static Host deployed werden.

## Deployment auf Vercel

1. Repository auf GitHub pushen
2. Vercel mit GitHub verbinden
3. Environment Variable `VITE_ODOO_URL` setzen
4. Deployen

## Deployment auf Netlify

1. Repository auf GitHub pushen
2. Netlify mit GitHub verbinden
3. Build Command: `npm run build`
4. Publish Directory: `dist`
5. Environment Variable `VITE_ODOO_URL` setzen

## Odoo Setup

### 1. Modul installieren

Installiere das `litholicht_product_fields` Modul in Odoo.

### 2. Produkte konfigurieren

1. Produkt oeffnen -> Tab "3D Konfigurator"
2. "Im Konfigurator anzeigen" aktivieren
3. 3D-Form waehlen (Flach/Kugel/Gebogen)
4. Groessen als Produktvarianten anlegen
5. Produkt veroeffentlichen

### 3. CORS konfigurieren (wichtig!)

Odoo muss Cross-Origin Requests vom Frontend erlauben.

Option A: Nginx Proxy (empfohlen)
```nginx
location /web/ {
    add_header 'Access-Control-Allow-Origin' 'https://dein-konfigurator.vercel.app';
    add_header 'Access-Control-Allow-Credentials' 'true';
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS';
    add_header 'Access-Control-Allow-Headers' 'Content-Type';
    proxy_pass http://localhost:8069;
}
```

Option B: Odoo CORS Modul
Installiere ein CORS-Modul aus dem Odoo App Store.

## Dateistruktur

```
litholicht-konfigurator/
├── index.html              # Hauptseite
├── package.json            # Dependencies
├── vite.config.js          # Build-Konfiguration
├── .env.example            # Beispiel Umgebungsvariablen
└── src/
    ├── main.js             # Haupt-JavaScript (Three.js + UI)
    ├── lib/
    │   └── odoo-api.js     # Odoo API Client
    └── styles/
        └── configurator.scss  # Styling
```

## Features

- 3D Live-Vorschau mit WebGL
- Foto-Upload per Drag & Drop
- Drei 3D-Formen: Flach, Kugel (MoonLamp), Gebogen
- Groessenauswahl mit Preisen aus Odoo
- Lichtfarben-Simulation
- Optionale Textgravur
- Warenkorb-Integration mit Odoo
