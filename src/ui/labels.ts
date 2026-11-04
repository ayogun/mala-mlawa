import type { BuildingKind, HeightSource } from '../data/types';

export const KIND_LABEL: Record<BuildingKind, string> = {
  h: 'Budynek mieszkalny (dom)',
  u: 'Budynek mieszkalny',
  a: 'Budynek wielorodzinny',
  c: 'Budynek handlowo-usługowy',
  i: 'Budynek przemysłowy / magazynowy',
  p: 'Budynek użyteczności publicznej',
  r: 'Obiekt sakralny',
  s: 'Budynek gospodarczy / garaż',
  o: 'Budynek',
};

export const HEIGHT_SOURCE: Record<HeightSource, string> = {
  0: 'dane OSM',
  1: 'szacunek z liczby kondygnacji (OSM)',
  2: 'szacunek ze względu na typ budynku',
  3: 'dane GUGiK (LoD2, 2017)',
  4: 'dane GUGiK (LoD1, zbiór 2024)',
};

const FUNCTIONS: Record<string, string> = {
  place_of_worship: 'obiekt kultu religijnego',
  school: 'szkoła',
  kindergarten: 'przedszkole',
  hospital: 'szpital',
  clinic: 'przychodnia',
  townhall: 'urząd miasta',
  library: 'biblioteka',
  theatre: 'teatr',
  cinema: 'kino',
  police: 'policja',
  fire_station: 'straż pożarna',
  courthouse: 'sąd',
  bank: 'bank',
  pharmacy: 'apteka',
  restaurant: 'restauracja',
  cafe: 'kawiarnia',
  fast_food: 'gastronomia',
  supermarket: 'supermarket',
  convenience: 'sklep',
  hotel: 'hotel',
  museum: 'muzeum',
  stadium: 'stadion',
  sports_centre: 'centrum sportowe',
  water_park: 'park wodny',
  community_centre: 'dom kultury',
  post_office: 'poczta',
  fuel: 'stacja paliw',
};

export const functionLabel = (t?: string) => (t ? (FUNCTIONS[t] ?? t.replace(/_/g, ' ')) : undefined);
