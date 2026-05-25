declare module "tz-lookup" {
  /** Returns the IANA timezone name for a latitude/longitude. Throws on bad input. */
  export default function tzlookup(latitude: number, longitude: number): string;
}
