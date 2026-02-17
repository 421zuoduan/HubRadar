export type HubKind = 'subway' | 'train' | 'highspeed' | 'airport';

export type HubCandidate = {
  name: string;
  address: string;
  distanceMeters: number | null;
  score: number;
  reasonTags: string[];
};

export type TrainStationProfile = {
  capacityScore: number;
  lineCountScore: number;
  lineCountEstimate: number;
  highSpeedScore: number;
  hasHighSpeedSignal: boolean;
  compositeScore: number;
  reasonTags: string[];
};

export type HubResult = {
  kind: HubKind;
  kindLabel: string;
  name: string;
  address: string;
  distanceMeters: number | null;
  latitude: number;
  longitude: number;
  highSpeedQueryHit?: boolean;
  trainProfile?: TrainStationProfile;
  topCandidates?: HubCandidate[];
};

export class AmapApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

type Poi = {
  id?: string;
  name?: string;
  address?: string;
  distance?: string;
  location?: string;
  type?: string;
  typecode?: string;
};

const HUB_QUERY: Record<HubKind, { keywords: string[]; label: string }> = {
  subway: { keywords: ['地铁站', '轨道交通站'], label: '地铁站' },
  train: { keywords: ['火车站'], label: '火车站' },
  highspeed: { keywords: ['高铁站', '火车站'], label: '高铁站' },
  airport: { keywords: ['机场'], label: '机场' },
};

const AMAP_AROUND_URL = 'https://restapi.amap.com/v3/place/around';
const AMAP_TEXT_URL = 'https://restapi.amap.com/v3/place/text';
const SEARCH_RADII = [8000, 20000, 50000];
const MIN_REQUEST_INTERVAL_MS = 350;
const TRAIN_CANDIDATE_LIMIT = 20;
const AIRPORT_CANDIDATE_LIMIT = 20;
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

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeStationName = (name: string): string => name.replace(/\s+/g, '').trim();

const normalizeCityToken = (cityName?: string): string => {
  if (!cityName) {
    return '';
  }
  return cityName.replace(/(特别行政区|自治州|自治县|地区|盟|市|州|区|县)$/g, '').trim();
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

const toRadians = (value: number): number => (value * Math.PI) / 180;

const calcDistanceMeters = (origin: { latitude: number; longitude: number }, target: { latitude: number; longitude: number }): number => {
  const earthRadius = 6371000;
  const dLat = toRadians(target.latitude - origin.latitude);
  const dLng = toRadians(target.longitude - origin.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(origin.latitude)) * Math.cos(toRadians(target.latitude)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadius * c);
};

const isCountyLevelName = (name: string): boolean => /(县|镇|乡|村|新区|开发区|工业园|郊|街道|社区)/.test(name);

const hasDirectionalStationSuffix = (name: string): boolean => /(东|西|南|北)站$/.test(name);

const isCityMainStyleName = (name: string): boolean => /^[\u4e00-\u9fa5]{2,8}(东|西|南|北)?站$/.test(name);

const hasHighSpeedSignal = (name: string): boolean =>
  /(高铁|动车|城际)/.test(name) || hasDirectionalStationSuffix(name);

const isNationalHubStyleName = (name: string): boolean =>
  /(北京|上海|广州|深圳|成都|重庆|西安|武汉|杭州|南京|天津|郑州|长沙|青岛|昆明|沈阳|厦门|福州|合肥|南昌|贵阳|兰州|乌鲁木齐)(东|西|南|北)?站/.test(
    name,
  );

const buildTrainStationProfile = (name: string, cityName?: string): TrainStationProfile => {
  const normalizedName = normalizeStationName(name);
  const cityToken = normalizeCityToken(cityName);
  const cityMatch = cityToken ? normalizedName.includes(cityToken) : false;
  const countyLevel = isCountyLevelName(normalizedName);
  const cityMainStyle = isCityMainStyleName(normalizedName);
  const directionalSuffix = hasDirectionalStationSuffix(normalizedName);
  const highSpeed = hasHighSpeedSignal(normalizedName);
  const nationalHubStyle = isNationalHubStyleName(normalizedName);

  let capacityScore = 20;
  if (cityMatch) {
    capacityScore += 38;
  }
  if (cityMainStyle) {
    capacityScore += 20;
  }
  if (directionalSuffix) {
    capacityScore += 12;
  }
  if (nationalHubStyle) {
    capacityScore += 12;
  }
  if (highSpeed) {
    capacityScore += 10;
  }
  if (countyLevel) {
    capacityScore -= 65;
  }
  capacityScore = clamp(Math.round(capacityScore), 0, 100);

  const rawLineEstimate =
    Math.round(capacityScore / 11) +
    (cityMatch ? 4 : 0) +
    (highSpeed ? 3 : 0) +
    (cityMainStyle ? 2 : 0) -
    (countyLevel ? 2 : 0);
  const lineCountEstimate = clamp(rawLineEstimate, 1, 24);
  const lineCountScore = clamp(Math.round(lineCountEstimate * 4.2), 0, 100);

  const highSpeedScore = highSpeed ? 100 : 30;
  const compositeScore = Number((capacityScore * 0.45 + lineCountScore * 0.35 + highSpeedScore * 0.2).toFixed(1));

  const reasonTags: string[] = [];
  if (cityMatch) {
    reasonTags.push('同城主站信号');
  }
  if (cityMainStyle) {
    reasonTags.push('主站命名');
  }
  if (highSpeed) {
    reasonTags.push('高铁信号');
  }
  if (nationalHubStyle) {
    reasonTags.push('全国级枢纽命名');
  }
  if (countyLevel) {
    reasonTags.push('县镇级命名');
  }

  return {
    capacityScore,
    lineCountScore,
    lineCountEstimate,
    highSpeedScore,
    hasHighSpeedSignal: highSpeed,
    compositeScore,
    reasonTags,
  };
};

const canonicalAirportName = (name: string): string => {
  const normalizedName = normalizeStationName(name);
  const airportIndex = normalizedName.indexOf('机场');
  if (airportIndex >= 0) {
    return normalizedName.slice(0, airportIndex + 2);
  }
  return normalizedName
    .replace(/([A-Z]?\d+|[一二三四五六七八九十1-9]号?)(航站楼|候机楼|卫星厅).*/g, '')
    .replace(/(航站楼|候机楼|卫星厅).*/g, '')
    .trim();
};

const buildAirportScore = (
  name: string,
  cityName: string | undefined,
  distanceMeters: number | null,
): { score: number; reasonTags: string[] } => {
  const normalizedName = normalizeStationName(name);
  const cityToken = normalizeCityToken(cityName);
  const cityMatch = cityToken ? normalizedName.includes(cityToken) : false;
  const isInternational = normalizedName.includes('国际机场');
  const isCommercialAirport = normalizedName.includes('机场');
  const isSmallAirport =
    /(通用|直升机|训练|校飞|试飞|观光|航校|产业园|航空港园区|机库|营地)/.test(normalizedName);

  let score = 30;
  if (isInternational) {
    score += 45;
  }
  if (isCommercialAirport) {
    score += 18;
  }
  if (cityMatch) {
    score += 18;
  }
  if (!cityMatch && cityToken) {
    score -= 18;
  }
  if (isSmallAirport) {
    score -= 70;
  }
  const distancePenalty = Math.min(85, Math.round(((distanceMeters ?? 120000) / 1000) * 0.65));
  score -= distancePenalty;

  const reasonTags: string[] = [];
  if (isInternational) {
    reasonTags.push('国际机场');
  }
  if (cityMatch) {
    reasonTags.push('同城机场');
  } else if (cityToken) {
    reasonTags.push('非同城机场');
  }
  if (isSmallAirport) {
    reasonTags.push('疑似通用机场');
  }
  reasonTags.push(`距离扣分${distancePenalty}`);

  return {
    score,
    reasonTags,
  };
};

const mapPoiToHub = (params: {
  poi: Poi;
  kind: HubKind;
  kindLabel: string;
  origin: { latitude: number; longitude: number };
  highSpeedQueryHit?: boolean;
}): HubResult | null => {
  const { poi, kind, kindLabel, origin, highSpeedQueryHit } = params;
  if (!poi?.name || !poi.location) {
    return null;
  }
  const parsed = parseLocation(poi.location);
  if (!parsed) {
    return null;
  }

  const computedDistance = calcDistanceMeters(origin, parsed);
  return {
    kind,
    kindLabel,
    name: normalizeStationName(poi.name),
    address: poi.address ?? '未知地址',
    distanceMeters: computedDistance,
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    highSpeedQueryHit,
  };
};

const dedupeHubs = (items: HubResult[]): HubResult[] => {
  const byKey = new Map<string, HubResult>();
  items.forEach((item) => {
    const key = `${item.name}|${item.latitude.toFixed(6)}|${item.longitude.toFixed(6)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      return;
    }
    const existingDistance = existing.distanceMeters ?? Number.MAX_SAFE_INTEGER;
    const nextDistance = item.distanceMeters ?? Number.MAX_SAFE_INTEGER;
    byKey.set(key, {
      ...(nextDistance < existingDistance ? item : existing),
      highSpeedQueryHit: Boolean(existing.highSpeedQueryHit || item.highSpeedQueryHit),
    });
  });
  return Array.from(byKey.values());
};

const fetchAroundPois = async (params: {
  key: string;
  latitude: number;
  longitude: number;
  keyword: string;
  radiusMeters: number;
  offset: number;
}): Promise<Poi[]> => {
  const { key, latitude, longitude, keyword, radiusMeters, offset } = params;
  const url = new URL(AMAP_AROUND_URL);
  url.search = new URLSearchParams({
    key,
    location: `${longitude},${latitude}`,
    keywords: keyword,
    radius: String(radiusMeters),
    sortrule: 'distance',
    offset: String(offset),
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
    pois?: Poi[];
  };
  if (json.status !== '1') {
    throw new AmapApiError(
      `高德接口错误: ${json.info ?? 'unknown'} (${json.infocode ?? 'n/a'})`,
      json.infocode,
    );
  }

  return json.pois ?? [];
};

const fetchTextPois = async (params: {
  key: string;
  cityName: string;
  keyword: string;
  offset: number;
}): Promise<Poi[]> => {
  const { key, cityName, keyword, offset } = params;
  const city = cityName.trim();
  if (!city) {
    return [];
  }
  const url = new URL(AMAP_TEXT_URL);
  url.search = new URLSearchParams({
    key,
    keywords: keyword,
    city,
    citylimit: 'true',
    offset: String(offset),
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
    pois?: Poi[];
  };
  if (json.status !== '1') {
    throw new AmapApiError(
      `高德接口错误: ${json.info ?? 'unknown'} (${json.infocode ?? 'n/a'})`,
      json.infocode,
    );
  }
  return json.pois ?? [];
};

const collectScoredKindCandidates = async (params: {
  key: string;
  latitude: number;
  longitude: number;
  kind: 'train' | 'highspeed' | 'airport';
  cityName?: string;
}): Promise<HubResult[]> => {
  const { key, latitude, longitude, kind, cityName } = params;
  const query = HUB_QUERY[kind];
  const candidateLimit = kind === 'airport' ? AIRPORT_CANDIDATE_LIMIT : TRAIN_CANDIDATE_LIMIT;
  const candidates: HubResult[] = [];
  const origin = { latitude, longitude };

  for (const radiusMeters of SEARCH_RADII) {
    for (const keyword of query.keywords) {
      const pois = await fetchAroundPois({
        key,
        latitude,
        longitude,
        keyword,
        radiusMeters,
        offset: candidateLimit,
      });
      pois.forEach((poi) => {
        const mapped = mapPoiToHub({
          poi,
          kind,
          kindLabel: query.label,
          origin,
          highSpeedQueryHit: kind === 'highspeed' && keyword.includes('高铁'),
        });
        if (mapped) {
          candidates.push(mapped);
        }
      });
    }
    const dedupedSize = dedupeHubs(candidates).length;
    if (((kind === 'train' || kind === 'highspeed') && dedupedSize >= 12) || (kind === 'airport' && dedupedSize >= 8)) {
      break;
    }
  }

  if (cityName?.trim()) {
    for (const keyword of query.keywords) {
      const textPois = await fetchTextPois({
        key,
        cityName,
        keyword,
        offset: candidateLimit,
      });
      textPois.forEach((poi) => {
        const mapped = mapPoiToHub({
          poi,
          kind,
          kindLabel: query.label,
          origin,
          highSpeedQueryHit: kind === 'highspeed' && keyword.includes('高铁'),
        });
        if (mapped) {
          candidates.push(mapped);
        }
      });
    }
  }

  return dedupeHubs(candidates);
};

const pickBestTrainHub = (
  candidates: HubResult[],
  cityName?: string,
  options?: { highSpeedOnly?: boolean },
): HubResult | null => {
  if (!candidates.length) {
    return null;
  }

  const cityToken = normalizeCityToken(cityName);
  let working = [...candidates];
  const nonCounty = working.filter((item) => !isCountyLevelName(item.name));
  if (nonCounty.length >= 3) {
    working = nonCounty;
  }
  if (cityToken) {
    const cityNamed = working.filter((item) => normalizeStationName(item.name).includes(cityToken));
    if (cityNamed.length >= 2) {
      const notCityNamed = working.filter((item) => !normalizeStationName(item.name).includes(cityToken));
      working = [...cityNamed, ...notCityNamed];
    }
  }

  const rankedSource = working
    .map((item) => {
      const trainProfile = buildTrainStationProfile(item.name, cityName);
      return { ...item, trainProfile };
    });

  const filteredSource = options?.highSpeedOnly
    ? rankedSource.filter((item) => item.trainProfile?.hasHighSpeedSignal && item.highSpeedQueryHit)
    : rankedSource;

  if (!filteredSource.length) {
    return null;
  }

  const ranked = filteredSource
    .sort((a, b) => {
      const profileA = a.trainProfile;
      const profileB = b.trainProfile;
      if (profileB.compositeScore !== profileA.compositeScore) {
        return profileB.compositeScore - profileA.compositeScore;
      }
      if (profileB.lineCountEstimate !== profileA.lineCountEstimate) {
        return profileB.lineCountEstimate - profileA.lineCountEstimate;
      }
      const distA = a.distanceMeters ?? Number.MAX_SAFE_INTEGER;
      const distB = b.distanceMeters ?? Number.MAX_SAFE_INTEGER;
      return distA - distB;
    });

  const topCandidates: HubCandidate[] = ranked.slice(0, 3).map((item) => ({
    name: item.name,
    address: item.address,
    distanceMeters: item.distanceMeters,
    score: item.trainProfile?.compositeScore ?? 0,
    reasonTags: item.trainProfile?.reasonTags ?? [],
  }));
  const primary = ranked[0];
  if (!primary) {
    return null;
  }
  return {
    ...primary,
    topCandidates,
  };
};

const pickBestAirportHub = (candidates: HubResult[], cityName?: string): HubResult | null => {
  if (!candidates.length) {
    return null;
  }

  const grouped = new Map<string, HubResult[]>();
  candidates.forEach((item) => {
    const key = canonicalAirportName(item.name);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  });

  let working = Array.from(grouped.values()).map((items) => {
    return [...items].sort((a, b) => {
      const distA = a.distanceMeters ?? Number.MAX_SAFE_INTEGER;
      const distB = b.distanceMeters ?? Number.MAX_SAFE_INTEGER;
      return distA - distB;
    })[0];
  });

  const ranked = working
    .map((item) => {
      const profile = buildAirportScore(item.name, cityName, item.distanceMeters);
      return {
        item,
        score: profile.score,
        reasonTags: profile.reasonTags,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const distA = a.item.distanceMeters ?? Number.MAX_SAFE_INTEGER;
      const distB = b.item.distanceMeters ?? Number.MAX_SAFE_INTEGER;
      return distA - distB;
    });

  const topCandidates: HubCandidate[] = ranked.slice(0, 3).map((row) => ({
    name: row.item.name,
    address: row.item.address,
    distanceMeters: row.item.distanceMeters,
    score: row.score,
    reasonTags: row.reasonTags,
  }));

  const primary = ranked[0]?.item;
  if (!primary) {
    return null;
  }

  return {
    ...primary,
    topCandidates,
  };
};

export async function fetchNearestHubByKind(params: {
  key: string;
  latitude: number;
  longitude: number;
  kind: HubKind;
  cityName?: string;
}): Promise<HubResult | null> {
  const { key, latitude, longitude, kind, cityName } = params;
  const query = HUB_QUERY[kind];

  if (kind === 'train') {
    const candidates = await collectScoredKindCandidates({ key, latitude, longitude, kind: 'train', cityName });
    return pickBestTrainHub(candidates, cityName);
  }
  if (kind === 'highspeed') {
    const candidates = await collectScoredKindCandidates({ key, latitude, longitude, kind: 'highspeed', cityName });
    return pickBestTrainHub(candidates, cityName, { highSpeedOnly: true });
  }
  if (kind === 'airport') {
    const candidates = await collectScoredKindCandidates({ key, latitude, longitude, kind: 'airport', cityName });
    return pickBestAirportHub(candidates, cityName);
  }

  for (const radiusMeters of SEARCH_RADII) {
    for (const keyword of query.keywords) {
      const pois = await fetchAroundPois({
        key,
        latitude,
        longitude,
        keyword,
        radiusMeters,
        offset: 1,
      });
      const first = mapPoiToHub({
        poi: pois[0],
        kind,
        kindLabel: query.label,
        origin: { latitude, longitude },
      });
      if (first) {
        return first;
      }
    }
  }

  return null;
}

export async function fetchNearestHubs(params: {
  key: string;
  latitude: number;
  longitude: number;
  cityName?: string;
}): Promise<HubResult[]> {
  const { key, latitude, longitude, cityName } = params;
  const list: Array<HubResult | null> = [];
  for (const kind of Object.keys(HUB_QUERY) as HubKind[]) {
    const result = await fetchNearestHubByKind({ key, latitude, longitude, kind, cityName });
    list.push(result);
  }

  return list.filter((item): item is HubResult => Boolean(item));
}
