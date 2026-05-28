/**
 * Lazy loader for the Google Maps JS API with the Places library.
 *
 * The API key is HTTP-referer restricted to the production domain in the
 * Google Cloud console, so it is safe to embed in the client bundle; that's
 * the standard pattern for Maps. A VITE_GOOGLE_MAPS_API_KEY env var can
 * override it for dev or rotation. When no key is configured (or the script
 * fails to load, e.g. wrong referer) loadPlaces resolves to null and the SPA
 * falls back to manual address entry.
 */

const DEFAULT_KEY = "AIzaSyBM4-7QniJYHXXNakOXRuHHl1LpWPoYsVw";
const SCRIPT_ATTR = "data-airdesk-google-maps";

/** Minimum surface of the Places library we consume - hand-typed to avoid
 * pulling @types/google.maps (10+ MB). */
export interface PlacesAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}
export interface PlacesPlace {
  address_components?: PlacesAddressComponent[];
  formatted_address?: string;
}
export interface PlacesAutocomplete {
  addListener(eventName: "place_changed", handler: () => void): { remove(): void };
  getPlace(): PlacesPlace;
}
interface PlacesNamespace {
  Autocomplete: new (
    input: HTMLInputElement,
    opts?: { types?: string[]; fields?: string[]; componentRestrictions?: { country?: string | string[] } },
  ) => PlacesAutocomplete;
}

declare global {
  interface Window {
    google?: { maps?: { places?: PlacesNamespace } };
  }
}

let inflight: Promise<PlacesNamespace | null> | null = null;

export function loadPlaces(): Promise<PlacesNamespace | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.google?.maps?.places) return Promise.resolve(window.google.maps.places);
  if (inflight) return inflight;

  const key = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? DEFAULT_KEY;
  if (!key) return Promise.resolve(null);

  inflight = new Promise<PlacesNamespace | null>((resolve) => {
    const existing = document.querySelector(`script[${SCRIPT_ATTR}]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google?.maps?.places ?? null));
      existing.addEventListener("error", () => resolve(null));
      return;
    }
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly&loading=async`;
    s.async = true;
    s.defer = true;
    s.setAttribute(SCRIPT_ATTR, "true");
    s.onload = () => resolve(window.google?.maps?.places ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return inflight;
}

export interface ParsedAddress {
  street: string; // route + number, in the order the locale typically prints them
  zip: string; // postal_code (city is reported separately as `place`)
  place: string; // locality / postal_town
  country: string;
  countryCode: string;
}

/**
 * Pull out the bits we care about from a Google Place result.
 * Falls back gracefully if a component type is missing in the response.
 */
export function parseAddress(place: PlacesPlace): ParsedAddress {
  const get = (type: string) =>
    place.address_components?.find((c) => c.types.includes(type));
  const streetNumber = get("street_number")?.long_name ?? "";
  const route = get("route")?.long_name ?? "";
  const postalCode = get("postal_code")?.long_name ?? "";
  const locality =
    get("locality")?.long_name ?? get("postal_town")?.long_name ?? get("sublocality")?.long_name ?? "";
  const country = get("country");

  // Most European locales: "Street name 12". US/UK/IE etc. put the number
  // first; we pick the order from the country code so it reads naturally.
  const numberFirstLocales = new Set(["US", "GB", "IE", "CA", "AU", "NZ", "IN"]);
  const cc = country?.short_name?.toUpperCase() ?? "";
  const street = numberFirstLocales.has(cc)
    ? [streetNumber, route].filter(Boolean).join(" ")
    : [route, streetNumber].filter(Boolean).join(" ");

  return {
    street,
    zip: postalCode,
    place: locality,
    country: country?.long_name ?? "",
    countryCode: cc,
  };
}
