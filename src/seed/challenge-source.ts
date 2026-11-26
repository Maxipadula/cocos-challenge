// Transcribed from prisma/fixtures/real-database.sql. That file stays the
// reference and is never executed. Literals keep the script's values; the
// development transform applies the approved adjustments.

export type ChallengeUser = {
  readonly serial: number;
  readonly email: string;
  readonly accountNumber: string;
};

export type ChallengeInstrument = {
  readonly serial: number;
  readonly ticker: string;
  readonly name: string;
  readonly type: 'ACCIONES' | 'MONEDA';
};

export type ChallengeMarketRow = {
  readonly serial: number;
  readonly instrumentSerial: number;
  readonly date: string;
  readonly open: string | null;
  readonly high: string | null;
  readonly low: string | null;
  readonly close: string;
  readonly previousClose: string;
};

export type ChallengeOrder = {
  readonly serial: number;
  readonly instrumentSerial: number;
  readonly userSerial: number;
  readonly size: string;
  readonly price: string;
  readonly side: 'BUY' | 'SELL' | 'CASH_IN' | 'CASH_OUT';
  readonly status: 'NEW' | 'FILLED' | 'REJECTED' | 'CANCELLED';
  readonly type: 'MARKET' | 'LIMIT';
  readonly datetime: string;
};

export const challengeUsers: readonly ChallengeUser[] = [
  {
    "serial": 1,
    "email": "emiliano@test.com",
    "accountNumber": "10001"
  },
  {
    "serial": 2,
    "email": "jose@test.com",
    "accountNumber": "10002"
  },
  {
    "serial": 3,
    "email": "francisco@test.com",
    "accountNumber": "10003"
  },
  {
    "serial": 4,
    "email": "juan@test.com",
    "accountNumber": "10004"
  }
];

export const challengeInstruments: readonly ChallengeInstrument[] = [
  {
    "serial": 1,
    "ticker": "DYCA",
    "name": "Dycasa S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 2,
    "ticker": "CAPX",
    "name": "Capex S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 3,
    "ticker": "PGR",
    "name": "Phoenix Global Resources",
    "type": "ACCIONES"
  },
  {
    "serial": 4,
    "ticker": "MOLA",
    "name": "Molinos Agro S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 5,
    "ticker": "MIRG",
    "name": "Mirgor",
    "type": "ACCIONES"
  },
  {
    "serial": 6,
    "ticker": "PATA",
    "name": "Importadora y Exportadora de la Patagonia",
    "type": "ACCIONES"
  },
  {
    "serial": 7,
    "ticker": "TECO2",
    "name": "Telecom",
    "type": "ACCIONES"
  },
  {
    "serial": 8,
    "ticker": "FERR",
    "name": "Ferrum S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 9,
    "ticker": "SAMI",
    "name": "S.A San Miguel",
    "type": "ACCIONES"
  },
  {
    "serial": 10,
    "ticker": "IRCP",
    "name": "IRSA Propiedades Comerciales S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 11,
    "ticker": "GAMI",
    "name": "Boldt Gaming S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 12,
    "ticker": "DOME",
    "name": "Domec",
    "type": "ACCIONES"
  },
  {
    "serial": 13,
    "ticker": "INTR",
    "name": "Compañía Introductora de Buenos Aires S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 14,
    "ticker": "MTR",
    "name": "Matba Rofex S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 15,
    "ticker": "FIPL",
    "name": "Fiplasto",
    "type": "ACCIONES"
  },
  {
    "serial": 16,
    "ticker": "GARO",
    "name": "Garovaglio Y Zorraquín",
    "type": "ACCIONES"
  },
  {
    "serial": 17,
    "ticker": "SEMI",
    "name": "Molinos Juan Semino",
    "type": "ACCIONES"
  },
  {
    "serial": 18,
    "ticker": "HARG",
    "name": "Holcim (Argentina) S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 19,
    "ticker": "BPAT",
    "name": "Banco Patagonia",
    "type": "ACCIONES"
  },
  {
    "serial": 20,
    "ticker": "RIGO",
    "name": "Rigolleau S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 21,
    "ticker": "CVH",
    "name": "Cablevision Holding",
    "type": "ACCIONES"
  },
  {
    "serial": 22,
    "ticker": "BBAR",
    "name": "Banco Frances",
    "type": "ACCIONES"
  },
  {
    "serial": 23,
    "ticker": "LEDE",
    "name": "Ledesma",
    "type": "ACCIONES"
  },
  {
    "serial": 24,
    "ticker": "CELU",
    "name": "Celulosa Argentina S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 25,
    "ticker": "CECO2",
    "name": "Central Costanera",
    "type": "ACCIONES"
  },
  {
    "serial": 26,
    "ticker": "AGRO",
    "name": "Agrometal",
    "type": "ACCIONES"
  },
  {
    "serial": 27,
    "ticker": "AUSO",
    "name": "Autopistas del Sol",
    "type": "ACCIONES"
  },
  {
    "serial": 28,
    "ticker": "BHIP",
    "name": "Banco Hipotecario S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 29,
    "ticker": "BOLT",
    "name": "Boldt S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 30,
    "ticker": "CARC",
    "name": "Carboclor S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 31,
    "ticker": "BMA",
    "name": "Banco Macro S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 32,
    "ticker": "CRES",
    "name": "Cresud S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 33,
    "ticker": "EDN",
    "name": "Edenor S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 34,
    "ticker": "GGAL",
    "name": "Grupo Financiero Galicia",
    "type": "ACCIONES"
  },
  {
    "serial": 35,
    "ticker": "DGCU2",
    "name": "Distribuidora De Gas Cuyano S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 36,
    "ticker": "GBAN",
    "name": "Gas Natural Ban S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 37,
    "ticker": "CGPA2",
    "name": "Camuzzi Gas del Sur",
    "type": "ACCIONES"
  },
  {
    "serial": 38,
    "ticker": "CADO",
    "name": "Carlos Casado",
    "type": "ACCIONES"
  },
  {
    "serial": 39,
    "ticker": "GCLA",
    "name": "Grupo Clarin S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 40,
    "ticker": "GRIM",
    "name": "Grimoldi",
    "type": "ACCIONES"
  },
  {
    "serial": 41,
    "ticker": "RICH",
    "name": "Laboratorios Richmond",
    "type": "ACCIONES"
  },
  {
    "serial": 42,
    "ticker": "MOLI",
    "name": "Molinos Río de la Plata",
    "type": "ACCIONES"
  },
  {
    "serial": 43,
    "ticker": "VALO",
    "name": "BCO DE VALORES ACCIONES ORD.",
    "type": "ACCIONES"
  },
  {
    "serial": 44,
    "ticker": "TGNO4",
    "name": "Transportadora de Gas del Norte",
    "type": "ACCIONES"
  },
  {
    "serial": 45,
    "ticker": "LOMA",
    "name": "Loma Negra S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 46,
    "ticker": "IRSA",
    "name": "IRSA Inversiones y Representaciones S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 47,
    "ticker": "PAMP",
    "name": "Pampa Holding S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 48,
    "ticker": "TGSU2",
    "name": "Transportadora de Gas del Sur",
    "type": "ACCIONES"
  },
  {
    "serial": 49,
    "ticker": "TXAR",
    "name": "Ternium Argentina S.A",
    "type": "ACCIONES"
  },
  {
    "serial": 50,
    "ticker": "YPFD",
    "name": "Y.P.F. S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 51,
    "ticker": "MORI",
    "name": "Morixe Hermanos S.A.C.I.",
    "type": "ACCIONES"
  },
  {
    "serial": 52,
    "ticker": "INVJ",
    "name": "Inversora Juramento S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 53,
    "ticker": "POLL",
    "name": "Polledo S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 54,
    "ticker": "METR",
    "name": "MetroGAS S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 55,
    "ticker": "LONG",
    "name": "Longvie",
    "type": "ACCIONES"
  },
  {
    "serial": 56,
    "ticker": "SUPV",
    "name": "Grupo Supervielle S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 57,
    "ticker": "ROSE",
    "name": "Instituto Rosenbusch",
    "type": "ACCIONES"
  },
  {
    "serial": 58,
    "ticker": "OEST",
    "name": "Oeste Grupo Concesionario",
    "type": "ACCIONES"
  },
  {
    "serial": 59,
    "ticker": "COME",
    "name": "Sociedad Comercial Del Plata",
    "type": "ACCIONES"
  },
  {
    "serial": 60,
    "ticker": "CEPU",
    "name": "Central Puerto",
    "type": "ACCIONES"
  },
  {
    "serial": 61,
    "ticker": "ALUA",
    "name": "Aluar Aluminio Argentino S.A.I.C.",
    "type": "ACCIONES"
  },
  {
    "serial": 62,
    "ticker": "CTIO",
    "name": "Consultatio S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 63,
    "ticker": "TRAN",
    "name": "Transener S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 64,
    "ticker": "HAVA",
    "name": "Havanna Holding",
    "type": "ACCIONES"
  },
  {
    "serial": 65,
    "ticker": "BYMA",
    "name": "Bolsas y Mercados Argentinos S.A.",
    "type": "ACCIONES"
  },
  {
    "serial": 66,
    "ticker": "ARS",
    "name": "PESOS",
    "type": "MONEDA"
  }
];

export const challengeMarketRows: readonly ChallengeMarketRow[] = [
  {
    "serial": 1,
    "instrumentSerial": 12,
    "date": "2023-07-13",
    "open": null,
    "high": null,
    "low": null,
    "close": "20.5",
    "previousClose": "20.5"
  },
  {
    "serial": 2,
    "instrumentSerial": 35,
    "date": "2023-07-13",
    "open": "337.5",
    "high": "342.5",
    "low": "328.5",
    "close": "341.5",
    "previousClose": "335"
  },
  {
    "serial": 3,
    "instrumentSerial": 54,
    "date": "2023-07-13",
    "open": "232",
    "high": "232",
    "low": "222.5",
    "close": "232",
    "previousClose": "229"
  },
  {
    "serial": 4,
    "instrumentSerial": 51,
    "date": "2023-07-13",
    "open": "35.9",
    "high": "36.55",
    "low": "35.75",
    "close": "35.95",
    "previousClose": "35.9"
  },
  {
    "serial": 5,
    "instrumentSerial": 52,
    "date": "2023-07-13",
    "open": "105",
    "high": "105",
    "low": "98.5",
    "close": "99.7",
    "previousClose": "103"
  },
  {
    "serial": 6,
    "instrumentSerial": 60,
    "date": "2023-07-13",
    "open": "358",
    "high": "365.95",
    "low": "354.45",
    "close": "364.8",
    "previousClose": "353.45"
  },
  {
    "serial": 7,
    "instrumentSerial": 31,
    "date": "2023-07-13",
    "open": "1425",
    "high": "1541",
    "low": "1415",
    "close": "1520.25",
    "previousClose": "1413.5"
  },
  {
    "serial": 8,
    "instrumentSerial": 40,
    "date": "2023-07-13",
    "open": "400",
    "high": "400",
    "low": "395",
    "close": "397.5",
    "previousClose": "400"
  },
  {
    "serial": 9,
    "instrumentSerial": 4,
    "date": "2023-07-13",
    "open": "6940",
    "high": "7044",
    "low": "6561",
    "close": "6621.5",
    "previousClose": "6659.5"
  },
  {
    "serial": 10,
    "instrumentSerial": 37,
    "date": "2023-07-13",
    "open": "407",
    "high": "409",
    "low": "388.5",
    "close": "400.5",
    "previousClose": "408"
  },
  {
    "serial": 11,
    "instrumentSerial": 44,
    "date": "2023-07-13",
    "open": "668",
    "high": "669.5",
    "low": "655",
    "close": "668",
    "previousClose": "658"
  },
  {
    "serial": 12,
    "instrumentSerial": 63,
    "date": "2023-07-13",
    "open": "367.5",
    "high": "378",
    "low": "366",
    "close": "373",
    "previousClose": "367.5"
  },
  {
    "serial": 13,
    "instrumentSerial": 18,
    "date": "2023-07-13",
    "open": "500",
    "high": "525",
    "low": "494",
    "close": "515.5",
    "previousClose": "498"
  },
  {
    "serial": 14,
    "instrumentSerial": 30,
    "date": "2023-07-13",
    "open": "6.7",
    "high": "6.8",
    "low": "6.66",
    "close": "6.75",
    "previousClose": "6.64"
  },
  {
    "serial": 15,
    "instrumentSerial": 25,
    "date": "2023-07-13",
    "open": "188",
    "high": "195",
    "low": "187",
    "close": "192.75",
    "previousClose": "187.5"
  },
  {
    "serial": 16,
    "instrumentSerial": 19,
    "date": "2023-07-13",
    "open": "273",
    "high": "295",
    "low": "266",
    "close": "289",
    "previousClose": "273"
  },
  {
    "serial": 17,
    "instrumentSerial": 6,
    "date": "2023-07-13",
    "open": "245",
    "high": "256",
    "low": "241.25",
    "close": "251.5",
    "previousClose": "247.25"
  },
  {
    "serial": 18,
    "instrumentSerial": 11,
    "date": "2023-07-13",
    "open": "86.5",
    "high": "86.5",
    "low": "84",
    "close": "86",
    "previousClose": "86.4"
  },
  {
    "serial": 19,
    "instrumentSerial": 17,
    "date": "2023-07-13",
    "open": "53",
    "high": "54",
    "low": "51.5",
    "close": "53.2",
    "previousClose": "52"
  },
  {
    "serial": 20,
    "instrumentSerial": 64,
    "date": "2023-07-13",
    "open": "1107",
    "high": "1170",
    "low": "1107",
    "close": "1163",
    "previousClose": "1122"
  },
  {
    "serial": 21,
    "instrumentSerial": 21,
    "date": "2023-07-13",
    "open": "1567",
    "high": "1660",
    "low": "1562",
    "close": "1656",
    "previousClose": "1562"
  },
  {
    "serial": 22,
    "instrumentSerial": 23,
    "date": "2023-07-13",
    "open": "307",
    "high": "348",
    "low": "298",
    "close": "337",
    "previousClose": "304"
  },
  {
    "serial": 23,
    "instrumentSerial": 39,
    "date": "2023-07-13",
    "open": "450",
    "high": "460",
    "low": "433",
    "close": "449.65",
    "previousClose": "447.75"
  },
  {
    "serial": 24,
    "instrumentSerial": 1,
    "date": "2023-07-13",
    "open": "268",
    "high": "268",
    "low": "255",
    "close": "260",
    "previousClose": "264"
  },
  {
    "serial": 25,
    "instrumentSerial": 8,
    "date": "2023-07-13",
    "open": "38.15",
    "high": "38.5",
    "low": "37",
    "close": "37.55",
    "previousClose": "38.15"
  },
  {
    "serial": 26,
    "instrumentSerial": 58,
    "date": "2023-07-13",
    "open": "217",
    "high": "220.5",
    "low": "217",
    "close": "220",
    "previousClose": "217.5"
  },
  {
    "serial": 27,
    "instrumentSerial": 14,
    "date": "2023-07-13",
    "open": "617",
    "high": "617",
    "low": "612.5",
    "close": "615",
    "previousClose": "612.5"
  },
  {
    "serial": 28,
    "instrumentSerial": 2,
    "date": "2023-07-13",
    "open": "1850",
    "high": "1930",
    "low": "1850",
    "close": "1918",
    "previousClose": "1885.5"
  },
  {
    "serial": 29,
    "instrumentSerial": 29,
    "date": "2023-07-13",
    "open": "8.8",
    "high": "8.9",
    "low": "8.72",
    "close": "8.79",
    "previousClose": "8.76"
  },
  {
    "serial": 30,
    "instrumentSerial": 36,
    "date": "2023-07-13",
    "open": "330",
    "high": "330",
    "low": "311",
    "close": "323",
    "previousClose": "325"
  },
  {
    "serial": 31,
    "instrumentSerial": 27,
    "date": "2023-07-13",
    "open": "640",
    "high": "640",
    "low": "615",
    "close": "623",
    "previousClose": "631.5"
  },
  {
    "serial": 32,
    "instrumentSerial": 62,
    "date": "2023-07-13",
    "open": "535",
    "high": "535",
    "low": "495",
    "close": "519",
    "previousClose": "530"
  },
  {
    "serial": 33,
    "instrumentSerial": 15,
    "date": "2023-07-13",
    "open": "64",
    "high": "66",
    "low": "64",
    "close": "66",
    "previousClose": "65"
  },
  {
    "serial": 34,
    "instrumentSerial": 13,
    "date": "2023-07-13",
    "open": "75",
    "high": "75",
    "low": "75",
    "close": "75",
    "previousClose": "72.3"
  },
  {
    "serial": 35,
    "instrumentSerial": 26,
    "date": "2023-07-13",
    "open": "134.25",
    "high": "140",
    "low": "132",
    "close": "138",
    "previousClose": "136.75"
  },
  {
    "serial": 36,
    "instrumentSerial": 24,
    "date": "2023-07-13",
    "open": "309",
    "high": "313.5",
    "low": "302",
    "close": "310",
    "previousClose": "306.5"
  },
  {
    "serial": 37,
    "instrumentSerial": 32,
    "date": "2023-07-13",
    "open": "415",
    "high": "430",
    "low": "408.3",
    "close": "429.45",
    "previousClose": "405.1"
  },
  {
    "serial": 38,
    "instrumentSerial": 22,
    "date": "2023-07-13",
    "open": "1039",
    "high": "1076.9",
    "low": "1031",
    "close": "1062.2",
    "previousClose": "1020.9"
  },
  {
    "serial": 39,
    "instrumentSerial": 57,
    "date": "2023-07-13",
    "open": "21.4",
    "high": "21.4",
    "low": "21.4",
    "close": "21.4",
    "previousClose": "21.4"
  },
  {
    "serial": 40,
    "instrumentSerial": 9,
    "date": "2023-07-13",
    "open": "313",
    "high": "315",
    "low": "305",
    "close": "310",
    "previousClose": "313"
  },
  {
    "serial": 41,
    "instrumentSerial": 65,
    "date": "2023-07-13",
    "open": "363.5",
    "high": "368",
    "low": "360",
    "close": "362",
    "previousClose": "360"
  },
  {
    "serial": 42,
    "instrumentSerial": 59,
    "date": "2023-07-13",
    "open": "40.45",
    "high": "43.2",
    "low": "40.2",
    "close": "42.9",
    "previousClose": "39.9"
  },
  {
    "serial": 43,
    "instrumentSerial": 41,
    "date": "2023-07-13",
    "open": "508.5",
    "high": "546",
    "low": "502",
    "close": "543",
    "previousClose": "500.5"
  },
  {
    "serial": 44,
    "instrumentSerial": 38,
    "date": "2023-07-13",
    "open": "162.25",
    "high": "163.5",
    "low": "160",
    "close": "163.25",
    "previousClose": "162"
  },
  {
    "serial": 45,
    "instrumentSerial": 5,
    "date": "2023-07-13",
    "open": "9150",
    "high": "9297.5",
    "low": "9121",
    "close": "9278",
    "previousClose": "9114"
  },
  {
    "serial": 46,
    "instrumentSerial": 61,
    "date": "2023-07-13",
    "open": "391",
    "high": "412",
    "low": "391",
    "close": "412",
    "previousClose": "391"
  },
  {
    "serial": 47,
    "instrumentSerial": 55,
    "date": "2023-07-13",
    "open": "18.9",
    "high": "19.4",
    "low": "18.7",
    "close": "19.05",
    "previousClose": "19"
  },
  {
    "serial": 48,
    "instrumentSerial": 42,
    "date": "2023-07-13",
    "open": "663",
    "high": "682",
    "low": "646",
    "close": "657.5",
    "previousClose": "661.5"
  },
  {
    "serial": 49,
    "instrumentSerial": 20,
    "date": "2023-07-13",
    "open": "540",
    "high": "565",
    "low": "540",
    "close": "565",
    "previousClose": "580"
  },
  {
    "serial": 50,
    "instrumentSerial": 34,
    "date": "2023-07-13",
    "open": "875",
    "high": "925.85",
    "low": "875",
    "close": "917.75",
    "previousClose": "864.9"
  },
  {
    "serial": 51,
    "instrumentSerial": 46,
    "date": "2023-07-13",
    "open": "428.35",
    "high": "439",
    "low": "421",
    "close": "431.9",
    "previousClose": "428.6"
  },
  {
    "serial": 52,
    "instrumentSerial": 45,
    "date": "2023-07-13",
    "open": "701.8",
    "high": "746",
    "low": "701.8",
    "close": "734.35",
    "previousClose": "696.6"
  },
  {
    "serial": 53,
    "instrumentSerial": 47,
    "date": "2023-07-13",
    "open": "900",
    "high": "924.6",
    "low": "896",
    "close": "921.8",
    "previousClose": "893.65"
  },
  {
    "serial": 54,
    "instrumentSerial": 56,
    "date": "2023-07-13",
    "open": "311.6",
    "high": "340.25",
    "low": "311.6",
    "close": "338.85",
    "previousClose": "311.6"
  },
  {
    "serial": 55,
    "instrumentSerial": 7,
    "date": "2023-07-13",
    "open": "670",
    "high": "684.5",
    "low": "665.7",
    "close": "672.65",
    "previousClose": "664.25"
  },
  {
    "serial": 56,
    "instrumentSerial": 48,
    "date": "2023-07-13",
    "open": "1410.5",
    "high": "1440",
    "low": "1403.65",
    "close": "1437.55",
    "previousClose": "1394.2"
  },
  {
    "serial": 57,
    "instrumentSerial": 49,
    "date": "2023-07-13",
    "open": "428",
    "high": "458",
    "low": "425.5",
    "close": "448",
    "previousClose": "428"
  },
  {
    "serial": 58,
    "instrumentSerial": 43,
    "date": "2023-07-13",
    "open": "107",
    "high": "110",
    "low": "106",
    "close": "108.5",
    "previousClose": "106.5"
  },
  {
    "serial": 59,
    "instrumentSerial": 50,
    "date": "2023-07-13",
    "open": "7746.55",
    "high": "8035",
    "low": "7746.55",
    "close": "7975.05",
    "previousClose": "7673.65"
  },
  {
    "serial": 60,
    "instrumentSerial": 16,
    "date": "2023-07-13",
    "open": "56",
    "high": "58.5",
    "low": "56",
    "close": "56.1",
    "previousClose": "56"
  },
  {
    "serial": 61,
    "instrumentSerial": 53,
    "date": "2023-07-13",
    "open": null,
    "high": null,
    "low": null,
    "close": "62",
    "previousClose": "62"
  },
  {
    "serial": 62,
    "instrumentSerial": 28,
    "date": "2023-07-13",
    "open": "33",
    "high": "35",
    "low": "31.9",
    "close": "34.6",
    "previousClose": "33.15"
  },
  {
    "serial": 63,
    "instrumentSerial": 33,
    "date": "2023-07-13",
    "open": "394",
    "high": "421.3",
    "low": "382",
    "close": "418.5",
    "previousClose": "381.65"
  },
  {
    "serial": 64,
    "instrumentSerial": 62,
    "date": "2023-07-14",
    "open": "520",
    "high": "523",
    "low": "510",
    "close": "520",
    "previousClose": "519"
  },
  {
    "serial": 65,
    "instrumentSerial": 12,
    "date": "2023-07-14",
    "open": "20.5",
    "high": "20.5",
    "low": "20.5",
    "close": "20.5",
    "previousClose": "20.5"
  },
  {
    "serial": 66,
    "instrumentSerial": 42,
    "date": "2023-07-14",
    "open": "657.5",
    "high": "669",
    "low": "638",
    "close": "648.5",
    "previousClose": "657.5"
  },
  {
    "serial": 67,
    "instrumentSerial": 35,
    "date": "2023-07-14",
    "open": "336",
    "high": "340",
    "low": "333",
    "close": "338",
    "previousClose": "341.5"
  },
  {
    "serial": 68,
    "instrumentSerial": 15,
    "date": "2023-07-14",
    "open": "69",
    "high": "93",
    "low": "68.5",
    "close": "88.7",
    "previousClose": "66"
  },
  {
    "serial": 69,
    "instrumentSerial": 54,
    "date": "2023-07-14",
    "open": "232",
    "high": "233",
    "low": "225.25",
    "close": "229.5",
    "previousClose": "232"
  },
  {
    "serial": 70,
    "instrumentSerial": 48,
    "date": "2023-07-14",
    "open": "1434.05",
    "high": "1435.55",
    "low": "1380",
    "close": "1397.7",
    "previousClose": "1437.55"
  },
  {
    "serial": 71,
    "instrumentSerial": 51,
    "date": "2023-07-14",
    "open": "35.8",
    "high": "36.7",
    "low": "34.6",
    "close": "36",
    "previousClose": "35.95"
  },
  {
    "serial": 72,
    "instrumentSerial": 13,
    "date": "2023-07-14",
    "open": "74.9",
    "high": "77",
    "low": "74.8",
    "close": "77",
    "previousClose": "75"
  },
  {
    "serial": 73,
    "instrumentSerial": 52,
    "date": "2023-07-14",
    "open": "101",
    "high": "103",
    "low": "98",
    "close": "102",
    "previousClose": "99.7"
  },
  {
    "serial": 74,
    "instrumentSerial": 20,
    "date": "2023-07-14",
    "open": "565",
    "high": "565",
    "low": "565",
    "close": "565",
    "previousClose": "565"
  },
  {
    "serial": 75,
    "instrumentSerial": 60,
    "date": "2023-07-14",
    "open": "369.65",
    "high": "369.65",
    "low": "356.25",
    "close": "363",
    "previousClose": "364.8"
  },
  {
    "serial": 76,
    "instrumentSerial": 26,
    "date": "2023-07-14",
    "open": "138",
    "high": "140",
    "low": "134.25",
    "close": "138",
    "previousClose": "138"
  },
  {
    "serial": 77,
    "instrumentSerial": 31,
    "date": "2023-07-14",
    "open": "1525",
    "high": "1560",
    "low": "1470",
    "close": "1502.8",
    "previousClose": "1520.25"
  },
  {
    "serial": 78,
    "instrumentSerial": 16,
    "date": "2023-07-14",
    "open": "55",
    "high": "57",
    "low": "55",
    "close": "56.1",
    "previousClose": "56.1"
  },
  {
    "serial": 79,
    "instrumentSerial": 40,
    "date": "2023-07-14",
    "open": "395",
    "high": "395",
    "low": "390",
    "close": "392.5",
    "previousClose": "397.5"
  },
  {
    "serial": 80,
    "instrumentSerial": 24,
    "date": "2023-07-14",
    "open": "295",
    "high": "322.5",
    "low": "295",
    "close": "322",
    "previousClose": "310"
  },
  {
    "serial": 81,
    "instrumentSerial": 4,
    "date": "2023-07-14",
    "open": "6650",
    "high": "6840",
    "low": "6500",
    "close": "6640",
    "previousClose": "6621.5"
  },
  {
    "serial": 82,
    "instrumentSerial": 34,
    "date": "2023-07-14",
    "open": "915.8",
    "high": "918.9",
    "low": "870",
    "close": "885.8",
    "previousClose": "917.75"
  },
  {
    "serial": 83,
    "instrumentSerial": 37,
    "date": "2023-07-14",
    "open": "390",
    "high": "412",
    "low": "388",
    "close": "400.5",
    "previousClose": "400.5"
  },
  {
    "serial": 84,
    "instrumentSerial": 32,
    "date": "2023-07-14",
    "open": "421.5",
    "high": "429.5",
    "low": "410",
    "close": "424.25",
    "previousClose": "429.45"
  },
  {
    "serial": 85,
    "instrumentSerial": 44,
    "date": "2023-07-14",
    "open": "668",
    "high": "668.5",
    "low": "640.5",
    "close": "650",
    "previousClose": "668"
  },
  {
    "serial": 86,
    "instrumentSerial": 49,
    "date": "2023-07-14",
    "open": "455",
    "high": "455",
    "low": "426",
    "close": "429",
    "previousClose": "448"
  },
  {
    "serial": 87,
    "instrumentSerial": 63,
    "date": "2023-07-14",
    "open": "373",
    "high": "373",
    "low": "360",
    "close": "369.5",
    "previousClose": "373"
  },
  {
    "serial": 88,
    "instrumentSerial": 22,
    "date": "2023-07-14",
    "open": "1047",
    "high": "1062",
    "low": "1002",
    "close": "1038.1",
    "previousClose": "1047.166"
  },
  {
    "serial": 89,
    "instrumentSerial": 18,
    "date": "2023-07-14",
    "open": "515",
    "high": "516",
    "low": "500.5",
    "close": "505.5",
    "previousClose": "515.5"
  },
  {
    "serial": 90,
    "instrumentSerial": 46,
    "date": "2023-07-14",
    "open": "431.8",
    "high": "431.8",
    "low": "419.3",
    "close": "420.1",
    "previousClose": "431.9"
  },
  {
    "serial": 91,
    "instrumentSerial": 30,
    "date": "2023-07-14",
    "open": "6.8",
    "high": "7.02",
    "low": "6.8",
    "close": "7",
    "previousClose": "6.75"
  },
  {
    "serial": 92,
    "instrumentSerial": 57,
    "date": "2023-07-14",
    "open": "21.4",
    "high": "21.4",
    "low": "21.4",
    "close": "21.4",
    "previousClose": "21.4"
  },
  {
    "serial": 93,
    "instrumentSerial": 25,
    "date": "2023-07-14",
    "open": "190",
    "high": "196",
    "low": "189",
    "close": "195",
    "previousClose": "192.75"
  },
  {
    "serial": 94,
    "instrumentSerial": 28,
    "date": "2023-07-14",
    "open": "35.4",
    "high": "35.5",
    "low": "32.6",
    "close": "33.4",
    "previousClose": "34.6"
  },
  {
    "serial": 95,
    "instrumentSerial": 19,
    "date": "2023-07-14",
    "open": "291",
    "high": "291",
    "low": "275",
    "close": "279",
    "previousClose": "289"
  },
  {
    "serial": 96,
    "instrumentSerial": 9,
    "date": "2023-07-14",
    "open": "312",
    "high": "317",
    "low": "305.5",
    "close": "309.5",
    "previousClose": "310"
  },
  {
    "serial": 97,
    "instrumentSerial": 6,
    "date": "2023-07-14",
    "open": "252.5",
    "high": "257",
    "low": "244",
    "close": "251",
    "previousClose": "251.5"
  },
  {
    "serial": 98,
    "instrumentSerial": 45,
    "date": "2023-07-14",
    "open": "730",
    "high": "744.45",
    "low": "724",
    "close": "734.65",
    "previousClose": "734.35"
  },
  {
    "serial": 99,
    "instrumentSerial": 11,
    "date": "2023-07-14",
    "open": "86.9",
    "high": "86.9",
    "low": "84",
    "close": "84.3",
    "previousClose": "86"
  },
  {
    "serial": 100,
    "instrumentSerial": 65,
    "date": "2023-07-14",
    "open": "363",
    "high": "370.5",
    "low": "361",
    "close": "369.5",
    "previousClose": "362"
  },
  {
    "serial": 101,
    "instrumentSerial": 17,
    "date": "2023-07-14",
    "open": "53.5",
    "high": "58",
    "low": "53",
    "close": "57.2",
    "previousClose": "53.2"
  },
  {
    "serial": 102,
    "instrumentSerial": 43,
    "date": "2023-07-14",
    "open": "106.5",
    "high": "110",
    "low": "106",
    "close": "107.5",
    "previousClose": "108.5"
  },
  {
    "serial": 103,
    "instrumentSerial": 64,
    "date": "2023-07-14",
    "open": "1170",
    "high": "1190",
    "low": "1150",
    "close": "1180",
    "previousClose": "1163"
  },
  {
    "serial": 104,
    "instrumentSerial": 59,
    "date": "2023-07-14",
    "open": "43",
    "high": "43.3",
    "low": "41.75",
    "close": "42.75",
    "previousClose": "42.9"
  },
  {
    "serial": 105,
    "instrumentSerial": 21,
    "date": "2023-07-14",
    "open": "1659.5",
    "high": "1680",
    "low": "1580",
    "close": "1660",
    "previousClose": "1656"
  },
  {
    "serial": 106,
    "instrumentSerial": 47,
    "date": "2023-07-14",
    "open": "920.15",
    "high": "927.7",
    "low": "902.05",
    "close": "925.85",
    "previousClose": "921.8"
  },
  {
    "serial": 107,
    "instrumentSerial": 23,
    "date": "2023-07-14",
    "open": "338.5",
    "high": "350",
    "low": "320",
    "close": "341.5",
    "previousClose": "337"
  },
  {
    "serial": 108,
    "instrumentSerial": 41,
    "date": "2023-07-14",
    "open": "546",
    "high": "579",
    "low": "525",
    "close": "550",
    "previousClose": "543"
  },
  {
    "serial": 109,
    "instrumentSerial": 39,
    "date": "2023-07-14",
    "open": "455",
    "high": "455",
    "low": "437",
    "close": "450.6",
    "previousClose": "449.65"
  },
  {
    "serial": 110,
    "instrumentSerial": 53,
    "date": "2023-07-14",
    "open": "60",
    "high": "60",
    "low": "60",
    "close": "60",
    "previousClose": "62"
  },
  {
    "serial": 111,
    "instrumentSerial": 1,
    "date": "2023-07-14",
    "open": "260",
    "high": "278",
    "low": "240",
    "close": "259",
    "previousClose": "260"
  },
  {
    "serial": 112,
    "instrumentSerial": 38,
    "date": "2023-07-14",
    "open": "165",
    "high": "167",
    "low": "161.5",
    "close": "166.5",
    "previousClose": "163.25"
  },
  {
    "serial": 113,
    "instrumentSerial": 8,
    "date": "2023-07-14",
    "open": "38.8",
    "high": "39",
    "low": "37.8",
    "close": "38.8",
    "previousClose": "37.55"
  },
  {
    "serial": 114,
    "instrumentSerial": 56,
    "date": "2023-07-14",
    "open": "335.15",
    "high": "335.55",
    "low": "322",
    "close": "328.1",
    "previousClose": "338.85"
  },
  {
    "serial": 115,
    "instrumentSerial": 58,
    "date": "2023-07-14",
    "open": "219.5",
    "high": "220.25",
    "low": "214",
    "close": "220.25",
    "previousClose": "220"
  },
  {
    "serial": 116,
    "instrumentSerial": 5,
    "date": "2023-07-14",
    "open": "9299.5",
    "high": "9299.5",
    "low": "8899.5",
    "close": "9163",
    "previousClose": "9278"
  },
  {
    "serial": 117,
    "instrumentSerial": 14,
    "date": "2023-07-14",
    "open": "615",
    "high": "615",
    "low": "614.5",
    "close": "615",
    "previousClose": "615"
  },
  {
    "serial": 118,
    "instrumentSerial": 50,
    "date": "2023-07-14",
    "open": "7901.25",
    "high": "7901.25",
    "low": "7752",
    "close": "7837.5",
    "previousClose": "7975.05"
  },
  {
    "serial": 119,
    "instrumentSerial": 2,
    "date": "2023-07-14",
    "open": "1850",
    "high": "1920",
    "low": "1850",
    "close": "1865",
    "previousClose": "1918"
  },
  {
    "serial": 120,
    "instrumentSerial": 61,
    "date": "2023-07-14",
    "open": "411.5",
    "high": "413",
    "low": "395",
    "close": "410",
    "previousClose": "412"
  },
  {
    "serial": 121,
    "instrumentSerial": 29,
    "date": "2023-07-14",
    "open": "8.84",
    "high": "8.94",
    "low": "8.8",
    "close": "8.93",
    "previousClose": "8.79"
  },
  {
    "serial": 122,
    "instrumentSerial": 7,
    "date": "2023-07-14",
    "open": "674",
    "high": "675",
    "low": "647",
    "close": "651.85",
    "previousClose": "672.65"
  },
  {
    "serial": 123,
    "instrumentSerial": 36,
    "date": "2023-07-14",
    "open": "311",
    "high": "316",
    "low": "311",
    "close": "315",
    "previousClose": "323"
  },
  {
    "serial": 124,
    "instrumentSerial": 55,
    "date": "2023-07-14",
    "open": "19.1",
    "high": "19.3",
    "low": "18.75",
    "close": "19",
    "previousClose": "19.05"
  },
  {
    "serial": 125,
    "instrumentSerial": 27,
    "date": "2023-07-14",
    "open": "636",
    "high": "636",
    "low": "620",
    "close": "624",
    "previousClose": "623"
  },
  {
    "serial": 126,
    "instrumentSerial": 33,
    "date": "2023-07-14",
    "open": "418",
    "high": "418.5",
    "low": "407.2",
    "close": "414.7",
    "previousClose": "418.5"
  }
];

export const challengeOrders: readonly ChallengeOrder[] = [
  {
    "serial": 1,
    "instrumentSerial": 66,
    "userSerial": 1,
    "size": "1000000",
    "price": "1",
    "side": "CASH_IN",
    "status": "FILLED",
    "type": "MARKET",
    "datetime": "2023-07-12 12:11:20"
  },
  {
    "serial": 2,
    "instrumentSerial": 47,
    "userSerial": 1,
    "size": "50",
    "price": "930",
    "side": "BUY",
    "status": "FILLED",
    "type": "MARKET",
    "datetime": "2023-07-12 12:31:20"
  },
  {
    "serial": 3,
    "instrumentSerial": 47,
    "userSerial": 1,
    "size": "50",
    "price": "920",
    "side": "BUY",
    "status": "CANCELLED",
    "type": "LIMIT",
    "datetime": "2023-07-12 14:21:20"
  },
  {
    "serial": 4,
    "instrumentSerial": 47,
    "userSerial": 1,
    "size": "10",
    "price": "940",
    "side": "SELL",
    "status": "FILLED",
    "type": "MARKET",
    "datetime": "2023-07-12 14:51:20"
  },
  {
    "serial": 5,
    "instrumentSerial": 45,
    "userSerial": 1,
    "size": "50",
    "price": "710",
    "side": "BUY",
    "status": "NEW",
    "type": "LIMIT",
    "datetime": "2023-07-12 15:14:20"
  },
  {
    "serial": 6,
    "instrumentSerial": 47,
    "userSerial": 1,
    "size": "100",
    "price": "950",
    "side": "SELL",
    "status": "REJECTED",
    "type": "MARKET",
    "datetime": "2023-07-12 16:11:20"
  },
  {
    "serial": 7,
    "instrumentSerial": 31,
    "userSerial": 1,
    "size": "60",
    "price": "1500",
    "side": "BUY",
    "status": "NEW",
    "type": "LIMIT",
    "datetime": "2023-07-13 11:13:20"
  },
  {
    "serial": 8,
    "instrumentSerial": 66,
    "userSerial": 1,
    "size": "100000",
    "price": "1",
    "side": "CASH_OUT",
    "status": "FILLED",
    "type": "MARKET",
    "datetime": "2023-07-13 12:31:20"
  },
  {
    "serial": 9,
    "instrumentSerial": 31,
    "userSerial": 1,
    "size": "20",
    "price": "1540",
    "side": "BUY",
    "status": "FILLED",
    "type": "LIMIT",
    "datetime": "2023-07-13 12:51:20"
  },
  {
    "serial": 10,
    "instrumentSerial": 54,
    "userSerial": 1,
    "size": "500",
    "price": "250",
    "side": "BUY",
    "status": "FILLED",
    "type": "MARKET",
    "datetime": "2023-07-13 14:11:20"
  },
  {
    "serial": 11,
    "instrumentSerial": 31,
    "userSerial": 1,
    "size": "30",
    "price": "1530",
    "side": "SELL",
    "status": "FILLED",
    "type": "MARKET",
    "datetime": "2023-07-13 15:13:20"
  }
];
