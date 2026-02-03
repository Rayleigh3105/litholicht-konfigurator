/**
 * Odoo API Client für den LithoLicht Konfigurator
 *
 * Kommuniziert mit Odoo über externe JSON-RPC API für:
 * - Produkte & Varianten laden (Preise aus Odoo)
 * - Warenkorb-Integration
 *
 * Die Konfigurator-spezifischen Einstellungen (3D-Form, etc.)
 * kommen aus der lokalen products-config.js
 */

import { PRODUCTS_CONFIG } from './products-config.js';

// Konfiguration
const ODOO_URL = import.meta.env.VITE_ODOO_URL || 'https://litholicht.de';
const API_BASE = import.meta.env.DEV ? '/odoo-api' : ODOO_URL;
const API_KEY = import.meta.env.VITE_ODOO_API_KEY || '';
const ODOO_DB = import.meta.env.VITE_ODOO_DB || '';
const ODOO_LOGIN = import.meta.env.VITE_ODOO_LOGIN || '';
const USE_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// Demo-Daten für Entwicklung ohne Odoo-Verbindung
const DEMO_PRODUCTS = PRODUCTS_CONFIG.map((config, index) => ({
  id: config.odoo_product_id,
  name: config.name,
  renderer_type: config.renderer_type,
  is_bestseller: config.is_bestseller,
  has_engraving: config.has_engraving,
  engraving_max: config.engraving_max,
  multicolor: config.multicolor,
  color_count: config.color_count,
  min_price: [49.90, 39.90, 21.90][index] || 39.90,  // MoonLamp, Gebogen, Windlicht
  image_url: null,
}));

const DEMO_VARIANTS = {
  7146: [ // MoonLamp
    { id: 71461, name: 'MoonLamp (10cm)', size: '10cm', price: 49.90 },
    { id: 71462, name: 'MoonLamp (15cm)', size: '15cm', price: 69.90 },
    { id: 71463, name: 'MoonLamp (20cm)', size: '20cm', price: 89.90 },
  ],
  7145: [ // Gebogen
    { id: 71451, name: 'Lithophane Gebogen (15x20cm)', size: '15x20cm', price: 39.90 },
    { id: 71452, name: 'Lithophane Gebogen (20x25cm)', size: '20x25cm', price: 54.90 },
  ],
  7147: [ // Windlicht - einzelnes Produkt ohne Varianten
    { id: 71471, name: 'Windlicht Lithophane Ø60mm x 10cm', size: '10cm', price: 21.90 },
  ],
};

class OdooAPI {
  constructor() {
    this.baseUrl = ODOO_URL;
    this.apiBase = API_BASE;
    this.apiKey = API_KEY;
    this.db = ODOO_DB;
    this.login = ODOO_LOGIN;
    this.uid = null;
    this.demoMode = USE_DEMO_MODE;
  }

  /**
   * Authentifizierung bei Odoo - holt die User ID
   */
  async authenticate() {
    if (this.uid) return this.uid;

    const response = await fetch(`${this.apiBase}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: {
          service: 'common',
          method: 'authenticate',
          args: [this.db, this.login, this.apiKey, {}],
        },
        id: Date.now(),
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.data?.message || data.error.message || 'Auth failed');
    }

    this.uid = data.result;
    if (!this.uid) {
      throw new Error('Authentifizierung fehlgeschlagen - prüfe DB, Login und API-Key');
    }

    console.log('Odoo authentifiziert, UID:', this.uid);
    return this.uid;
  }

  /**
   * Externe JSON-RPC API Call (execute_kw)
   */
  async executeKw(model, method, args = [], kwargs = {}) {
    await this.authenticate();

    const response = await fetch(`${this.apiBase}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: {
          service: 'object',
          method: 'execute_kw',
          args: [this.db, this.uid, this.apiKey, model, method, args, kwargs],
        },
        id: Date.now(),
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.data?.message || data.error.message || 'Odoo API Error');
    }

    return data.result;
  }

  /**
   * Alle konfigurierbaren Produkte laden
   */
  async getProducts() {
    if (this.demoMode) {
      console.log('Demo-Modus aktiv - verwende lokale Produktdaten');
      return DEMO_PRODUCTS;
    }

    const productIds = PRODUCTS_CONFIG.map(p => p.odoo_product_id);

    // search_read über externe API
    const odooProducts = await this.executeKw(
      'product.template',
      'search_read',
      [[['id', 'in', productIds], ['sale_ok', '=', true]]],
      { fields: ['id', 'name', 'list_price'] }
    );

    const products = PRODUCTS_CONFIG
      .map(config => {
        const odooProduct = odooProducts.find(p => p.id === config.odoo_product_id);
        if (!odooProduct) return null;

        return {
          id: odooProduct.id,
          name: config.name || odooProduct.name,
          renderer_type: config.renderer_type,
          is_bestseller: config.is_bestseller,
          has_engraving: config.has_engraving,
          engraving_max: config.engraving_max,
          multicolor: config.multicolor,
          color_count: config.color_count,
          min_price: odooProduct.list_price,
          image_url: `${this.baseUrl}/web/image/product.template/${odooProduct.id}/image_512`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const configA = PRODUCTS_CONFIG.find(c => c.odoo_product_id === a.id);
        const configB = PRODUCTS_CONFIG.find(c => c.odoo_product_id === b.id);
        return (configA?.sequence || 0) - (configB?.sequence || 0);
      });

    return products;
  }

  /**
   * Produktvarianten (Größen) laden
   */
  async getProductVariants(productId) {
    if (this.demoMode) {
      return DEMO_VARIANTS[productId] || [];
    }

    const result = await this.executeKw(
      'product.product',
      'search_read',
      [[['product_tmpl_id', '=', productId]]],
      { fields: ['id', 'display_name', 'lst_price'] }
    );

    return result.map(v => ({
      id: v.id,
      name: v.display_name,
      size: this.extractSize(v.display_name),
      price: v.lst_price,
    })).sort((a, b) => a.price - b.price);
  }

  /**
   * Größe aus Produktname extrahieren
   */
  extractSize(displayName) {
    const match = displayName.match(/\(([^)]+)\)/);
    return match ? match[1] : displayName;
  }

  /**
   * Einzelnes Produkt aus lokaler Config holen (ohne Odoo-Call)
   * Fuer schnelles Laden wenn product_id bekannt ist
   */
  getProductFromConfig(productId) {
    const config = PRODUCTS_CONFIG.find(c => c.odoo_product_id === productId);
    if (!config) return null;

    return {
      id: config.odoo_product_id,
      name: config.name,
      renderer_type: config.renderer_type,
      is_bestseller: config.is_bestseller,
      has_engraving: config.has_engraving,
      engraving_max: config.engraving_max,
      multicolor: config.multicolor,
      color_count: config.color_count,
      min_price: 0, // Wird durch Varianten aktualisiert
      image_url: null,
      variants: [], // Werden separat geladen
    };
  }

  /**
   * Produkt zum Warenkorb hinzufügen
   * Redirect zur Produktseite auf Odoo Shop
   */
  addToCart(variantId, productId, customValues = {}) {
    if (this.demoMode) {
      console.log('Demo-Modus: Warenkorb simuliert', { variantId, productId, customValues });
      alert('Demo-Modus: Weiterleitung zum Shop simuliert');
      return;
    }

    // Zur Produktseite weiterleiten
    // Der User kann dort normal "In den Warenkorb" klicken
    const productUrl = `${this.baseUrl}/shop/${productId}`;
    console.log('Redirect zu Produktseite:', productUrl);
    window.location.href = productUrl;
  }

  /**
   * Redirect zum Odoo Warenkorb
   */
  goToCart() {
    window.location.href = `${this.baseUrl}/shop/cart`;
  }
}

export const odooApi = new OdooAPI();
export default OdooAPI;
