import type { GameLocation } from '../types';

/**
 * Curated, geographically varied locations with a high likelihood of official
 * outdoor Google Street View coverage. Coordinates favour public streets and
 * open landmarks (not indoor photospheres) so that panorama navigation works.
 *
 * The `label` is shown to the player ONLY after they submit a guess.
 *
 * NOTE (documented limitation): this data is bundled with the client, so a
 * determined user could inspect the app bundle and read the coordinates. That
 * is an accepted trade-off for the MVP. The data sits behind a provider
 * interface (see providers/) so it can move to a backend later without
 * changing game logic.
 */
export const LOCATIONS: GameLocation[] = [
  // ── Europe ─────────────────────────────────────────────
  { id: 'paris-eiffel', lat: 48.8584, lng: 2.2945, label: 'Champ de Mars, Paris', country: 'France' },
  { id: 'london-westminster', lat: 51.5007, lng: -0.1246, label: 'Westminster, London', country: 'United Kingdom' },
  { id: 'rome-colosseum', lat: 41.8902, lng: 12.4922, label: 'Colosseum, Rome', country: 'Italy' },
  { id: 'venice-canal', lat: 45.4380, lng: 12.3358, label: 'Grand Canal, Venice', country: 'Italy' },
  { id: 'barcelona-sagrada', lat: 41.4036, lng: 2.1744, label: 'Sagrada Família, Barcelona', country: 'Spain' },
  { id: 'amsterdam-canal', lat: 52.3667, lng: 4.8945, label: 'Canal Ring, Amsterdam', country: 'Netherlands' },
  { id: 'berlin-brandenburg', lat: 52.5163, lng: 13.3777, label: 'Brandenburg Gate, Berlin', country: 'Germany' },
  { id: 'prague-oldtown', lat: 50.0870, lng: 14.4207, label: 'Old Town Square, Prague', country: 'Czechia' },
  { id: 'lisbon-alfama', lat: 38.7113, lng: -9.1300, label: 'Alfama, Lisbon', country: 'Portugal' },
  { id: 'athens-acropolis', lat: 37.9715, lng: 23.7267, label: 'Acropolis, Athens', country: 'Greece' },
  { id: 'reykjavik-center', lat: 64.1466, lng: -21.9426, label: 'Reykjavík city centre', country: 'Iceland' },
  { id: 'stockholm-gamlastan', lat: 59.3251, lng: 18.0711, label: 'Gamla Stan, Stockholm', country: 'Sweden' },
  { id: 'zurich-lake', lat: 47.3667, lng: 8.5406, label: 'Lake Zürich waterfront', country: 'Switzerland' },
  { id: 'edinburgh-royalmile', lat: 55.9496, lng: -3.1904, label: 'Royal Mile, Edinburgh', country: 'United Kingdom' },
  { id: 'dubrovnik-walls', lat: 42.6407, lng: 18.1077, label: 'Old Town, Dubrovnik', country: 'Croatia' },

  // ── North America ──────────────────────────────────────
  { id: 'nyc-timessquare', lat: 40.7580, lng: -73.9855, label: 'Times Square, New York', country: 'United States' },
  { id: 'sf-goldengate', lat: 37.8078, lng: -122.4750, label: 'Golden Gate overlook, San Francisco', country: 'United States' },
  { id: 'chicago-millennium', lat: 41.8826, lng: -87.6226, label: 'Millennium Park, Chicago', country: 'United States' },
  { id: 'neworleans-french', lat: 29.9584, lng: -90.0644, label: 'French Quarter, New Orleans', country: 'United States' },
  { id: 'toronto-downtown', lat: 43.6426, lng: -79.3871, label: 'Harbourfront, Toronto', country: 'Canada' },
  { id: 'vancouver-gastown', lat: 49.2835, lng: -123.1089, label: 'Gastown, Vancouver', country: 'Canada' },
  { id: 'mexicocity-zocalo', lat: 19.4326, lng: -99.1332, label: 'Zócalo, Mexico City', country: 'Mexico' },
  { id: 'oaxaca-center', lat: 17.0654, lng: -96.7237, label: 'Historic centre, Oaxaca', country: 'Mexico' },
  { id: 'havana-malecon', lat: 23.1400, lng: -82.3600, label: 'El Malecón, Havana', country: 'Cuba' },

  // ── South America ──────────────────────────────────────
  { id: 'rio-copacabana', lat: -22.9711, lng: -43.1822, label: 'Copacabana, Rio de Janeiro', country: 'Brazil' },
  { id: 'buenosaires-obelisco', lat: -34.6037, lng: -58.3816, label: 'Obelisco, Buenos Aires', country: 'Argentina' },
  { id: 'cusco-plaza', lat: -13.5170, lng: -71.9785, label: 'Plaza de Armas, Cusco', country: 'Peru' },
  { id: 'santiago-center', lat: -33.4372, lng: -70.6506, label: 'Plaza de Armas, Santiago', country: 'Chile' },
  { id: 'cartagena-oldcity', lat: 10.4236, lng: -75.5518, label: 'Walled City, Cartagena', country: 'Colombia' },
  { id: 'valparaiso-hills', lat: -33.0472, lng: -71.6127, label: 'Cerro Concepción, Valparaíso', country: 'Chile' },

  // ── Africa & Middle East ───────────────────────────────
  { id: 'capetown-waterfront', lat: -33.9036, lng: 18.4200, label: 'V&A Waterfront, Cape Town', country: 'South Africa' },
  { id: 'marrakech-medina', lat: 31.6258, lng: -7.9891, label: 'Jemaa el-Fnaa, Marrakech', country: 'Morocco' },
  { id: 'cairo-giza', lat: 29.9765, lng: 31.1325, label: 'Giza Plateau, Cairo', country: 'Egypt' },
  { id: 'jerusalem-oldcity', lat: 31.7767, lng: 35.2345, label: 'Old City, Jerusalem', country: 'Israel' },
  { id: 'dubai-marina', lat: 25.0805, lng: 55.1403, label: 'Dubai Marina', country: 'United Arab Emirates' },
  { id: 'nairobi-center', lat: -1.2864, lng: 36.8172, label: 'Central Nairobi', country: 'Kenya' },

  // ── Asia ───────────────────────────────────────────────
  { id: 'tokyo-shibuya', lat: 35.6595, lng: 139.7005, label: 'Shibuya Crossing, Tokyo', country: 'Japan' },
  { id: 'kyoto-gion', lat: 35.0037, lng: 135.7788, label: 'Gion, Kyoto', country: 'Japan' },
  { id: 'seoul-gyeongbok', lat: 37.5796, lng: 126.9770, label: 'Gyeongbokgung, Seoul', country: 'South Korea' },
  { id: 'singapore-marina', lat: 1.2830, lng: 103.8607, label: 'Marina Bay, Singapore', country: 'Singapore' },
  { id: 'bangkok-grandpalace', lat: 13.7500, lng: 100.4914, label: 'Grand Palace area, Bangkok', country: 'Thailand' },
  { id: 'hongkong-tsimshatsui', lat: 22.2940, lng: 114.1722, label: 'Tsim Sha Tsui, Hong Kong', country: 'Hong Kong' },
  { id: 'istanbul-sultanahmet', lat: 41.0058, lng: 28.9769, label: 'Sultanahmet, Istanbul', country: 'Türkiye' },
  { id: 'delhi-indiagate', lat: 28.6129, lng: 77.2295, label: 'India Gate, New Delhi', country: 'India' },
  { id: 'taipei-101', lat: 25.0338, lng: 121.5636, label: 'Xinyi District, Taipei', country: 'Taiwan' },

  // ── Oceania ────────────────────────────────────────────
  { id: 'sydney-operahouse', lat: -33.8568, lng: 151.2153, label: 'Sydney Harbour', country: 'Australia' },
  { id: 'melbourne-flinders', lat: -37.8183, lng: 144.9671, label: 'Flinders Street, Melbourne', country: 'Australia' },
  { id: 'auckland-viaduct', lat: -36.8434, lng: 174.7593, label: 'Viaduct Harbour, Auckland', country: 'New Zealand' },
  { id: 'queenstown-lakefront', lat: -45.0312, lng: 168.6626, label: 'Lakefront, Queenstown', country: 'New Zealand' },
  { id: 'wellington-waterfront', lat: -41.2889, lng: 174.7772, label: 'Waterfront, Wellington', country: 'New Zealand' },
];
