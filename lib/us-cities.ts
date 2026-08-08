// Small, free/public-domain dataset of major US city centroids (plus the
// handful of Canadian metros this app's own hub cities live in — Toronto,
// Montreal), used to back the home-base typeahead in
// components/profile-panel.tsx (story: generalize-profile-inputs).
//
// Coordinates are approximate city-center lat/lng — common geographic facts,
// not pulled from any proprietary/licensed dataset — precise enough for a
// ~250-mile drive-vs-fly travel-cost estimate, not for turn-by-turn routing.
//
// Not exhaustive by design (risk mitigation in the story: "typeahead can
// fall back to nearest-match; full geocoding accuracy isn't required for a
// travel-cost estimate"). A visitor whose city isn't listed can still type
// it in as free text — Assumptions.home_base accepts a plain string with no
// coordinates attached, and lib/scoring.ts's drivable() then conservatively
// assumes every trip is a flight until they pick (or type exactly) a listed
// city instead.
import type { GeoPoint } from "./types";

export const US_CITIES: GeoPoint[] = [
  { city: "New York, NY", lat: 40.7128, lng: -74.006 },
  { city: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
  { city: "Chicago, IL", lat: 41.8781, lng: -87.6298 },
  { city: "Houston, TX", lat: 29.7604, lng: -95.3698 },
  { city: "Phoenix, AZ", lat: 33.4484, lng: -112.074 },
  { city: "Philadelphia, PA", lat: 39.9526, lng: -75.1652 },
  { city: "San Antonio, TX", lat: 29.4241, lng: -98.4936 },
  { city: "San Diego, CA", lat: 32.7157, lng: -117.1611 },
  { city: "Dallas, TX", lat: 32.7767, lng: -96.797 },
  { city: "Austin, TX", lat: 30.2672, lng: -97.7431 },
  { city: "San Jose, CA", lat: 37.3382, lng: -121.8863 },
  { city: "Fort Worth, TX", lat: 32.7555, lng: -97.3308 },
  { city: "Jacksonville, FL", lat: 30.3322, lng: -81.6557 },
  { city: "Columbus, OH", lat: 39.9612, lng: -82.9988 },
  { city: "Charlotte, NC", lat: 35.2271, lng: -80.8431 },
  { city: "San Francisco, CA", lat: 37.7749, lng: -122.4194 },
  { city: "Indianapolis, IN", lat: 39.7684, lng: -86.1581 },
  { city: "Seattle, WA", lat: 47.6062, lng: -122.3321 },
  { city: "Denver, CO", lat: 39.7392, lng: -104.9903 },
  { city: "Washington, DC", lat: 38.9072, lng: -77.0369 },
  { city: "Boston, MA", lat: 42.3601, lng: -71.0589 },
  { city: "El Paso, TX", lat: 31.7619, lng: -106.485 },
  { city: "Nashville, TN", lat: 36.1627, lng: -86.7816 },
  { city: "Detroit, MI", lat: 42.3314, lng: -83.0458 },
  { city: "Oklahoma City, OK", lat: 35.4676, lng: -97.5164 },
  { city: "Portland, OR", lat: 45.5152, lng: -122.6784 },
  { city: "Las Vegas, NV", lat: 36.1699, lng: -115.1398 },
  { city: "Memphis, TN", lat: 35.1495, lng: -90.049 },
  { city: "Louisville, KY", lat: 38.2527, lng: -85.7585 },
  { city: "Baltimore, MD", lat: 39.2904, lng: -76.6122 },
  { city: "Milwaukee, WI", lat: 43.0389, lng: -87.9065 },
  { city: "Albuquerque, NM", lat: 35.0844, lng: -106.6504 },
  { city: "Tucson, AZ", lat: 32.2226, lng: -110.9747 },
  { city: "Fresno, CA", lat: 36.7378, lng: -119.7871 },
  { city: "Sacramento, CA", lat: 38.5816, lng: -121.4944 },
  { city: "Kansas City, MO", lat: 39.0997, lng: -94.5786 },
  { city: "Mesa, AZ", lat: 33.4152, lng: -111.8315 },
  { city: "Atlanta, GA", lat: 33.749, lng: -84.388 },
  { city: "Omaha, NE", lat: 41.2565, lng: -95.9345 },
  { city: "Colorado Springs, CO", lat: 38.8339, lng: -104.8214 },
  { city: "Raleigh, NC", lat: 35.7796, lng: -78.6382 },
  { city: "Miami, FL", lat: 25.7617, lng: -80.1918 },
  { city: "Long Beach, CA", lat: 33.7701, lng: -118.1937 },
  { city: "Virginia Beach, VA", lat: 36.8529, lng: -75.978 },
  { city: "Oakland, CA", lat: 37.8044, lng: -122.2712 },
  { city: "Minneapolis, MN", lat: 44.9778, lng: -93.265 },
  { city: "Tulsa, OK", lat: 36.154, lng: -95.9928 },
  { city: "Tampa, FL", lat: 27.9506, lng: -82.4572 },
  { city: "Arlington, TX", lat: 32.7357, lng: -97.1081 },
  { city: "New Orleans, LA", lat: 29.9511, lng: -90.0715 },
  { city: "Wichita, KS", lat: 37.6872, lng: -97.3301 },
  { city: "Cleveland, OH", lat: 41.4993, lng: -81.6944 },
  { city: "Bakersfield, CA", lat: 35.3733, lng: -119.0187 },
  { city: "Aurora, CO", lat: 39.7294, lng: -104.8319 },
  { city: "Anaheim, CA", lat: 33.8366, lng: -117.9143 },
  { city: "Honolulu, HI", lat: 21.3069, lng: -157.8583 },
  { city: "Santa Ana, CA", lat: 33.7455, lng: -117.8677 },
  { city: "Riverside, CA", lat: 33.9806, lng: -117.3755 },
  { city: "Corpus Christi, TX", lat: 27.8006, lng: -97.3964 },
  { city: "Lexington, KY", lat: 38.0406, lng: -84.5037 },
  { city: "Stockton, CA", lat: 37.9577, lng: -121.2908 },
  { city: "St. Louis, MO", lat: 38.627, lng: -90.1994 },
  { city: "Saint Paul, MN", lat: 44.9537, lng: -93.09 },
  { city: "Cincinnati, OH", lat: 39.1031, lng: -84.512 },
  { city: "Pittsburgh, PA", lat: 40.4406, lng: -79.9959 },
  { city: "Greensboro, NC", lat: 36.0726, lng: -79.792 },
  { city: "Anchorage, AK", lat: 61.2181, lng: -149.9003 },
  { city: "Lincoln, NE", lat: 40.8136, lng: -96.7026 },
  { city: "Plano, TX", lat: 33.0198, lng: -96.6989 },
  { city: "Orlando, FL", lat: 28.5383, lng: -81.3792 },
  { city: "Irvine, CA", lat: 33.6846, lng: -117.8265 },
  { city: "Newark, NJ", lat: 40.7357, lng: -74.1724 },
  { city: "Durham, NC", lat: 35.994, lng: -78.8986 },
  { city: "Chula Vista, CA", lat: 32.6401, lng: -117.0842 },
  { city: "Toledo, OH", lat: 41.6528, lng: -83.5379 },
  { city: "Fort Wayne, IN", lat: 41.0793, lng: -85.1394 },
  { city: "St. Petersburg, FL", lat: 27.7676, lng: -82.6403 },
  { city: "Laredo, TX", lat: 27.5306, lng: -99.4803 },
  { city: "Jersey City, NJ", lat: 40.7178, lng: -74.0431 },
  { city: "Chandler, AZ", lat: 33.3062, lng: -111.8413 },
  { city: "Madison, WI", lat: 43.0731, lng: -89.4012 },
  { city: "Lubbock, TX", lat: 33.5779, lng: -101.8552 },
  { city: "Buffalo, NY", lat: 42.8864, lng: -78.8784 },
  { city: "Scottsdale, AZ", lat: 33.4942, lng: -111.9261 },
  { city: "Reno, NV", lat: 39.5296, lng: -119.8138 },
  { city: "Glendale, AZ", lat: 33.5387, lng: -112.186 },
  { city: "Salt Lake City, UT", lat: 40.7608, lng: -111.891 },
  { city: "Boise, ID", lat: 43.615, lng: -116.2023 },
  { city: "Richmond, VA", lat: 37.5407, lng: -77.436 },
  { city: "Spokane, WA", lat: 47.6588, lng: -117.426 },
  { city: "Des Moines, IA", lat: 41.5868, lng: -93.625 },
  { city: "Baton Rouge, LA", lat: 30.4515, lng: -91.1871 },
  { city: "Daytona Beach, FL", lat: 29.2108, lng: -81.0228 },
  { city: "Lenexa, KS", lat: 38.9536, lng: -94.7336 },
  { city: "Overland Park, KS", lat: 38.9822, lng: -94.6708 },
  { city: "Secaucus, NJ", lat: 40.7895, lng: -74.0565 },
  { city: "Cypress, CA", lat: 33.8166, lng: -118.0373 },
  { city: "Toronto, ON", lat: 43.6532, lng: -79.3832 },
  { city: "Montreal, QC", lat: 45.5019, lng: -73.5674 },
];

/**
 * Case-insensitive lookup against the dataset, matching either the full
 * "City, ST" label or just the city name before the comma (so "seattle"
 * matches "Seattle, WA"). Returns null if nothing matches — the caller
 * (components/profile-panel.tsx) then falls back to storing the visitor's
 * typed text as a plain string with no coordinates, per HomeBase's contract.
 */
export function findUsCity(query: string): GeoPoint | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  for (const c of US_CITIES) {
    const label = c.city.toLowerCase();
    const namePart = label.split(",")[0]?.trim();
    if (label === q || namePart === q) return c;
  }
  return null;
}
