import type { APIRoute } from 'astro';

const base = import.meta.env.BASE_URL;

// Built from the base so start_url, scope and icon paths stay correct wherever the site is hosted.
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: 'Zork AI',
        short_name: 'Zork AI',
        description: "Infocom's Zork I with AI-made pictures of each place, using your own OpenRouter key.",
        lang: 'en',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: '#fbfaf5',
        theme_color: '#fbfaf5',
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
