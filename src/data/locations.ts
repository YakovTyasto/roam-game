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
  { id: 'paris-eiffel', lat: 48.8584, lng: 2.2945, label: 'Champ de Mars, Paris', country: 'France', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: 'Xta4ugN_QRTIo3XDFLujgw', panoVerifiedAt: '2026-07-27' },
  { id: 'london-westminster', lat: 51.5007, lng: -0.1246, label: 'Westminster, London', country: 'United Kingdom', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: 'ZmsI43WwTX2x8c_UcLF7jw', panoVerifiedAt: '2026-07-27' },
  { id: 'rome-colosseum', lat: 41.8902, lng: 12.4922, label: 'Colosseum, Rome', country: 'Italy', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: 'Z47FwC7ICZVNc2M7rWmIMg', panoVerifiedAt: '2026-07-27' },
  { id: 'venice-canal', lat: 45.438, lng: 12.3358, label: 'Grand Canal, Venice', country: 'Italy', continent: 'Europe', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: 'CAoSFkNJSE0wb2dLRUlDQWdJQ0V1Wlg5ZWc.', panoVerifiedAt: '2026-07-27' },
  { id: 'barcelona-sagrada', lat: 41.4036, lng: 2.1744, label: 'Sagrada Família, Barcelona', country: 'Spain', continent: 'Europe', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: '95Ttwo22PlsJM3ZuWJ8Hkw', panoVerifiedAt: '2026-07-27' },
  { id: 'berlin-brandenburg', lat: 52.5163, lng: 13.3777, label: 'Brandenburg Gate, Berlin', country: 'Germany', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: '7V_Y88lkp1msmQxuqoeq7g', panoVerifiedAt: '2026-07-27' },
  { id: 'athens-acropolis', lat: 37.9715, lng: 23.7267, label: 'Acropolis, Athens', country: 'Greece', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: 'M3rDCliijGd7f2TaAwnf6A', panoVerifiedAt: '2026-07-27' },
  { id: 'amsterdam-canal', lat: 52.3667, lng: 4.8945, label: 'Canal Ring, Amsterdam', country: 'Netherlands', continent: 'Europe', difficulty: 'normal', tags: ['capitals'], setting: 'urban', panoId: '3gx1wLT77IUdNdpDHayyKA', panoVerifiedAt: '2026-07-27' },
  { id: 'prague-oldtown', lat: 50.087, lng: 14.4207, label: 'Old Town Square, Prague', country: 'Czechia', continent: 'Europe', difficulty: 'normal', tags: ['capitals'], setting: 'urban', panoId: '8BXNrpb9N4m3_IpoGnD9zw', panoVerifiedAt: '2026-07-27' },
  { id: 'lisbon-alfama', lat: 38.7113, lng: -9.13, label: 'Alfama, Lisbon', country: 'Portugal', continent: 'Europe', difficulty: 'normal', tags: ['capitals'], setting: 'urban', panoId: 's3OZJNePIM5megzeJxEAXA', panoVerifiedAt: '2026-07-27' },
  { id: 'stockholm-gamlastan', lat: 59.3251, lng: 18.0711, label: 'Gamla Stan, Stockholm', country: 'Sweden', continent: 'Europe', difficulty: 'normal', tags: ['capitals'], setting: 'urban', panoId: '322ejJ013uJRMpDoqfjUFw', panoVerifiedAt: '2026-07-27' },
  { id: 'zurich-lake', lat: 47.3667, lng: 8.5406, label: 'Lake Zürich waterfront', country: 'Switzerland', continent: 'Europe', difficulty: 'normal', tags: [], setting: 'urban', panoId: 'gFGRJ98gime-4cNxarn4nA', panoVerifiedAt: '2026-07-27' },
  { id: 'edinburgh-royalmile', lat: 55.9496, lng: -3.1904, label: 'Royal Mile, Edinburgh', country: 'United Kingdom', continent: 'Europe', difficulty: 'normal', tags: [], setting: 'urban', panoId: 'd0IQvWZjwLzrpNPA03ESSQ', panoVerifiedAt: '2026-07-27' },
  { id: 'reykjavik-center', lat: 64.1466, lng: -21.9426, label: 'Reykjavík city centre', country: 'Iceland', continent: 'Europe', difficulty: 'hard', tags: ['capitals'], setting: 'urban', panoId: 'gMrLMqGZfjtaPBNwOHRgmw', panoVerifiedAt: '2026-07-27' },
  { id: 'dubrovnik-walls', lat: 42.6407, lng: 18.1077, label: 'Old Town, Dubrovnik', country: 'Croatia', continent: 'Europe', difficulty: 'hard', tags: ['famous'], setting: 'landmark', panoId: 'uGpyiwiz2yHYtUVFdpV0lg', panoVerifiedAt: '2026-07-27' },

  // ── North America ──────────────────────────────────────
  { id: 'nyc-timessquare', lat: 40.758, lng: -73.9855, label: 'Times Square, New York', country: 'United States', continent: 'North America', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: 'ywskIOsAFskiKHt5fwIUWA', panoVerifiedAt: '2026-07-27' },
  { id: 'sf-goldengate', lat: 37.8078, lng: -122.475, label: 'Golden Gate overlook, San Francisco', country: 'United States', continent: 'North America', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: 'pWtT7jOIWZtEQm-KDcgqrQ', panoVerifiedAt: '2026-07-27' },
  { id: 'chicago-millennium', lat: 41.8826, lng: -87.6226, label: 'Millennium Park, Chicago', country: 'United States', continent: 'North America', difficulty: 'normal', tags: [], setting: 'urban', panoId: 'QZFXb5I7gYZegqvmi7kYOQ', panoVerifiedAt: '2026-07-27' },
  { id: 'toronto-downtown', lat: 43.6426, lng: -79.3871, label: 'Harbourfront, Toronto', country: 'Canada', continent: 'North America', difficulty: 'normal', tags: [], setting: 'urban', panoId: 'uZJI93W2K-JS1I67-YS_7Q', panoVerifiedAt: '2026-07-27' },
  { id: 'vancouver-gastown', lat: 49.2835, lng: -123.1089, label: 'Gastown, Vancouver', country: 'Canada', continent: 'North America', difficulty: 'normal', tags: [], setting: 'urban', panoId: 'q8WdYOVlreNiwWoDx_g15w', panoVerifiedAt: '2026-07-27' },
  { id: 'mexicocity-zocalo', lat: 19.4326, lng: -99.1332, label: 'Zócalo, Mexico City', country: 'Mexico', continent: 'North America', difficulty: 'normal', tags: ['capitals'], setting: 'urban', panoId: 'x2KyfopAtV3pg_Tcx7_YKw', panoVerifiedAt: '2026-07-27' },
  { id: 'neworleans-french', lat: 29.9584, lng: -90.0644, label: 'French Quarter, New Orleans', country: 'United States', continent: 'North America', difficulty: 'hard', tags: [], setting: 'urban', panoId: 'OhgO3V1TU-wSM0A8IBjZWw', panoVerifiedAt: '2026-07-27' },
  { id: 'oaxaca-center', lat: 17.0654, lng: -96.7237, label: 'Historic centre, Oaxaca', country: 'Mexico', continent: 'North America', difficulty: 'hard', tags: [], setting: 'urban', panoId: 'RCcXsMXf3iwecLySwQBF1w', panoVerifiedAt: '2026-07-27' },
  { id: 'havana-malecon', lat: 23.1400, lng: -82.3600, label: 'El Malecón, Havana', country: 'Cuba', continent: 'North America', difficulty: 'hard', tags: ['capitals'], setting: 'urban' },

  // ── South America ──────────────────────────────────────
  { id: 'rio-copacabana', lat: -22.9711, lng: -43.1822, label: 'Copacabana, Rio de Janeiro', country: 'Brazil', continent: 'South America', difficulty: 'easy', tags: ['famous'], setting: 'urban', panoId: '7qjBV14agwlgVc6KCtXMVQ', panoVerifiedAt: '2026-07-27' },
  { id: 'buenosaires-obelisco', lat: -34.6037, lng: -58.3816, label: 'Obelisco, Buenos Aires', country: 'Argentina', continent: 'South America', difficulty: 'normal', tags: ['capitals', 'famous'], setting: 'landmark', panoId: 'T32SqZE3NkYZDJhnIy4gpA', panoVerifiedAt: '2026-07-27' },
  { id: 'santiago-center', lat: -33.4372, lng: -70.6506, label: 'Plaza de Armas, Santiago', country: 'Chile', continent: 'South America', difficulty: 'normal', tags: ['capitals'], setting: 'urban', panoId: 'zvrEwnaFCc5oJLwYibj4ag', panoVerifiedAt: '2026-07-27' },
  { id: 'cusco-plaza', lat: -13.517, lng: -71.9785, label: 'Plaza de Armas, Cusco', country: 'Peru', continent: 'South America', difficulty: 'hard', tags: [], setting: 'urban', panoId: '8853zU5s8QMu-oKS6BPLcw', panoVerifiedAt: '2026-07-27' },
  { id: 'cartagena-oldcity', lat: 10.4236, lng: -75.5518, label: 'Walled City, Cartagena', country: 'Colombia', continent: 'South America', difficulty: 'hard', tags: [], setting: 'urban', panoId: 'vTBz6H2NUIAmnvomh0XFRw', panoVerifiedAt: '2026-07-27' },
  { id: 'valparaiso-hills', lat: -33.0472, lng: -71.6127, label: 'Cerro Concepción, Valparaíso', country: 'Chile', continent: 'South America', difficulty: 'hard', tags: [], setting: 'urban', panoId: 'nZYP43hfaUQzaCiIfowMnA', panoVerifiedAt: '2026-07-27' },

  // ── Africa & Middle East ───────────────────────────────
  { id: 'cairo-giza', lat: 29.9765, lng: 31.1325, label: 'Giza Plateau, Cairo', country: 'Egypt', continent: 'Africa', difficulty: 'easy', tags: ['famous'], setting: 'landmark' },
  { id: 'dubai-marina', lat: 25.0805, lng: 55.1403, label: 'Dubai Marina', country: 'United Arab Emirates', continent: 'Asia', difficulty: 'easy', tags: ['famous'], setting: 'urban', panoId: 'qhIFoM83XAvR0_t4v8iXMw', panoVerifiedAt: '2026-07-27' },
  { id: 'capetown-waterfront', lat: -33.9036, lng: 18.4200, label: 'V&A Waterfront, Cape Town', country: 'South Africa', continent: 'Africa', difficulty: 'normal', tags: [], setting: 'urban' },
  { id: 'jerusalem-oldcity', lat: 31.7767, lng: 35.2345, label: 'Old City, Jerusalem', country: 'Israel', continent: 'Asia', difficulty: 'normal', tags: ['famous'], setting: 'landmark', panoId: 'zpdcMsH1hKsThQQoTVFd2g', panoVerifiedAt: '2026-07-27' },
  { id: 'marrakech-medina', lat: 31.6258, lng: -7.9891, label: 'Jemaa el-Fnaa, Marrakech', country: 'Morocco', continent: 'Africa', difficulty: 'hard', tags: ['famous'], setting: 'urban' },
  { id: 'nairobi-center', lat: -1.2864, lng: 36.8172, label: 'Central Nairobi', country: 'Kenya', continent: 'Africa', difficulty: 'hard', tags: ['capitals'], setting: 'urban', panoId: 'Lz4-whHVErwA98oXe1lpDA', panoVerifiedAt: '2026-07-27' },

  // ── Asia ───────────────────────────────────────────────
  { id: 'tokyo-shibuya', lat: 35.6595, lng: 139.7005, label: 'Shibuya Crossing, Tokyo', country: 'Japan', continent: 'Asia', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'urban', panoId: 'XlVh96-Z9lAI5tKrU2O4Yg', panoVerifiedAt: '2026-07-27' },
  { id: 'singapore-marina', lat: 1.283, lng: 103.8607, label: 'Marina Bay, Singapore', country: 'Singapore', continent: 'Asia', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'urban', panoId: 'PCa_v3w-GEdKE5krOd5nbQ', panoVerifiedAt: '2026-07-27' },
  { id: 'seoul-gyeongbok', lat: 37.5796, lng: 126.977, label: 'Gyeongbokgung, Seoul', country: 'South Korea', continent: 'Asia', difficulty: 'normal', tags: ['capitals', 'famous'], setting: 'landmark', panoId: 'tT6O77Wv_Y1ct91PTPfXrA', panoVerifiedAt: '2026-07-27' },
  { id: 'bangkok-grandpalace', lat: 13.7500, lng: 100.4914, label: 'Grand Palace area, Bangkok', country: 'Thailand', continent: 'Asia', difficulty: 'normal', tags: ['capitals', 'famous'], setting: 'landmark' },
  { id: 'hongkong-tsimshatsui', lat: 22.294, lng: 114.1722, label: 'Tsim Sha Tsui, Hong Kong', country: 'Hong Kong', continent: 'Asia', difficulty: 'normal', tags: [], setting: 'urban', panoId: 'D7Ks7DJsNg_WMdROzEp40A', panoVerifiedAt: '2026-07-27' },
  { id: 'istanbul-sultanahmet', lat: 41.0058, lng: 28.9769, label: 'Sultanahmet, Istanbul', country: 'Türkiye', continent: 'Europe', difficulty: 'normal', tags: ['famous'], setting: 'landmark', panoId: 'j_q4DCQ1r347av7gcWcrCA', panoVerifiedAt: '2026-07-27' },
  { id: 'delhi-indiagate', lat: 28.6129, lng: 77.2295, label: 'India Gate, New Delhi', country: 'India', continent: 'Asia', difficulty: 'normal', tags: ['capitals', 'famous'], setting: 'landmark' },
  { id: 'kyoto-gion', lat: 35.0037, lng: 135.7788, label: 'Gion, Kyoto', country: 'Japan', continent: 'Asia', difficulty: 'hard', tags: [], setting: 'urban', panoId: 'io_PwbaaDBtlORhfh4rJpA', panoVerifiedAt: '2026-07-27' },
  { id: 'taipei-101', lat: 25.0338, lng: 121.5636, label: 'Xinyi District, Taipei', country: 'Taiwan', continent: 'Asia', difficulty: 'hard', tags: ['capitals'], setting: 'urban', panoId: 'mkvLcZYsKZhJhutMsVU4HA', panoVerifiedAt: '2026-07-27' },

  // ── Oceania ────────────────────────────────────────────
  { id: 'sydney-operahouse', lat: -33.8568, lng: 151.2153, label: 'Sydney Harbour', country: 'Australia', continent: 'Oceania', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: 'cFou_FaIrbvqN0kcS5QuxA', panoVerifiedAt: '2026-07-27' },
  { id: 'melbourne-flinders', lat: -37.8183, lng: 144.9671, label: 'Flinders Street, Melbourne', country: 'Australia', continent: 'Oceania', difficulty: 'normal', tags: [], setting: 'urban', panoId: 'JExXU33eyq-qP-l1vRyExQ', panoVerifiedAt: '2026-07-27' },
  { id: 'auckland-viaduct', lat: -36.8434, lng: 174.7593, label: 'Viaduct Harbour, Auckland', country: 'New Zealand', continent: 'Oceania', difficulty: 'normal', tags: [], setting: 'urban', panoId: '3I6loqin1YB7uKhliDZlfA', panoVerifiedAt: '2026-07-27' },
  { id: 'queenstown-lakefront', lat: -45.0312, lng: 168.6626, label: 'Lakefront, Queenstown', country: 'New Zealand', continent: 'Oceania', difficulty: 'hard', tags: [], setting: 'suburban', panoId: '_BapbaakU-zbJaDzkwkZ_w', panoVerifiedAt: '2026-07-27' },
  { id: 'wellington-waterfront', lat: -41.2889, lng: 174.7772, label: 'Waterfront, Wellington', country: 'New Zealand', continent: 'Oceania', difficulty: 'hard', tags: ['capitals'], setting: 'urban', panoId: 'WomWNQ3SF_MVZrF-bkqT8Q', panoVerifiedAt: '2026-07-27' },

  // ── Batch 001 (verified 2026-07-26) ────────────────────────
  // Added by the catalog expansion workflow. Every panoId below was
  // resolved by a real Street View metadata request; see
  // data/candidates/batch-001.verified.json for the run that produced them.
  { id: 'southafrica-karoo-highway', lat: -32.36, lng: 22.58, label: 'Great Karoo, Western Cape', country: 'South Africa', continent: 'Africa', difficulty: 'hard', tags: [], setting: 'remote', panoId: '6XcgSnZYKCaqmpiHezLY2A', panoVerifiedAt: '2026-07-26' },
  { id: 'reunion-cilaos-road', lat: -21.13, lng: 55.47, label: 'Route de Cilaos', country: 'Réunion', continent: 'Africa', difficulty: 'hard', tags: [], setting: 'rural', panoId: 'qW7KV42pmtSv-_exOSCPwg', panoVerifiedAt: '2026-07-26' },
  { id: 'rwanda-musanze-hills', lat: -1.5, lng: 29.63, label: 'Terraced hills near Musanze', country: 'Rwanda', continent: 'Africa', difficulty: 'normal', tags: [], setting: 'rural', panoId: 'kWJVmwr36D8qB5M5xdUttw', panoVerifiedAt: '2026-07-26' },
  { id: 'australia-winton-landsborough', lat: -22.39, lng: 143.04, label: 'Landsborough Highway, outback Queensland', country: 'Australia', continent: 'Oceania', difficulty: 'hard', tags: [], setting: 'remote', panoId: 'cg9R2KlxLFxE7-GirlU0kQ', panoVerifiedAt: '2026-07-26' },
  { id: 'newzealand-alexandra-otago', lat: -45.25, lng: 169.38, label: 'Central Otago near Alexandra', country: 'New Zealand', continent: 'Oceania', difficulty: 'hard', tags: [], setting: 'rural', panoId: 'K0WHDxl2l3XzLaHfyju3Zg', panoVerifiedAt: '2026-07-26' },
  { id: 'argentina-ruta40-patagonia', lat: -46.59, lng: -70.93, label: 'Ruta 40, Patagonian steppe', country: 'Argentina', continent: 'South America', difficulty: 'hard', tags: [], setting: 'remote', panoId: 'iCMjk39lJgxck7sqG-0hbg', panoVerifiedAt: '2026-07-26' },
  { id: 'peru-altiplano-juliaca', lat: -15.83, lng: -70.02, label: 'Altiplano near Juliaca', country: 'Peru', continent: 'South America', difficulty: 'hard', tags: [], setting: 'remote', panoId: 'WHn8qkLSijnBWHnnfYmVLA', panoVerifiedAt: '2026-07-26' },
  { id: 'ecuador-banos-andes', lat: -1.4, lng: -78.42, label: 'Andean valley near Baños', country: 'Ecuador', continent: 'South America', difficulty: 'hard', tags: [], setting: 'rural', panoId: 'G5pXZSn45H9TZkJ2caal1Q', panoVerifiedAt: '2026-07-26' },
  { id: 'colombia-salento-coffee', lat: 4.64, lng: -75.57, label: 'Coffee country near Salento', country: 'Colombia', continent: 'South America', difficulty: 'normal', tags: [], setting: 'rural', panoId: 'XY2nmz3Vy1G6PjhCxz7oTQ', panoVerifiedAt: '2026-07-26' },
  { id: 'brazil-gramado-serra', lat: -29.38, lng: -50.87, label: 'Serra Gaúcha near Gramado', country: 'Brazil', continent: 'South America', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'P10LY2LFq2Kk17HOlb707g', panoVerifiedAt: '2026-07-26' },
  { id: 'kyrgyzstan-naryn-pass', lat: 41.43, lng: 75.99, label: 'Mountain road near Naryn', country: 'Kyrgyzstan', continent: 'Asia', difficulty: 'hard', tags: [], setting: 'remote', panoId: 'Hqd7TGGxGMBBhm_TX0uAGw', panoVerifiedAt: '2026-07-26' },
  { id: 'srilanka-ella-hills', lat: 6.87, lng: 81.05, label: 'Hill country near Ella', country: 'Sri Lanka', continent: 'Asia', difficulty: 'normal', tags: [], setting: 'rural', panoId: 'BX4aUMb_Mvb6RX9BMz_laQ', panoVerifiedAt: '2026-07-26' },
  { id: 'malaysia-ipoh-outskirts', lat: 4.55, lng: 101.1, label: 'Outskirts of Ipoh', country: 'Malaysia', continent: 'Asia', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'xmOzOqLby_a4jZzLHNXbDQ', panoVerifiedAt: '2026-07-26' },
  { id: 'guatemala-chichicastenango', lat: 14.94, lng: -91.11, label: 'Highlands near Chichicastenango', country: 'Guatemala', continent: 'North America', difficulty: 'hard', tags: [], setting: 'rural', panoId: 'l91IdZPdPl11WLPNqLlaVg', panoVerifiedAt: '2026-07-26' },

  // ── Batch 002 (verified 2026-07-27) ────────────────────────
  // Placed on named long-distance road corridors after batch 001's 65% miss
  // rate; the hit rate rose to 55%. See data/candidates/batch-002.verified.json.
  { id: 'southafrica-n7-namaqualand', lat: -29.66, lng: 17.89, label: 'N7 through Namaqualand', country: 'South Africa', continent: 'Africa', difficulty: 'hard', tags: [], setting: 'remote', panoId: 'BnxpR4aNTWG7dL3osbzJzQ', panoVerifiedAt: '2026-07-27' },
  { id: 'southafrica-stellenbosch-outskirts', lat: -33.93, lng: 18.86, label: 'Winelands outside Stellenbosch', country: 'South Africa', continent: 'Africa', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'VpSqHP0_m1w_Ah2s3SWb0w', panoVerifiedAt: '2026-07-27' },
  { id: 'lesotho-a2-mafeteng', lat: -29.82, lng: 27.24, label: 'A2 near Mafeteng', country: 'Lesotho', continent: 'Africa', difficulty: 'hard', tags: [], setting: 'rural', panoId: 'QHJ8W805MDz9x1J-wl0DjQ', panoVerifiedAt: '2026-07-27' },
  { id: 'ghana-n1-takoradi', lat: 4.9, lng: -1.76, label: 'N1 coastal road near Takoradi', country: 'Ghana', continent: 'Africa', difficulty: 'normal', tags: [], setting: 'suburban', panoId: '8yw-sityAwtdv2RPZ2j5vQ', panoVerifiedAt: '2026-07-27' },
  { id: 'newzealand-sh6-haast', lat: -43.88, lng: 169.04, label: 'State Highway 6 near Haast', country: 'New Zealand', continent: 'Oceania', difficulty: 'hard', tags: [], setting: 'rural', panoId: '6k-_awBkZjPoxpa9tguOYQ', panoVerifiedAt: '2026-07-27' },
  { id: 'newzealand-sh1-canterbury', lat: -44.1, lng: 171.24, label: 'State Highway 1, Canterbury Plains', country: 'New Zealand', continent: 'Oceania', difficulty: 'hard', tags: [], setting: 'rural', panoId: '1eAU6XIIqegHswGIPSBvZg', panoVerifiedAt: '2026-07-27' },
  { id: 'chile-ruta5-chanaral', lat: -26.35, lng: -70.62, label: 'Ruta 5 near Chañaral', country: 'Chile', continent: 'South America', difficulty: 'hard', tags: [], setting: 'remote', panoId: 'g7FUWEnZPyVAUifJHch7EQ', panoVerifiedAt: '2026-07-27' },
  { id: 'argentina-ruta3-santacruz', lat: -49.31, lng: -67.73, label: 'Ruta 3 near Puerto San Julián', country: 'Argentina', continent: 'South America', difficulty: 'hard', tags: [], setting: 'remote', panoId: 'hLZwUeSkM9PayxJvu2OV_g', panoVerifiedAt: '2026-07-27' },
  { id: 'argentina-rosario-outskirts', lat: -32.93, lng: -60.68, label: 'Outskirts of Rosario', country: 'Argentina', continent: 'South America', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'I5I3sbEZkwDmRpdlQDt_bg', panoVerifiedAt: '2026-07-27' },
  { id: 'brazil-minas-rural', lat: -21.13, lng: -44.25, label: 'Farmland in southern Minas Gerais', country: 'Brazil', continent: 'South America', difficulty: 'normal', tags: [], setting: 'rural', panoId: 'avE_Ar4JhLKucthNuSPOMA', panoVerifiedAt: '2026-07-27' },
  { id: 'peru-panamericana-nazca', lat: -14.83, lng: -74.94, label: 'Panamericana Sur near Nazca', country: 'Peru', continent: 'South America', difficulty: 'hard', tags: [], setting: 'remote', panoId: '6wEOoVOTponHYbvcQq28DA', panoVerifiedAt: '2026-07-27' },
  { id: 'uruguay-ruta9-rocha', lat: -34.48, lng: -54.34, label: 'Ruta 9 near Rocha', country: 'Uruguay', continent: 'South America', difficulty: 'normal', tags: [], setting: 'rural', panoId: 'S9C6JHsdlZUA2dimkvXFDg', panoVerifiedAt: '2026-07-27' },
  { id: 'colombia-boyaca-rural', lat: 5.55, lng: -73.36, label: 'Andean farmland in Boyacá', country: 'Colombia', continent: 'South America', difficulty: 'normal', tags: [], setting: 'rural', panoId: 'hHGrwIrTxv5a6VxyGy9MLQ', panoVerifiedAt: '2026-07-27' },
  { id: 'canada-transcanada-swiftcurrent', lat: 50.29, lng: -107.8, label: 'Trans-Canada Highway, Saskatchewan', country: 'Canada', continent: 'North America', difficulty: 'hard', tags: [], setting: 'remote', panoId: 'xUsoLzvKPfchqhIF40f20Q', panoVerifiedAt: '2026-07-27' },
  { id: 'mexico-mex1-catavina', lat: 29.73, lng: -114.72, label: 'Mexico 1 near Cataviña, Baja California', country: 'Mexico', continent: 'North America', difficulty: 'hard', tags: [], setting: 'remote', panoId: 'yUG_-0LzC_X1GAXlwkfkIQ', panoVerifiedAt: '2026-07-27' },
  { id: 'mexico-merida-outskirts', lat: 20.98, lng: -89.62, label: 'Outskirts of Mérida, Yucatán', country: 'Mexico', continent: 'North America', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'MLy_FIiO-dIESkP3dTN65w', panoVerifiedAt: '2026-07-27' },
  { id: 'japan-hokkaido-biei', lat: 43.59, lng: 142.47, label: 'Rolling farmland near Biei, Hokkaido', country: 'Japan', continent: 'Asia', difficulty: 'hard', tags: [], setting: 'rural', panoId: 'P-7apcUUn5L013sSQjlwNg', panoVerifiedAt: '2026-07-27' },
  { id: 'thailand-1095-pai', lat: 19.36, lng: 98.44, label: 'Route 1095 near Pai', country: 'Thailand', continent: 'Asia', difficulty: 'hard', tags: [], setting: 'rural', panoId: 'jfSIgOuFReig-_qAwRrCaQ', panoVerifiedAt: '2026-07-27' },
  { id: 'indonesia-yogyakarta-outskirts', lat: -7.78, lng: 110.42, label: 'Outskirts of Yogyakarta, Java', country: 'Indonesia', continent: 'Asia', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'rWQe_mcztSFXMnqAjqfBWA', panoVerifiedAt: '2026-07-27' },
  { id: 'norway-e6-finnmark', lat: 69.47, lng: 25.51, label: 'E6 in Finnmark', country: 'Norway', continent: 'Europe', difficulty: 'hard', tags: [], setting: 'remote', panoId: 'brfx4leWpVejGpi6eFMwnA', panoVerifiedAt: '2026-07-27' },
  { id: 'spain-ronda-countryside', lat: 36.74, lng: -5.16, label: 'Countryside near Ronda, Andalusia', country: 'Spain', continent: 'Europe', difficulty: 'hard', tags: [], setting: 'rural', panoId: 'aQMdugK4F3-PYh0Fzjy7ZQ', panoVerifiedAt: '2026-07-27' },
  { id: 'portugal-n2-alentejo', lat: 37.51, lng: -8.06, label: 'N2 through the Alentejo', country: 'Portugal', continent: 'Europe', difficulty: 'hard', tags: [], setting: 'rural', panoId: 'a0fjzJXlL5tWsuooCeNppQ', panoVerifiedAt: '2026-07-27' },

  // ── Batch 003 (verified 2026-07-27) ────────────────────────
  // Replacements for batch-001 failures, relocated to countries with proven
  // coverage. See data/candidates/batch-003.verified.json.
  { id: 'rwanda-southern-rural', lat: -2.6, lng: 29.75, label: 'Farmland in southern Rwanda', country: 'Rwanda', continent: 'Africa', difficulty: 'normal', tags: [], setting: 'rural', panoId: 'EjzsDBdG1ipyZzxZox4TDA', panoVerifiedAt: '2026-07-27' },
  { id: 'southafrica-durban-outskirts', lat: -29.78, lng: 30.98, label: 'Outskirts of Durban', country: 'South Africa', continent: 'Africa', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'T8r1-IKQ48mbMe9_N6PXOA', panoVerifiedAt: '2026-07-27' },
  { id: 'ecuador-cuenca-outskirts', lat: -2.9, lng: -79, label: 'Outskirts of Cuenca', country: 'Ecuador', continent: 'South America', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'qqtqLDvZs3bFycly2fzhDA', panoVerifiedAt: '2026-07-27' },
  { id: 'colombia-medellin-outskirts', lat: 6.2, lng: -75.62, label: 'Outskirts of Medellín', country: 'Colombia', continent: 'South America', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'Ysx94J1kblzJswJ6FxP_Rg', panoVerifiedAt: '2026-07-27' },
  { id: 'brazil-curitiba-outskirts', lat: -25.5, lng: -49.3, label: 'Outskirts of Curitiba', country: 'Brazil', continent: 'South America', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'tCje8N2-JjkXTUgtvwIAEg', panoVerifiedAt: '2026-07-27' },
  { id: 'argentina-mendoza-outskirts', lat: -32.92, lng: -68.79, label: 'Outskirts of Mendoza', country: 'Argentina', continent: 'South America', difficulty: 'normal', tags: [], setting: 'suburban', panoId: '1_QqXXbg_ZzQnxrBSvJweg', panoVerifiedAt: '2026-07-27' },
  { id: 'guatemala-quetzaltenango-outskirts', lat: 14.84, lng: -91.52, label: 'Outskirts of Quetzaltenango', country: 'Guatemala', continent: 'North America', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'Wi3LdkchdJD7wZLzD2f5Mw', panoVerifiedAt: '2026-07-27' },
  { id: 'mexico-queretaro-outskirts', lat: 20.63, lng: -100.42, label: 'Outskirts of Querétaro', country: 'Mexico', continent: 'North America', difficulty: 'normal', tags: [], setting: 'suburban', panoId: '3x5S9EuSO1Yt1blEG1HhBQ', panoVerifiedAt: '2026-07-27' },
  { id: 'canada-okanagan-rural', lat: 49.9, lng: -119.5, label: 'Okanagan valley farmland', country: 'Canada', continent: 'North America', difficulty: 'normal', tags: [], setting: 'rural', panoId: '-zzqfqrmzO3oIYDSGUthQw', panoVerifiedAt: '2026-07-27' },
  { id: 'kyrgyzstan-bishkek-outskirts', lat: 42.85, lng: 74.65, label: 'Outskirts of Bishkek', country: 'Kyrgyzstan', continent: 'Asia', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'WfCzMis5XVfaTFgJQMHyOg', panoVerifiedAt: '2026-07-27' },
  { id: 'srilanka-kandy-outskirts', lat: 7.3, lng: 80.63, label: 'Outskirts of Kandy', country: 'Sri Lanka', continent: 'Asia', difficulty: 'normal', tags: [], setting: 'suburban', panoId: '7E2L20l03WNINGVuApwwJA', panoVerifiedAt: '2026-07-27' },
  { id: 'malaysia-johor-outskirts', lat: 1.52, lng: 103.7, label: 'Outskirts of Johor Bahru', country: 'Malaysia', continent: 'Asia', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'FHY1EjvZBPscAiq_tF91bw', panoVerifiedAt: '2026-07-27' },
  { id: 'japan-kanazawa-outskirts', lat: 36.55, lng: 136.68, label: 'Outskirts of Kanazawa', country: 'Japan', continent: 'Asia', difficulty: 'normal', tags: [], setting: 'suburban', panoId: 'mbrOG8FYHSayRybp-P2rgA', panoVerifiedAt: '2026-07-27' },
  { id: 'portugal-douro-rural', lat: 41.15, lng: -7.78, label: 'Douro valley terraces', country: 'Portugal', continent: 'Europe', difficulty: 'normal', tags: [], setting: 'rural', panoId: 'pAYQdA9tPUivxYFpf112rA', panoVerifiedAt: '2026-07-27' },

  // ── Batch 004 (verified 2026-07-27) ────────────────────────
  // Easy tier: pedestrian squares, promenades and named city-centre streets.
  // 34 of 40 verified — the best hit rate of any batch. See
  // data/candidates/batch-004.verified.json.
  { id: 'australia-brisbane-southbank', lat: -27.4748, lng: 153.0175, label: 'South Bank promenade, Brisbane', country: 'Australia', continent: 'Oceania', difficulty: 'easy', tags: ['famous'], setting: 'urban', panoId: 'wP5syAo8yetqXBnV-EEBLw', panoVerifiedAt: '2026-07-27' },
  { id: 'australia-goldcoast-surfers', lat: -28.0024, lng: 153.43, label: 'Surfers Paradise, Gold Coast', country: 'Australia', continent: 'Oceania', difficulty: 'easy', tags: [], setting: 'urban', panoId: 'Upmy8hBDMqsWR55nOAcsJw', panoVerifiedAt: '2026-07-27' },
  { id: 'newzealand-christchurch-centre', lat: -43.5309, lng: 172.6365, label: 'Cathedral Square, Christchurch', country: 'New Zealand', continent: 'Oceania', difficulty: 'easy', tags: [], setting: 'urban', panoId: 'Pnr3gGMt8pTdHpKgg-i-xw', panoVerifiedAt: '2026-07-27' },
  { id: 'newzealand-rotorua-gardens', lat: -38.1368, lng: 176.2497, label: 'Government Gardens, Rotorua', country: 'New Zealand', continent: 'Oceania', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: 'bfdhwJZwzfW4nssAaxn4MA', panoVerifiedAt: '2026-07-27' },
  { id: 'newzealand-dunedin-octagon', lat: -45.8742, lng: 170.5036, label: 'The Octagon, Dunedin', country: 'New Zealand', continent: 'Oceania', difficulty: 'easy', tags: [], setting: 'urban', panoId: 'Hn34FrbGwUWbxeAkmHZklw', panoVerifiedAt: '2026-07-27' },
  { id: 'southafrica-johannesburg-newtown', lat: -26.2041, lng: 28.0473, label: 'Newtown, Johannesburg', country: 'South Africa', continent: 'Africa', difficulty: 'easy', tags: [], setting: 'urban', panoId: 'Sgp7DvAZuQmbWjpHehpaug', panoVerifiedAt: '2026-07-27' },
  { id: 'southafrica-pretoria-union-buildings', lat: -25.7407, lng: 28.21, label: 'Union Buildings, Pretoria', country: 'South Africa', continent: 'Africa', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: 'eGbR3kyzeBiiz0Abt9uzMg', panoVerifiedAt: '2026-07-27' },
  { id: 'senegal-dakar-place-independance', lat: 14.669, lng: -17.439, label: 'Place de l\'Indépendance, Dakar', country: 'Senegal', continent: 'Africa', difficulty: 'easy', tags: ['capitals'], setting: 'urban', panoId: 'CR87oBdsI-FjCZl9rpE-1g', panoVerifiedAt: '2026-07-27' },
  { id: 'nigeria-lagos-marina', lat: 6.4498, lng: 3.396, label: 'Lagos Marina', country: 'Nigeria', continent: 'Africa', difficulty: 'easy', tags: [], setting: 'urban', panoId: 'INdmZPzyPA2x4xyMCfMsmQ', panoVerifiedAt: '2026-07-27' },
  { id: 'india-mumbai-gateway', lat: 18.922, lng: 72.8347, label: 'Gateway of India, Mumbai', country: 'India', continent: 'Asia', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: '_u6tanRA4GZi2jjqeDvycg', panoVerifiedAt: '2026-07-27' },
  { id: 'philippines-manila-intramuros', lat: 14.5906, lng: 120.975, label: 'Intramuros, Manila', country: 'Philippines', continent: 'Asia', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: 'fiYDkjj_hITl7sqZsyNd0A', panoVerifiedAt: '2026-07-27' },
  { id: 'cambodia-siemreap-angkor', lat: 13.4125, lng: 103.867, label: 'Angkor Wat causeway', country: 'Cambodia', continent: 'Asia', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: 'u-y_MApaJfTEWjdGoX40lQ', panoVerifiedAt: '2026-07-27' },
  { id: 'japan-osaka-dotonbori', lat: 34.6687, lng: 135.5013, label: 'Dōtonbori, Osaka', country: 'Japan', continent: 'Asia', difficulty: 'easy', tags: ['famous'], setting: 'urban', panoId: 'REPRhZd6-Yd2jO6I4SbCfg', panoVerifiedAt: '2026-07-27' },
  { id: 'southkorea-busan-haeundae', lat: 35.1587, lng: 129.1604, label: 'Haeundae, Busan', country: 'South Korea', continent: 'Asia', difficulty: 'easy', tags: [], setting: 'urban', panoId: 'rC7Dgv_sxIcmGX2PqCDhNA', panoVerifiedAt: '2026-07-27' },
  { id: 'thailand-chiangmai-oldcity', lat: 18.7883, lng: 98.9853, label: 'Old City, Chiang Mai', country: 'Thailand', continent: 'Asia', difficulty: 'easy', tags: [], setting: 'urban', panoId: 's8-coGYWlU1yo8Xa5dcT-Q', panoVerifiedAt: '2026-07-27' },
  { id: 'austria-vienna-schonbrunn', lat: 48.1849, lng: 16.3122, label: 'Schönbrunn Palace, Vienna', country: 'Austria', continent: 'Europe', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: 'cyk8P_zrVFEPoDeJHrpENQ', panoVerifiedAt: '2026-07-27' },
  { id: 'hungary-budapest-chainbridge', lat: 47.4986, lng: 19.0435, label: 'Chain Bridge, Budapest', country: 'Hungary', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: '5TIqM4MbYTi7hCWl1iyy5Q', panoVerifiedAt: '2026-07-27' },
  { id: 'ireland-dublin-oconnell', lat: 53.3498, lng: -6.2603, label: 'O\'Connell Street, Dublin', country: 'Ireland', continent: 'Europe', difficulty: 'easy', tags: ['capitals'], setting: 'urban', panoId: '2zC0AMogePyOM1WmtUNmaw', panoVerifiedAt: '2026-07-27' },
  { id: 'denmark-copenhagen-nyhavn', lat: 55.6797, lng: 12.5913, label: 'Nyhavn, Copenhagen', country: 'Denmark', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: '6gydHFCiuBavs9k-zRGECw', panoVerifiedAt: '2026-07-27' },
  { id: 'poland-krakow-mainsquare', lat: 50.0616, lng: 19.9373, label: 'Main Market Square, Kraków', country: 'Poland', continent: 'Europe', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: 'aVzx-gQEZg-oY7tZ8o2DIg', panoVerifiedAt: '2026-07-27' },
  { id: 'finland-helsinki-senatesquare', lat: 60.1699, lng: 24.9524, label: 'Senate Square, Helsinki', country: 'Finland', continent: 'Europe', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: 'c26dHIq8hx_0Gcnl7clr0g', panoVerifiedAt: '2026-07-27' },
  { id: 'dominicanrepublic-santodomingo-zona', lat: 18.473, lng: -69.884, label: 'Zona Colonial, Santo Domingo', country: 'Dominican Republic', continent: 'North America', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: 'DJIDkLk095s0BlgL1LHyog', panoVerifiedAt: '2026-07-27' },
  { id: 'panama-city-cascoviejo', lat: 8.953, lng: -79.535, label: 'Casco Viejo, Panama City', country: 'Panama', continent: 'North America', difficulty: 'easy', tags: ['capitals'], setting: 'urban', panoId: '6i60cARjI4hHus2AANWKAw', panoVerifiedAt: '2026-07-27' },
  { id: 'costarica-sanjose-centre', lat: 9.9333, lng: -84.08, label: 'Central San José', country: 'Costa Rica', continent: 'North America', difficulty: 'easy', tags: ['capitals'], setting: 'urban', panoId: 'tMbwRB4tNmsd02hLWvhJAQ', panoVerifiedAt: '2026-07-27' },
  { id: 'puertorico-oldsanjuan', lat: 18.4663, lng: -66.1057, label: 'Old San Juan', country: 'Puerto Rico', continent: 'North America', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: 'AW9ocRtlLCBnUM8as3p2bA', panoVerifiedAt: '2026-07-27' },
  { id: 'canada-quebeccity-chateau', lat: 46.8123, lng: -71.205, label: 'Château Frontenac, Québec City', country: 'Canada', continent: 'North America', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: 'PypgpCKbNCRHD6y-NFoeqg', panoVerifiedAt: '2026-07-27' },
  { id: 'mexico-guadalajara-centro', lat: 20.6767, lng: -103.3475, label: 'Centro Histórico, Guadalajara', country: 'Mexico', continent: 'North America', difficulty: 'easy', tags: [], setting: 'urban', panoId: 'V6d6SBowfQMah2oYLqwFrA', panoVerifiedAt: '2026-07-27' },
  { id: 'bermuda-hamilton-frontstreet', lat: 32.2949, lng: -64.782, label: 'Front Street, Hamilton', country: 'Bermuda', continent: 'North America', difficulty: 'easy', tags: ['capitals'], setting: 'urban', panoId: 'yEg8JITFgqh9a6ESoT52FA', panoVerifiedAt: '2026-07-27' },
  { id: 'bolivia-lapaz-plaza-murillo', lat: -16.4955, lng: -68.1336, label: 'Plaza Murillo, La Paz', country: 'Bolivia', continent: 'South America', difficulty: 'easy', tags: ['capitals'], setting: 'landmark', panoId: 'htl5v11uVb8wt1BCXAbKeA', panoVerifiedAt: '2026-07-27' },
  { id: 'brazil-salvador-pelourinho', lat: -12.9714, lng: -38.5124, label: 'Pelourinho, Salvador', country: 'Brazil', continent: 'South America', difficulty: 'easy', tags: ['famous'], setting: 'landmark', panoId: 'DObpWgRPw9ciKcfOe48Mvg', panoVerifiedAt: '2026-07-27' },
  { id: 'peru-lima-plaza-mayor', lat: -12.0464, lng: -77.0428, label: 'Plaza Mayor, Lima', country: 'Peru', continent: 'South America', difficulty: 'easy', tags: ['capitals'], setting: 'urban', panoId: 'ZWpSfXO6Pw0dT9cKhsoDBA', panoVerifiedAt: '2026-07-27' },
  { id: 'argentina-cordoba-centre', lat: -31.4201, lng: -64.1888, label: 'Centre of Córdoba', country: 'Argentina', continent: 'South America', difficulty: 'easy', tags: [], setting: 'urban', panoId: '74Mv--ITTRlxu825cm4g_Q', panoVerifiedAt: '2026-07-27' },
  { id: 'uruguay-montevideo-ciudadvieja', lat: -34.908, lng: -56.211, label: 'Ciudad Vieja, Montevideo', country: 'Uruguay', continent: 'South America', difficulty: 'easy', tags: ['capitals'], setting: 'urban', panoId: '0I6s3XTcAQn52Jpko9bvUQ', panoVerifiedAt: '2026-07-27' },
  { id: 'ecuador-quito-plaza-grande', lat: -0.2201, lng: -78.5123, label: 'Plaza Grande, Quito', country: 'Ecuador', continent: 'South America', difficulty: 'easy', tags: ['capitals', 'famous'], setting: 'landmark', panoId: 'Xvzntx1TUxZGQnhaQc7Z0Q', panoVerifiedAt: '2026-07-27' },
];
