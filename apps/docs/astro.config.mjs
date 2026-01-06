import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://your-username.github.io',
  base: '/effstate',
  integrations: [
    starlight({
      title: 'effstate',
      description: 'Effect-first state machine library for TypeScript',
      social: {
        github: 'https://github.com/your-username/effstate',
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
      ],
    }),
  ],
});
