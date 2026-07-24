/** Runtime access to environment configuration. */

export const GOOGLE_MAPS_API_KEY: string = (
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
).trim();

/** Whether a Google Maps key is configured. Drives the setup screen. */
export const hasGoogleMapsKey = (): boolean => GOOGLE_MAPS_API_KEY.length > 0;
