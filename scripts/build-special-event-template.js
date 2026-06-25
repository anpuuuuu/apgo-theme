const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//, '').trim();
const collection = JSON.parse(
  stripComments(fs.readFileSync(path.join(root, 'templates/collection.json'), 'utf8'))
);
const productCard = collection.sections.main.blocks['product-card'];

const template = {
  sections: {
    main: {
      type: 'main-page',
      disabled: true,
      blocks: {
        heading: {
          type: 'text',
          name: 'Title',
          disabled: true,
          settings: {
            text: '<h1>{{ closest.page.title }}</h1>',
            width: '100%',
            max_width: 'normal',
            alignment: 'left',
            type_preset: 'h2',
            font: 'var(--font-body--family)',
            font_size: '1rem',
            line_height: 'normal',
            letter_spacing: 'normal',
            case: 'none',
            wrap: 'pretty',
            color: 'var(--color-foreground)',
            background: false,
            background_color: '#00000026',
            corner_radius: 0,
            'padding-block-start': 0,
            'padding-block-end': 0,
            'padding-inline-start': 0,
            'padding-inline-end': 0,
          },
          blocks: {},
        },
        'page-content': {
          type: 'page-content',
          disabled: true,
          settings: {},
          blocks: {},
        },
      },
      block_order: ['heading', 'page-content'],
      settings: {
        content_direction: 'column',
        gap: 32,
        color_scheme: 'scheme-a27d2d12-7174-40fe-a01c-a128174b4c26',
        'padding-block-start': 0,
        'padding-block-end': 0,
      },
    },
    banner_hero: {
      type: 'apgo-event-banner',
      name: 'Hero Banner',
      settings: {
        image: '',
        image_alt: '',
        link: '',
        desktop_width_percent: 67,
        color_scheme: 'scheme-a27d2d12-7174-40fe-a01c-a128174b4c26',
      },
    },
    grid_primary: {
      type: 'apgo-event-collection-grid',
      name: 'Primary Collection',
      blocks: {
        'product-card': productCard,
      },
      block_order: ['product-card'],
      settings: {
        collection: '',
        heading: '',
        product_limit: 24,
        overlap_enabled: true,
        overlap_offset: 56,
        layout_type: 'grid',
        product_card_size: 'large',
        mobile_product_card_size: 'small',
        product_grid_width: 'centered',
        full_width_on_mobile: true,
        columns_gap_horizontal: 20,
        columns_gap_vertical: 20,
        color_scheme: 'scheme-5',
        'padding-block-start': 0,
        'padding-block-end': 32,
      },
    },
    banner_mid: {
      type: 'apgo-event-banner',
      name: 'Mid Banner',
      settings: {
        image: '',
        image_alt: '',
        link: '',
        desktop_width_percent: 67,
        color_scheme: 'scheme-a27d2d12-7174-40fe-a01c-a128174b4c26',
      },
    },
    grid_promo: {
      type: 'apgo-event-promo-collection',
      name: 'Promo Collection',
      settings: {
        collection: '',
        heading: '限時特惠',
        subheading: '',
        product_limit: 12,
        layout_variant: 'promo',
      },
    },
  },
  order: ['banner_hero', 'grid_primary', 'banner_mid', 'grid_promo'],
};

const header = `/*
 * ------------------------------------------------------------
 * IMPORTANT: The contents of this file are auto-generated.
 *
 * This file may be updated by the Shopify admin theme editor
 * or related systems. Please exercise caution as any changes
 * made to this file may be overwritten.
 * ------------------------------------------------------------
 */
`;

fs.writeFileSync(
  path.join(root, 'templates/page.special-event.json'),
  header + JSON.stringify(template, null, 2) + '\n'
);
console.log('templates/page.special-event.json written');
