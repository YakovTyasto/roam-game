import type { Page } from '@playwright/test';

/**
 * Serve a tiny stand-in for the Google Maps JS API.
 *
 * Why this exists: every in-game browser test (exit confirmation, Daily resume,
 * Country Streak, share fallback) needs the app to get *past* the panorama, and
 * the real API cannot be used in CI — it is billable, it needs a real key, and
 * a sandbox has no route to maps.googleapis.com. Stubbing at the network layer
 * keeps the app code under test completely unmodified: it still creates exactly
 * one `StreetViewPanorama`, still calls `setPano`/`setPov`, and still resolves
 * panoramas through `StreetViewService`.
 *
 * The stub only implements the surface the app actually touches (see
 * src/components/street/StreetView.tsx and src/multiplayer/resolvePanorama.ts).
 * If a test starts failing with "undefined is not a function" on a
 * `google.maps.*` symbol, that means production code reached for something new
 * — add it here deliberately rather than widening the stub speculatively.
 *
 * `window.__roamStub.panoramas` records every instance and every `setPano`
 * call, which is what lets a test assert the single-instance cost guarantee
 * from a real browser instead of trusting a code review.
 */
export async function installGoogleMapsStub(page: Page): Promise<void> {
  await page.route('https://maps.googleapis.com/maps/api/js*', async (route) => {
    const callback = new URL(route.request().url()).searchParams.get('callback') ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: mapsStubSource(callback),
    });
  });

  // Leaflet's OSM tiles: harmless but slow and noisy offline. A 1×1 PNG keeps
  // the map behaving normally (tiles "load", no error events) with no network.
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(TRANSPARENT_PNG_BASE64, 'base64'),
    }),
  );
}

const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function mapsStubSource(callbackName: string): string {
  return `
(function () {
  var stub = (window.__roamStub = window.__roamStub || {});
  stub.panoramas = [];
  stub.panoLookups = 0;

  function StreetViewPanorama(container, opts) {
    var self = this;
    this.container = container;
    this.options = opts || {};
    this.pano = null;
    this.pov = { heading: 0, pitch: 0 };
    this.zoom = 0;
    this.visible = opts && opts.visible === true;
    this.setPanoCalls = [];

    container.setAttribute('data-stub-panorama', 'true');
    var face = document.createElement('div');
    face.setAttribute('data-testid', 'stub-panorama');
    face.style.cssText =
      'position:absolute;inset:0;display:grid;place-items:center;color:#fff;' +
      'font:600 14px/1.4 system-ui;background:' +
      'linear-gradient(160deg,#1d3b2a,#0f2018 60%,#132c1f);';
    face.textContent = 'Street View (test stub)';
    container.appendChild(face);
    this.face = face;

    stub.panoramas.push(this);

    this.setPano = function (id) {
      self.pano = id;
      self.setPanoCalls.push(id);
      face.setAttribute('data-pano', String(id));
    };
    this.getPano = function () { return self.pano; };
    this.setPov = function (pov) { self.pov = pov; };
    this.getPov = function () { return self.pov; };
    this.setZoom = function (z) { self.zoom = z; };
    this.setVisible = function (v) {
      self.visible = !!v;
      face.style.opacity = v ? '1' : '0';
    };
    this.getVisible = function () { return self.visible; };
    this.addListener = function () { return { remove: function () {} }; };
    this.setOptions = function (next) { Object.assign(self.options, next || {}); };
  }

  function StreetViewService() {
    this.getPanorama = function (request, callback) {
      stub.panoLookups += 1;
      // Derive a stable, obviously-fake pano id from the requested point so
      // different rounds get different ids (the app keys effects on pano id).
      var loc = request && request.location ? request.location : { lat: 0, lng: 0 };
      var id =
        'STUB_' +
        String(Math.round(Number(loc.lat) * 1000)) +
        '_' +
        String(Math.round(Number(loc.lng) * 1000));
      if (stub.noPanorama) {
        callback(null, 'ZERO_RESULTS');
        return;
      }
      callback({ location: { pano: id, latLng: loc } }, 'OK');
    };
  }

  window.google = window.google || {};
  window.google.maps = Object.assign(window.google.maps || {}, {
    StreetViewPanorama: StreetViewPanorama,
    StreetViewService: StreetViewService,
    StreetViewStatus: { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS', UNKNOWN_ERROR: 'UNKNOWN_ERROR' },
    StreetViewSource: { DEFAULT: 'default', OUTDOOR: 'outdoor' },
    StreetViewPreference: { BEST: 'best', NEAREST: 'nearest' },
  });

  ${callbackName ? `if (typeof window[${JSON.stringify(callbackName)}] === 'function') window[${JSON.stringify(callbackName)}]();` : ''}
})();
`;
}
