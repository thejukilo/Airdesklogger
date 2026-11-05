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
    google?: {
      maps?: {
        places?: PlacesNamespace;
        // Present with the modern (loading=async) bootstrap; loads a library on demand.
        importLibrary?: (name: string) => Promise<unknown>;
      };
    };
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
    // With loading=async the bootstrap defers library loading, so
    // window.google.maps.places is NOT ready when the script's onload fires.
    // We must call importLibrary('places') (idempotent) to actually load it.
    function ready() {
      const maps = window.google?.maps;
      if (!maps) return resolve(null);
      if (maps.places) return resolve(maps.places);
      if (maps.importLibrary) {
        maps
          .importLibrary("places")
          .then(() => resolve(window.google?.maps?.places ?? null))
          .catch(() => resolve(null));
        return;
      }
      resolve(null);
    }
    const existing = document.querySelector(`script[${SCRIPT_ATTR}]`);
    if (existing) {
      if (window.google?.maps) ready();
      else {
        existing.addEventListener("load", ready);
        existing.addEventListener("error", () => resolve(null));
      }
      return;
    }
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly&loading=async`;
    s.async = true;
    s.defer = true;
    s.setAttribute(SCRIPT_ATTR, "true");
    s.onload = ready;
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
    country: canonicalCountryName(cc, country?.long_name ?? ""),
    countryCode: cc,
  };
}

/* ───────────────────────── New Places API (2025+) ─────────────────────────
 * google.maps.places.Autocomplete (the old widget) was deprecated and cut off
 * for newer projects in March 2025, so we use the current AutocompleteSuggestion
 * data API and render our own dropdown. These are loosely typed (no @types). */

export interface NewAddressComponent {
  types: string[];
  longText?: string | null;
  shortText?: string | null;
}
export interface NewPlace {
  fetchFields(options: { fields: string[] }): Promise<unknown>;
  addressComponents?: NewAddressComponent[];
  formattedAddress?: string | null;
}
export interface NewPlacePrediction {
  placeId: string;
  text?: { text?: string } | null;
  toPlace(): NewPlace;
}
export interface PlacesLib {
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: {
      input: string;
      sessionToken?: unknown;
      includedRegionCodes?: string[];
    }): Promise<{ suggestions?: Array<{ placePrediction?: NewPlacePrediction | null }> }>;
  };
  AutocompleteSessionToken: new () => unknown;
}

/** Load the modern Places library classes, or null if unavailable.
 *
 * The caller loads this once on mount, so it must not give up before the Maps
 * script has finished initializing. At mount time google.maps / importLibrary
 * are usually not ready yet (the script is injected with loading=async and the
 * library initializes a tick or two later), so a single check returns null and,
 * being one-shot, would disable the field forever. Instead we trigger the
 * script injection, then poll for google.maps.importLibrary and resolve the
 * classes through it (importLibrary is idempotent and only settles once the
 * library is fully ready, so its result always carries the modern classes).
 * Falls back to the google.maps.places namespace if importLibrary is absent. */
export async function loadPlacesLib(): Promise<PlacesLib | null> {
  if (typeof window === "undefined") return null;
  // Kick off the script injection (idempotent). We poll window.google below
  // rather than depend on this promise's resolution timing.
  void loadPlaces();

  const deadline = Date.now() + 12000;
  for (;;) {
    const maps = window.google?.maps;
    if (maps?.importLibrary) {
      try {
        const lib = (await maps.importLibrary("places")) as unknown as Partial<PlacesLib>;
        if (lib.AutocompleteSuggestion && lib.AutocompleteSessionToken) return lib as PlacesLib;
      } catch {
        /* library not ready yet — keep polling */
      }
    }
    const ns = maps?.places as unknown as Partial<PlacesLib> | undefined;
    if (ns?.AutocompleteSuggestion && ns.AutocompleteSessionToken) return ns as PlacesLib;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Canonical, language-independent country name from an ISO-3166 alpha-2 code
 * (e.g. "CH" -> "Switzerland"). Google returns country names localized to the
 * browser language ("Zwitserland", "Suisse", "Schweiz"), which makes the stored
 * value vary per user; deriving it from the code instead keeps it consistent.
 * Falls back to the supplied (localized) name if the code is missing/unknown. */
export function canonicalCountryName(countryCode: string, fallback: string): string {
  const cc = countryCode?.trim().toUpperCase();
  if (!cc) return fallback;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(cc);
    return name && name !== cc ? name : fallback;
  } catch {
    return fallback;
  }
}

/** Map a fetched new-API Place to our ParsedAddress (components use longText/shortText). */
export function parseNewPlace(place: NewPlace): ParsedAddress {
  const comps = place.addressComponents ?? [];
  const get = (type: string) => comps.find((c) => c.types.includes(type));
  const streetNumber = get("street_number")?.longText ?? "";
  const route = get("route")?.longText ?? "";
  const postalCode = get("postal_code")?.longText ?? "";
  const locality =
    get("locality")?.longText ?? get("postal_town")?.longText ?? get("sublocality")?.longText ?? "";
  const country = get("country");
  const cc = country?.shortText?.toUpperCase() ?? "";
  const numberFirstLocales = new Set(["US", "GB", "IE", "CA", "AU", "NZ", "IN"]);
  const street = numberFirstLocales.has(cc)
    ? [streetNumber, route].filter(Boolean).join(" ")
    : [route, streetNumber].filter(Boolean).join(" ");
  return {
    street,
    zip: postalCode,
    place: locality,
    country: canonicalCountryName(cc, country?.longText ?? ""),
    countryCode: cc,
  };
}
