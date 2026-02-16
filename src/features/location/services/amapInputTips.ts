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

  const tipUrl = new URL(INPUT_TIPS_URL);
  tipUrl.search = new URLSearchParams({
    key,
    keywords: trimmed,
    city: city ?? '',
    citylimit: city ? 'true' : 'false',
    datatype: 'all',
  }).toString();

  const tipResponse = await fetch(tipUrl.toString());
  if (!tipResponse.ok) {
    throw new AmapApiError(`高德请求失败: ${tipResponse.status}`);
  }
  const tipJson = (await tipResponse.json()) as {
    status?: string;
    infocode?: string;
    info?: string;
    tips?: RawTip[];
  };
  if (tipJson.status !== '1') {
    throw new AmapApiError(
      `高德接口错误: ${tipJson.info ?? 'unknown'} (${tipJson.infocode ?? 'n/a'})`,
      tipJson.infocode,
    );
  }

  const tipList = (tipJson.tips ?? [])
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

  let poiList: AddressSuggestion[] = [];
  if (tipList.length < limit) {
    const textUrl = new URL(TEXT_SEARCH_URL);
    textUrl.search = new URLSearchParams({
      key,
      keywords: trimmed,
      city: city ?? '',
      citylimit: city ? 'true' : 'false',
      offset: String(Math.min(20, limit * 2)),
      page: '1',
      extensions: 'base',
    }).toString();

    const textResponse = await fetch(textUrl.toString());
    if (textResponse.ok) {
      const textJson = (await textResponse.json()) as {
        status?: string;
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
      }
    }
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
  return deduped;
}
