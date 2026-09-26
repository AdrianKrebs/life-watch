import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The maker site: build your own life watch, share it as a link.
export default defineConfig({
	plugins: [react()],
	build: { outDir: 'site-dist', chunkSizeWarningLimit: 2000 },
});
