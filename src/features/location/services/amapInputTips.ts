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

const INPUT_TIPS_URL = 'https://restapi.amap.com/v3/assistant/inputtips';

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

  const url = new URL(INPUT_TIPS_URL);
  url.search = new URLSearchParams({
    key,
    keywords: trimmed,
    city: city ?? '',
    citylimit: 'false',
    datatype: 'all',
  }).toString();

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new AmapApiError(`高德请求失败: ${response.status}`);
  }
  const json = (await response.json()) as {
    status?: string;
    infocode?: string;
    info?: string;
    tips?: RawTip[];
  };
  if (json.status !== '1') {
    throw new AmapApiError(
      `高德接口错误: ${json.info ?? 'unknown'} (${json.infocode ?? 'n/a'})`,
      json.infocode,
    );
  }

  return (json.tips ?? [])
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
    .filter((item): item is AddressSuggestion => Boolean(item))
    .slice(0, limit);
}
