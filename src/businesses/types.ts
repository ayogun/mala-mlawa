export interface Business {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  named: boolean;
  source: 'osm' | 'manual';
  address?: string;
}

export interface BusinessDataset {
  updated: string;
  attribution: string;
  license: string;
  businesses: Business[];
}
