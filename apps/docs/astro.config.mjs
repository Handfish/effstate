import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://handfish.github.io',
  base: '/effstate',
  integrations: [
    starlight({
      title: 'effstate',
      description: 'Effect-first state machine library for TypeScript',
      favicon: '/logo.png',
      logo: {
        src: './public/logo.png',
        alt: 'effstate logo',
      },
      social: {
        github: 'https://github.com/handfish/effstate',
      },
      sidebar: [
        {
          label: 'Getting Started',
          autogenerate: { directory: 'getting-started' },
        },
        {
          label: 'Guides',
          autogenerate: { directory: 'guides' },
        },
        {
          label: 'API Reference',
          autogenerate: { directory: 'api' },
        },
        {
          label: 'Demo',
          link: '/demo',
        },
      ],
      customCss: ['./src/styles/demo.css'],
    }),
    react(),
    tailwind({ applyBaseStyles: false }),
  ],
});
