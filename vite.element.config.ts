import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// <life-watch> as a self-contained script for any page (three.js bundled in).
// The 3D engine is split into a chunk that loads when the watch mounts.
export default defineConfig({
	plugins: [react()],
	define: { 'process.env.NODE_ENV': JSON.stringify('production') },
	build: {
		outDir: 'dist',
		emptyOutDir: false,
		chunkSizeWarningLimit: 2000,
		lib: {
			entry: 'src/lib/element.tsx',
			formats: ['es'],
			fileName: 'life-watch',
			cssFileName: 'element',
		},
		rollupOptions: {
			output: { chunkFileNames: 'chunks/[name]-[hash].js' },
		},
	},
});
