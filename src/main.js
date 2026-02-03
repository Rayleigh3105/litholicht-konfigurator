/**
 * LithoLicht 3D Konfigurator - Standalone Version
 * Kommuniziert mit Odoo über API
 */
import * as THREE from 'three';
import { odooApi } from './lib/odoo-api.js';

// =========================================================================
// State
// =========================================================================
const state = {
    products: [],
    selectedProduct: null,
    selectedVariant: null,
    uploadedImage: null,
    lightColor: 'warm',
    lightOn: true,
    engraving: '',
};

// Three.js
let scene, camera, renderer, mesh, group;
let rotX = 0.1, rotY = 0, targetRotX = 0.1, targetRotY = 0;
let isDragging = false, lastX = 0, lastY = 0;
const canvas = document.getElementById('three-canvas');

// =========================================================================
// Lithophane Shader
// =========================================================================
const VERTEX_SHADER = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const FRAGMENT_SHADER = `
    uniform sampler2D uTexture;
    uniform float uLightOn;
    uniform vec3 uLightColor;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
        vec4 texColor = texture2D(uTexture, vUv);

        // Luminanz berechnen
        float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));

        // Kontrast erhoehen fuer besseren Lithophane-Effekt
        float contrast = lum * lum * (3.0 - 2.0 * lum);

        // Porzellan-Grundfarbe
        vec3 porcelain = vec3(0.95, 0.93, 0.90);

        // Dicke simulieren (dunkel = dick = weniger Lichtdurchlass)
        float thickness = 1.0 - contrast;
        float transmission = exp(-thickness * 2.5);
        transmission = clamp(transmission, 0.02, 0.95);

        // Hintergrundbeleuchtung
        vec3 backlight = uLightColor * transmission * 0.9;

        // Subsurface Scattering simulieren
        float sss = transmission * 0.15;

        // Diffuse Beleuchtung
        float diffuse = max(dot(vNormal, normalize(vec3(0.2, 0.3, 1.0))), 0.0);
        vec3 surface = porcelain * (0.25 + diffuse * 0.2);

        // Fresnel-Effekt (Rand-Glanz)
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.0);
        vec3 rim = porcelain * fresnel * 0.12;

        // Finale Farbe
        vec3 litColor = backlight + porcelain * sss + surface * 0.3 + rim;
        vec3 unlitColor = surface + rim * 0.5;
        vec3 finalColor = mix(unlitColor, litColor, uLightOn);

        // Leichte Abdunklung in dicken Bereichen
        finalColor *= (1.0 - thickness * 0.08);

        // Tone Mapping
        finalColor = finalColor / (finalColor + vec3(1.0));

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

const LIGHT_COLORS = {
    warm: new THREE.Vector3(1.0, 0.88, 0.65),
    cool: new THREE.Vector3(0.85, 0.92, 1.0),
    multi: new THREE.Vector3(1.0, 0.9, 0.75),
};

// =========================================================================
// MoonLamp Shader - Bild nur auf einer Seite, Rest ist Mondoberfläche
// =========================================================================
const MOON_VERTEX_SHADER = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec3 vPosition;

    void main() {
        vUv = uv;
        vPosition = position;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const MOON_FRAGMENT_SHADER = `
    uniform sampler2D uTexture;
    uniform float uLightOn;
    uniform vec3 uLightColor;
    uniform float uImageRadius;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec3 vPosition;

    // Simplex Noise für Mondkrater
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }

    float craterNoise(vec2 uv) {
        float n = 0.0;
        // Basis-Terrain
        n += 0.5 * snoise(uv * 3.0);
        n += 0.25 * snoise(uv * 6.0);
        n += 0.125 * snoise(uv * 12.0);

        // Krater: Mehrere Größen
        float crater1 = 1.0 - smoothstep(0.0, 0.15, abs(snoise(uv * 5.0)));
        float crater2 = 1.0 - smoothstep(0.0, 0.1, abs(snoise(uv * 10.0 + 5.0)));
        float crater3 = 1.0 - smoothstep(0.0, 0.08, abs(snoise(uv * 20.0 + 10.0)));

        // Krater-Ränder
        float rim1 = smoothstep(0.12, 0.15, abs(snoise(uv * 5.0))) * smoothstep(0.2, 0.15, abs(snoise(uv * 5.0)));
        float rim2 = smoothstep(0.08, 0.1, abs(snoise(uv * 10.0 + 5.0))) * smoothstep(0.14, 0.1, abs(snoise(uv * 10.0 + 5.0)));

        return n * 0.3 - crater1 * 0.15 - crater2 * 0.08 - crater3 * 0.04 + rim1 * 0.1 + rim2 * 0.05;
    }

    void main() {
        // Position auf Einheitskugel normalisieren
        vec3 nPos = normalize(vPosition);

        // Berechne Abstand vom Zentrum der Vorderseite (Z+)
        float distFromFront = length(nPos.xy);

        // Extrem weicher, gradueller Übergang
        float edgeSoftness = 0.9;
        float radialFade = smoothstep(uImageRadius + edgeSoftness, uImageRadius - edgeSoftness * 0.3, distFromFront);
        // Zusätzliche Glättung für weicheren radialen Übergang
        radialFade = radialFade * radialFade * (3.0 - 2.0 * radialFade);

        // Sehr sanfter Z-Übergang über noch größeren Bereich
        float zFade = smoothstep(-0.7, 0.5, nPos.z);
        // Noch weicher machen
        zFade = zFade * zFade * (3.0 - 2.0 * zFade);

        // Kombiniere beide Fades
        float imageArea = radialFade * zFade;
        // Dreifache Hermite-Interpolation für ultra-weichen Übergang
        imageArea = imageArea * imageArea * (3.0 - 2.0 * imageArea);
        imageArea = imageArea * imageArea * (3.0 - 2.0 * imageArea);

        // Mond-Texturkoordinaten (sphärisch)
        vec2 moonUv = vec2(
            0.5 + atan(nPos.z, nPos.x) / (2.0 * 3.14159),
            0.5 - asin(nPos.y) / 3.14159
        );

        // Mondkrater-Textur - realistischer
        float moonNoise = craterNoise(moonUv * 8.0);
        float detailNoise = snoise(moonUv * 30.0) * 0.03;

        // Mond-Grundfarbe (grau mit leichtem Warmton)
        vec3 moonBase = vec3(0.82, 0.80, 0.78);
        // Dunklere Bereiche (Maria)
        float maria = smoothstep(-0.1, 0.2, snoise(moonUv * 2.0));
        vec3 moonColor = mix(vec3(0.65, 0.63, 0.60), moonBase, maria);
        // Krater-Details
        moonColor += moonNoise * 0.2 + detailNoise;

        // Lithophane-Bereich
        vec4 texColor = texture2D(uTexture, vUv);
        float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));

        // Stärkerer Kontrast für besseren Lithophane-Effekt
        float contrast = pow(lum, 1.5) * (3.0 - 2.0 * lum);

        // Porzellan-Grundfarbe
        vec3 porcelain = vec3(0.98, 0.96, 0.93);

        // Dicke simulieren (stärker)
        float thickness = 1.0 - contrast;
        float transmission = exp(-thickness * 3.5);
        transmission = clamp(transmission, 0.01, 0.98);

        // Hintergrundbeleuchtung
        vec3 backlight = uLightColor * transmission * 1.1;

        // Subsurface Scattering
        float sss = transmission * 0.2;

        // Diffuse Beleuchtung
        float diffuse = max(dot(vNormal, normalize(vec3(0.2, 0.3, 1.0))), 0.0);
        vec3 surface = porcelain * (0.2 + diffuse * 0.25);

        // Fresnel-Effekt
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.0);
        vec3 rim = porcelain * fresnel * 0.15;

        // Lithophane-Farbe (beleuchtet)
        vec3 litLitho = backlight + porcelain * sss + surface * 0.25 + rim;
        vec3 unlitLitho = surface + rim * 0.5;
        vec3 lithoColor = mix(unlitLitho, litLitho, uLightOn);
        lithoColor *= (1.0 - thickness * 0.12);

        // Mond-Farbe (mit Beleuchtung)
        // Hauptlicht von vorne-oben
        float moonDiffuse = max(dot(vNormal, normalize(vec3(0.3, 0.5, 0.8))), 0.0);
        vec3 moonLit = moonColor * (0.15 + moonDiffuse * 0.7);

        // Ambient Occlusion durch Krater
        moonLit *= (1.0 + moonNoise * 0.3);

        // Subtiler Innenglow bei Licht an
        moonLit += uLightColor * 0.08 * uLightOn;

        // Fresnel für Kanten
        float moonFresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.5);
        moonLit += vec3(0.9, 0.88, 0.85) * moonFresnel * 0.12;

        // Mische Lithophane und Mond basierend auf Position
        vec3 finalColor = mix(moonLit, lithoColor, imageArea);

        // Tone Mapping
        finalColor = finalColor / (finalColor + vec3(1.0));

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

// =========================================================================
// URL Parameter
// =========================================================================
function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        productId: params.get('product_id') ? parseInt(params.get('product_id')) : null,
        variantId: params.get('variant_id') ? parseInt(params.get('variant_id')) : null,
    };
}

// =========================================================================
// API
// =========================================================================
async function loadProducts() {
    try {
        const urlParams = getUrlParams();

        // Wenn product_id in URL: Nur dieses Produkt laden
        if (urlParams.productId) {
            await loadSingleProduct(urlParams.productId, urlParams.variantId);
            return;
        }

        // Sonst: Alle Produkte laden (Katalog-Modus)
        const products = await odooApi.getProducts();

        // Varianten fuer jedes Produkt laden
        for (const product of products) {
            product.variants = await odooApi.getProductVariants(product.id);
        }

        state.products = products;
        renderProducts();
    } catch (e) {
        console.error('Fehler beim Laden:', e);
        document.getElementById('product-grid').innerHTML =
            '<p class="error">Fehler beim Laden der Produkte. Prüfe die Odoo-Verbindung.</p>';
    }
}

/**
 * Einzelnes Produkt laden (wenn von Odoo mit product_id aufgerufen)
 */
async function loadSingleProduct(productId, variantId = null) {
    try {
        // Produkt direkt aus lokaler Config holen (kein Odoo-Call noetig)
        const product = odooApi.getProductFromConfig(productId);

        if (!product) {
            throw new Error(`Produkt ${productId} nicht in Config gefunden`);
        }

        // Nur Varianten fuer dieses Produkt laden
        product.variants = await odooApi.getProductVariants(productId);

        state.products = [product];
        console.log('Einzelprodukt geladen:', product.name);

        // Produkt-Auswahl: Zeige ausgewaehltes Produkt (nicht editierbar)
        const productGrid = document.getElementById('product-grid');
        if (productGrid) {
            productGrid.innerHTML = `
                <div class="product-card selected single-product">
                    <div class="product-icon ${product.renderer_type}"></div>
                    <div class="product-name">${product.name}</div>
                </div>
            `;
        }

        // Direkt Produkt auswaehlen
        state.selectedProduct = product;

        // Variante vorauswaehlen
        if (variantId) {
            const variant = product.variants.find(v => v.id === variantId);
            state.selectedVariant = variant || product.variants[0] || null;
            if (variant) {
                console.log('Variante vorausgewaehlt:', variant.name);
            }
        } else {
            state.selectedVariant = product.variants[0] || null;
        }

        // UI rendern
        renderSizes(variantId);
        renderOptions();
        updatePrice();

    } catch (e) {
        console.error('Fehler beim Laden des Produkts:', e);
        document.getElementById('product-grid').innerHTML =
            `<p class="error">Produkt konnte nicht geladen werden: ${e.message}</p>`;
    }
}

// =========================================================================
// Render UI
// =========================================================================
function renderProducts() {
    const grid = document.getElementById('product-grid');
    if (!state.products.length) {
        grid.innerHTML = '<p class="muted">Keine Produkte verfügbar</p>';
        return;
    }

    grid.innerHTML = state.products.map(p => `
        <div class="product-card" data-id="${p.id}">
            <div class="product-icon ${p.renderer_type}"></div>
            <div class="product-name">${p.name}</div>
            <div class="product-price">ab ${formatPrice(p.min_price)}</div>
        </div>
    `).join('');

    // Event Listener
    grid.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', () => selectProduct(parseInt(card.dataset.id)));
    });

    // URL-Parameter pruefen fuer Vorauswahl
    const urlParams = getUrlParams();
    let selectedProductId = null;

    if (urlParams.productId) {
        // Produkt aus URL-Parameter
        const product = state.products.find(p => p.id === urlParams.productId);
        if (product) {
            selectedProductId = product.id;
            console.log('Produkt aus URL vorausgewaehlt:', product.name);
        }
    }

    // Fallback: Erstes Produkt
    if (!selectedProductId && state.products.length) {
        selectedProductId = state.products[0].id;
    }

    if (selectedProductId) {
        selectProduct(selectedProductId, urlParams.variantId);
    }
}

function selectProduct(productId, preselectedVariantId = null) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    state.selectedProduct = product;

    // Variante vorauswaehlen (aus URL oder erste)
    if (preselectedVariantId) {
        const variant = product.variants.find(v => v.id === preselectedVariantId);
        state.selectedVariant = variant || product.variants[0] || null;
        if (variant) {
            console.log('Variante aus URL vorausgewaehlt:', variant.name);
        }
    } else {
        state.selectedVariant = product.variants[0] || null;
    }

    // UI aktualisieren
    document.querySelectorAll('.product-card').forEach(c =>
        c.classList.toggle('selected', parseInt(c.dataset.id) === productId)
    );

    renderSizes(preselectedVariantId);
    renderOptions();
    updatePrice();

    if (state.uploadedImage) {
        buildMesh();
    }
}

function renderSizes(preselectedVariantId = null) {
    const grid = document.getElementById('size-grid');
    const variants = state.selectedProduct?.variants || [];

    if (!variants.length) {
        grid.innerHTML = '<p class="muted">Keine Größen verfügbar</p>';
        return;
    }

    // Bestimme welche Variante selektiert sein soll
    const selectedVariantId = preselectedVariantId || state.selectedVariant?.id || variants[0]?.id;

    grid.innerHTML = variants.map(v => `
        <button class="size-btn ${v.id === selectedVariantId ? 'selected' : ''}" data-id="${v.id}">
            <span class="size-name">${v.size}</span>
            <span class="size-price">${formatPrice(v.price)}</span>
        </button>
    `).join('');

    grid.querySelectorAll('.size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const variantId = parseInt(btn.dataset.id);
            state.selectedVariant = variants.find(v => v.id === variantId);
            grid.querySelectorAll('.size-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            updatePrice();

            // 3D-Modell an neue Größe anpassen
            updateMeshScale();
        });
    });
}

function renderOptions() {
    const product = state.selectedProduct;
    if (!product) return;

    // Lichtfarbe
    const lightOptions = document.getElementById('light-options');
    if (product.multicolor) {
        lightOptions.innerHTML = `
            <label>Lichtfarbe</label>
            <div class="multicolor-info">
                <div class="color-dots">
                    <span style="background:#fff"></span>
                    <span style="background:#ffeb3b"></span>
                    <span style="background:#ff9800"></span>
                    <span style="background:#f44336"></span>
                    <span style="background:#9c27b0"></span>
                    <span style="background:#2196f3"></span>
                </div>
                <strong>${product.color_count} Farbmodi</strong>
                <small>Mit Fernbedienung waehlbar</small>
            </div>
        `;
        state.lightColor = 'multi';
    } else {
        lightOptions.innerHTML = `
            <label>Lichtfarbe</label>
            <div class="light-btns">
                <button type="button" class="light-btn selected" data-light="warm">
                    <span class="light-dot warm"></span>
                    Warmweiß
                </button>
                <button type="button" class="light-btn" data-light="cool">
                    <span class="light-dot cool"></span>
                    Kaltweiß
                </button>
            </div>
        `;
        bindLightButtons();
    }
}

function bindLightButtons() {
    document.querySelectorAll('.light-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.lightColor = btn.dataset.light;
            document.querySelectorAll('.light-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            updateLightColor();
        });
    });
}

function updatePrice() {
    const price = state.selectedVariant?.price || state.selectedProduct?.min_price || 0;
    document.getElementById('total-price').textContent = formatPrice(price);
    updateCartButton();
}

function updateCartButton() {
    const btn = document.getElementById('btn-add-cart');
    btn.disabled = !state.uploadedImage || !state.selectedVariant;
}

function formatPrice(price) {
    return price.toFixed(2).replace('.', ',') + ' EUR';
}

// =========================================================================
// File Upload
// =========================================================================
function setupUpload() {
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');
    const preview = document.getElementById('upload-preview');

    input.addEventListener('change', e => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    document.getElementById('btn-remove-image').addEventListener('click', () => {
        state.uploadedImage = null;
        zone.style.display = 'block';
        preview.style.display = 'none';
        document.getElementById('preview-placeholder').style.display = 'flex';
        document.getElementById('preview-controls').style.display = 'none';
        if (mesh) {
            group.remove(mesh);
            mesh = null;
        }
        updateCartButton();
    });
}

function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        alert('Bitte waehle eine Bilddatei');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        alert('Die Datei ist zu gross (max. 10 MB)');
        return;
    }

    const reader = new FileReader();
    reader.onload = e => {
        state.uploadedImage = e.target.result;

        // Preview
        document.getElementById('upload-zone').style.display = 'none';
        document.getElementById('upload-preview').style.display = 'flex';
        document.getElementById('preview-thumb').src = state.uploadedImage;
        document.getElementById('file-name').textContent = file.name;

        // 3D bauen
        buildMesh();
        updateCartButton();
    };
    reader.readAsDataURL(file);
}

// =========================================================================
// Three.js
// =========================================================================
function initThree() {
    if (!canvas) return;

    const container = document.getElementById('preview-container');
    const rect = container.getBoundingClientRect();

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, rect.width / rect.height, 0.1, 100);
    camera.position.z = 6;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(rect.width, rect.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a14, 1);

    // Lichter
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    group = new THREE.Group();
    scene.add(group);

    // Hintergrund: Boden-Grid und Oberfläche für Größenreferenz
    addBackgroundElements();

    // Interaktion
    canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
    canvas.addEventListener('mouseup', () => isDragging = false);
    canvas.addEventListener('mouseleave', () => isDragging = false);
    canvas.addEventListener('mousemove', e => {
        if (!isDragging) return;
        targetRotY += (e.clientX - lastX) * 0.008;
        targetRotX += (e.clientY - lastY) * 0.008;
        targetRotX = Math.max(-0.8, Math.min(0.8, targetRotX));
        lastX = e.clientX;
        lastY = e.clientY;
    });

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        camera.position.z += e.deltaY * 0.01;
        camera.position.z = Math.max(3, Math.min(15, camera.position.z)); // Max zoom-out auf 15
    }, { passive: false });

    // Controls
    document.querySelectorAll('.ctrl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            switch(action) {
                case 'rotate-left': targetRotY -= 0.5; break;
                case 'rotate-right': targetRotY += 0.5; break;
                case 'zoom-in': camera.position.z = Math.max(3, camera.position.z - 0.5); break;
                case 'zoom-out': camera.position.z = Math.min(15, camera.position.z + 0.5); break; // Max zoom-out auf 15
                case 'reset': targetRotX = 0.1; targetRotY = 0; camera.position.z = 6; break;
                case 'toggle-light': toggleLight(); break;
            }
        });
    });

    // Resize
    window.addEventListener('resize', () => {
        const r = container.getBoundingClientRect();
        camera.aspect = r.width / r.height;
        camera.updateProjectionMatrix();
        renderer.setSize(r.width, r.height);
    });

    animate();
}

// Hintergrund-Elemente für atmosphärische Nachtszene
let backgroundGroup = null;
let particles = null;

function addBackgroundElements() {
    backgroundGroup = new THREE.Group();

    // Dunkler Boden - weiter unten für zentriertes Objekt
    const surfaceGeo = new THREE.PlaneGeometry(20, 20);
    const surfaceMat = new THREE.MeshStandardMaterial({
        color: 0x0d0d12,
        roughness: 0.95,
        metalness: 0.0,
    });
    const surface = new THREE.Mesh(surfaceGeo, surfaceMat);
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = -3;
    surface.receiveShadow = true;
    backgroundGroup.add(surface);

    // Sanfter Lichtkreis unter dem Objekt (Glow-Effekt auf der Oberfläche)
    const glowGeo = new THREE.CircleGeometry(2.5, 64);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0xffeedd,
        transparent: true,
        opacity: 0.06,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -2.98;
    backgroundGroup.add(glow);

    // Zweiter, größerer Glow-Ring
    const glowGeo2 = new THREE.RingGeometry(2.5, 5, 64);
    const glowMat2 = new THREE.MeshBasicMaterial({
        color: 0xffeedd,
        transparent: true,
        opacity: 0.02,
    });
    const glow2 = new THREE.Mesh(glowGeo2, glowMat2);
    glow2.rotation.x = -Math.PI / 2;
    glow2.position.y = -2.97;
    backgroundGroup.add(glow2);

    scene.add(backgroundGroup);

    // Atmosphärische Partikel (wie Staubkörnchen im Mondlicht)
    createAtmosphericParticles();
}

function createAtmosphericParticles() {
    const particleCount = 60;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
        // Partikel um das zentrierte Objekt herum verteilen
        positions[i * 3] = (Math.random() - 0.5) * 8;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 6; // Vertikal um 0 herum
        positions[i * 3 + 2] = (Math.random() - 0.5) * 8;
        sizes[i] = Math.random() * 0.025 + 0.008;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.02,
        transparent: true,
        opacity: 0.3,
        sizeAttenuation: true,
    });

    particles = new THREE.Points(geometry, material);
    scene.add(particles);
}

// =========================================================================
// Light Show Animation
// =========================================================================
let lightShowAnimation = null;

function startLightShowAnimation() {
    // Falls bereits eine Animation läuft, abbrechen
    if (lightShowAnimation) {
        cancelAnimationFrame(lightShowAnimation.frameId);
    }

    // Licht ausschalten für den Start
    state.lightOn = false;
    if (mesh && mesh.material.uniforms) {
        mesh.material.uniforms.uLightOn.value = 0.0;
    }
    document.querySelector('.ctrl-light')?.classList.add('off');

    // Kurze Verzögerung, dann Animation starten
    setTimeout(() => {
        const startTime = performance.now();
        const duration = 1500; // 1.5 Sekunden für sanftes Einblenden

        function animateLightOn(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing: ease-out cubic für natürlicheren Effekt
            const eased = 1 - Math.pow(1 - progress, 3);

            if (mesh && mesh.material.uniforms) {
                mesh.material.uniforms.uLightOn.value = eased;
            }

            if (progress < 1) {
                lightShowAnimation = {
                    frameId: requestAnimationFrame(animateLightOn)
                };
            } else {
                // Animation abgeschlossen
                state.lightOn = true;
                document.querySelector('.ctrl-light')?.classList.remove('off');
                lightShowAnimation = null;
            }
        }

        lightShowAnimation = {
            frameId: requestAnimationFrame(animateLightOn)
        };
    }, 400); // 400ms Verzögerung damit der User das Objekt erst sieht
}

// Größe aus Variantenname parsen (z.B. "10cm", "15 cm", "20")
function parseSizeFromVariant(variant) {
    if (!variant || !variant.size) return 15; // Standard: 15cm

    const sizeStr = variant.size;
    // Versuche Zahl zu extrahieren
    const match = sizeStr.match(/(\d+)/);
    if (match) {
        return parseInt(match[1]);
    }
    return 15;
}

// Skalierungsfaktor basierend auf Größe berechnen
function getScaleForSize(sizeCm) {
    // Basis: 15cm = Skalierung 1.0
    // Je 5cm Unterschied = 0.33 Skalierung
    const baseSize = 15;
    const scale = sizeCm / baseSize;
    return Math.max(0.5, Math.min(2.0, scale)); // Begrenzen zwischen 0.5 und 2.0
}

// Mesh-Skalierung aktualisieren
function updateMeshScale() {
    if (!mesh) return;

    const sizeCm = parseSizeFromVariant(state.selectedVariant);
    const scale = getScaleForSize(sizeCm);

    mesh.scale.set(scale, scale, scale);

    // Objekt zentriert positionieren (schwebt in der Mitte)
    mesh.position.y = 0;

    console.log(`Größe: ${sizeCm}cm, Scale: ${scale.toFixed(2)}`);
}

function animate() {
    requestAnimationFrame(animate);

    // Smooth rotation
    rotX += (targetRotX - rotX) * 0.1;
    rotY += (targetRotY - rotY) * 0.1;
    group.rotation.x = rotX;
    group.rotation.y = rotY;

    // Atmosphärische Partikel sanft bewegen
    if (particles) {
        const positions = particles.geometry.attributes.position.array;
        const time = performance.now() * 0.0001;

        for (let i = 0; i < positions.length; i += 3) {
            // Sehr langsame, sanfte Bewegung
            positions[i + 1] += Math.sin(time + i) * 0.0002;

            // Partikel die zu hoch oder niedrig sind, zurücksetzen (um 0 herum)
            if (positions[i + 1] > 3) positions[i + 1] = -3;
            if (positions[i + 1] < -3) positions[i + 1] = 3;
        }

        particles.geometry.attributes.position.needsUpdate = true;
    }

    renderer.render(scene, camera);
}

function buildMesh() {
    if (!state.uploadedImage || !state.selectedProduct) return;

    // Altes Mesh entfernen
    if (mesh) {
        group.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
    }

    // Placeholder ausblenden
    document.getElementById('preview-placeholder').style.display = 'none';
    document.getElementById('preview-controls').style.display = 'flex';

    // Textur laden
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(state.uploadedImage, texture => {
        const type = state.selectedProduct.renderer_type;
        let geometry;
        let material;

        if (type === 'sphere') {
            // MoonLamp: Bild nur auf einer Seite, Rest ist Mondoberfläche
            const result = buildSphereGeometry(texture);
            geometry = result.geometry;

            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTexture: { value: texture },
                    uLightOn: { value: state.lightOn ? 1.0 : 0.0 },
                    uLightColor: { value: LIGHT_COLORS[state.lightColor] || LIGHT_COLORS.warm },
                    uImageRadius: { value: result.imageRadius },
                },
                vertexShader: MOON_VERTEX_SHADER,
                fragmentShader: MOON_FRAGMENT_SHADER,
                side: THREE.DoubleSide,
            });
        } else {
            switch(type) {
                case 'curved':
                    geometry = buildCurvedGeometry(texture);
                    break;
                case 'cylinder':
                    geometry = buildCylinderGeometry(texture);
                    break;
                default:
                    geometry = buildFlatGeometry(texture);
            }

            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTexture: { value: texture },
                    uLightOn: { value: state.lightOn ? 1.0 : 0.0 },
                    uLightColor: { value: LIGHT_COLORS[state.lightColor] || LIGHT_COLORS.warm },
                },
                vertexShader: VERTEX_SHADER,
                fragmentShader: FRAGMENT_SHADER,
                side: THREE.DoubleSide,
            });
        }

        mesh = new THREE.Mesh(geometry, material);
        group.add(mesh);

        // Skalierung basierend auf gewählter Größe anwenden
        updateMeshScale();

        // Light Show Animation starten - zeigt den emotionalen "Wow"-Effekt
        startLightShowAnimation();
    });
}

function buildFlatGeometry(texture) {
    const geo = new THREE.PlaneGeometry(2, 2.5, 100, 125);
    displaceGeometry(geo, texture);
    return geo;
}

function buildCurvedGeometry(texture) {
    const geo = new THREE.PlaneGeometry(2.5, 3, 120, 150);
    displaceGeometry(geo, texture);

    // Biegen
    const pos = geo.attributes.position;
    const curvature = 0.4;
    const radius = 2.5 / (Math.PI * curvature);

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const angle = (x / 2.5) * Math.PI * curvature;
        const r = radius + z;
        pos.setX(i, r * Math.sin(angle));
        pos.setZ(i, r * Math.cos(angle) - radius);
    }

    geo.computeVertexNormals();
    return geo;
}

function buildSphereGeometry(texture) {
    const radius = 1.5;
    const imageRadius = 0.75; // Radius des Bildbereichs auf Einheitskugel
    const geo = new THREE.SphereGeometry(radius, 128, 128);

    const canvas = textureToCanvas(texture);
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pos = geo.attributes.position;
    const uvAttr = geo.attributes.uv;

    // Simplex noise Funktion für Mondkrater
    const hash = (x, y) => {
        const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return n - Math.floor(n);
    };

    const noise2D = (x, y) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;
        const ux = fx * fx * (3 - 2 * fx);
        const uy = fy * fy * (3 - 2 * fy);
        return (
            hash(ix, iy) * (1 - ux) * (1 - uy) +
            hash(ix + 1, iy) * ux * (1 - uy) +
            hash(ix, iy + 1) * (1 - ux) * uy +
            hash(ix + 1, iy + 1) * ux * uy
        ) * 2 - 1;
    };

    const moonNoise = (x, y, z) => {
        let n = 0;
        n += noise2D(x * 4, y * 4 + z * 3) * 0.5;
        n += noise2D(x * 8, y * 8 + z * 6) * 0.25;
        n += noise2D(x * 16, y * 16 + z * 12) * 0.125;
        n += noise2D(x * 32, y * 32 + z * 24) * 0.0625;
        return n;
    };

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const len = Math.sqrt(x*x + y*y + z*z);

        // Normalisierte Position
        const nx = x / len, ny = y / len, nz = z / len;

        // Abstand vom Zentrum der Vorderseite (Z+)
        const distFromFront = Math.sqrt(nx*nx + ny*ny);

        // Ist dieser Punkt im Bildbereich? (Vorderseite, innerhalb des Radius)
        const inImageArea = nz > 0 && distFromFront < imageRadius;

        let disp = 0;

        if (inImageArea) {
            // Bildbereich: UV-Koordinaten für das Bild berechnen
            // Projiziere auf eine Scheibe auf der Vorderseite
            // Bild richtig herum (nicht upside down)
            const imgU = 0.5 + (nx / imageRadius) * 0.5;
            const imgV = 0.5 + (ny / imageRadius) * 0.5;

            // Setze UV für Shader
            uvAttr.setXY(i, imgU, imgV);

            const px = Math.floor(Math.max(0, Math.min(canvas.width - 1, imgU * canvas.width)));
            const py = Math.floor(Math.max(0, Math.min(canvas.height - 1, imgV * canvas.height)));
            const idx = (py * canvas.width + px) * 4;

            const lum = (pixels[idx] * 0.299 + pixels[idx+1] * 0.587 + pixels[idx+2] * 0.114) / 255;
            // Stärkerer Lithophane-Effekt
            disp = (1 - lum) * 0.12;

            // Sanfter Übergang am Rand
            const edgeFade = 1 - smoothstep(imageRadius * 0.7, imageRadius, distFromFront);
            disp *= edgeFade;
        } else {
            // Mondbereich: Krater-Displacement - realistischer
            const baseNoise = moonNoise(nx * 4, ny * 4, nz * 4);

            // Größere Krater (Einbuchtungen)
            const crater1 = Math.abs(noise2D(nx * 3 + nz * 2, ny * 3));
            const crater2 = Math.abs(noise2D(nx * 6 + nz * 4, ny * 6 + 10));
            const crater3 = Math.abs(noise2D(nx * 12 + nz * 8, ny * 12 + 20));

            // Krater-Vertiefungen
            const craterDepth1 = crater1 < 0.15 ? (0.15 - crater1) * 0.3 : 0;
            const craterDepth2 = crater2 < 0.12 ? (0.12 - crater2) * 0.2 : 0;
            const craterDepth3 = crater3 < 0.1 ? (0.1 - crater3) * 0.1 : 0;

            disp = baseNoise * 0.025 - craterDepth1 - craterDepth2 - craterDepth3;

            // UV für Mondtextur
            const moonU = 0.5 + Math.atan2(nz, nx) / (2 * Math.PI);
            const moonV = 0.5 - Math.asin(ny) / Math.PI;
            uvAttr.setXY(i, moonU, moonV);
        }

        // Displacement anwenden
        pos.setX(i, x + (x/len) * disp);
        pos.setY(i, y + (y/len) * disp);
        pos.setZ(i, z + (z/len) * disp);
    }

    geo.computeVertexNormals();
    return { geometry: geo, imageRadius: imageRadius };
}

// Hilfsfunktion für sanfte Übergänge
function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function buildCylinderGeometry(texture) {
    // Zylinder mit offenem Deckel/Boden (nur Mantelflaeche)
    // Windlicht: Ø60mm x 10cm - kleiner und kompakter als andere Produkte
    const radius = 0.4;
    const height = 1.0;
    const radialSegments = 64;
    const heightSegments = 80;

    const geo = new THREE.CylinderGeometry(radius, radius, height, radialSegments, heightSegments, true);

    // Displacement via pixel sampling
    const canvas = textureToCanvas(texture);
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);

        // UV-Koordinaten fuer Zylinder berechnen
        const u = 0.5 + Math.atan2(z, x) / (2 * Math.PI);
        const v = (y + height / 2) / height;

        const px = Math.floor(u * (canvas.width - 1));
        const py = Math.floor((1 - v) * (canvas.height - 1));
        const idx = (py * canvas.width + px) * 4;

        const lum = (pixels[idx] * 0.299 + pixels[idx+1] * 0.587 + pixels[idx+2] * 0.114) / 255;
        const disp = (1 - lum) * 0.08;

        // Displacement radial nach aussen
        const len = Math.sqrt(x*x + z*z);
        if (len > 0) {
            pos.setX(i, x + (x/len) * disp);
            pos.setZ(i, z + (z/len) * disp);
        }
    }

    geo.computeVertexNormals();
    return geo;
}

function displaceGeometry(geo, texture) {
    const canvas = textureToCanvas(texture);
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pos = geo.attributes.position;
    const w = geo.parameters.width;
    const h = geo.parameters.height;

    for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) / w + 0.5;
        const v = 1 - (pos.getY(i) / h + 0.5);

        const px = Math.floor(u * (canvas.width - 1));
        const py = Math.floor(v * (canvas.height - 1));
        const idx = (py * canvas.width + px) * 4;

        const lum = (pixels[idx] * 0.299 + pixels[idx+1] * 0.587 + pixels[idx+2] * 0.114) / 255;
        pos.setZ(i, (1 - lum) * 0.12);
    }

    geo.computeVertexNormals();
}

function textureToCanvas(texture) {
    const img = texture.image;
    const canvas = document.createElement('canvas');
    const size = 256;
    canvas.width = size;
    canvas.height = Math.round(size / (img.width / img.height));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
}

function toggleLight() {
    state.lightOn = !state.lightOn;
    if (mesh && mesh.material.uniforms) {
        mesh.material.uniforms.uLightOn.value = state.lightOn ? 1.0 : 0.0;
    }
    document.querySelector('.ctrl-light').classList.toggle('off', !state.lightOn);
}

function updateLightColor() {
    if (mesh && mesh.material.uniforms) {
        mesh.material.uniforms.uLightColor.value = LIGHT_COLORS[state.lightColor] || LIGHT_COLORS.warm;
    }
}

// =========================================================================
// Cart
// =========================================================================
function setupCart() {
    document.getElementById('btn-add-cart').addEventListener('click', addToCart);
}

function addToCart() {
    if (!state.selectedVariant || !state.uploadedImage || !state.selectedProduct) return;

    const btn = document.getElementById('btn-add-cart');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> <span>Wird weitergeleitet...</span>';

    // Zur Produktseite im Odoo Shop weiterleiten
    odooApi.addToCart(state.selectedVariant.id, state.selectedProduct.id, {
        engraving: state.engraving,
        light_color: state.lightColor === 'multi' ? 'Multicolor' :
                     state.lightColor === 'warm' ? 'Warmweiß' : 'Kaltweiß',
    });
}

// =========================================================================
// Init
// =========================================================================
function init() {
    if (!document.getElementById('litho-configurator')) return;

    initThree();
    setupUpload();
    setupCart();
    bindLightButtons();
    loadProducts();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
