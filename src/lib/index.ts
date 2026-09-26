// life-watch: a procedural mechanical pocket watch that counts your life.

export { default as LifeWatch, type LifeWatchProps } from './LifeWatch';
export { default as LifeWatchEmbed, type LifeWatchEmbedProps } from './LifeWatchEmbed';
export {
	configFromParams,
	configToParams,
	defaultSignature,
	ENAMELS,
	parseBirth,
	resolveConfig,
	type LifeWatchConfig,
	type Metal,
	type ResolvedConfig,
} from './config';
export { watchState, type WatchState } from './time';
