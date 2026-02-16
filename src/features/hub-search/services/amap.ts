export type HubKind = 'subway' | 'train' | 'airport';

export type HubResult = {
  kind: HubKind;
  kindLabel: string;
  name: string;
  address: string;
  distanceMeters: number | null;
  latitude: number;
  longitude: number;
};

export class AmapApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

type AroundPoi = {
  name?: string;
  address?: string;
  distance?: string;
  location?: string;
};

const HUB_QUERY: Record<HubKind, { keywords: string[]; label: string }> = {
  subway: { keywords: ['地铁站', '轨道交通站'], label: '地铁站' },
  train: { keywords: ['火车站', '高铁站'], label: '火车站' },
  airport: { keywords: ['机场'], label: '机场' },
};

const AMAP_AROUND_URL = 'https://restapi.amap.com/v3/place/around';
const SEARCH_RADII = [8000, 20000, 50000];
const MIN_REQUEST_INTERVAL_MS = 350;
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const throttleAmapRequest = async () => {
  const now = Date.now();
  const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (now - lastRequestAt));
  if (wait > 0) {
    await sleep(wait);
  }
  lastRequestAt = Date.now();
};

const parseLocation = (location: string): { longitude: number; latitude: number } | null => {
  const [lng, lat] = location.split(',');
  const longitude = Number(lng);
  const latitude = Number(lat);
  if (Number.isNaN(longitude) || Number.isNaN(latitude)) {
    return null;
  }
  return { longitude, latitude };
};

const toDistance = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

export async function fetchNearestHubByKind(params: {
  key: string;
  latitude: number;
  longitude: number;
  kind: HubKind;
}): Promise<HubResult | null> {
  const { key, latitude, longitude, kind } = params;
  const query = HUB_QUERY[kind];

  for (const radiusMeters of SEARCH_RADII) {
    for (const keyword of query.keywords) {
      const url = new URL(AMAP_AROUND_URL);
      url.search = new URLSearchParams({
        key,
        location: `${longitude},${latitude}`,
        keywords: keyword,
        radius: String(radiusMeters),
        sortrule: 'distance',
        offset: '1',
        page: '1',
        extensions: 'base',
      }).toString();

      await throttleAmapRequest();
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new AmapApiError(`高德请求失败: ${response.status}`);
      }

      const json = (await response.json()) as {
        status?: string;
        infocode?: string;
        info?: string;
        pois?: AroundPoi[];
      };

      if (json.status !== '1') {
        throw new AmapApiError(
          `高德接口错误: ${json.info ?? 'unknown'} (${json.infocode ?? 'n/a'})`,
          json.infocode,
        );
      }

      const poi = json.pois?.[0];
      if (!poi?.name || !poi.location) {
        continue;
      }

      const parsed = parseLocation(poi.location);
      if (!parsed) {
        continue;
      }

      return {
        kind,
        kindLabel: query.label,
        name: poi.name,
        address: poi.address ?? '未知地址',
        distanceMeters: toDistance(poi.distance),
        latitude: parsed.latitude,
        longitude: parsed.longitude,
      };
    }
  }

  return null;
}

export async function fetchNearestHubs(params: {
  key: string;
  latitude: number;
  longitude: number;
}): Promise<HubResult[]> {
  const { key, latitude, longitude } = params;
  const list: Array<HubResult | null> = [];
  for (const kind of Object.keys(HUB_QUERY) as HubKind[]) {
    const result = await fetchNearestHubByKind({ key, latitude, longitude, kind });
    list.push(result);
  }

  return list.filter((item): item is HubResult => Boolean(item));
}
