// Bundled, procedurally generated loops (see scripts/gen-sounds.cjs). They play with no network.
export type SoundId = 'rain' | 'ocean' | 'forest' | 'brown' | 'drone';

export const SOUND_ASSETS: Record<SoundId, number> = {
  rain: require('../../assets/sounds/rain.wav'),
  ocean: require('../../assets/sounds/ocean.wav'),
  forest: require('../../assets/sounds/forest.wav'),
  brown: require('../../assets/sounds/brown.wav'),
  drone: require('../../assets/sounds/drone.wav'),
};

export const SOUND_IDS = Object.keys(SOUND_ASSETS) as SoundId[];
