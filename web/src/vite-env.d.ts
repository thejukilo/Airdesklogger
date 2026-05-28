/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Google Maps JS API key used for address autocomplete on sign-up and the
   * profile page. The default in placesAutocomplete.ts is referer-restricted
   * to the production domain; set this to override (rotation or local dev).
   */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
