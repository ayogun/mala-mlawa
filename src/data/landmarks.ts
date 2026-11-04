// Landmark configuration. Add or edit entries freely — they are resolved against building
// footprints at runtime (no re-run of the data pipeline needed).
//
// Only facts that can be verified from open data should go into `description`.
// `customModel` is a hook for a future hand-made GLB (path relative to /public); unused for now.

export type LandmarkCategory = 'kultura' | 'sakralne' | 'urząd' | 'natura' | 'sport' | 'historia' | 'usługi' | 'inne';

export interface Landmark {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description?: string;
  category?: LandmarkCategory;
  customModel?: string;
  /** OSM way id (or negative relation id) of the building; optional, improves matching */
  osmId?: number;
}

const OSM = 'Dane: OpenStreetMap.';

export const LANDMARKS: Landmark[] = [
  { id: 'urzad-miasta', name: 'Urząd Miasta', latitude: 53.11161, longitude: 20.38297, osmId: 247801441, category: 'urząd',
    description: `Siedziba urzędu miasta. W OpenStreetMap budynek datowany na koniec XVIII wieku. ${OSM}` },
  { id: 'kosciol-trojcy', name: 'Kościół pw. Świętej Trójcy', latitude: 53.11181, longitude: 20.38248, osmId: 150836816, category: 'sakralne',
    description: `Kościół w centrum miasta. W OpenStreetMap datowany na koniec XIX wieku. ${OSM}` },
  { id: 'kosciol-wawrzynca', name: 'Kościół pw. św. Wawrzyńca', latitude: 53.11015, longitude: 20.38913, osmId: 150836827, category: 'sakralne',
    description: `Kościół parafialny. W OpenStreetMap datowany na koniec XVIII wieku. ${OSM}` },
  { id: 'kosciol-rodziny', name: 'Kościół pw. Świętej Rodziny', latitude: 53.12045, longitude: 20.37804, osmId: 151060451, category: 'sakralne' },
  { id: 'kosciol-jana-kantego', name: 'Kościół pw. św. Jana Kantego', latitude: 53.12812, longitude: 20.35503, osmId: 151060452, category: 'sakralne' },
  { id: 'kosciol-mb-krolowej', name: 'Kościół pw. Matki Bożej Królowej Polski', latitude: 53.11078, longitude: 20.36729, osmId: 300900664, category: 'sakralne' },
  { id: 'muzeum', name: 'Muzeum Ziemi Zawkrzeńskiej', latitude: 53.11219, longitude: 20.38013, category: 'kultura',
    description: `Muzeum regionalne. ${OSM}` },
  { id: 'biblioteka', name: 'Biblioteka Publiczna im. B. Prusa', latitude: 53.1122, longitude: 20.37982, category: 'kultura',
    description: `Biblioteka miejska. ${OSM}` },
  { id: 'amfiteatr', name: 'Amfiteatr', latitude: 53.11277, longitude: 20.37814, osmId: 300827468, category: 'kultura',
    description: `Scena plenerowa w Parku Miejskim. ${OSM}` },
  { id: 'park-miejski', name: 'Park Miejski im. Marszałka Józefa Piłsudskiego', latitude: 53.11248, longitude: 20.37716, category: 'natura',
    description: `Park w centrum miasta. W OpenStreetMap z datą 1880. ${OSM}` },
  { id: 'pomnik-pilsudskiego', name: 'Pomnik Józefa Piłsudskiego', latitude: 53.1124, longitude: 20.37871, category: 'historia' },
  { id: 'stacja', name: 'Stacja kolejowa Mława', latitude: 53.12608, longitude: 20.35096, category: 'usługi',
    description: `Stacja kolejowa. ${OSM}` },
  { id: 'szpital', name: 'Szpital', latitude: 53.12321, longitude: 20.37072, osmId: 320669430, category: 'usługi',
    description: `Samodzielny Publiczny Zakład Opieki Zdrowotnej. ${OSM}` },
  { id: 'hala-sportowa', name: 'Mławska Hala Sportowa', latitude: 53.12002, longitude: 20.36558, osmId: 354670420, category: 'sport' },
  { id: 'stadion', name: 'Stadion MKS Mławianka', latitude: 53.12413, longitude: 20.37954, osmId: 151060457, category: 'sport' },
  { id: 'mini-teznia', name: 'Mini-tężnia', latitude: 53.12546, longitude: 20.34926, osmId: 980790461, category: 'natura',
    description: `Atrakcja w zachodniej części miasta. ${OSM}` },
  { id: 'kopiec', name: 'Kopiec Tadeusza Kościuszki', latitude: 53.12876, longitude: 20.35433, category: 'historia',
    description: `Kopiec pamiątkowy. ${OSM}` },
  { id: 'mauzoleum', name: 'Mauzoleum rozstrzelanych Polaków', latitude: 53.10369, longitude: 20.36117, osmId: -19591852, category: 'historia',
    description: `Miejsce pamięci. ${OSM}` },
  { id: 'schron', name: 'Schron bojowy, Pozycja Mławska', latitude: 53.1426, longitude: 20.34841, category: 'historia',
    description: `Schron z 1939 roku należący do Pozycji Mławskiej. ${OSM}` },
];
