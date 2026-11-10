/**
 * Module de gestion de la carte MapLibre GL JS
 * MesChampis — Grille raster 25 m principale
 */

/**
 * Calcule l'emprise bounds [sw_lon, sw_lat, ne_lon, ne_lat] en WGS84 depuis l'emprise Lambert-93
 */
export function calculerBoundsWGS84(emprise, proj4Str, margeMetres = 2000) {
  const fallback = [2.3628, 45.2612, 4.0652, 46.2737];
  if (!emprise) return fallback;
  const epsgKey = 'EPSG:2154';
  if (proj4Str && window.proj4) {
    proj4.defs(epsgKey, proj4Str);
  }
  if (!window.proj4) return fallback;
  const minx = emprise.minx - margeMetres;
  const miny = emprise.miny - margeMetres;
  const maxx = emprise.maxx + margeMetres;
  const maxy = emprise.maxy + margeMetres;
  const sw = proj4(epsgKey, 'EPSG:4326', [minx, miny]);
  const ne = proj4(epsgKey, 'EPSG:4326', [maxx, maxy]);
  return [Number(sw[0].toFixed(4)), Number(sw[1].toFixed(4)), Number(ne[0].toFixed(4)), Number(ne[1].toFixed(4))];
}

export class GestionnaireCarte {
  constructor(mapContainerId, options = {}) {
    this.mapContainerId = mapContainerId;
    this.options = options;
    this.onLoaded = options.onLoaded;
    this.onError = options.onError;

    this.map = null;
    this.activeBasemap = 'ortho'; // Photos aériennes par défaut pour observer les versants
    this.userLocationMarker = null;

    this.boundsIGN = options.bounds || (options.emprise ? calculerBoundsWGS84(options.emprise, options.proj4) : [2.3628, 45.2612, 4.0652, 46.2737]);

    this.initMap();
  }

  /**
   * Initialise la carte MapLibre avec les fonds IGN Géoplateforme
   */
  initMap() {
    const styleIGN = {
      version: 8,
      sources: {
        'plan-ign': {
          type: 'raster',
          tiles: [
            'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
          ],
          tileSize: 256,
          bounds: this.boundsIGN,
          attribution: '© <a href="https://www.ign.fr/" target="_blank">IGN</a> – Géoplateforme | <a href="https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_MNH-LIDAR-HD" target="_blank">LiDAR HD © IGN</a>'
        },
        'ortho-ign': {
          type: 'raster',
          tiles: [
            'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
          ],
          tileSize: 256,
          bounds: this.boundsIGN,
          attribution: '© <a href="https://www.ign.fr/" target="_blank">IGN</a> – Géoplateforme | <a href="https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_MNH-LIDAR-HD" target="_blank">LiDAR HD © IGN</a>'
        }
      },
      layers: [
        {
          id: 'plan-ign-layer',
          type: 'raster',
          source: 'plan-ign',
          layout: { visibility: 'none' }
        },
        {
          id: 'ortho-ign-layer',
          type: 'raster',
          source: 'ortho-ign',
          layout: { visibility: 'visible' }
        }
      ]
    };

    // Centre initial sur le Puy-de-Dôme / Chaîne des Puys
    this.map = new maplibregl.Map({
      container: this.mapContainerId,
      style: styleIGN,
      center: [2.97, 45.77],
      zoom: 12.2,
      maxZoom: 18,
      minZoom: 6,
      customAttribution: '<a href="https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_MNH-LIDAR-HD" target="_blank">LiDAR HD © IGN</a>'
    });

    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    this.map.on('load', () => {
      if (this.onLoaded) {
        this.onLoaded();
      }
    });
  }

  /**
   * Bascule entre le Plan IGN et les Photos Aériennes
   */
  changerFond(fond) {
    if (!this.map) return;
    this.activeBasemap = fond;

    const visiblePlan = fond === 'plan' ? 'visible' : 'none';
    const visibleOrtho = fond === 'ortho' ? 'visible' : 'none';

    this.map.setLayoutProperty('plan-ign-layer', 'visibility', visiblePlan);
    this.map.setLayoutProperty('ortho-ign-layer', 'visibility', visibleOrtho);

    // Adapter le contraste des contours BD Forêt
    if (this.map.getLayer('parcelles-line')) {
      if (fond === 'plan') {
        this.map.setPaintProperty('parcelles-line', 'line-color', '#0f172a');
        this.map.setPaintProperty('parcelles-line', 'line-opacity', 0.75);
      } else {
        this.map.setPaintProperty('parcelles-line', 'line-color', '#ffffff');
        this.map.setPaintProperty('parcelles-line', 'line-opacity', 0.6);
      }
    }
  }

  /**
   * Charge les contours des parcelles BD Forêt (couche secondaire, sans remplissage, masquée par défaut)
   */
  async chargerLimitesForetSecondaire(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;

      const data = await resp.json();

      if (this.map.getSource('parcelles-source')) return;

      this.map.addSource('parcelles-source', {
        type: 'geojson',
        data: data
      });

      const isPlan = this.activeBasemap === 'plan';

      // Uniquement un contour fin adapté au fond
      this.map.addLayer({
        id: 'parcelles-line',
        type: 'line',
        source: 'parcelles-source',
        layout: {
          visibility: 'visible'
        },
        paint: {
          'line-color': isPlan ? '#0f172a' : '#ffffff',
          'line-width': 0.8,
          'line-opacity': isPlan ? 0.75 : 0.6
        }
      });

      console.info('[Carte] Contours BD Forêt chargés et affichés.');
    } catch (err) {
      console.warn('[Carte] Impossible de charger parcelles.geojson pour les contours :', err);
    }
  }

  /**
   * Active ou désactive la visibilité des limites BD Forêt (chargement différé)
   */
  setLimitesVisibles(visible) {
    if (!this.map) return;
    if (visible) {
      if (!this.map.getSource('parcelles-source')) {
        this.chargerLimitesForetSecondaire('data/parcelles.geojson');
        return;
      }
      this.map.setLayoutProperty('parcelles-line', 'visibility', 'visible');
    } else {
      if (this.map.getLayer('parcelles-line')) {
        this.map.setLayoutProperty('parcelles-line', 'visibility', 'none');
      }
    }
  }

  /**
   * Géolocalisation locale (GPS local uniquement)
   */
  activerGeolocalisation() {
    if (!('geolocation' in navigator)) {
      alert("La géolocalisation n'est pas prise en charge par votre navigateur.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;

        if (!this.userLocationMarker) {
          const el = document.createElement('div');
          el.className = 'user-location-marker';
          this.userLocationMarker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(this.map);
        } else {
          this.userLocationMarker.setLngLat([lng, lat]);
        }

        this.map.flyTo({
          center: [lng, lat],
          zoom: 14,
          speed: 1.2
        });
      },
      (err) => {
        console.warn('Erreur géolocalisation :', err);
        alert(`Impossible d'obtenir votre position : ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }
}
