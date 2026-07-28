import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f1115',
        panel: '#171a21',
        edge: '#262b36',
        muted: '#8b93a7',
        accent: '#7c9cff',
      },
    },
  },
  plugins: [],
};

export default config;
