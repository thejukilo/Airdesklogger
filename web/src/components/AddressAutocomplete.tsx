import { useEffect, useRef, useState } from "react";
import { loadPlaces, parseAddress, type ParsedAddress, type PlacesAutocomplete } from "../lib/placesAutocomplete";

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
