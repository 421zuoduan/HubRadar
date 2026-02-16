import { AmapApiError } from '../../hub-search/services/amap';

export type AddressSuggestion = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

type RawTip = {
  id?: string;
  name?: string;
  district?: string;
  address?: string;
  location?: string;
};

type RawPoi = {
  id?: string;
  name?: string;
  address?: string;
  pname?: string;
  cityname?: string;
  adname?: string;
  location?: string;
};

const INPUT_TIPS_URL = 'https://restapi.amap.com/v3/assistant/inputtips';
const TEXT_SEARCH_URL = 'https://restapi.amap.com/v3/place/text';

const HOTEL_BRAND_REGEX = /(汉庭|如家|全季|亚朵|锦江|7天|格林豪泰|维也纳|桔子|喆啡|酒店)/;
const REQUEST_INTERVAL_MS = 700;
const suggestionCache = new Map<string, AddressSuggestion[]>();
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const throttle = async () => {
  const now = Date.now();
  const wait = Math.max(0, REQUEST_INTERVAL_MS - (now - lastRequestAt));
  if (wait > 0) {
    await sleep(wait);
  }
  lastRequestAt = Date.now();
};

const parseLocation = (location?: string): { longitude: number; latitude: number } | null => {
  if (!location) {
    return null;
  }
  const [lng, lat] = location.split(',');
  const longitude = Number(lng);
  const latitude = Number(lat);
  if (Number.isNaN(longitude) || Number.isNaN(latitude)) {
    return null;
  }
  return { longitude, latitude };
};

export async function fetchAddressSuggestions(params: {
  key: string;
  keyword: string;
  city?: string;
  limit?: number;
}): Promise<AddressSuggestion[]> {
  const { key, keyword, city, limit = 8 } = params;
  const trimmed = keyword.trim();
  if (!trimmed) {
    return [];
  }
  const cacheKey = `${trimmed}|${city ?? ''}|${limit}`;
  const cached = suggestionCache.get(cacheKey);
  if (cached?.length) {
    return cached;
  }

  const keywordVariants = HOTEL_BRAND_REGEX.test(trimmed)
    ? [trimmed, `${trimmed}酒店`]
    : [trimmed];

  let poiList: AddressSuggestion[] = [];
  for (const keywordText of keywordVariants) {
    const textUrl = new URL(TEXT_SEARCH_URL);
    textUrl.search = new URLSearchParams({
      key,
      keywords: keywordText,
      city: city ?? '',
      citylimit: 'false',
      offset: String(Math.min(20, limit * 2)),
      page: '1',
      extensions: 'base',
    }).toString();

    await throttle();
    const textResponse = await fetch(textUrl.toString());
    if (!textResponse.ok) {
      continue;
    }
    const textJson = (await textResponse.json()) as {
      status?: string;
      infocode?: string;
      pois?: RawPoi[];
    };
    if (textJson.status === '1') {
      poiList = (textJson.pois ?? [])
        .map((poi) => {
          const point = parseLocation(poi.location);
          if (!point || !poi.name) {
            return null;
          }
          const address = [poi.pname, poi.cityname, poi.adname, poi.address].filter(Boolean).join(' ');
          return {
            id: poi.id ?? `${poi.name}-${poi.location}`,
            name: poi.name,
            address: address || '未知地址',
            latitude: point.latitude,
            longitude: point.longitude,
          } satisfies AddressSuggestion;
        })
        .filter((item): item is AddressSuggestion => Boolean(item));
    } else if (textJson.infocode === '10021') {
      const quickCache = suggestionCache.get(cacheKey);
      if (quickCache?.length) {
        return quickCache;
      }
    }
    if (poiList.length >= limit) {
      break;
    }
  }

  const tipUrl = new URL(INPUT_TIPS_URL);
  tipUrl.search = new URLSearchParams({
    key,
    keywords: trimmed,
    city: city ?? '',
    citylimit: 'false',
    datatype: 'all',
  }).toString();

  let tipList: AddressSuggestion[] = [];
  try {
    await throttle();
    const tipResponse = await fetch(tipUrl.toString());
    if (tipResponse.ok) {
      const tipJson = (await tipResponse.json()) as {
        status?: string;
        tips?: RawTip[];
      };
      if (tipJson.status === '1') {
        tipList = (tipJson.tips ?? [])
          .map((tip) => {
            const point = parseLocation(tip.location);
            if (!point || !tip.name) {
              return null;
            }
            const address = [tip.district, tip.address].filter(Boolean).join(' ');
            return {
              id: tip.id ?? `${tip.name}-${tip.location}`,
              name: tip.name,
              address: address || '未知地址',
              latitude: point.latitude,
              longitude: point.longitude,
            } satisfies AddressSuggestion;
          })
          .filter((item): item is AddressSuggestion => Boolean(item));
      }
    }
  } catch {
    tipList = [];
  }

  const merged = [...tipList, ...poiList];
  const deduped: AddressSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of merged) {
    const keyOfItem = `${item.name}|${item.latitude.toFixed(6)}|${item.longitude.toFixed(6)}`;
    if (seen.has(keyOfItem)) {
      continue;
    }
    seen.add(keyOfItem);
    deduped.push(item);
    if (deduped.length >= limit) {
      break;
    }
  }
  if (!deduped.length) {
    throw new AmapApiError('暂无可用候选，请稍后重试或补充关键词');
  }

  suggestionCache.set(cacheKey, deduped);
  return deduped;
}
