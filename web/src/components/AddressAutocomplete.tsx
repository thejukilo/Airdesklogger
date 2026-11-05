import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  loadPlaces,
  loadPlacesLib,
  parseAddress,
  parseNewPlace,
  type ParsedAddress,
  type PlacesAutocomplete,
  type PlacesLib,
  type NewPlacePrediction,
} from "../lib/placesAutocomplete";

/**
 * Single search box that fills the street, ZIP, place and country fields
 * below it from a Google Places result. Renders nothing visible if the Places
 * API cannot load (wrong referer, network blocked, ...) so the form stays
 * usable - the manual fields below it always work.
 */
export function AddressAutocomplete({
  onSelect,
  countryHint,
  label = "Find your address",
}: {
  onSelect: (address: ParsedAddress) => void;
  /** Two-letter country code to bias results (e.g. "ch"). Optional. */
  countryHint?: string;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let cancelled = false;
    let listener: { remove(): void } | null = null;
    let ac: PlacesAutocomplete | null = null;

    loadPlaces().then((places) => {
      if (cancelled) return;
      if (!places || !inputRef.current) {
        setStatus("unavailable");
        return;
      }
      ac = new places.Autocomplete(inputRef.current, {
        types: ["address"],
        fields: ["address_components", "formatted_address"],
        ...(countryHint ? { componentRestrictions: { country: countryHint.toLowerCase() } } : {}),
      });
      listener = ac.addListener("place_changed", () => {
        if (!ac) return;
        const parsed = parseAddress(ac.getPlace());
        onSelect(parsed);
        if (inputRef.current) inputRef.current.value = "";
      });
      setStatus("ready");
    });

    return () => {
      cancelled = true;
      listener?.remove();
    };
    // onSelect/countryHint are stable for our use cases; rebinding the
    // autocomplete on each re-render would tear down the dropdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "unavailable") return null;

  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        placeholder={status === "loading" ? "Loading address search..." : "Start typing your address..."}
        disabled={status !== "ready"}
        className="block min-h-[2.625rem] w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
      />
      <span className="mt-1 block text-xs text-slate-500">
        Pick a suggestion to fill street, postcode, place and country below. You can still edit them after.
      </span>
    </label>
  );
}

/**
 * Street input with address autocomplete, using Google's current Places API
 * (AutocompleteSuggestion) and our own dropdown — the legacy Autocomplete widget
 * was deprecated/disabled for newer projects in 2025. Typing shows suggestions;
 * picking one fills ZIP, place and country via onResolved. If Places can't load
 * it stays a plain, fully usable text field.
 */
export function StreetAutocomplete({
  label,
  value,
  onChange,
  onResolved,
  countryHint,
  required,
}: {
  label: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  onResolved: (address: ParsedAddress) => void;
  countryHint?: string;
  required?: boolean;
}) {
  const libRef = useRef<PlacesLib | null>(null);
  const tokenRef = useRef<unknown>(null);
  const resolvedRef = useRef(onResolved);
  resolvedRef.current = onResolved;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [preds, setPreds] = useState<Array<{ id: string; text: string; prediction: NewPlacePrediction }>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadPlacesLib().then((lib) => {
      if (!cancelled) libRef.current = lib;
    });
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleInput(e: ChangeEvent<HTMLInputElement>) {
    onChange(e);
    const input = e.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (input.trim().length < 3 || !libRef.current) {
      setPreds([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const lib = libRef.current;
      if (!lib) return;
      try {
        if (!tokenRef.current) tokenRef.current = new lib.AutocompleteSessionToken();
        const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          sessionToken: tokenRef.current,
          ...(countryHint ? { includedRegionCodes: [countryHint.toLowerCase()] } : {}),
        });
        const items = (suggestions ?? [])
          .map((s) => s.placePrediction)
          .filter((p): p is NewPlacePrediction => Boolean(p))
          .map((p) => ({ id: p.placeId, text: p.text?.text ?? "", prediction: p }));
        setPreds(items);
        setOpen(items.length > 0);
      } catch {
        setPreds([]);
        setOpen(false);
      }
    }, 250);
  }

  async function choose(prediction: NewPlacePrediction) {
    setOpen(false);
    setPreds([]);
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ["addressComponents", "formattedAddress"] });
      resolvedRef.current(parseNewPlace(place));
    } catch {
      /* keep whatever the pilot typed */
    }
    tokenRef.current = null; // a selection ends the billing session
  }

  return (
    <label className="relative block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type="text"
        value={value}
        onChange={handleInput}
        onFocus={() => {
          if (preds.length > 0) setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        required={required}
        autoComplete="off"
        placeholder="Start typing your address..."
        className="block min-h-[2.25rem] w-full appearance-none rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
      />
      {open && preds.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {preds.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(p.prediction)}
                className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-brand-50 hover:text-brand-700"
              >
                {p.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
