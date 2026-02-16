import { AmapApiError } from '../../hub-search/services/amap';

export type RegeoInfo = {
  city: string;
  district: string;
  formattedAddress: string;
};

export async function reverseGeocode(params: {
  key: string;
  latitude: number;
  longitude: number;
}): Promise<RegeoInfo | null> {
  const { key, latitude, longitude } = params;
  const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
  url.search = new URLSearchParams({
    key,
    location: `${longitude},${latitude}`,
    extensions: 'base',
  }).toString();

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new AmapApiError(`高德请求失败: ${response.status}`);
  }
  const json = (await response.json()) as {
    status?: string;
    infocode?: string;
    info?: string;
    regeocode?: {
      formatted_address?: string;
      addressComponent?: {
        city?: string | string[];
        district?: string;
      };
    };
  };

  if (json.status !== '1') {
    throw new AmapApiError(
      `高德接口错误: ${json.info ?? 'unknown'} (${json.infocode ?? 'n/a'})`,
      json.infocode,
    );
  }

  const cityRaw = json.regeocode?.addressComponent?.city;
  const city = Array.isArray(cityRaw) ? cityRaw[0] ?? '' : cityRaw ?? '';
  const district = json.regeocode?.addressComponent?.district ?? '';
  const formattedAddress = json.regeocode?.formatted_address ?? '';

  if (!city && !district && !formattedAddress) {
    return null;
  }
  return {
    city,
    district,
    formattedAddress,
  };
}
