/**
 * Produkt-Konfiguration für den Konfigurator
 *
 * Die Produkt-IDs und Preise kommen aus deinem Odoo.
 * Hier definierst du nur die Konfigurator-spezifischen Einstellungen.
 */

export const PRODUCTS_CONFIG = [
  {
    odoo_product_id: 7146,  // MoonLamp - 3D Foto Mondlampe
    name: 'MoonLamp',
    renderer_type: 'sphere',
    sequence: 1,
    is_bestseller: true,
    has_engraving: true,
    engraving_max: 30,
    multicolor: true,
    color_count: 16,
  },
  {
    odoo_product_id: 7145,  // Curved Lithophane
    name: 'Lithophane Gebogen',
    renderer_type: 'curved',
    sequence: 2,
    is_bestseller: false,
    has_engraving: true,
    engraving_max: 50,
    multicolor: false,
    color_count: 2,
  },
  {
    odoo_product_id: 7147,  // Windlicht Lithophane Ø60mm x 10cm
    name: 'Windlicht',
    renderer_type: 'cylinder',
    sequence: 3,
    is_bestseller: false,
    has_engraving: false,
    engraving_max: 0,
    multicolor: false,
    color_count: 2,  // Warm/Kalt zur Veranschaulichung
  },
];
