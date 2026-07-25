import type { CatalogLocation } from '../types';

/**
 * Curated, geographically varied locations with a high likelihood of official
 * outdoor Google Street View coverage. Coordinates favour public streets and
 * open landmarks (not indoor photospheres) so that panorama navigation works.
 *
 * The `label` is shown to the player ONLY after they submit a guess.
 *
 * Each location carries an explicit `difficulty` tier used by the shared
 * difficulty-aware selection system (see utils/difficultyPool.ts):
 *   • easy   — iconic cities/landmarks with strong, recognisable clues
 *   • normal — balanced urban/suburban spots recognisable with some thought
 *   • hard   — remote, rural, or geographically ambiguous places
 * Country/continent diversity is preserved within every tier so a five-round
 * game never feels regionally lopsided.
 *
 * Each entry also carries V4 diversity metadata (the `CatalogLocation` type
 * makes both mandatory, so a new location cannot be added without them):
 *   • `continent` — drives in-match geographic spread and continent collections.
 *     It must agree with `COUNTRY_CONTINENT` in config/geography.ts; the dataset
 *     audit fails if it doesn't.
 *   • `tags` — CURATED collections only (`capitals`, `famous`, `rural`).
 *     Derived collections (continents, Islands, Left-Side Driving) are computed
 *     from factual country metadata and must never be hand-tagged here.
 *
 * Tagging rules applied deliberately conservatively, because an over-tagged
 * collection is worse than a missing one:
 *   • `capitals` — the location is inside the country's capital city itself.
 *     Giza (adjacent to, not part of, Cairo) and Jerusalem (contested capital
 *     status) are deliberately excluded.
 *   • `famous`   — a globally recognisable landmark is at or in view of the spot.
 *   • `rural`    — genuinely rural/countryside. NO entry currently qualifies:
 *     every curated location is urban or small-town, so the Rural collection is
 *     reported as unavailable by the audit rather than shipped half-empty.
 *
 * NOTE (documented limitation): this data is bundled with the client, so a
 * determined user could inspect the app bundle and read the coordinates. That
 * is an accepted trade-off for the MVP. The data sits behind a provider
 * interface (see providers/) so it can move to a backend later without
 * changing game logic.
 */
export const LOCATIONS: CatalogLocation[] = [
  // ── Europe ─────────────────────────────────────────────
  { id: 'paris-eiffel', lat: 48.8584, lng: 2.2945, label: 'Champ de Mars, Paris', country: 'France', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'] },
  { id: 'london-westminster', lat: 51.5007, lng: -0.1246, label: 'Westminster, London', country: 'United Kingdom', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'] },
  { id: 'rome-colosseum', lat: 41.8902, lng: 12.4922, label: 'Colosseum, Rome', country: 'Italy', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'] },
  { id: 'venice-canal', lat: 45.4380, lng: 12.3358, label: 'Grand Canal, Venice', country: 'Italy', continent: 'Europe', difficulty: 'easy', tags: ['famous'] },
  { id: 'barcelona-sagrada', lat: 41.4036, lng: 2.1744, label: 'Sagrada Família, Barcelona', country: 'Spain', continent: 'Europe', difficulty: 'easy', tags: ['famous'] },
  { id: 'berlin-brandenburg', lat: 52.5163, lng: 13.3777, label: 'Brandenburg Gate, Berlin', country: 'Germany', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'] },
  { id: 'athens-acropolis', lat: 37.9715, lng: 23.7267, label: 'Acropolis, Athens', country: 'Greece', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'] },
  { id: 'amsterdam-canal', lat: 52.3667, lng: 4.8945, label: 'Canal Ring, Amsterdam', country: 'Netherlands', continent: 'Europe', difficulty: 'normal', tags: ['capitals'] },
  { id: 'prague-oldtown', lat: 50.0870, lng: 14.4207, label: 'Old Town Square, Prague', country: 'Czechia', continent: 'Europe', difficulty: 'normal', tags: ['capitals'] },
  { id: 'lisbon-alfama', lat: 38.7113, lng: -9.1300, label: 'Alfama, Lisbon', country: 'Portugal', continent: 'Europe', difficulty: 'normal', tags: ['capitals'] },
  { id: 'stockholm-gamlastan', lat: 59.3251, lng: 18.0711, label: 'Gamla Stan, Stockholm', country: 'Sweden', continent: 'Europe', difficulty: 'normal', tags: ['capitals'] },
  { id: 'zurich-lake', lat: 47.3667, lng: 8.5406, label: 'Lake Zürich waterfront', country: 'Switzerland', continent: 'Europe', difficulty: 'normal', tags: [] },
  { id: 'edinburgh-royalmile', lat: 55.9496, lng: -3.1904, label: 'Royal Mile, Edinburgh', country: 'United Kingdom', continent: 'Europe', difficulty: 'normal', tags: [] },
  { id: 'reykjavik-center', lat: 64.1466, lng: -21.9426, label: 'Reykjavík city centre', country: 'Iceland', continent: 'Europe', difficulty: 'hard', tags: ['capitals'] },
  { id: 'dubrovnik-walls', lat: 42.6407, lng: 18.1077, label: 'Old Town, Dubrovnik', country: 'Croatia', continent: 'Europe', difficulty: 'hard', tags: ['famous'] },

  // ── North America ──────────────────────────────────────
  { id: 'nyc-timessquare', lat: 40.7580, lng: -73.9855, label: 'Times Square, New York', country: 'United States', continent: 'North America', difficulty: 'easy', tags: ['famous'] },
  { id: 'sf-goldengate', lat: 37.8078, lng: -122.4750, label: 'Golden Gate overlook, San Francisco', country: 'United States', continent: 'North America', difficulty: 'easy', tags: ['famous'] },
  { id: 'chicago-millennium', lat: 41.8826, lng: -87.6226, label: 'Millennium Park, Chicago', country: 'United States', continent: 'North America', difficulty: 'normal', tags: [] },
  { id: 'toronto-downtown', lat: 43.6426, lng: -79.3871, label: 'Harbourfront, Toronto', country: 'Canada', continent: 'North America', difficulty: 'normal', tags: [] },
  { id: 'vancouver-gastown', lat: 49.2835, lng: -123.1089, label: 'Gastown, Vancouver', country: 'Canada', continent: 'North America', difficulty: 'normal', tags: [] },
  { id: 'mexicocity-zocalo', lat: 19.4326, lng: -99.1332, label: 'Zócalo, Mexico City', country: 'Mexico', continent: 'North America', difficulty: 'normal', tags: ['capitals'] },
  { id: 'neworleans-french', lat: 29.9584, lng: -90.0644, label: 'French Quarter, New Orleans', country: 'United States', continent: 'North America', difficulty: 'hard', tags: [] },
  { id: 'oaxaca-center', lat: 17.0654, lng: -96.7237, label: 'Historic centre, Oaxaca', country: 'Mexico', continent: 'North America', difficulty: 'hard', tags: [] },
  { id: 'havana-malecon', lat: 23.1400, lng: -82.3600, label: 'El Malecón, Havana', country: 'Cuba', continent: 'North America', difficulty: 'hard', tags: ['capitals'] },

  // ── South America ──────────────────────────────────────
  { id: 'rio-copacabana', lat: -22.9711, lng: -43.1822, label: 'Copacabana, Rio de Janeiro', country: 'Brazil', continent: 'South America', difficulty: 'easy', tags: ['famous'] },
  { id: 'buenosaires-obelisco', lat: -34.6037, lng: -58.3816, label: 'Obelisco, Buenos Aires', country: 'Argentina', continent: 'South America', difficulty: 'normal', tags: ['capitals', 'famous'] },
  { id: 'santiago-center', lat: -33.4372, lng: -70.6506, label: 'Plaza de Armas, Santiago', country: 'Chile', continent: 'South America', difficulty: 'normal', tags: ['capitals'] },
  { id: 'cusco-plaza', lat: -13.5170, lng: -71.9785, label: 'Plaza de Armas, Cusco', country: 'Peru', continent: 'South America', difficulty: 'hard', tags: [] },
  { id: 'cartagena-oldcity', lat: 10.4236, lng: -75.5518, label: 'Walled City, Cartagena', country: 'Colombia', continent: 'South America', difficulty: 'hard', tags: [] },
  { id: 'valparaiso-hills', lat: -33.0472, lng: -71.6127, label: 'Cerro Concepción, Valparaíso', country: 'Chile', continent: 'South America', difficulty: 'hard', tags: [] },

  // ── Africa & Middle East ───────────────────────────────
  { id: 'cairo-giza', lat: 29.9765, lng: 31.1325, label: 'Giza Plateau, Cairo', country: 'Egypt', continent: 'Africa', difficulty: 'easy', tags: ['famous'] },
  { id: 'dubai-marina', lat: 25.0805, lng: 55.1403, label: 'Dubai Marina', country: 'United Arab Emirates', continent: 'Asia', difficulty: 'easy', tags: ['famous'] },
  { id: 'capetown-waterfront', lat: -33.9036, lng: 18.4200, label: 'V&A Waterfront, Cape Town', country: 'South Africa', continent: 'Africa', difficulty: 'normal', tags: [] },
  { id: 'jerusalem-oldcity', lat: 31.7767, lng: 35.2345, label: 'Old City, Jerusalem', country: 'Israel', continent: 'Asia', difficulty: 'normal', tags: ['famous'] },
  { id: 'marrakech-medina', lat: 31.6258, lng: -7.9891, label: 'Jemaa el-Fnaa, Marrakech', country: 'Morocco', continent: 'Africa', difficulty: 'hard', tags: ['famous'] },
  { id: 'nairobi-center', lat: -1.2864, lng: 36.8172, label: 'Central Nairobi', country: 'Kenya', continent: 'Africa', difficulty: 'hard', tags: ['capitals'] },

  // ── Asia ───────────────────────────────────────────────
  { id: 'tokyo-shibuya', lat: 35.6595, lng: 139.7005, label: 'Shibuya Crossing, Tokyo', country: 'Japan', continent: 'Asia', difficulty: 'easy', tags: ['capitals', 'famous'] },
  { id: 'singapore-marina', lat: 1.2830, lng: 103.8607, label: 'Marina Bay, Singapore', country: 'Singapore', continent: 'Asia', difficulty: 'easy', tags: ['capitals', 'famous'] },
  { id: 'seoul-gyeongbok', lat: 37.5796, lng: 126.9770, label: 'Gyeongbokgung, Seoul', country: 'South Korea', continent: 'Asia', difficulty: 'normal', tags: ['capitals', 'famous'] },
  { id: 'bangkok-grandpalace', lat: 13.7500, lng: 100.4914, label: 'Grand Palace area, Bangkok', country: 'Thailand', continent: 'Asia', difficulty: 'normal', tags: ['capitals', 'famous'] },
  { id: 'hongkong-tsimshatsui', lat: 22.2940, lng: 114.1722, label: 'Tsim Sha Tsui, Hong Kong', country: 'Hong Kong', continent: 'Asia', difficulty: 'normal', tags: [] },
  { id: 'istanbul-sultanahmet', lat: 41.0058, lng: 28.9769, label: 'Sultanahmet, Istanbul', country: 'Türkiye', continent: 'Europe', difficulty: 'normal', tags: ['famous'] },
  { id: 'delhi-indiagate', lat: 28.6129, lng: 77.2295, label: 'India Gate, New Delhi', country: 'India', continent: 'Asia', difficulty: 'normal', tags: ['capitals', 'famous'] },
  { id: 'kyoto-gion', lat: 35.0037, lng: 135.7788, label: 'Gion, Kyoto', country: 'Japan', continent: 'Asia', difficulty: 'hard', tags: [] },
  { id: 'taipei-101', lat: 25.0338, lng: 121.5636, label: 'Xinyi District, Taipei', country: 'Taiwan', continent: 'Asia', difficulty: 'hard', tags: ['capitals'] },

  // ── Oceania ────────────────────────────────────────────
  { id: 'sydney-operahouse', lat: -33.8568, lng: 151.2153, label: 'Sydney Harbour', country: 'Australia', continent: 'Oceania', difficulty: 'easy', tags: ['famous'] },
  { id: 'melbourne-flinders', lat: -37.8183, lng: 144.9671, label: 'Flinders Street, Melbourne', country: 'Australia', continent: 'Oceania', difficulty: 'normal', tags: [] },
  { id: 'auckland-viaduct', lat: -36.8434, lng: 174.7593, label: 'Viaduct Harbour, Auckland', country: 'New Zealand', continent: 'Oceania', difficulty: 'normal', tags: [] },
  { id: 'queenstown-lakefront', lat: -45.0312, lng: 168.6626, label: 'Lakefront, Queenstown', country: 'New Zealand', continent: 'Oceania', difficulty: 'hard', tags: [] },
  { id: 'wellington-waterfront', lat: -41.2889, lng: 174.7772, label: 'Waterfront, Wellington', country: 'New Zealand', continent: 'Oceania', difficulty: 'hard', tags: ['capitals'] },
];
