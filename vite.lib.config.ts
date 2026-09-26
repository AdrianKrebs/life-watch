import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The React library: dependencies stay external so apps share one three.js.
const external = [/^react(\/.*)?$/, /^react-dom(\/.*)?$/, /^three(\/.*)?$/, /^@react-three\//, /^postprocessing$/, /^zustand(\/.*)?$/];

export default defineConfig({
	plugins: [react()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		sourcemap: true,
		lib: {
			entry: 'src/lib/index.ts',
			formats: ['es'],
			fileName: 'index',
			cssFileName: 'style',
		},
		rollupOptions: { external },
	},
});
