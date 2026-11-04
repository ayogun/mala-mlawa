export interface AdventBusiness {
  id: string;
  name: string;
  description: string;
  address: string;
  latitude: number;
  longitude: number;
  buildingOsmId?: number;
  sponsor?: boolean;
}

export interface AdventOffer {
  day: number;
  business: AdventBusiness;
  discount: string;
  example: boolean;
  coupon?: string;
  terms?: string;
  validThrough?: string;
}

export const ADVENT_YEAR = 2026;

const HI_GIRLS: AdventBusiness = {
  id: 'hi-girls', name: 'Hi Girls Hair Salon', sponsor: true,
  description: 'Salon fryzjerski przy alei Piłsudskiego w Mławie. Hi Girls jest głównym sponsorem kalendarza i zaprasza na złoty dzień co tydzień.',
  address: 'al. Józefa Piłsudskiego 35/48, Mława',
  latitude: 53.1211729, longitude: 20.3651528, buildingOsmId: 671988950,
};

const businesses: Record<string, AdventBusiness> = {
  tradycja: {
    id: 'tradycja', name: 'Restauracja Tradycja',
    description: 'Restauracja w Mławie, w której można spróbować dań kuchni polskiej.',
    address: 'ul. Henryka Sienkiewicza 21, Mława',
    latitude: 53.1095170, longitude: 20.3737360, buildingOsmId: 300919221,
  },
  tesali: {
    id: 'tesali', name: 'Restauracja Tesali',
    description: 'Restauracja przy ulicy Poświętnej, niedaleko centrum Mławy.',
    address: 'ul. Poświętna 3a, Mława',
    latitude: 53.1130426, longitude: 20.3852924, buildingOsmId: 367879204,
  },
  benka: {
    id: 'benka', name: 'Pizzeria u Benka',
    description: 'Mławska pizzeria przy ulicy Płockiej.',
    address: 'ul. Płocka 39, Mława',
    latitude: 53.1082652, longitude: 20.3782325,
  },
  peperoni: {
    id: 'peperoni', name: 'Peperoni Pizza & Drink',
    description: 'Pizzeria i restauracja przy ulicy Długiej.',
    address: 'ul. Długa 2, Mława',
    latitude: 53.1113903, longitude: 20.3792407, buildingOsmId: 300819555,
  },
  dapur: {
    id: 'dapur', name: 'Dapur Omah',
    description: 'Restauracja serwująca dania kuchni indonezyjskiej.',
    address: 'ul. Franciszka Żwirki 26D, Mława',
    latitude: 53.1147286, longitude: 20.3778828,
  },
  kokumo: {
    id: 'kokumo', name: 'Kokumo Cafe',
    description: 'Kawiarnia przy ulicy Sądowej. Oprócz kawy można tu znaleźć śniadania i coś słodkiego.',
    address: 'ul. Sądowa 10, Mława',
    latitude: 53.1141652, longitude: 20.3777862, buildingOsmId: 367154856,
  },
  dhaka: {
    id: 'dhaka', name: 'Dhaka Curry Masala',
    description: 'Restauracja przy ulicy Kopernika, znana z dań curry.',
    address: 'ul. Mikołaja Kopernika 55B, Mława',
    latitude: 53.1212622, longitude: 20.3768681, buildingOsmId: 369301628,
  },
  ilPrimo: {
    id: 'il-primo', name: 'Il Primo Ristorante Italiano',
    description: 'Włoska restauracja przy alei Piłsudskiego.',
    address: 'al. Józefa Piłsudskiego 41/68, Mława',
    latitude: 53.1220188, longitude: 20.3624307, buildingOsmId: 701013733,
  },
  olka: {
    id: 'ol-ka', name: 'Ol-Ka Obiady Domowe',
    description: 'Lokal z domowymi obiadami przy ulicy Żwirki.',
    address: 'ul. Franciszka Żwirki 33, Mława',
    latitude: 53.1152283, longitude: 20.3761716, buildingOsmId: 700727235,
  },
  gary: {
    id: 'gary-babci-krysi', name: 'Mławskie Gary Babci Krysi',
    description: 'Miejsce z domowymi obiadami przy ulicy Reymonta. To także inicjatywa społeczna wspierająca zatrudnienie osób starszych.',
    address: 'ul. Władysława Reymonta 10, Mława',
    latitude: 53.1129707, longitude: 20.3776023, buildingOsmId: 300826874,
  },
  united: {
    id: 'united-chicken', name: 'United Chicken Mława',
    description: 'Lokal z daniami z kurczaka przy ulicy Ordona.',
    address: 'ul. Juliusza Ordona 25/1, Mława',
    latitude: 53.1109995, longitude: 20.3720996, buildingOsmId: 1016199065,
  },
  budki: {
    id: 'budki-smakow', name: 'Budki Smaków',
    description: 'Lokal przy ulicy Sienkiewicza serwujący m.in. kebab i kurczaka z rożna.',
    address: 'ul. Henryka Sienkiewicza 24, Mława',
    latitude: 53.1107510, longitude: 20.3732056, buildingOsmId: 39721714,
  },
  bari: {
    id: 'kebab-bari', name: 'Kebab Bari',
    description: 'Lokal gastronomiczny na Osiedlu Młodych.',
    address: 'Osiedle Młodych 32, Mława',
    latitude: 53.1205530, longitude: 20.3684739, buildingOsmId: 363225874,
  },
  alif: {
    id: 'alif-kebab', name: 'Alif Kebab',
    description: 'Lokal z kebabem przy Starym Rynku, w centrum Mławy.',
    address: 'Stary Rynek 4, Mława',
    latitude: 53.1123703, longitude: 20.3833338, buildingOsmId: 285927375,
  },
  mrBurger: {
    id: 'mr-burger', name: 'Mr. Burger Mława',
    description: 'Burgerownia przy ulicy Powstańców Styczniowych.',
    address: 'ul. Powstańców Styczniowych 5A, Mława',
    latitude: 53.1075283, longitude: 20.3761877,
  },
  pizza105: {
    id: 'pizzeria-105', name: 'Pizzeria 105',
    description: 'Pizzeria przy ulicy Żwirki w Mławie.',
    address: 'ul. Franciszka Żwirki 33A, Mława',
    latitude: 53.1153801, longitude: 20.3759535, buildingOsmId: 300936955,
  },
  asia: {
    id: 'bar-asia', name: 'Bar Asia',
    description: 'Bar na Osiedlu Młodych, serwujący dania kuchni azjatyckiej.',
    address: 'Osiedle Młodych 19, Mława',
    latitude: 53.1199144, longitude: 20.3688938,
  },
  zakrecone: {
    id: 'zakrecone', name: 'Zakręcone',
    description: 'Lokal przy ulicy Długiej, w którym można znaleźć desery i słodkości.',
    address: 'ul. Długa 20, Mława',
    latitude: 53.1088607, longitude: 20.3787472,
  },
  fantazja: {
    id: 'cukiernia-fantazja', name: 'Cukiernia Fantazja',
    description: 'Mławska cukiernia przy ulicy 3 Maja. Rodzinna firma działa od 1984 roku i przygotowuje tradycyjne wypieki.',
    address: 'ul. 3 Maja 6, Mława',
    latitude: 53.1123923, longitude: 20.3810946, buildingOsmId: 701426596,
  },
  seito: {
    id: 'seito-sushi', name: 'Seito Sushi',
    description: 'Lokal z sushi na Osiedlu Młodych.',
    address: 'Osiedle Młodych 26, Mława',
    latitude: 53.1202842, longitude: 20.3684515,
  },
};

const example = (day: number, business: AdventBusiness, discount = '10% na zamówienie'): AdventOffer => ({
  day, business, discount, example: true,
});

export const ADVENT_OFFERS: AdventOffer[] = [
  example(1, HI_GIRLS, '30% na usługę'),
  example(2, businesses.tradycja),
  example(3, businesses.tesali, '15% na posiłek'),
  example(4, businesses.benka, '10% na pizzę'),
  example(5, businesses.peperoni, '15% na zamówienie'),
  example(6, businesses.dapur),
  example(7, businesses.kokumo, '10% na kawę i słodkości'),
  example(8, HI_GIRLS, '30% na usługę'),
  example(9, businesses.dhaka),
  example(10, businesses.ilPrimo, '15% na posiłek'),
  example(11, businesses.olka),
  example(12, businesses.gary, '10% na obiad'),
  example(13, businesses.united),
  example(14, businesses.budki),
  example(15, HI_GIRLS, '30% na usługę'),
  example(16, businesses.bari),
  example(17, businesses.alif),
  example(18, businesses.mrBurger, '10% na burgera'),
  example(19, businesses.pizza105, '10% na pizzę'),
  example(20, businesses.asia),
  example(21, businesses.zakrecone, '10% na słodkości'),
  example(22, HI_GIRLS, '30% na usługę'),
  example(23, businesses.fantazja, '10% na słodkości'),
  example(24, businesses.seito, '15% na zamówienie'),
];
